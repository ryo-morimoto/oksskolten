# Oksskolten Spec — Score Recalculation Optimization

## Background

Oksskolten's engagement score is computed as the product of an engagement value (based on user actions: like/bookmark/read/translate) and a time decay factor.

```
score = engagement × decay

engagement = (liked_at ? 10 : 0)
           + (bookmarked_at ? 5 : 0)
           + (full_text_translated ? 3 : 0)
           + (read_at ? 2 : 0)

decay = 1.0 / (1.0 + days_since_activity × 0.05)
  where days_since_activity = julianday('now') - julianday(COALESCE(read_at, published_at, fetched_at))
```

Score updates currently happen through two paths:

1. **Event-driven (already implemented)**: `updateScoreDb(id)` is called immediately on like/bookmark/read/translate/unseen actions
2. **Cron batch (every 5 minutes)**: `recalculateScores()` UPDATEs all articles that have any engagement

Since event-driven updates already handle engagement changes instantly, the cron batch's only remaining role is **periodic time-decay refresh**. Running every 5 minutes is excessive, and CPU cost scales linearly with article count.

## Current Problem

`recalculateScores()` in `server/db/articles.ts`:

```sql
UPDATE articles SET score = (score expression)
WHERE liked_at IS NOT NULL
   OR bookmarked_at IS NOT NULL
   OR read_at IS NOT NULL
   OR full_text_translated IS NOT NULL
   OR score > 0
```

Issues:

- Articles with `score > 0` remain in the recalculation set permanently
- Recalculation runs every 5 minutes even when no engagement state has changed
- Event-driven updates already reflect engagement changes instantly; the cron's effective purpose is limited to time-decay refresh

## Existing Score Update Implementation

### Event-Driven (`server/db/articles.ts`)

| Function | Trigger | Action |
|---|---|---|
| `markArticleLiked()` | like/unlike | `updateScoreDb(id)` |
| `markArticleBookmarked()` | bookmark/unbookmark | `updateScoreDb(id)` |
| `recordArticleRead()` | opening an article | `updateScoreDb(id)` |
| `markArticleSeen()` | marking unseen | `updateScoreDb(id)` |
| Translation complete (`server/routes/articles.ts`) | translate API | `updateScore(id)` (DB + Meilisearch sync) |

### Where Scores Are Used

| Usage | Reference Method | Decay Freshness Important? |
|---|---|---|
| `GET /api/articles?sort=score` | Stored `score` column | Somewhat — affects sort order |
| `getArticlesByIds()` (search results) | Dynamically computed via `scoreExpr()` | No — computed each time |
| Meilisearch index | Synced `score` value | Low — primarily for filtering |
| AI chat tools | Via search results | No — dynamically computed |
| Smart Floor | Not used | No |

## Approach: Decouple Score Recalculation from Feed Fetch

Separate score recalculation into its own cron with a configurable schedule (`SCORE_RECALC_SCHEDULE`). Add Meilisearch sync after each recalculation. The default frequency stays at 5 minutes for safety; deployments confident in event-driven coverage can reduce to daily.

### Changes

1. `server/index.ts`: Remove the `recalculateScores()` call from the feed-fetch cron (`CRON_SCHEDULE`)
2. `server/index.ts`: Add a separate cron job that runs `recalculateScores()` on a configurable schedule
3. After each recalculation, bulk-sync updated article scores to the Meilisearch index
4. Do not change the `recalculateScores()` WHERE clause (use existing logic as-is)

### Schedule

- Default: `*/5 * * * *` (every 5 minutes, same as the original frequency)
- Configurable via the `SCORE_RECALC_SCHEDULE` environment variable
- For deployments where event-driven updates cover all engagement actions, set to e.g. `0 3 * * *` (daily) to reduce CPU cost
- Document the default in `.env.example`

### Meilisearch Bulk Sync

After each recalculation, fetch articles matching the same WHERE clause as `recalculateScores()` and bulk-sync their scores to Meilisearch. `recalculateScores()` itself is not modified; a separate sync function is added.

```typescript
// Daily batch flow
const { updated } = recalculateScores()
if (updated > 0) {
  await syncAllScoredArticlesToSearch()
}
```

`syncAllScoredArticlesToSearch()` is added to `server/search/sync.ts`. It queries `id, score` using the shared `SCORED_ARTICLES_WHERE` constant (exported from `server/db/articles.ts`) and performs batched partial document updates in Meilisearch (batch size 1000, matching `rebuildSearchIndex()`). The function is async and awaits each Meilisearch call to ensure sync completion before logging success. It skips execution if an index rebuild is in progress (the rebuild will include fresh scores).

### Key Files

| File | Description |
|---|---|
| `server/index.ts` | Cron schedule: removed `recalculateScores()` from feed-fetch, added separate score recalculation cron |
| `server/search/sync.ts` | `syncAllScoredArticlesToSearch()` — batched Meilisearch score sync |
| `server/db/articles.ts` | `SCORED_ARTICLES_WHERE` constant shared between recalculation and sync |
| `.env.example` | `SCORE_RECALC_SCHEDULE` environment variable documentation |

### Logging

Follow existing log format at `info` level:

```
[cron] Scores recalculated: 142 articles
[cron] Score sync to search: 142 articles
```

### Testing

- Existing score persistence tests in `server/db/articles.test.ts` are preserved as-is
- Add unit tests for `syncAllScoredArticlesToSearch()` in `server/search/sync.ts`

### Scope

This spec is limited to:

- Removing `recalculateScores()` from the feed-fetch cron
- Adding a separate score recalculation cron
- Adding the Meilisearch bulk sync function

Out of scope:
- Refactoring event-driven score updates (`updateScoreDb()` / `updateScore()`)
- Changing the score formula
- Schema changes

### Error Handling

Follow existing cron error handling: try-catch with `log.error`. No retries (the next scheduled run will re-execute automatically). If `recalculateScores()` errors, skip the Meilisearch sync.

```typescript
try {
  const { updated } = recalculateScores()
  log.info(`[cron] Scores recalculated: ${updated} articles`)
  if (updated > 0) {
    const synced = await syncAllScoredArticlesToSearch()
    log.info(`[cron] Score sync to search: ${synced} articles`)
  }
} catch (err) {
  log.error('[cron] Score recalculation error:', err)
}
```

### Concurrency

No mutex is needed between the daily batch and the feed-fetch cron. SQLite's WAL mode serializes writes, so there is no data corruption risk. If the batch and an event-driven update overlap, whichever runs last wins — both use the same `scoreExpr()`, so the difference is negligible (only seconds of `julianday('now')` drift).

### Migration

No schema changes required. Deploy the code change only. After deployment, the feed-fetch cron no longer runs `recalculateScores()`, and the separate score recalculation cron takes over at the configured schedule.

## Expected Impact

- Score recalculation is decoupled from feed fetching, allowing independent schedule tuning
- Default frequency unchanged (5 minutes); can be reduced to daily via `SCORE_RECALC_SCHEDULE=0 3 * * *` for ~288x CPU reduction
- Meilisearch scores are synced after each recalculation (previously only during 6-hourly index rebuild)
- `SCORED_ARTICLES_WHERE` constant eliminates duplicated WHERE clause across files
