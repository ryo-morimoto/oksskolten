import { describe, it, expect } from "vitest";
import {
  computeInterval,
  computeEmpiricalInterval,
  parseRssTtl,
  MIN_INTERVAL,
  MAX_INTERVAL,
} from "../../server/lib/schedule";

describe("computeInterval", () => {
  it("clamps to MIN_INTERVAL", () => {
    expect(computeInterval(60, null, 60)).toBe(MIN_INTERVAL);
  });

  it("clamps to MAX_INTERVAL", () => {
    expect(computeInterval(999999, null, 999999)).toBe(MAX_INTERVAL);
  });

  it("uses max of all sources", () => {
    expect(computeInterval(3600, 7200, 1800)).toBe(7200);
  });

  it("handles all nulls", () => {
    expect(computeInterval(null, null, MIN_INTERVAL)).toBe(MIN_INTERVAL);
  });
});

describe("computeEmpiricalInterval", () => {
  it("returns MAX_INTERVAL for no items", () => {
    expect(computeEmpiricalInterval([])).toBe(MAX_INTERVAL);
  });

  it("returns MAX_INTERVAL for stale feed (>30 days)", () => {
    const old = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    expect(computeEmpiricalInterval([{ title: "a", url: "u", published_at: old }])).toBe(
      MAX_INTERVAL,
    );
  });

  it("returns shorter interval for active feed", () => {
    const now = Date.now();
    const items = [
      { title: "a", url: "u1", published_at: new Date(now - 3600 * 1000).toISOString() },
      { title: "b", url: "u2", published_at: new Date(now - 7200 * 1000).toISOString() },
      { title: "c", url: "u3", published_at: new Date(now - 10800 * 1000).toISOString() },
    ];
    const interval = computeEmpiricalInterval(items);
    expect(interval).toBeGreaterThanOrEqual(MIN_INTERVAL);
    expect(interval).toBeLessThan(MAX_INTERVAL);
  });
});

describe("parseRssTtl", () => {
  it("parses TTL from RSS XML", () => {
    expect(parseRssTtl("<rss><channel><ttl>60</ttl></channel></rss>")).toBe(3600);
  });

  it("returns null when no TTL", () => {
    expect(parseRssTtl("<rss><channel></channel></rss>")).toBeNull();
  });

  it("returns null for zero TTL", () => {
    expect(parseRssTtl("<rss><channel><ttl>0</ttl></channel></rss>")).toBeNull();
  });
});
