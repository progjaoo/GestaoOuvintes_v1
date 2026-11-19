import argon2 from "argon2";
import { closeDatabase, pool } from "../database/client.js";

const ROOT_EMAIL = "joaomvprog@gmail.com";
const ROOT_USERNAME = "joaomprog-root";

async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Execute este comando em um terminal interativo para digitar a senha sem eco.");
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          reject(new Error("Operacao cancelada."));
          return;
        }
        if (character === "\r" || character === "\n") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  const password = await readSecret("Nova senha unica do Super Admin (minimo 16 caracteres): ");
  const confirmation = await readSecret("Confirme a nova senha: ");
  if (password.length < 16 || password.length > 200 || password !== confirmation) {
    throw new Error("Senha invalida ou confirmacao diferente. Nenhuma conta foi criada.");
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(881188, 12)");
    const existing = await client.query(
      `SELECT id FROM admin_user
       WHERE is_super_admin = true OR email_normalized = $1 OR username = $2
       FOR UPDATE`,
      [ROOT_EMAIL, ROOT_USERNAME],
    );
    if (existing.rowCount) throw new Error("A conta raiz ou o identificador ja existe. Nao houve alteracao.");

    const role = await client.query<{ id: string }>("SELECT id FROM role WHERE key = 'admin'");
    if (!role.rows[0]) throw new Error("Papel admin ausente; aplique as migrations locais antes do provisionamento.");

    const created = await client.query<{ id: string }>(
      `INSERT INTO admin_user
         (name, username, password_hash, role, active, email, email_normalized,
          is_super_admin, must_change_password, password_changed_at)
       VALUES ('Super Admin', $1, $2, 'admin', true, $3, lower($3), true, false, now())
       RETURNING id`,
      [ROOT_USERNAME, passwordHash, ROOT_EMAIL],
    );
    const userId = created.rows[0]?.id;
    if (!userId) throw new Error("Falha ao provisionar Super Admin.");
    await client.query(
      "INSERT INTO admin_user_role (admin_user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, role.rows[0].id],
    );
    await client.query(
      `INSERT INTO admin_audit_log (admin_user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, 'admin_user.super_admin_provisioned', 'admin_user', $1, $2::jsonb)`,
      [userId, JSON.stringify({ emailDomain: ROOT_EMAIL.split("@")[1], emailVerified: false, source: "secure_cli" })],
    );
    await client.query("COMMIT");
    process.stdout.write(`Super Admin provisionado. Usuario de acesso: ${ROOT_USERNAME}. E-mail: ${ROOT_EMAIL} (ainda nao confirmado).\n`);
    process.stdout.write("Guarde a senha digitada em um gerenciador seguro. A senha nao e exibida nem registrada.\n");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Falha no provisionamento."}\n`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
