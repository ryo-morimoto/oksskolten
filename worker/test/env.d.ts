import type { D1Migration } from '@cloudflare/vitest-pool-workers'

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      FEED_QUEUE: Queue
      ENVIRONMENT: string
      TEST_MIGRATIONS: D1Migration[]
    }
    interface GlobalProps {
      mainModule: {
        default: ExportedHandler<Env>
      }
    }
  }
}
