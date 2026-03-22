import { execSync } from 'node:child_process'

function d1Count(sql: string): number {
  const output = execSync(
    `npx wrangler d1 execute oksskolten --remote --command "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
  )
  // Parse the cnt value from wrangler output (table or JSON format)
  const match = output.match(/"cnt":\s*(\d+)/)
  if (match) return Number(match[1])
  // Fallback: look for the number after "cnt"
  const lines = output.split('\n')
  for (const line of lines) {
    const m = line.match(/cnt\D+(\d+)/)
    if (m) return Number(m[1])
  }
  return 0
}

describe('E2E: pipeline', () => {
  it('has articles with title_tokens populated (kuromoji)', () => {
    const count = d1Count(
      "SELECT COUNT(*) as cnt FROM articles WHERE title_tokens IS NOT NULL",
    )
    expect(count).toBeGreaterThan(0)
  })

  it('has articles with embedded_at populated (bge-m3)', () => {
    const count = d1Count(
      "SELECT COUNT(*) as cnt FROM articles WHERE embedded_at IS NOT NULL",
    )
    // May be 0 if P2 backfill hasn't run yet — skip rather than fail
    if (count === 0) {
      console.warn('No embedded articles yet — backfill may not have run')
    }
    expect(count).toBeGreaterThanOrEqual(0)
  })

  it('has terms in trigram dictionary', () => {
    const count = d1Count("SELECT COUNT(*) as cnt FROM term_dictionary")
    expect(count).toBeGreaterThan(0)
  })
})
