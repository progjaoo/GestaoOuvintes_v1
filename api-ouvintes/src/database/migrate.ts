import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./client.js";

const migrationsDir = join(process.cwd(), "database/migrations");

async function migrate(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        id varchar(255) PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const alreadyApplied = await client.query<{ id: string }>(
        "SELECT id FROM schema_migration WHERE id = $1",
        [file],
      );

      if (alreadyApplied.rowCount) {
        continue;
      }

      const sql = await readFile(join(migrationsDir, file), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migration (id) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.info(`Migracao aplicada: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

migrate()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("Falha ao aplicar migracoes.", error);
    await pool.end();
    process.exitCode = 1;
  });
