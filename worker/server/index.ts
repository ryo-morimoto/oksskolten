import { OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { healthRoute } from "./routes/health";
import { handleOgImage } from "./routes/image-proxy";
import { feedRoutes } from "./routes/feeds";
import { categoryRoutes } from "./routes/categories";
import { articleRoutes } from "./routes/articles";
import { opmlRoutes } from "./routes/opml";
import { searchRoutes } from "./routes/search";
import { handleAuthorize, handleCallback } from "./auth/github";
import { handleBrowserLogin, handleBrowserCallback, handleBrowserExchange } from "./auth/browser";
import { resolveExternalToken } from "./auth/jwt";
import { startIngestWorkflows, startEnrichWorkflow } from "./pipeline/scheduled";
import { McpApiHandler } from "./mcp/handler";

// Re-export Workflow and Container classes (required by wrangler)
export { IngestWorkflow } from "./pipeline/ingest-workflow";
export { EnrichWorkflow } from "./pipeline/enrich-workflow";
export { KuromojiContainer } from "./container/kuromoji";

// Re-export MCP API handler (OAuthProvider references by class)
export { McpApiHandler } from "./mcp/handler";

export type Env = {
  DB: D1Database;
  INGEST_WORKFLOW: Workflow;
  ENRICH_WORKFLOW: Workflow;
  KUROMOJI_CONTAINER: DurableObjectNamespace<import("./container/kuromoji").KuromojiContainer>;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  OAUTH_PROVIDER: OAuthHelpers;
  OAUTH_KV: KVNamespace;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_ALLOWED_USERNAME: string;
  STORAGE: R2Bucket;
  JWT_SECRET: string;
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
};

export type AppContext = { Bindings: Env };

// ── API app factory ──────────────────────────────────────────
// Routes declare auth is required via the guard parameter.
// Production: OAuthProvider validates externally → pass-through guard.
// Tests: inject pass-through directly.
import type { MiddlewareHandler } from "hono";

export function createApiApp(guard: MiddlewareHandler<AppContext>) {
  const app = new Hono<AppContext>();

  // Public
  app.route("/api", healthRoute);

  // Redirect legacy /api/og/* → /og/* (clients may have cached old URLs)
  app.get("/api/og/*", (c) => {
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace("/api/og/", "/og/");
    return c.redirect(url.toString(), 301);
  });

  // Protected
  const protected_ = new Hono<AppContext>();
  protected_.use("/*", guard);

  // /api/me — returns the authenticated user's identity.
  // Works for both MCP OAuth tokens (props set by OAuthProvider) and
  // browser JWTs (props set by resolveExternalToken).
  protected_.get("/me", (c) => c.json({ login: c.env.GITHUB_ALLOWED_USERNAME }));

  protected_.route("/", feedRoutes);
  protected_.route("/", categoryRoutes);
  protected_.route("/", searchRoutes);
  protected_.route("/", articleRoutes);
  protected_.route("/", opmlRoutes);
  app.route("/api", protected_);

  return app;
}

// OAuthProvider already validates tokens before reaching this handler.
const authenticated: MiddlewareHandler<AppContext> = async (_, next) => next();
const apiApp = createApiApp(authenticated);

// ── OAuthProvider wraps the Worker ───────────────────────────
// OAuthProvider only exposes fetch(); scheduled/queue/etc. are not forwarded.
// Compose as a plain ExportedHandler so the Workers runtime can reach both.
const oauth = new OAuthProvider({
  apiHandlers: {
    "/mcp": McpApiHandler,
    "/api/": {
      async fetch(request: Request, env: Env) {
        return apiApp.fetch(request, env);
      },
    },
  },
  defaultHandler: {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/og/")) return handleOgImage(request, env, ctx);

      // MCP OAuth routes
      if (url.pathname === "/authorize") return handleAuthorize(request, env);
      if (url.pathname === "/callback") return handleCallback(request, env);

      // Browser OAuth routes (outside /api/ prefix so they don't require a token)
      if (url.pathname === "/auth/github/login") return handleBrowserLogin(request, env);
      if (url.pathname === "/auth/github/callback") return handleBrowserCallback(request, env);
      if (url.pathname === "/auth/github/exchange" && request.method === "POST") {
        return handleBrowserExchange(request, env);
      }

      // Static assets + SPA fallback
      // not_found_handling = "single-page-application" in wrangler.toml
      // automatically serves index.html for unmatched paths
      if (env.ASSETS) return env.ASSETS.fetch(request);

      return new Response("Not found", { status: 404 });
    },
  },
  // When a Bearer token doesn't match OAuthProvider's internal format
  // (userId:grantId:secret), this callback is invoked to check if it's
  // a browser JWT instead. Returns { props } on success, null on failure.
  // Without this, OAuthProvider would reject all JWT-bearing requests with 401
  // before they reach the Hono apiHandlers.
  async resolveExternalToken({ token, env }) {
    return resolveExternalToken(token, env as Env);
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["read", "write"],
  accessTokenTTL: 86400, // 24 hours
  refreshTokenTTL: 2592000, // 30 days
});

// ── Public routes ────────────────────────────────────────────
// OAuthProvider enforces auth on every request matching an apiHandlers prefix.
// handleApiRequest() rejects requests without an Authorization header
// immediately — resolveExternalToken is never invoked.
// Therefore token-free endpoints (e.g. health) must be intercepted
// before oauth.fetch() and routed directly to Hono.
const publicApp = new Hono<AppContext>();
publicApp.route("/api", healthRoute);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return publicApp.fetch(request, env);
    }
    return oauth.fetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const ingest = await startIngestWorkflows(env);
    const enrich = await startEnrichWorkflow(env);
    // eslint-disable-next-line no-console -- TODO: replace with typed Logger (B4)
    console.log(`[cron] ingest=${ingest} enrich=${enrich}`);
  },
} satisfies ExportedHandler<Env>;
