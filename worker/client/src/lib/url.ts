/**
 * Convert an article's external URL to an in-app path.
 * Query-string characters are percent-encoded so they stay inside
 * the path segment and are not interpreted by the browser / React Router.
 */
export function articleUrlToPath(url: string): string {
  const raw = url.replace(/^https?:\/\//, "");
  return "/" + raw.replace(/\?/g, "%3F").replace(/&/g, "%26").replace(/=/g, "%3D").replace(/#/g, "%23");
}

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
