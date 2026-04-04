/**
 * Adaptive feed scheduling — ported from fork's schedule.ts (unchanged).
 * Pure functions, no Node.js dependencies.
 */

export const MIN_INTERVAL = 15 * 60; // 15 minutes (seconds)
export const MAX_INTERVAL = 4 * 60 * 60; // 4 hours (seconds)
export const DEFAULT_INTERVAL = 60 * 60; // 1 hour (seconds)

export function formatDateSqlite(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function sqliteFuture(seconds: number): string {
  return formatDateSqlite(new Date(Date.now() + seconds * 1000));
}

export function parseHttpCacheInterval(headers: Headers): number | null {
  let maxAgeSec = 0;
  const cc = headers.get("cache-control");
  const match = cc?.match(/max-age=(\d+)/);
  if (match?.[1]) maxAgeSec = parseInt(match[1], 10);

  let expiresSec = 0;
  const expires = headers.get("expires");
  if (expires) {
    const expiresMs = new Date(expires).getTime() - Date.now();
    if (expiresMs > 0) expiresSec = Math.floor(expiresMs / 1000);
  }

  const result = Math.max(maxAgeSec, expiresSec);
  return result > 0 ? result : null;
}

export function parseRssTtl(xml: string): number | null {
  const match = xml.match(/<ttl>\s*(\d+)\s*<\/ttl>/i);
  const ttlStr = match?.[1];
  if (!ttlStr) return null;
  const minutes = parseInt(ttlStr, 10);
  return minutes > 0 ? minutes * 60 : null;
}

export interface RssItem {
  title: string;
  url: string;
  published_at: string | null;
  excerpt?: string;
}

export function computeEmpiricalInterval(items: RssItem[]): number {
  const now = Date.now();
  const dates = items
    .map((i) => (i.published_at ? new Date(i.published_at).getTime() : null))
    .filter((d): d is number => d !== null && !isNaN(d))
    .sort((a, b) => b - a);

  if (dates.length === 0) return MAX_INTERVAL;

  // dates is guaranteed non-empty (early return above)
  const daysSinceLatest = (now - dates[0]!) / (24 * 60 * 60 * 1000);
  if (daysSinceLatest >= 30) return MAX_INTERVAL;
  if (daysSinceLatest >= 14) return MAX_INTERVAL / 2;
  if (daysSinceLatest >= 7) return MAX_INTERVAL / 4;

  if (dates.length >= 2) {
    const totalSpan = dates[0]! - dates[dates.length - 1]!;
    const avgIntervalMs = totalSpan / (dates.length - 1);
    const halfAvgSec = Math.floor(avgIntervalMs / 2000);
    return Math.max(MIN_INTERVAL, halfAvgSec);
  }

  return MAX_INTERVAL / 4;
}

export function computeInterval(
  httpCacheSeconds: number | null,
  rssTtlSeconds: number | null,
  empiricalSeconds: number,
): number {
  return Math.min(
    MAX_INTERVAL,
    Math.max(MIN_INTERVAL, Math.max(httpCacheSeconds ?? 0, rssTtlSeconds ?? 0, empiricalSeconds)),
  );
}
