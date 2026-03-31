import { describe, it, expect } from "vitest";
import { cleanUrl } from "../../server/lib/url-cleaner";

describe("cleanUrl", () => {
  it("removes utm_ parameters", () => {
    expect(cleanUrl("https://example.com/post?utm_source=twitter&utm_medium=social")).toBe(
      "https://example.com/post",
    );
  });

  it("removes fbclid", () => {
    expect(cleanUrl("https://example.com/post?fbclid=abc123")).toBe("https://example.com/post");
  });

  it("preserves non-tracking parameters", () => {
    expect(cleanUrl("https://example.com/post?page=2&utm_source=x")).toBe(
      "https://example.com/post?page=2",
    );
  });

  it("returns original if no tracking params", () => {
    const url = "https://example.com/post?id=42";
    expect(cleanUrl(url)).toBe(url);
  });

  it("returns original for invalid URLs", () => {
    expect(cleanUrl("not-a-url")).toBe("not-a-url");
  });

  it("handles URL with no params", () => {
    expect(cleanUrl("https://example.com/post")).toBe("https://example.com/post");
  });
});
