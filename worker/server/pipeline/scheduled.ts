import type { Env } from "../index";
import type { IngestParams } from "./ingest-workflow";

/**
 * Cron Trigger handler: start Ingest workflows for due feeds
 * and a single Enrich workflow for pending tokenization.
 */

export async function startIngestWorkflows(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT id, name, rss_url, etag, last_modified, last_content_hash,
            check_interval, requires_js_challenge
     FROM feeds
     WHERE disabled = 0
       AND type = 'rss'
       AND rss_url IS NOT NULL
       AND error_count < 10
       AND (next_check_at IS NULL OR next_check_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
  ).all<{
    id: number;
    name: string;
    rss_url: string;
    etag: string | null;
    last_modified: string | null;
    last_content_hash: string | null;
    check_interval: number | null;
    requires_js_challenge: number;
  }>();

  const feeds = result.results;
  if (feeds.length === 0) return 0;

  // Use hour-level timestamp for deterministic IDs (prevents duplicate within same cron window)
  const cronTimestamp = new Date().toISOString().slice(0, 13); // "2026-03-22T16"

  let started = 0;
  for (const feed of feeds) {
    const instanceId = `feed-${feed.id}-${cronTimestamp}`;
    const params: IngestParams = {
      feedId: feed.id,
      feedName: feed.name,
      rssUrl: feed.rss_url,
      etag: feed.etag,
      lastModified: feed.last_modified,
      lastContentHash: feed.last_content_hash,
      checkInterval: feed.check_interval,
    };

    try {
      await env.INGEST_WORKFLOW.create({ id: instanceId, params });
      started++;
    } catch (err) {
      // Likely already running (duplicate ID) — skip silently
      if (err instanceof Error && err.message.includes("already exists")) {
        continue;
      }
      // eslint-disable-next-line no-console -- TODO: replace with typed Logger (B4)
      console.error(`Failed to start ingest workflow for feed ${feed.name} (${feed.id}):`, err);
    }
  }

  return started;
}

export async function startEnrichWorkflow(env: Env): Promise<boolean> {
  const cronTimestamp = new Date().toISOString().slice(0, 13);
  const instanceId = `enrich-${cronTimestamp}`;
  try {
    await env.ENRICH_WORKFLOW.create({ id: instanceId, params: {} });
    return true;
  } catch (err) {
    if (err instanceof Error && err.message.includes("already exists")) {
      return false;
    }
    // eslint-disable-next-line no-console -- TODO: replace with typed Logger (B4)
    console.error("Failed to start enrich workflow:", err);
    return false;
  }
}
