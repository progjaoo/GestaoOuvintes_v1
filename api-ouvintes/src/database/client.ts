import { drizzle } from "drizzle-orm/node-postgres";
import pg from "../../node_modules/@types/pg/index.js";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
});

pool.on("error", (error) => {
  console.error("Falha inesperada no pool PostgreSQL.", {
    name: error.name,
    message: error.message,
  });
});

export const db = drizzle(pool, { schema });

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
