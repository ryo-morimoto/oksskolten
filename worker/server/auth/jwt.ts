import type { Env } from "../index";

const JWT_ALG = "HS256";
const JWT_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const JWT_ISSUER = "oksskolten";
const JWT_AUDIENCE = "oksskolten-browser";

interface JwtPayload {
  sub: string; // GitHub username
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

/**
 * Sign a JWT using HMAC-SHA256.
 * Uses the Web Crypto API available in workerd.
 */
export async function signJwt(username: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: username,
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: now,
    exp: now + JWT_TTL,
  };

  const header = base64url(JSON.stringify({ alg: JWT_ALG, typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;

  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));

  return `${signingInput}.${base64url(sig)}`;
}

/**
 * Verify a JWT and return the payload if valid, null otherwise.
 * Checks signature and expiration.
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const signingInput = `${header}.${body}`;

  const key = await importKey(secret);
  const sigBytes = base64urlDecode(sig);
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(signingInput));
  if (!valid) return null;

  const payload: JwtPayload = JSON.parse(new TextDecoder().decode(base64urlDecode(body)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  if (payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) return null;

  return payload;
}

/**
 * Resolve a Bearer token as a browser JWT for OAuthProvider's resolveExternalToken.
 * Returns { props: { username } } on success, null on failure.
 */
export async function resolveExternalToken(
  token: string,
  env: Env,
): Promise<{ props: { username: string } } | null> {
  if (!env.JWT_SECRET) return null;

  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;

  return { props: { username: payload.sub } };
}

// ── Helpers ──────────────────────────────────────────────────

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64url(input: string | ArrayBuffer): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): ArrayBuffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
