import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export type Db = pg.Pool;

/** `DATABASE_URL` がある場合のみ Veriora canonical 用プールを返す */
export function getPool(): Db {
  if (pool) return pool;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for Veriora Postgres repositories");
  }
  pool = new Pool({
    connectionString: url,
    ssl: url.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    max: 4,
  });
  return pool;
}
