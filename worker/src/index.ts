import { Hono } from 'hono'
import { healthRoute } from './routes/health'
import { feedRoutes } from './routes/feeds'
import { categoryRoutes } from './routes/categories'
import { articleRoutes } from './routes/articles'
import { opmlRoutes } from './routes/opml'
import { bearerAuth } from './auth/bearer'
import { enqueueFeedChecks } from './pipeline/fetch-feeds'
import { processFeedBatch } from './pipeline/process-feed'
import type { FeedQueueMessage } from './pipeline/fetch-feeds'

export type Env = {
  DB: D1Database
  FEED_QUEUE: Queue
  // INDEX_QUEUE: Queue  // P1
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
protectedApi.route('/', articleRoutes)
protectedApi.route('/', opmlRoutes)
app.route('/api', protectedApi)

export default {
  fetch: app.fetch,

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    await enqueueFeedChecks(env)
  },

  async queue(
    batch: MessageBatch<FeedQueueMessage>,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    await processFeedBatch(batch, env)
  },
}
