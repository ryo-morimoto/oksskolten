import { Hono } from "hono";
import type { AppContext } from "../index";

export const imageProxyRoute = new Hono<AppContext>();

/** Serve og_image from R2 via Worker. Key format: og/{article_id}.{ext} */
imageProxyRoute.get("/og/:key{.+}", async (c) => {
  const key = `og/${c.req.param("key")}`;
  const object = await c.env.STORAGE.get(key);
  if (!object) return c.text("Not found", 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
      ETag: object.httpEtag,
    },
  });
});
