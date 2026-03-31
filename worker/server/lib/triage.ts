export interface FeedInterest {
  feedId: number;
  feedName: string;
  interest: number;
  engagementCount: number;
  articleCount: number;
}

export interface RecommendedArticle {
  id: number;
  title: string;
  url: string;
  excerpt: string | null;
  og_image: string | null;
  feed_id: number;
  feed_name: string;
  quality_score: number | null;
  recommendation_score: number;
  published_at: string | null;
  seen_at: string | null;
  bookmarked_at: string | null;
  liked_at: string | null;
}

export interface RecommendOptions {
  limit: number;
  offset: number;
  feed_id?: number | undefined;
  category_id?: number | undefined;
  min_quality?: number | undefined;
  unread_only?: boolean | undefined;
  after?: string | undefined;
  before?: string | undefined;
  timezone?: string | undefined;
}

/** Normalize a datetime string to UTC ISO format using the given timezone. */
function toUtc(datetime: string, timezone?: string): string {
  // Already has timezone offset or Z — parse directly
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(datetime)) {
    return new Date(datetime).toISOString();
  }
  // Date-only (e.g. "2026-04-02") or naive datetime — interpret in the given timezone
  if (timezone) {
    // Append T00:00:00 if date-only
    const naive = datetime.includes("T") ? datetime : `${datetime}T00:00:00`;
    // Format in the target timezone to find the UTC offset
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset",
    });
    // Parse the naive datetime as if it were in UTC, then adjust
    const asUtc = new Date(naive + "Z");
    const parts = formatter.formatToParts(asUtc);
    const offsetStr = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // offsetStr is like "GMT+9" or "GMT-5:30"
    const match = offsetStr.match(/GMT([+-]?\d+)(?::(\d+))?/);
    if (match) {
      const hours = parseInt(match[1]!, 10);
      const mins = parseInt(match[2] ?? "0", 10);
      const offsetMs = (hours * 60 + (hours < 0 ? -mins : mins)) * 60_000;
      return new Date(new Date(naive + "Z").getTime() - offsetMs).toISOString();
    }
  }
  // Fallback: treat as UTC
  return new Date(datetime).toISOString();
}

/** Compute per-feed interest from engagement aggregates. */
export async function computeFeedInterests(db: D1Database): Promise<FeedInterest[]> {
  const result = await db
    .prepare(
      `SELECT f.id AS feed_id, f.name AS feed_name,
              COUNT(*) AS article_count,
              SUM(
                CASE WHEN a.liked_at IS NOT NULL THEN 3 ELSE 0 END +
                CASE WHEN a.bookmarked_at IS NOT NULL THEN 3 ELSE 0 END +
                CASE WHEN a.read_at IS NOT NULL THEN 2 ELSE 0 END +
                CASE WHEN a.seen_at IS NOT NULL THEN 1 ELSE 0 END
              ) AS engagement_sum
       FROM feeds f
       JOIN active_articles a ON a.feed_id = f.id
       GROUP BY f.id
       ORDER BY engagement_sum DESC`,
    )
    .all<{ feed_id: number; feed_name: string; article_count: number; engagement_sum: number }>();

  const MAX_ENGAGEMENT_PER_ARTICLE = 9;

  return result.results.map((row) => {
    const raw = row.engagement_sum / (row.article_count * MAX_ENGAGEMENT_PER_ARTICLE);
    return {
      feedId: row.feed_id,
      feedName: row.feed_name,
      interest: Math.max(raw, 0.1), // floor: new feeds don't get fully suppressed
      engagementCount: row.engagement_sum,
      articleCount: row.article_count,
    };
  });
}

type ArticleRow = {
  id: number;
  title: string;
  url: string;
  excerpt: string | null;
  og_image: string | null;
  feed_id: number;
  feed_name: string;
  quality_score: number | null;
  published_at: string | null;
  fetched_at: string;
  seen_at: string | null;
  bookmarked_at: string | null;
  liked_at: string | null;
};

function computeRecencyDecay(publishedAt: string | null, fetchedAt: string): number {
  const ref = publishedAt || fetchedAt;
  const ageDays = (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24);
  return 1 / (1 + Math.max(ageDays, 0) * 0.1);
}

/** Get recommended articles ranked by quality × feed interest × recency. */
export async function getRecommendedArticles(
  db: D1Database,
  options: RecommendOptions,
): Promise<{ articles: RecommendedArticle[]; total: number }> {
  const limit = options.limit ?? 10;
  const offset = options.offset ?? 0;

  // 1. Get feed interests
  const feedInterests = await computeFeedInterests(db);
  const interestMap = new Map(feedInterests.map((f) => [f.feedId, f.interest]));

  // 2. Build query
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (options.unread_only !== false) {
    conditions.push("a.seen_at IS NULL");
  }
  if (options.feed_id != null) {
    conditions.push("a.feed_id = ?");
    binds.push(options.feed_id);
  }
  if (options.category_id != null) {
    conditions.push("a.category_id = ?");
    binds.push(options.category_id);
  }
  if (options.min_quality != null) {
    conditions.push("a.quality_score >= ?");
    binds.push(options.min_quality);
  }
  if (options.after != null) {
    conditions.push("COALESCE(a.published_at, a.fetched_at) >= ?");
    binds.push(toUtc(options.after, options.timezone));
  }
  if (options.before != null) {
    conditions.push("COALESCE(a.published_at, a.fetched_at) <= ?");
    binds.push(toUtc(options.before, options.timezone));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await db
    .prepare(
      `SELECT a.id, a.title, a.url, a.excerpt, a.og_image, a.feed_id, f.name AS feed_name,
              a.quality_score, a.published_at, a.fetched_at,
              a.seen_at, a.bookmarked_at, a.liked_at
       FROM active_articles a
       LEFT JOIN feeds f ON a.feed_id = f.id
       ${where}
       ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
       LIMIT 200`,
    )
    .bind(...binds)
    .all<ArticleRow>();

  // 3. Score and rank
  const scored = rows.results.map((row) => {
    // Unscored articles (EnrichWorkflow pending) get 0.3 — lower than
    // the typical scored range (0.4–0.8) so scored articles rank higher.
    const quality = row.quality_score ?? 0.3;
    const feedInterest = interestMap.get(row.feed_id) ?? 0.1;
    const recency = computeRecencyDecay(row.published_at, row.fetched_at);
    const recScore = quality * feedInterest * recency;

    return {
      id: row.id,
      title: row.title,
      url: row.url,
      excerpt: row.excerpt,
      og_image: row.og_image,
      feed_id: row.feed_id,
      feed_name: row.feed_name,
      quality_score: row.quality_score,
      recommendation_score: recScore,
      published_at: row.published_at,
      seen_at: row.seen_at,
      bookmarked_at: row.bookmarked_at,
      liked_at: row.liked_at,
    };
  });

  scored.sort((a, b) => b.recommendation_score - a.recommendation_score);

  const total = scored.length;
  const page = scored.slice(offset, offset + limit);

  return { articles: page, total };
}
