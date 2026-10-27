import pg from "pg";
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://sales:sales_dev_only@127.0.0.1:5432/sales",
  max: 12,
});
export type DB = pg.Pool | pg.PoolClient;
export async function tx<T>(fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const r = await fn(db);
    await db.query("COMMIT");
    return r;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
