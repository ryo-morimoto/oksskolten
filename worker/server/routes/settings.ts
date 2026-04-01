import { Hono } from "hono";
import type { AppContext } from "../index";

export const settingsRoutes = new Hono<AppContext>();

settingsRoutes.get("/settings/preferences", async (c) => {
  const result = await c.env.DB.prepare("SELECT key, value FROM settings").all<{
    key: string;
    value: string | null;
  }>();

  const preferences: Record<string, string | null> = {};
  for (const row of result.results) {
    preferences[row.key] = row.value;
  }
  return c.json(preferences);
});

settingsRoutes.patch("/settings/preferences", async (c) => {
  const body = await c.req.json<Record<string, string | null>>();

  const entries = Object.entries(body);
  if (entries.length > 0) {
    const stmts = entries.map(([key, value]) =>
      c.env.DB.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).bind(key, value),
    );
    await c.env.DB.batch(stmts);
  }

  const result = await c.env.DB.prepare("SELECT key, value FROM settings").all<{
    key: string;
    value: string | null;
  }>();

  const preferences: Record<string, string | null> = {};
  for (const row of result.results) {
    preferences[row.key] = row.value;
  }
  return c.json(preferences);
});

settingsRoutes.get("/settings/profile", async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'language'").first<{
    value: string | null;
  }>();

  return c.json({
    login: c.env.GITHUB_ALLOWED_USERNAME,
    language: row?.value ?? null,
  });
});
