import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "../helpers";
import { startIngestWorkflows } from "../../server/pipeline/scheduled";

describe("startIngestWorkflows", () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  it("starts workflows only for enabled feeds with rss_url due for check", async () => {
    // Due for check (no next_check_at)
    await env.DB.prepare(
      "INSERT INTO feeds (name, url, rss_url, type) VALUES ('Active', 'https://a.com', 'https://a.com/rss', 'rss')",
    ).run();

    // Disabled feed
    await env.DB.prepare(
      "INSERT INTO feeds (name, url, rss_url, type, disabled) VALUES ('Disabled', 'https://b.com', 'https://b.com/rss', 'rss', 1)",
    ).run();

    // No rss_url
    await env.DB.prepare(
      "INSERT INTO feeds (name, url, type) VALUES ('No RSS', 'https://c.com', 'rss')",
    ).run();

    // Future next_check_at (not due)
    await env.DB.prepare(
      "INSERT INTO feeds (name, url, rss_url, type, next_check_at) VALUES ('Future', 'https://d.com', 'https://d.com/rss', 'rss', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 hour'))",
    ).run();

    const started = await startIngestWorkflows(env as unknown as import("../../server/index").Env);
    expect(started).toBe(1);
  });

  it("returns 0 when no feeds are due", async () => {
    const started = await startIngestWorkflows(env as unknown as import("../../server/index").Env);
    expect(started).toBe(0);
  });
});
