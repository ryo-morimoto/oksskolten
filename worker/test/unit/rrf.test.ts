import { computeEngagement, computeRrfScore } from '../../src/routes/search'

describe('computeRrfScore', () => {
  it('sums 1/(k+rank) for each ranker with k=60', () => {
    const k = 60
    const rrf = computeRrfScore([1, 1], 0)
    const expected = 2 * (1 / (k + 1))
    expect(rrf).toBeCloseTo(expected, 10)
  })

  it('applies engagement boost log(1+e)*0.01', () => {
    const base = computeRrfScore([5], 0)
    const withEng = computeRrfScore([5], 9)
    expect(withEng - base).toBeCloseTo(Math.log(10) * 0.01, 10)
  })
})

describe('computeEngagement', () => {
  it('weights seen, read, bookmark, like', () => {
    expect(
      computeEngagement({
        seen_at: null,
        read_at: null,
        bookmarked_at: null,
        liked_at: null,
      }),
    ).toBe(0)
    expect(
      computeEngagement({
        seen_at: 'x',
        read_at: null,
        bookmarked_at: null,
        liked_at: null,
      }),
    ).toBe(1)
    expect(
      computeEngagement({
        seen_at: null,
        read_at: 'x',
        bookmarked_at: null,
        liked_at: null,
      }),
    ).toBe(2)
    expect(
      computeEngagement({
        seen_at: null,
        read_at: null,
        bookmarked_at: 'x',
        liked_at: null,
      }),
    ).toBe(3)
    expect(
      computeEngagement({
        seen_at: null,
        read_at: null,
        bookmarked_at: null,
        liked_at: 'x',
      }),
    ).toBe(3)
    expect(
      computeEngagement({
        seen_at: 'a',
        read_at: 'b',
        bookmarked_at: 'c',
        liked_at: 'd',
      }),
    ).toBe(1 + 2 + 3 + 3)
  })
})
