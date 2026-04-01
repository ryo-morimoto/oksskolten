import type { Env } from "../index";
import { signJwt } from "./jwt";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

const CODE_TTL = 60; // seconds
const STATE_COOKIE = "oauth_state";

/**
 * GET /auth/github/login?redirect_uri=/inbox
 *
 * Initiates browser GitHub OAuth flow.
 * - Generates a random state, stores it in an HttpOnly cookie (CSRF protection)
 * - Validates redirect_uri is a same-origin path (prevents open redirect)
 * - Redirects to GitHub OAuth
 */
export async function handleBrowserLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get("redirect_uri") || "/";

  // Only allow same-origin paths (no absolute URLs, no protocol-relative)
  if (!redirectUri.startsWith("/") || redirectUri.startsWith("//")) {
    return Response.json({ error: "Invalid redirect_uri" }, { status: 400 });
  }

  const state = crypto.randomUUID();
  // Encode redirect_uri into state so we can restore it in callback
  const statePayload = JSON.stringify({ state, redirectUri });

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: new URL("/auth/github/callback", request.url).href,
    state: btoa(statePayload),
    scope: "read:user",
  });

  const response = Response.redirect(`${GITHUB_AUTHORIZE_URL}?${params}`, 302);
  // Clone to set cookie (Response.redirect returns immutable response)
  const mutable = new Response(response.body, response);
  mutable.headers.append(
    "Set-Cookie",
    `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
  );
  return mutable;
}

/**
 * GET /auth/github/callback?code=...&state=...
 *
 * GitHub redirects here after user authorizes.
 * - Verifies state cookie matches (CSRF protection)
 * - Exchanges code for GitHub token
 * - Verifies user is GITHUB_ALLOWED_USERNAME
 * - Stores a one-time code in KV (browser_code: prefix, 60s TTL)
 * - Redirects to SPA with ?code= for exchange
 */
export async function handleBrowserCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code || !stateParam) {
    return Response.json({ error: "Missing code or state" }, { status: 400 });
  }

  // Decode state and verify CSRF cookie
  let state: string;
  let redirectUri: string;
  try {
    const parsed = JSON.parse(atob(stateParam));
    state = parsed.state;
    redirectUri = parsed.redirectUri || "/";
  } catch {
    return Response.json({ error: "Invalid state" }, { status: 400 });
  }

  const cookieHeader = request.headers.get("Cookie") || "";
  const stateCookie = parseCookie(cookieHeader, STATE_COOKIE);
  if (!stateCookie || stateCookie !== state) {
    return Response.json({ error: "State mismatch (CSRF check failed)" }, { status: 403 });
  }

  // Exchange code for GitHub access token
  const tokenRes = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenRes.json<{ access_token?: string; error?: string }>();
  if (!tokenData.access_token) {
    return redirectWithError(url.origin, redirectUri, `GitHub token exchange failed: ${tokenData.error}`);
  }

  // Verify user identity
  const userRes = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "User-Agent": "oksskolten",
      Accept: "application/json",
    },
  });
  const userData = await userRes.json<{ login?: string }>();
  if (!userData.login) {
    return redirectWithError(url.origin, redirectUri, "Failed to get GitHub user info");
  }
  if (userData.login !== env.GITHUB_ALLOWED_USERNAME) {
    return redirectWithError(url.origin, redirectUri, "Unauthorized: user not allowed");
  }

  // Store one-time exchange code in KV
  // Uses browser_code: prefix to avoid collision with MCP OAuth's github_state: keys
  const exchangeCode = crypto.randomUUID();
  await env.OAUTH_KV.put(
    `browser_code:${exchangeCode}`,
    JSON.stringify({ username: userData.login }),
    { expirationTtl: CODE_TTL },
  );

  // Redirect to SPA with the exchange code
  // The SPA will POST /auth/github/exchange to trade this for a JWT
  const redirectUrl = new URL(redirectUri, url.origin);
  redirectUrl.searchParams.set("code", exchangeCode);

  const response = Response.redirect(redirectUrl.href, 302);
  // Clear the state cookie
  const mutable = new Response(response.body, response);
  mutable.headers.append(
    "Set-Cookie",
    `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  );
  return mutable;
}

/**
 * POST /auth/github/exchange
 * Body: { code: string }
 *
 * Exchanges a one-time code (from KV) for a JWT.
 * The code is deleted from KV after use (one-time).
 */
export async function handleBrowserExchange(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ code?: string }>().catch(() => ({}));
  const code = (body as { code?: string }).code;
  if (!code) {
    return Response.json({ error: "Missing code" }, { status: 400 });
  }

  const stored = await env.OAUTH_KV.get(`browser_code:${code}`);
  if (!stored) {
    return Response.json({ error: "Invalid or expired code" }, { status: 400 });
  }
  await env.OAUTH_KV.delete(`browser_code:${code}`);

  const { username } = JSON.parse(stored) as { username: string };

  if (!env.JWT_SECRET) {
    return Response.json({ error: "JWT_SECRET not configured" }, { status: 500 });
  }

  const token = await signJwt(username, env.JWT_SECRET);
  return Response.json({ token });
}

// ── Helpers ──────────────────────────────────────────────────

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function redirectWithError(origin: string, redirectUri: string, error: string): Response {
  const url = new URL(redirectUri, origin);
  url.searchParams.set("auth_error", error);
  return Response.redirect(url.href, 302);
}
