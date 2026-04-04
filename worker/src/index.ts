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
      if (url.pathname === "/authorize") return handleAuthorize(request, env);
      if (url.pathname === "/callback") return handleCallback(request, env);
      return new Response("Not found", { status: 404 });
    },
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["read", "write"],
  accessTokenTTL: 86400, // 24 hours
  refreshTokenTTL: 2592000, // 30 days
});

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => oauth.fetch(request, env, ctx),

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const ingest = await startIngestWorkflows(env);
    const enrich = await startEnrichWorkflow(env);
    // eslint-disable-next-line no-console -- TODO: replace with typed Logger (B4)
    console.log(`[cron] ingest=${ingest} enrich=${enrich}`);
  },
} satisfies ExportedHandler<Env>;
