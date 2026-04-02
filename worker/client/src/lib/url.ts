/**
 * Convert an article's external URL to an in-app path.
 * Encodes protocol as a prefix ("h/" for http, "s/" for https)
 * so ArticleDetailPage can reconstruct the original URL.
 * Query-string characters are percent-encoded so they stay inside
 * the path segment and are not interpreted by the browser / React Router.
 */
export function articleUrlToPath(url: string): string {
  const prefix = url.startsWith("http://") ? "h" : "s";
  const raw = url.replace(/^https?:\/\//, "");
  return `/${prefix}/${raw.replace(/\?/g, "%3F").replace(/&/g, "%26").replace(/=/g, "%3D").replace(/#/g, "%23")}`;
}

/**
 * Reconstruct an article URL from the in-app splat path.
 * Reverses the encoding done by articleUrlToPath.
 */
export function pathToArticleUrl(splat: string): string {
  if (splat.startsWith("h/")) {
    return `http://${decodeURIComponent(splat.slice(2))}`;
  }
  if (splat.startsWith("s/")) {
    return `https://${decodeURIComponent(splat.slice(2))}`;
  }
  // Fallback for old-format paths without protocol prefix
  return `https://${decodeURIComponent(splat)}`;
}

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
