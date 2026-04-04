import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import type { Env } from "../index";
import { createMcpServer } from "./server";

/**
 * MCP API handler wrapped as a WorkerEntrypoint for OAuthProvider.
 * Receives pre-authenticated requests (OAuthProvider verifies Bearer token).
 */
export class McpApiHandler extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const env = this.env;
    const app = new Hono();

    app.all("*", async (c) => {
      const origin = new URL(c.req.url).origin;
      const mcpServer = createMcpServer(env, origin);
      const transport = new StreamableHTTPTransport({ enableJsonResponse: true });
      await mcpServer.connect(transport);
      return transport.handleRequest(c as never);
    });

    return app.fetch(request);
  }
}
