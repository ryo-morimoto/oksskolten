/**
 * Strip HTML tags and collapse whitespace to produce plain text.
 * Used to sanitize RSS excerpts before storage and display.
 */
export function stripHtmlToPlain(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip HTML, then truncate to maxLen characters. */
export function plainExcerpt(html: string | null | undefined, maxLen = 500): string | null {
  if (!html) return null;
  const plain = stripHtmlToPlain(html);
  return plain.slice(0, maxLen).trim() || null;
}
