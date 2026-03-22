/**
 * Trigram decomposition and fuzzy-match candidate lookup.
 * Used by both the pipeline (build_trigram step) and search routes.
 */

/**
 * Decompose a term into character trigrams.
 * e.g. "東京都" → ["東京都"] (length 3 is itself a trigram)
 * e.g. "プログラミング" → ["プログ", "ログラ", "グラミ", "ラミン", "ミング"]
 */
export function decomposeTrigrams(term: string): string[] {
  const chars = [...term.normalize('NFC')] // handle multi-byte chars, normalize NFD→NFC
  if (chars.length < 3) return [term]
  const trigrams: string[] = []
  for (let i = 0; i <= chars.length - 3; i++) {
    trigrams.push(chars.slice(i, i + 3).join(''))
  }
  return trigrams
}

/**
 * Find correction candidates from trigram dictionary.
 * Returns terms ranked by trigram overlap with the query.
 */
export async function findTrigramCandidates(
  db: D1Database,
  query: string,
  limit = 3,
): Promise<string[]> {
  const trigrams = decomposeTrigrams(query)
  if (trigrams.length === 0) return []

  const placeholders = trigrams.map(() => '?').join(',')
  const result = await db
    .prepare(
      `SELECT td.term, COUNT(*) as match_count
       FROM term_trigrams tt
       JOIN term_dictionary td ON td.id = tt.term_id
       WHERE tt.trigram IN (${placeholders})
       GROUP BY tt.term_id
       ORDER BY match_count DESC, td.frequency DESC
       LIMIT ?`,
    )
    .bind(...trigrams, limit)
    .all<{ term: string; match_count: number }>()

  return result.results.map((r) => r.term)
}
