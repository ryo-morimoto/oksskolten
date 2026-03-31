import { describe, it, expect } from "vitest";
import { decomposeTrigrams } from "../../server/lib/trigram";

describe("decomposeTrigrams", () => {
  it("returns the term itself for 2-char strings", () => {
    expect(decomposeTrigrams("東京")).toEqual(["東京"]);
  });

  it("returns single trigram for 3-char strings", () => {
    expect(decomposeTrigrams("東京都")).toEqual(["東京都"]);
  });

  it("decomposes longer strings into overlapping trigrams", () => {
    // プ ロ グ ラ ミ ン グ = 7 chars → 5 trigrams of 3 chars each
    const result = decomposeTrigrams("プログラミング");
    expect(result).toEqual(["プログ", "ログラ", "グラミ", "ラミン", "ミング"]);
  });

  it("handles ASCII strings", () => {
    expect(decomposeTrigrams("abcde")).toEqual(["abc", "bcd", "cde"]);
  });

  it("handles single-char strings", () => {
    expect(decomposeTrigrams("あ")).toEqual(["あ"]);
  });

  it("handles empty string", () => {
    expect(decomposeTrigrams("")).toEqual([""]);
  });

  it("handles mixed scripts", () => {
    // 'A','B','C','あ','い','う' = 6 chars → 4 trigrams of 3 chars each
    const result = decomposeTrigrams("ABCあいう");
    expect(result).toEqual(["ABC", "BCあ", "Cあい", "あいう"]);
  });
});
