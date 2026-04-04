const USER_AGENT = "Mozilla/5.0 (compatible; Oksskolten/1.0)";

const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

const OG_MAX_SIZE = 2 * 1024 * 1024; // 2 MB

/** Download og_image and upload to R2. Returns the R2 key or null on failure. */
export async function uploadOgImage(
  storage: R2Bucket,
  imageUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok || !res.body) return null;

    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!IMAGE_CONTENT_TYPES.has(contentType)) return null;

    const contentLength = Number(res.headers.get("content-length") ?? 0);
    if (contentLength > OG_MAX_SIZE) return null;

    const ext = contentType.split("/")[1]?.replace("svg+xml", "svg") ?? "jpg";
    const key = `og/${crypto.randomUUID()}.${ext}`;

    await storage.put(key, res.body, {
      httpMetadata: { contentType },
    });
    return key;
  } catch {
    return null;
  }
}
