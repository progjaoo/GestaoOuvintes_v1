import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/database/client.js";

const clerkUserId = (process.env.CLERK_USER_ID ?? "").trim();
const adminUsername = (process.env.ADMIN_USERNAME ?? "").trim().toLocaleLowerCase("pt-BR");

async function linkClerkAdmin(): Promise<void> {
  if (!/^user_[A-Za-z0-9_]+$/.test(clerkUserId)) {
    throw new Error("Informe um CLERK_USER_ID valido, no formato user_... .");
  }
  if (adminUsername.length < 3) {
    throw new Error("Informe ADMIN_USERNAME para localizar o administrador local.");
  }

  const result = await db.execute<{ id: string; username: string }>(sql`
    UPDATE admin_user
       SET clerk_user_id = ${clerkUserId},
           updated_at = now()
     WHERE lower(username) = lower(${adminUsername})
       AND active = true
     RETURNING id, username
  `);

  const admin = result.rows[0];
  if (!admin) {
    throw new Error("Administrador local nao encontrado ou inativo.");
  }

  console.info(`Identidade Clerk vinculada ao administrador ${admin.username}.`);
}

linkClerkAdmin()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("Falha ao vincular identidade Clerk.", error);
    await pool.end();
    process.exitCode = 1;
  });
