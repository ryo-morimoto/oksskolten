import { Hono } from 'hono'
import { StreamableHTTPTransport } from '@hono/mcp'
import { healthRoute } from './routes/health'
import { feedRoutes } from './routes/feeds'
import { categoryRoutes } from './routes/categories'
import { articleRoutes } from './routes/articles'
import { opmlRoutes } from './routes/opml'
import { searchRoutes } from './routes/search'
import { bearerAuth } from './auth/bearer'
import { startFeedWorkflows } from './pipeline/fetch-feeds'
import { createMcpServer } from './mcp/server'

// Re-export Workflow and Container classes (required by wrangler)
export { ArticlePipelineWorkflow } from './pipeline/article-workflow'
export { KuromojiContainer } from './container/kuromoji'

export type Env = {
  DB: D1Database
  ARTICLE_PIPELINE: Workflow
  KUROMOJI_CONTAINER: DurableObjectNamespace
  VECTORIZE: VectorizeIndex
  AI: Ai
  // STORAGE: R2Bucket   // future
  ENVIRONMENT: string
}

export type AppContext = { Bindings: Env }

const app = new Hono<AppContext>()

// Public routes (no auth)
app.route('/api', healthRoute)

// Protected routes (bearer auth)
const protectedApi = new Hono<AppContext>()
protectedApi.use(bearerAuth())
protectedApi.route('/', feedRoutes)
protectedApi.route('/', categoryRoutes)
protectedApi.route('/', searchRoutes)
protectedApi.route('/', articleRoutes)  // :id{[0-9]+} prevents matching /articles/search
protectedApi.route('/', opmlRoutes)
app.route('/api', protectedApi)

// MCP Streamable HTTP endpoint (bearer auth protected)
const mcpApp = new Hono<AppContext>()
mcpApp.use(bearerAuth())
mcpApp.all('/', async (c) => {
  const mcpServer = createMcpServer(c.env)
  const transport = new StreamableHTTPTransport({ enableJsonResponse: true })
  await mcpServer.connect(transport)
  return transport.handleRequest(c as never)
})
app.route('/mcp', mcpApp)

export default {
  fetch: app.fetch,

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    await startFeedWorkflows(env)
  },
}
