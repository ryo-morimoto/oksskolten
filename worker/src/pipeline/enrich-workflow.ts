import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from "cloudflare:workers";
import { getContainer } from "@cloudflare/containers";
import { tokenizeText } from "../container/kuromoji";
import { decomposeTrigrams } from "../lib/trigram";
import { computeQualityScore } from "../lib/quality";
import type { Env } from "../index";

export interface EnrichParams {}

/**
 * Enriches articles that have full_text but lack derived data (tokens, quality, trigrams).
 * Runs as a single instance per cron to serialize Container access.
 */
export class EnrichWorkflow extends WorkflowEntrypoint<Env, EnrichParams> {
  async run(_event: WorkflowEvent<EnrichParams>, step: WorkflowStep) {
    // Step 0: re-extract — retry content extraction for articles still missing full_text
    await step.do(
      "re_extract",
      {
        retries: { limit: 1, delay: "5 second", backoff: "exponential" },
        timeout: "2 minutes",
      },
      async () => {
        const rows = await this.env.DB.prepare(
          `SELECT id, url, excerpt FROM articles
           WHERE full_text IS NULL AND url LIKE 'http%'
           ORDER BY id ASC LIMIT 20`,
        ).all<{ id: number; url: string; excerpt: string | null }>();

        let extracted = 0;
        for (const row of rows.results) {
          try {
            const res = await fetch(row.url, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; Oksskolten/1.0)" },
              signal: AbortSignal.timeout(5_000),
            });
            if (!res.ok) continue;
            const html = await res.text();
            const { extractContent } = await import("./extract-content");
            const content = await extractContent(html, row.url, {
              fallbackContent: row.excerpt ?? undefined,
            });
            if (content.fullText) {
              await this.env.DB.prepare(
                `UPDATE articles SET full_text = ?, og_image = ?,
                        excerpt = COALESCE(?, excerpt), title = COALESCE(?, title)
                 WHERE id = ?`,
              )
                .bind(content.fullText, content.ogImage, content.excerpt, content.title, row.id)
                .run();
              extracted++;
            }
          } catch {
            // best-effort — skip and retry on next cron
          }
        }
        return { attempted: rows.results.length, extracted };
      },
    );

    // Step 1: query pending articles (全フィード横断、古い順、50件で打ち切り)
    const articles = await step.do("query_pending", async () => {
      const result = await this.env.DB.prepare(
        `SELECT id, title, full_text FROM articles
         WHERE title_tokens IS NULL AND full_text IS NOT NULL
         ORDER BY id ASC LIMIT 50`,
      ).all<{ id: number; title: string; full_text: string }>();
      return result.results.map((a) => ({
        id: a.id,
        title: a.title,
        fullText: a.full_text.slice(0, 10_000),
      }));
    });

    if (articles.length === 0) return;

    // Step 2: warm up the Container to absorb cold-start latency
    await step.do(
      "warmup_container",
      { timeout: "2 minutes", retries: { limit: 2, delay: "10 second", backoff: "exponential" } },
      async () => {
        const container = getContainer(this.env.KUROMOJI_CONTAINER);
        await tokenizeText(container, "ping");
        return { ready: true };
      },
    );

    // Step 3: tokenize — 1 article per step (Container DO deadlock avoidance)
    let consecutiveFailures = 0;
    for (const article of articles) {
      try {
        await step.do(
          `tokenize_${article.id}`,
          {
            retries: { limit: 2, delay: "10 second", backoff: "exponential" },
            timeout: "2 minutes",
          },
          async () => {
            const container = getContainer(this.env.KUROMOJI_CONTAINER);
            const titleData = await tokenizeText(container, article.title);
            const fullTextData = await tokenizeText(container, article.fullText);

            await this.env.DB.prepare(
              `UPDATE articles SET title_tokens = ?, full_text_tokens = ?
               WHERE id = ? AND title_tokens IS NULL`,
            )
              .bind(titleData.tokens, fullTextData.tokens, article.id)
              .run();

            return { articleId: article.id };
          },
        );
        consecutiveFailures = 0;
      } catch {
        consecutiveFailures++;
        if (consecutiveFailures >= 5) break; // Container likely down — let next cron retry
      }
    }

    // Step 3: compute_quality — batch all articles that were just tokenized (or missed previously)
    await step.do("compute_quality", { timeout: "30 seconds" }, async () => {
      const rows = await this.env.DB.prepare(
        `SELECT id, full_text, full_text_tokens FROM articles
         WHERE quality_score IS NULL AND full_text IS NOT NULL
         ORDER BY id ASC LIMIT 100`,
      ).all<{ id: number; full_text: string; full_text_tokens: string | null }>();

      for (const row of rows.results) {
        const tokenCount = row.full_text_tokens
          ? row.full_text_tokens.split(/\s+/).length
          : undefined;
        const score = computeQualityScore({ markdown: row.full_text, tokenCount });
        await this.env.DB.prepare(
          "UPDATE articles SET quality_score = ? WHERE id = ? AND quality_score IS NULL",
        )
          .bind(score, row.id)
          .run();
      }
      return { scoredCount: rows.results.length };
    });

    // Step 4: build_trigram — batch all tokenized articles without trigrams
    await step.do(
      "build_trigram",
      {
        retries: { limit: 2, delay: "5 second", backoff: "exponential" },
        timeout: "2 minutes",
      },
      async () => {
        const rows = await this.env.DB.prepare(
          `SELECT id, title_tokens, full_text_tokens FROM articles
           WHERE title_tokens IS NOT NULL AND trigrams_at IS NULL
           ORDER BY id ASC LIMIT 100`,
        ).all<{
          id: number;
          title_tokens: string;
          full_text_tokens: string | null;
        }>();

        if (rows.results.length === 0) return { termsAdded: 0 };

        // Extract unique terms (2+ chars) from tokens
        const termSet = new Set<string>();
        for (const article of rows.results) {
          const allTokens = [article.title_tokens, article.full_text_tokens ?? ""].join(" ");
          for (const token of allTokens.split(/\s+/)) {
            if (token.length >= 2) termSet.add(token);
          }
        }

        if (termSet.size === 0) {
          await this.env.DB.batch(
            rows.results.map((a) =>
              this.env.DB.prepare(
                "UPDATE articles SET trigrams_at = datetime('now') WHERE id = ?",
              ).bind(a.id),
            ),
          );
          return { termsAdded: 0 };
        }

        // Batch upsert terms into dictionary
        const terms = [...termSet];
        const batchSize = 50;
        for (let i = 0; i < terms.length; i += batchSize) {
          const chunk = terms.slice(i, i + batchSize);
          await this.env.DB.batch(
            chunk.map((term) =>
              this.env.DB.prepare(
                `INSERT INTO term_dictionary (term) VALUES (?)
                 ON CONFLICT(term) DO UPDATE SET frequency = frequency + 1`,
              ).bind(term),
            ),
          );
        }

        // Build trigrams for new terms
        for (let i = 0; i < terms.length; i += batchSize) {
          const chunk = terms.slice(i, i + batchSize);
          const placeholders = chunk.map(() => "?").join(",");
          const termRows = await this.env.DB.prepare(
            `SELECT id, term FROM term_dictionary WHERE term IN (${placeholders})`,
          )
            .bind(...chunk)
            .all<{ id: number; term: string }>();

          const trigramInserts: D1PreparedStatement[] = [];
          for (const row of termRows.results) {
            const trigrams = decomposeTrigrams(row.term);
            for (const tri of trigrams) {
              trigramInserts.push(
                this.env.DB.prepare(
                  `INSERT OR IGNORE INTO term_trigrams (trigram, term_id) VALUES (?, ?)`,
                ).bind(tri, row.id),
              );
            }
          }

          if (trigramInserts.length > 0) {
            for (let j = 0; j < trigramInserts.length; j += 100) {
              await this.env.DB.batch(trigramInserts.slice(j, j + 100));
            }
          }
        }

        // Mark articles as processed
        await this.env.DB.batch(
          rows.results.map((a) =>
            this.env.DB.prepare(
              "UPDATE articles SET trigrams_at = datetime('now') WHERE id = ?",
            ).bind(a.id),
          ),
        );

        return { termsAdded: terms.length };
      },
    );
  }
}
