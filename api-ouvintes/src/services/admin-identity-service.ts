import { createHash, createHmac, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { env } from "../config/env.js";
import { pool } from "../database/client.js";
import { AppError } from "../lib/errors.js";
import { sendIdentityEmail, type EmailDeliveryResult, type IdentityEmailKind } from "./resend-email-service.js";

export function normalizeAdminEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function allowIdentityRequest(identifier: string, limit = 5) {
  const keyHash = createHmac("sha256", env.JWT_SECRET)
    .update(normalizeAdminEmail(identifier))
    .digest("hex");
  const result = await pool.query<{ attempt_count: number }>(
    `INSERT INTO admin_identity_rate_limit (key_hash, window_started_at, attempt_count)
     VALUES ($1, now(), 1)
     ON CONFLICT (key_hash) DO UPDATE SET
       window_started_at = CASE
         WHEN admin_identity_rate_limit.window_started_at < now() - interval '1 hour' THEN now()
         ELSE admin_identity_rate_limit.window_started_at
       END,
       attempt_count = CASE
         WHEN admin_identity_rate_limit.window_started_at < now() - interval '1 hour' THEN 1
         ELSE admin_identity_rate_limit.attempt_count + 1
       END
     RETURNING attempt_count`,
    [keyHash],
  );
  return Number(result.rows[0]?.attempt_count ?? limit + 1) <= limit;
}

async function createIdentityToken(input: {
  adminUserId: string;
  email: string;
  kind: IdentityEmailKind;
  createdByAdminUserId?: string | null;
}) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const ttl = input.kind === "invite" ? "24 hours" : "30 minutes";
  const result = await pool.query<{ id: string }>(
    `WITH revoked AS (
       UPDATE admin_identity_token
       SET revoked_at = now()
       WHERE admin_user_id = $1 AND kind = $2 AND used_at IS NULL AND revoked_at IS NULL
       RETURNING id
     )
     INSERT INTO admin_identity_token
       (admin_user_id, kind, email_normalized_snapshot, token_hash, expires_at, created_by_admin_user_id)
     VALUES ($1, $2, $3, $4, now() + $5::interval, $6)
     RETURNING id`,
    [input.adminUserId, input.kind, normalizeAdminEmail(input.email), tokenHash, ttl, input.createdByAdminUserId ?? null],
  );
  const identityToken = result.rows[0];
  if (!identityToken) throw new AppError(500, "IDENTITY_TOKEN_CREATE_FAILED", "Nao foi possivel preparar o acesso.");
  return { id: identityToken.id, token };
}

export async function deliverIdentityToken(input: {
  adminUserId: string;
  email: string;
  name: string;
  kind: IdentityEmailKind;
  createdByAdminUserId?: string | null;
}): Promise<EmailDeliveryResult> {
  if (!env.resendConfigured) return { status: "not_configured" };
  const issued = await createIdentityToken(input);
  const delivery = await sendIdentityEmail({
    kind: input.kind,
    to: input.email,
    name: input.name,
    token: issued.token,
    idempotencyKey: `admin-identity/${issued.id}`,
  });
  await pool.query(
    "UPDATE admin_identity_token SET delivery_status = $2 WHERE id = $1",
    [issued.id, delivery.status],
  );
  return delivery;
}

export async function requestPasswordReset(email: string) {
  const normalizedEmail = normalizeAdminEmail(email);
  if (!env.resendConfigured || !await allowIdentityRequest(normalizedEmail)) return;

  const result = await pool.query<{
    id: string;
    email: string;
    name: string;
  }>(
    `SELECT id, email, name
     FROM admin_user
     WHERE email_normalized = $1
       AND email_verified_at IS NOT NULL
       AND active = true`,
    [normalizedEmail],
  );
  const user = result.rows[0];
  if (!user) return;

  await deliverIdentityToken({
    adminUserId: user.id,
    email: user.email,
    name: user.name,
    kind: "password_reset",
  });
}

export async function requestAdminEmailVerification(adminUserId: string) {
  if (!env.resendConfigured) throw new AppError(503, "EMAIL_NOT_CONFIGURED", "O envio de e-mail ainda nao esta configurado.");
  const result = await pool.query<{ id: string; email: string | null; name: string; email_verified_at: Date | null; active: boolean }>(
    "SELECT id, email, name, email_verified_at, active FROM admin_user WHERE id = $1",
    [adminUserId],
  );
  const user = result.rows[0];
  if (!user?.active || !user.email) throw new AppError(409, "EMAIL_NOT_AVAILABLE", "Esta conta ainda nao possui e-mail para confirmar.");
  if (user.email_verified_at) throw new AppError(409, "EMAIL_ALREADY_VERIFIED", "O e-mail desta conta ja foi confirmado.");
  if (!await allowIdentityRequest(user.email)) throw new AppError(429, "IDENTITY_RATE_LIMITED", "Aguarde antes de solicitar outro e-mail.");
  return deliverIdentityToken({ adminUserId, email: user.email, name: user.name, kind: "email_verification" });
}

export async function consumeIdentityToken(token: string, password?: string) {
  const tokenHash = hashToken(token);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize token consumption with account edits so an old link cannot
    // reactivate a deactivated account or race an email change.
    const ownerResult = await client.query<{ admin_user_id: string }>(
      "SELECT admin_user_id FROM admin_identity_token WHERE token_hash = $1",
      [tokenHash],
    );
    const owner = ownerResult.rows[0];
    if (!owner) throw new AppError(400, "IDENTITY_TOKEN_INVALID", "O link e invalido ou expirou. Solicite um novo link.");
    await client.query("SELECT pg_advisory_xact_lock(881188, 12)");
    const accountResult = await client.query<{ id: string }>(
      "SELECT id FROM admin_user WHERE id = $1 FOR UPDATE",
      [owner.admin_user_id],
    );
    const account = accountResult.rows[0];
    if (!account) throw new AppError(400, "IDENTITY_TOKEN_INVALID", "O link e invalido ou expirou. Solicite um novo link.");

    const tokenResult = await client.query<{
      id: string;
      admin_user_id: string;
      kind: IdentityEmailKind;
      email_normalized_snapshot: string;
      current_email_normalized: string | null;
      active: boolean;
      must_change_password: boolean;
    }>(
      `SELECT t.id, t.admin_user_id, t.kind, t.email_normalized_snapshot,
              u.email_normalized AS current_email_normalized, u.active, u.must_change_password
       FROM admin_identity_token t
       JOIN admin_user u ON u.id = t.admin_user_id
       WHERE t.token_hash = $1 AND t.admin_user_id = $2
         AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now()
       FOR UPDATE`,
      [tokenHash, owner.admin_user_id],
    );
    const identity = tokenResult.rows[0];
    if (!identity || identity.email_normalized_snapshot !== identity.current_email_normalized) {
      throw new AppError(400, "IDENTITY_TOKEN_INVALID", "O link e invalido ou expirou. Solicite um novo link.");
    }
    if (!identity.active && identity.kind !== "invite") {
      throw new AppError(400, "IDENTITY_TOKEN_INVALID", "O link e invalido ou expirou. Solicite um novo link.");
    }
    if (identity.kind === "invite" && (identity.active || !identity.must_change_password)) {
      throw new AppError(400, "IDENTITY_TOKEN_INVALID", "O link e invalido ou expirou. Solicite um novo link.");
    }

    if (identity.kind !== "email_verification") {
      if (!password || password.length < 12 || password.length > 200) {
        throw new AppError(400, "PASSWORD_POLICY", "A senha precisa ter entre 12 e 200 caracteres.");
      }
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const activatesInvite = identity.kind === "invite";
      await client.query(
        `UPDATE admin_user
         SET password_hash = $2,
             password_changed_at = now(),
             must_change_password = false,
             email_verified_at = COALESCE(email_verified_at, now()),
             active = CASE WHEN $3::boolean THEN true ELSE active END,
             authz_version = authz_version + 1,
             version = version + 1,
             updated_at = now()
         WHERE id = $1`,
        [identity.admin_user_id, passwordHash, activatesInvite],
      );
      await client.query(
        `UPDATE admin_session
         SET revoked_at = now(), revoke_reason = 'password_reset'
         WHERE admin_user_id = $1 AND revoked_at IS NULL`,
        [identity.admin_user_id],
      );
    } else {
      await client.query(
        `UPDATE admin_user
         SET email_verified_at = now(), version = version + 1, updated_at = now()
         WHERE id = $1 AND email_normalized IS NOT NULL`,
        [identity.admin_user_id],
      );
    }

    await client.query(
      `UPDATE admin_identity_token
       SET used_at = now(), revoked_at = NULL
       WHERE id = $1`,
      [identity.id],
    );
    await client.query(
      `UPDATE admin_identity_token
       SET revoked_at = now()
       WHERE admin_user_id = $1 AND kind = $2 AND id <> $3
         AND used_at IS NULL AND revoked_at IS NULL`,
      [identity.admin_user_id, identity.kind, identity.id],
    );
    await client.query(
      `INSERT INTO admin_audit_log (admin_user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, 'admin_user', $1, $3::jsonb)`,
      [identity.admin_user_id, `identity.${identity.kind}.consumed`, JSON.stringify({ tokenId: identity.id })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
