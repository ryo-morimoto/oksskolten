/**
 * D1 query helpers.
 * Ported from server/db/connection.ts — adapted from libsql (sync) to D1 (async).
 */

/**
 * Replace @paramName placeholders with positional ? bindings.
 * Ported from fork's bindNamedParams — same interface, same behavior.
 */
export function bindNamedParams(
  sql: string,
  params: Record<string, unknown>,
): { sql: string; args: unknown[] } {
  const args: unknown[] = [];
  const boundSql = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_match, key: string) => {
    if (!(key in params)) {
      throw new Error(`Missing SQL parameter: ${key}`);
    }
    args.push(params[key]);
    return "?";
  });
  return { sql: boundSql, args };
}

/** Execute a write query (INSERT/UPDATE/DELETE) with named params. */
export async function runNamed(
  db: D1Database,
  sql: string,
  params: Record<string, unknown>,
): Promise<D1Result> {
  const bound = bindNamedParams(sql, params);
  return db
    .prepare(bound.sql)
    .bind(...bound.args)
    .run();
}

/** Get a single row with named params. */
export async function getNamed<T>(
  db: D1Database,
  sql: string,
  params: Record<string, unknown>,
): Promise<T | null> {
  const bound = bindNamedParams(sql, params);
  return db
    .prepare(bound.sql)
    .bind(...bound.args)
    .first<T>();
}

/** Get all rows with named params. */
export async function allNamed<T>(
  db: D1Database,
  sql: string,
  params: Record<string, unknown>,
): Promise<T[]> {
  const bound = bindNamedParams(sql, params);
  const result = await db
    .prepare(bound.sql)
    .bind(...bound.args)
    .all<T>();
  return result.results;
}
