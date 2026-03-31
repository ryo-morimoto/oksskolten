import type { Env } from "../index";

/** Serve og_image from R2 with edge caching. Mounted at /og/ outside OAuthProvider. */
export async function handleOgImage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const key = url.pathname.slice(1); // "/og/abc.jpg" → "og/abc.jpg"

  // Edge cache lookup (Cloudflare-specific .default — type extended by workers-types)
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // R2 fetch
  const object = await env.STORAGE.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400, s-maxage=604800, immutable");

  const response = new Response(object.body, { headers });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
