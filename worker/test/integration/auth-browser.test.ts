import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { signJwt, verifyJwt } from "../../server/auth/jwt";
import { createApiApp } from "../../server/index";
import type { Env } from "../../server/index";

const appEnv = env as unknown as Env;
const JWT_SECRET = appEnv.JWT_SECRET;

// ── Helpers for crafting custom JWTs ────────────────────────────
function base64url(input: string | ArrayBuffer): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Sign a custom payload with the given secret (for testing bad claims). */
async function signCustomJwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(sig)}`;
}

// Test the API app directly (bypasses OAuthProvider).
// Guard is pass-through since we test auth at the JWT level, not the OAuth level.
const testApp = createApiApp(async (_, next) => next());

function fetchApi(path: string, init?: RequestInit) {
  return testApp.request(path, init, appEnv);
}

describe("JWT sign and verify", () => {
  it("signs and verifies a valid JWT", async () => {
    const token = await signJwt("test-user", JWT_SECRET);
    const payload = await verifyJwt(token, JWT_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("test-user");
    expect(payload!.exp).toBeGreaterThan(payload!.iat);
  });

  it("rejects a JWT with wrong secret", async () => {
    const token = await signJwt("test-user", JWT_SECRET);
    const payload = await verifyJwt(token, "wrong-secret");
    expect(payload).toBeNull();
  });

  it("rejects a malformed token", async () => {
    const payload = await verifyJwt("not.a.jwt", JWT_SECRET);
    expect(payload).toBeNull();
  });

  it("rejects a token with only 2 parts", async () => {
    const payload = await verifyJwt("header.body", JWT_SECRET);
    expect(payload).toBeNull();
  });

  it("rejects an expired JWT", async () => {
    const past = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const token = await signCustomJwt(
      {
        sub: "test-user",
        iss: "oksskolten",
        aud: "oksskolten-browser",
        iat: past - 7 * 24 * 60 * 60,
        exp: past, // already expired
      },
      JWT_SECRET,
    );
    const result = await verifyJwt(token, JWT_SECRET);
    expect(result).toBeNull();
  });

  it("rejects a JWT with wrong issuer", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signCustomJwt(
      {
        sub: "test-user",
        iss: "wrong-issuer",
        aud: "oksskolten-browser",
        iat: now,
        exp: now + 3600,
      },
      JWT_SECRET,
    );
    const result = await verifyJwt(token, JWT_SECRET);
    expect(result).toBeNull();
  });

  it("rejects a JWT with wrong audience", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signCustomJwt(
      {
        sub: "test-user",
        iss: "oksskolten",
        aud: "wrong-audience",
        iat: now,
        exp: now + 3600,
      },
      JWT_SECRET,
    );
    const result = await verifyJwt(token, JWT_SECRET);
    expect(result).toBeNull();
  });
});

describe("POST /auth/github/exchange", () => {
  beforeEach(async () => {
    // Clean up any stale browser codes
    const list = await appEnv.OAUTH_KV.list({ prefix: "browser_code:" });
    await Promise.all(list.keys.map((k: { name: string }) => appEnv.OAUTH_KV.delete(k.name)));
  });

  it("exchanges a valid one-time code for a JWT", async () => {
    // Simulate what handleBrowserCallback does: store a code in KV
    const code = crypto.randomUUID();
    await appEnv.OAUTH_KV.put(
      `browser_code:${code}`,
      JSON.stringify({ username: "test-user" }),
      { expirationTtl: 60 },
    );

    // The exchange endpoint is in defaultHandler, not apiHandlers,
    // so we can't test it through createApiApp. Instead, test the
    // underlying function directly.
    const { handleBrowserExchange } = await import("../../server/auth/browser");
    const request = new Request("http://localhost/auth/github/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const response = await handleBrowserExchange(request, appEnv);
    expect(response.status).toBe(200);

    const body = await response.json<{ token: string }>();
    expect(body.token).toBeDefined();

    // Verify the returned JWT is valid
    const payload = await verifyJwt(body.token, JWT_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("test-user");

    // Code should be consumed (one-time use)
    const stored = await appEnv.OAUTH_KV.get(`browser_code:${code}`);
    expect(stored).toBeNull();
  });

  it("rejects an invalid code", async () => {
    const { handleBrowserExchange } = await import("../../server/auth/browser");
    const request = new Request("http://localhost/auth/github/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "nonexistent" }),
    });
    const response = await handleBrowserExchange(request, appEnv);
    expect(response.status).toBe(400);
  });

  it("rejects a request with no code", async () => {
    const { handleBrowserExchange } = await import("../../server/auth/browser");
    const request = new Request("http://localhost/auth/github/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const response = await handleBrowserExchange(request, appEnv);
    expect(response.status).toBe(400);
  });
});

describe("GET /api/me", () => {
  it("returns the allowed username", async () => {
    const res = await fetchApi("/api/me");
    expect(res.status).toBe(200);
    const body = await res.json<{ login: string }>();
    expect(body.login).toBe("test-user");
  });
});

describe("browser login redirect", () => {
  it("redirects to GitHub with correct params", async () => {
    const { handleBrowserLogin } = await import("../../server/auth/browser");
    const request = new Request("http://localhost/auth/github/login?redirect_uri=/inbox");
    const response = await handleBrowserLogin(request, appEnv);

    expect(response.status).toBe(302);
    const location = response.headers.get("Location")!;
    expect(location).toContain("github.com/login/oauth/authorize");
    expect(location).toContain("client_id=");
    expect(location).toContain("redirect_uri=");

    // Should set HttpOnly state cookie
    const cookie = response.headers.get("Set-Cookie")!;
    expect(cookie).toContain("oauth_state=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("rejects absolute redirect_uri (open redirect prevention)", async () => {
    const { handleBrowserLogin } = await import("../../server/auth/browser");
    const request = new Request("http://localhost/auth/github/login?redirect_uri=https://evil.com");
    const response = await handleBrowserLogin(request, appEnv);
    expect(response.status).toBe(400);
  });

  it("rejects protocol-relative redirect_uri", async () => {
    const { handleBrowserLogin } = await import("../../server/auth/browser");
    const request = new Request("http://localhost/auth/github/login?redirect_uri=//evil.com");
    const response = await handleBrowserLogin(request, appEnv);
    expect(response.status).toBe(400);
  });
});

describe("handleBrowserCallback param validation", () => {
  it("returns 400 when code param is missing", async () => {
    const { handleBrowserCallback } = await import("../../server/auth/browser");
    const request = new Request("http://localhost/auth/github/callback?state=abc");
    const response = await handleBrowserCallback(request, appEnv);
    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain("Missing");
  });

  it("returns 400 when state param is missing", async () => {
    const { handleBrowserCallback } = await import("../../server/auth/browser");
    const request = new Request("http://localhost/auth/github/callback?code=abc");
    const response = await handleBrowserCallback(request, appEnv);
    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain("Missing");
  });

  it("returns 400 when both code and state are missing", async () => {
    const { handleBrowserCallback } = await import("../../server/auth/browser");
    const request = new Request("http://localhost/auth/github/callback");
    const response = await handleBrowserCallback(request, appEnv);
    expect(response.status).toBe(400);
  });

  it("returns 400 when state is not valid base64 JSON", async () => {
    const { handleBrowserCallback } = await import("../../server/auth/browser");
    const request = new Request("http://localhost/auth/github/callback?code=abc&state=not-valid-base64");
    const response = await handleBrowserCallback(request, appEnv);
    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toContain("Invalid state");
  });
});
