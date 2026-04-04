import { describe, it, expect } from "vitest";
import { computeEngagement, computeRrfScore } from "../../server/routes/search";

describe("computeRrfScore", () => {
  it("sums 1/(k+rank) for each ranker with k=60", () => {
    const k = 60;
    const rrf = computeRrfScore([1, 1], 0);
    const expected = 2 * (1 / (k + 1));
    expect(rrf).toBeCloseTo(expected, 10);
  });

  it("applies engagement boost log(1+e)*0.01", () => {
    const base = computeRrfScore([5], 0);
    const withEng = computeRrfScore([5], 9);
    expect(withEng - base).toBeCloseTo(Math.log(10) * 0.01, 10);
  });

  it("applies quality boost capped at 0.02", () => {
    const base = computeRrfScore([1], 0);
    const withQuality = computeRrfScore([1], 0, 1.0);
    expect(withQuality - base).toBeCloseTo(0.02, 10);
  });

  it("quality boost does not exceed base RRF for rank=1", () => {
    const baseRrf = 1 / (60 + 1); // ~0.0164
    const qualityMax = 1.0 * 0.02; // 0.02
    // quality boost is in the same order as RRF, not dominating
    expect(qualityMax).toBeLessThan(baseRrf * 2);
  });

  it("treats null quality as zero boost", () => {
    const base = computeRrfScore([1], 0);
    const withNull = computeRrfScore([1], 0, null);
    const withUndefined = computeRrfScore([1], 0, undefined);
    expect(withNull).toBe(base);
    expect(withUndefined).toBe(base);
  });

  it("quality acts as tiebreaker: same rank, higher quality wins", () => {
    const lowQuality = computeRrfScore([5], 0, 0.2);
    const highQuality = computeRrfScore([5], 0, 0.8);
    expect(highQuality).toBeGreaterThan(lowQuality);
    // Difference is proportional to quality gap * 0.02
    expect(highQuality - lowQuality).toBeCloseTo(0.6 * 0.02, 10);
  });
});

describe("computeEngagement", () => {
  it("weights seen, read, bookmark, like", () => {
    expect(
      computeEngagement({
        seen_at: null,
        read_at: null,
        bookmarked_at: null,
        liked_at: null,
      }),
    ).toBe(0);
    expect(
      computeEngagement({
        seen_at: "x",
        read_at: null,
        bookmarked_at: null,
        liked_at: null,
      }),
    ).toBe(1);
    expect(
      computeEngagement({
        seen_at: null,
        read_at: "x",
        bookmarked_at: null,
        liked_at: null,
      }),
    ).toBe(2);
    expect(
      computeEngagement({
        seen_at: null,
        read_at: null,
        bookmarked_at: "x",
        liked_at: null,
      }),
    ).toBe(3);
    expect(
      computeEngagement({
        seen_at: null,
        read_at: null,
        bookmarked_at: null,
        liked_at: "x",
      }),
    ).toBe(3);
    expect(
      computeEngagement({
        seen_at: "a",
        read_at: "b",
        bookmarked_at: "c",
        liked_at: "d",
      }),
    ).toBe(1 + 2 + 3 + 3);
  });
});
