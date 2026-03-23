import { findTrigramCandidates } from "./trigram";

/** Sanitize query for FTS5 MATCH: remove operators and special chars. */
export function sanitizeFts5Query(query: string): string {
  return query
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, "")
    .replace(/[*^()"{}[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** RRF rank fusion (k=60) + log engagement boost + quality boost. */
export function computeRrfScore(
  ranks: number[],
  engagement: number,
  qualityScore?: number | null,
): number {
  const k = 60;
  const rrfSum = ranks.reduce((sum, rank) => sum + 1 / (k + rank), 0);
  const engagementBoost = Math.log(1 + engagement) * 0.01;
  const qualityBoost = (qualityScore ?? 0) * 0.02;
  return rrfSum + engagementBoost + qualityBoost;
}

export function computeEngagement(article: {
  seen_at: string | null;
  read_at: string | null;
  bookmarked_at: string | null;
  liked_at: string | null;
}): number {
  return (
    (article.seen_at ? 1 : 0) +
    (article.read_at ? 2 : 0) +
    (article.bookmarked_at ? 3 : 0) +
    (article.liked_at ? 3 : 0)
  );
}

/** Extract embedding data from AI response (union type workaround). */
export function extractEmbedding(aiResult: unknown): number[] {
  const data = (aiResult as { data: number[][] }).data[0];
  if (!data) throw new Error("AI embedding response missing data[0]");
  return data;
}

export type SearchResultArticle = {
  id: number;
  title: string;
  url: string;
  excerpt: string | null;
  feed_id: number;
  published_at: string | null;
  seen_at: string | null;
  bookmarked_at: string | null;
  liked_at: string | null;
  quality_score: number | null;
  rank: number;
};

export type SearchResult = {
  articles: SearchResultArticle[];
  total: number;
  corrections: string[];
};

type SearchEnv = {
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
};

/**
 * Hybrid search: FTS5 + Vectorize (bge-m3) + RRF merge.
 * Shared by the Hono route and MCP tool.
 */
export async function hybridSearch(
  env: SearchEnv,
  rawQuery: string,
  limit: number,
  offset: number,
): Promise<SearchResult> {
  const db = env.DB;
  const sanitized = sanitizeFts5Query(rawQuery);

  if (!sanitized) {
    return { articles: [], total: 0, corrections: [] };
  }

  let matchQuery = sanitized;
  const corrections: string[] = [];

  const exactMatch = await db
    .prepare("SELECT term FROM term_dictionary WHERE term = ?")
    .bind(sanitized)
    .first<{ term: string }>();

  if (!exactMatch) {
    const candidates = await findTrigramCandidates(db, sanitized, 3);
    if (candidates.length > 0) {
      corrections.push(...candidates);
      matchQuery = [sanitized, ...candidates].join(" OR ");
    }
  }

  // Generate embedding (best-effort; falls back to FTS5-only)
  let queryEmbedding: number[] | null = null;
  try {
    const er = await env.AI.run("@cf/baai/bge-m3", { text: [sanitized] });
    queryEmbedding = extractEmbedding(er);
  } catch {
    // AI unavailable — FTS5-only mode
  }

  // Run FTS5 + Vectorize in parallel
  type FtsIdRow = { id: number };
  const ftsPromise = db
    .prepare(
      `SELECT a.id
       FROM articles_fts fts
       JOIN active_articles a ON a.id = fts.rowid
       WHERE articles_fts MATCH ?
       ORDER BY rank
       LIMIT 100`,
    )
    .bind(matchQuery)
    .all<FtsIdRow>()
    .then((r) => r.results)
    .catch(() => [] as FtsIdRow[]);

  const vecPromise = queryEmbedding
    ? env.VECTORIZE.query(queryEmbedding, { topK: 100 })
        .then((r) => r.matches ?? [])
        .catch(() => [] as Array<{ id: string; score: number }>)
    : Promise.resolve([] as Array<{ id: string; score: number }>);

  const [ftsRows, vecMatches] = await Promise.all([ftsPromise, vecPromise]);

  const ftsRankById = new Map<number, number>();
  ftsRows.forEach((row, i) => ftsRankById.set(row.id, i + 1));

  const vecRankById = new Map<number, number>();
  vecMatches.forEach((m, i) => vecRankById.set(Number(m.id), i + 1));

  const idSet = new Set<number>();
  for (const row of ftsRows) idSet.add(row.id);
  for (const m of vecMatches) idSet.add(Number(m.id));

  const allIds = [...idSet];
  if (allIds.length === 0) {
    return { articles: [], total: 0, corrections };
  }

  type ActiveRow = {
    id: number;
    title: string;
    url: string;
    excerpt: string | null;
    feed_id: number;
    published_at: string | null;
    seen_at: string | null;
    read_at: string | null;
    bookmarked_at: string | null;
    liked_at: string | null;
    quality_score: number | null;
  };

  // D1 limits bind parameters to 100 per statement; batch if needed
  const BATCH_SIZE = 100;
  const allRows: ActiveRow[] = [];
  for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
    const batch = allIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "?").join(",");
    const batchResult = await db
      .prepare(
        `SELECT id, title, url, excerpt, feed_id, published_at,
                seen_at, read_at, bookmarked_at, liked_at, quality_score
         FROM active_articles WHERE id IN (${placeholders})`,
      )
      .bind(...batch)
      .all<ActiveRow>();
    allRows.push(...batchResult.results);
  }

  const rowById = new Map(allRows.map((r) => [r.id, r]));

  const scored: Array<{ id: number; rrf: number; row: ActiveRow }> = [];
  for (const id of allIds) {
    const row = rowById.get(id);
    if (!row) continue;
    const ranks: number[] = [];
    const fr = ftsRankById.get(id);
    const vr = vecRankById.get(id);
    if (fr != null) ranks.push(fr);
    if (vr != null) ranks.push(vr);
    const engagement = computeEngagement(row);
    const rrf = computeRrfScore(ranks, engagement, row.quality_score);
    scored.push({ id, rrf, row });
  }

  scored.sort((a, b) => b.rrf - a.rrf || a.id - b.id);

  const total = scored.length;
  const page = scored.slice(offset, offset + limit);
  const articles = page.map(({ rrf, row }) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    excerpt: row.excerpt,
    feed_id: row.feed_id,
    published_at: row.published_at,
    seen_at: row.seen_at,
    bookmarked_at: row.bookmarked_at,
    liked_at: row.liked_at,
    quality_score: row.quality_score,
    rank: rrf,
  }));

  return { articles, total, corrections };
}
