import { Hono } from "hono";
import type { AppContext } from "../index";

export const healthRoute = new Hono<AppContext>();

healthRoute.get("/health", async (c) => {
  // Verify D1 is accessible
  let dbOk = false;
  try {
    const result = await c.env.DB.prepare("SELECT 1 as ok").first<{ ok: number }>();
    dbOk = result?.ok === 1;
  } catch {
    // D1 not available
  }

  return c.json({
    ok: dbOk,
    version: "0.1.0",
    environment: c.env.ENVIRONMENT,
  });
});
