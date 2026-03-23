import { describe, it, expect, beforeEach } from "vitest";
import { setupTestDb, fetchApi } from "../helpers";

describe("GET /api/health", () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  it("returns ok: true when D1 is accessible", async () => {
    const res = await fetchApi("/api/health");
    expect(res.status).toBe(200);

    const body = await res.json<{ ok: boolean; version: string }>();
    expect(body.ok).toBe(true);
    expect(body.version).toBe("0.1.0");
  });
});
