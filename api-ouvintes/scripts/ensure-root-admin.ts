import "dotenv/config";
import argon2 from "argon2";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/database/client.js";
import { adminUsers } from "../src/database/schema.js";

const username = (process.env.ROOT_ADMIN_USERNAME ?? process.env.ADMIN_INITIAL_USERNAME ?? "")
  .trim()
  .toLocaleLowerCase("pt-BR");
const password = process.env.ROOT_ADMIN_PASSWORD ?? process.env.ADMIN_INITIAL_PASSWORD;
const name = (process.env.ROOT_ADMIN_NAME ?? process.env.ADMIN_INITIAL_NAME ?? "Administrador Radio 88").trim();

async function ensureRootAdmin(): Promise<void> {
  if (!username || !password) {
    throw new Error("Informe ROOT_ADMIN_USERNAME e ROOT_ADMIN_PASSWORD para criar o administrador raiz.");
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  await db.execute(sql`
    UPDATE admin_user
    SET name = ${name},
        password_hash = ${passwordHash},
        role = 'admin',
        active = true,
        updated_at = now()
    WHERE lower(username) = lower(${username})
  `);

  await db.insert(adminUsers).values({
    name,
    username,
    passwordHash,
    role: "admin",
    active: true,
  }).onConflictDoNothing();

  const [admin] = await db.execute<{ id: string; username: string }>(sql`
    SELECT id, username
    FROM admin_user
    WHERE lower(username) = lower(${username})
    ORDER BY created_at DESC
    LIMIT 1
  `);

  if (!admin) {
    throw new Error("Nao foi possivel criar ou atualizar o administrador raiz.");
  }

  await db.execute(sql`
    INSERT INTO admin_user_role (admin_user_id, role_id)
    SELECT ${admin.id}, r.id
    FROM role r
    WHERE r.key = 'admin'
    ON CONFLICT DO NOTHING
  `);

  console.info(`Administrador raiz pronto: ${admin.username}`);
}

ensureRootAdmin()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("Falha ao garantir administrador raiz.", error);
    await pool.end();
    process.exitCode = 1;
  });
