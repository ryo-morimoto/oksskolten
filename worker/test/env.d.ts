import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      INGEST_WORKFLOW: Workflow;
      ENRICH_WORKFLOW: Workflow;
      KUROMOJI_CONTAINER: DurableObjectNamespace;
      VECTORIZE: VectorizeIndex;
      AI: Ai;
      ENVIRONMENT: string;
      TEST_MIGRATIONS: D1Migration[];
    }
    interface GlobalProps {
      mainModule: {
        default: ExportedHandler<Env>;
      };
    }
  }
}
