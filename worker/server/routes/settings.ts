import { Hono } from "hono";
import type { AppContext } from "../index";

export const settingsRoutes = new Hono<AppContext>();

const ALLOWED_SETTINGS_KEYS = new Set([
  "appearance.color_theme",
  "appearance.highlight_theme",
  "appearance.font_family",
  "appearance.list_layout",
  "appearance.mascot",
  "reading.date_mode",
  "reading.auto_mark_read",
  "reading.unread_indicator",
  "reading.internal_links",
  "reading.show_thumbnails",
  "reading.show_feed_activity",
  "reading.article_open_mode",
  "reading.category_unread_only",
  "reading.keyboard_navigation",
  "reading.keybindings",
  "summary.provider",
  "summary.model",
  "translate.provider",
  "translate.model",
  "translate.target_lang",
  "custom_themes",
  "language",
]);

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

const MAX_VALUE_BYTES = 64 * 1024; // 64 KB per value (custom_themes JSON can be large)

settingsRoutes.patch("/settings/preferences", async (c) => {
  const body = await c.req.json<Record<string, string | null>>();

  const entries = Object.entries(body).filter(([key]) => ALLOWED_SETTINGS_KEYS.has(key));
  for (const [key, value] of entries) {
    if (value !== null && typeof value !== "string") {
      return c.json({ error: `Value for "${key}" must be a string or null` }, 400);
    }
    if (typeof value === "string" && new TextEncoder().encode(value).byteLength > MAX_VALUE_BYTES) {
      return c.json({ error: `Value for "${key}" exceeds maximum size (64 KB)` }, 400);
    }
  }
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
    account_name: c.env.GITHUB_ALLOWED_USERNAME,
    language: row?.value ?? null,
  });
});
