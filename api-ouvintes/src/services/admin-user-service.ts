import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import type { PoolClient } from "pg";
import type { AuthorizationContext, ScopeType } from "./authorization-service.js";
import { pool } from "../database/client.js";
import { AppError } from "../lib/errors.js";
import { deliverIdentityToken } from "./admin-identity-service.js";

const privilegedPermissions = new Set([
  "user.manage", "user.permissions.manage", "role.manage", "user.deactivate",
  "user.password.reset", "user.session.revoke", "role.create", "role.update",
]);

async function actorIsSuperAdmin(client: PoolClient, actorId: string) {
  const result = await client.query<{ is_super_admin: boolean }>(
    "SELECT is_super_admin FROM admin_user WHERE id = $1 AND active = true",
    [actorId],
  );
  return result.rows[0]?.is_super_admin === true;
}

export async function requireRecentAdminReauthentication(sessionId: string, actorId: string) {
  const result = await pool.query<{ fresh: boolean }>(
    `SELECT reauthenticated_at >= now() - interval '5 minutes' AS fresh
     FROM admin_session WHERE id = $1 AND admin_user_id = $2 AND revoked_at IS NULL`,
    [sessionId, actorId],
  );
  if (result.rows[0]?.fresh !== true) {
    throw new AppError(428, "RECENT_AUTH_REQUIRED", "Confirme sua senha novamente antes desta alteracao.");
  }
}

async function audit(
  client: PoolClient,
  actorId: string,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await client.query(
    `INSERT INTO admin_audit_log (admin_user_id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actorId, action, resourceType, resourceId, JSON.stringify(metadata)],
  );
}

async function assertDelegableRoles(
  client: PoolClient,
  actorId: string,
  authz: AuthorizationContext,
  roleIds: string[],
) {
  const uniqueIds = [...new Set(roleIds)];
  const result = await client.query<{
    role_id: string;
    permission_key: string;
    scope_type: ScopeType;
    department_id: string | null;
  }>(
    `SELECT r.id AS role_id, p.key AS permission_key, rps.scope_type, rps.department_id
     FROM role r
     LEFT JOIN role_permission rp ON rp.role_id = r.id
     LEFT JOIN permission p ON p.id = rp.permission_id
     LEFT JOIN role_permission_scope rps
       ON rps.role_id = rp.role_id AND rps.permission_id = rp.permission_id
     WHERE r.id = ANY($1::uuid[])`,
    [uniqueIds],
  );
  const foundRoles = new Set(result.rows.map((row) => row.role_id));
  if (foundRoles.size !== uniqueIds.length) {
    throw new AppError(400, "UNKNOWN_ROLE", "Um ou mais papeis selecionados nao existem.");
  }

  if (await actorIsSuperAdmin(client, actorId)) return;
  for (const grant of result.rows) {
    if (!grant.permission_key) continue;
    if (privilegedPermissions.has(grant.permission_key)) {
      throw new AppError(403, "ROLE_DELEGATION_FORBIDDEN", "Somente o Super Admin pode delegar permissoes administrativas protegidas.");
    }
    const actorScopes = authz.scopes.get(grant.permission_key) ?? [];
    const canDelegateScope = actorScopes.some((scope) =>
      scope.type === "global" ||
      (scope.type === grant.scope_type &&
        (scope.type !== "department" || scope.departmentId === grant.department_id || scope.departmentId === null)),
    );
    if (!canDelegateScope) {
      throw new AppError(403, "ROLE_DELEGATION_FORBIDDEN", "Nao e permitido delegar acesso alem do seu escopo.");
    }
  }
}

async function assignRoles(client: PoolClient, userId: string, roleIds: string[]) {
  await client.query("DELETE FROM admin_user_role WHERE admin_user_id = $1", [userId]);
  await client.query(
    `INSERT INTO admin_user_role (admin_user_id, role_id)
     SELECT $1, assigned.role_id FROM unnest($2::uuid[]) AS assigned(role_id)
     ON CONFLICT DO NOTHING`,
    [userId, [...new Set(roleIds)]],
  );
}

export async function listAdminUsers(input: {
  q?: string;
  status: "active" | "inactive" | "all";
  page: number;
  pageSize: number;
}) {
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (input.status !== "all") {
    values.push(input.status === "active");
    conditions.push(`u.active = $${values.length}`);
  }
  if (input.q) {
    values.push(`%${input.q}%`);
    conditions.push(`(u.name ILIKE $${values.length} OR u.username ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM admin_user u ${where}`,
    values,
  );
  const offset = (input.page - 1) * input.pageSize;
  const rows = await pool.query(
    `SELECT u.id, u.name, u.username, u.email, u.email_verified_at, u.phone,
            u.active, u.is_super_admin, u.must_change_password, u.role, u.version, u.created_at, u.last_login_at,
            COALESCE(json_agg(json_build_object('id', r.id, 'key', r.key, 'name', r.name))
              FILTER (WHERE r.id IS NOT NULL), '[]'::json) AS roles
     FROM admin_user u
     LEFT JOIN admin_user_role ur ON ur.admin_user_id = u.id
     LEFT JOIN role r ON r.id = ur.role_id
     ${where}
     GROUP BY u.id
     ORDER BY u.is_super_admin DESC, u.active DESC, u.name ASC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, input.pageSize, offset],
  );
  const total = Number(count.rows[0]?.total ?? 0);
  return { items: rows.rows, pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) } };
}

export async function getAdminUserDetail(userId: string) {
  const client = await pool.connect();
  try {
    const user = await client.query(
      `SELECT u.id, u.name, u.username, u.email, u.email_verified_at, u.phone,
              u.active, u.is_super_admin, u.must_change_password, u.role, u.version,
              u.created_at, u.updated_at, u.last_login_at,
              COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name))
                FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS roles
       FROM admin_user u
       LEFT JOIN admin_user_role ur ON ur.admin_user_id = u.id
       LEFT JOIN role r ON r.id = ur.role_id
       WHERE u.id = $1 GROUP BY u.id`,
      [userId],
    );
    const item = user.rows[0];
    if (!item) throw new AppError(404, "ADMIN_USER_NOT_FOUND", "Usuario administrativo nao encontrado.");
    const grants = await client.query(
      `WITH effective AS (
         SELECT p.key AS permission_key, rps.scope_type, rps.department_id
         FROM admin_user_role ur
         JOIN role_permission rp ON rp.role_id = ur.role_id
         JOIN permission p ON p.id = rp.permission_id
         JOIN role_permission_scope rps ON rps.role_id = rp.role_id AND rps.permission_id = rp.permission_id
         WHERE ur.admin_user_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM admin_permission_override d
             WHERE d.admin_user_id = $1 AND d.permission_id = p.id AND d.effect = 'DENY'
           )
         UNION ALL
         SELECT p.key, o.scope_type, o.department_id
         FROM admin_permission_override o JOIN permission p ON p.id = o.permission_id
         WHERE o.admin_user_id = $1 AND o.effect = 'ALLOW'
       )
       SELECT permission_key, scope_type, department_id FROM effective
       ORDER BY permission_key, scope_type`,
      [userId],
    );
    const overrides = await client.query(
      `SELECT p.key AS permission_key, o.effect, o.scope_type, o.department_id, o.reason, o.created_at
       FROM admin_permission_override o JOIN permission p ON p.id = o.permission_id
       WHERE o.admin_user_id = $1 ORDER BY p.key`,
      [userId],
    );
    const sessions = await client.query(
      `SELECT id, created_at, expires_at, revoked_at, revoke_reason
       FROM admin_session WHERE admin_user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );
    return { ...item, effectivePermissions: grants.rows, overrides: overrides.rows, sessions: sessions.rows };
  } finally {
    client.release();
  }
}

export async function createAdminUser(input: {
  name: string;
  email: string;
  phone?: string | null;
  roleIds: string[];
}, actorId: string, authz: AuthorizationContext) {
  const email = input.email.trim();
  const normalizedEmail = email.toLocaleLowerCase("en-US");
  const id = randomUUID();
  const usernameBase = normalizedEmail.split("@")[0]?.replace(/[^a-z0-9_-]/gi, "-").slice(0, 45) || "equipe";
  const username = `${usernameBase}-${id.slice(0, 8)}`;
  const passwordHash = await argon2.hash(randomBytes(48).toString("base64url"), { type: argon2.argon2id });
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(881188, 12)");
    await assertDelegableRoles(client, actorId, authz, input.roleIds);
    const created = await client.query(
      `INSERT INTO admin_user
         (id, name, username, password_hash, role, active, email, email_normalized,
          phone, phone_normalized, must_change_password)
       VALUES ($1, $2, $3, $4, 'viewer', false, $5, $6, $7, $7, true)
       RETURNING id, name, username, email, active, version`,
      [id, input.name.trim(), username, passwordHash, email, normalizedEmail, input.phone ?? null],
    );
    await assignRoles(client, id, input.roleIds);
    await audit(client, actorId, "admin_user.invited", "admin_user", id, {
      emailDomain: normalizedEmail.split("@")[1] ?? null,
      roleCount: [...new Set(input.roleIds)].length,
    });
    await client.query("COMMIT");
    committed = true;
    const delivery = await deliverIdentityToken({ adminUserId: id, email, name: input.name, kind: "invite", createdByAdminUserId: actorId });
    return { user: created.rows[0], deliveryStatus: delivery.status };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(409, "ADMIN_EMAIL_EXISTS", "Ja existe um usuario com esse e-mail ou identificador.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function resendAdminInvitation(userId: string, actorId: string) {
  const result = await pool.query<{
    id: string; email: string; name: string; must_change_password: boolean; email_verified_at: Date | null; is_super_admin: boolean;
  }>(
    "SELECT id, email, name, must_change_password, email_verified_at, is_super_admin FROM admin_user WHERE id = $1",
    [userId],
  );
  const user = result.rows[0];
  if (!user) throw new AppError(404, "ADMIN_USER_NOT_FOUND", "Usuario administrativo nao encontrado.");
  if (user.is_super_admin || !user.must_change_password || user.email_verified_at) {
    throw new AppError(409, "ADMIN_INVITATION_NOT_AVAILABLE", "Este usuario nao possui um convite pendente.");
  }
  const delivery = await deliverIdentityToken({ adminUserId: user.id, email: user.email, name: user.name, kind: "invite", createdByAdminUserId: actorId });
  return { deliveryStatus: delivery.status };
}

export async function updateAdminUser(
  userId: string,
  input: { name?: string; email?: string; phone?: string | null; active?: boolean; roleIds?: string[]; version: number },
  actorId: string,
  authz: AuthorizationContext,
) {
  const client = await pool.connect();
  let emailVerification: { email: string; name: string } | null = null;
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(881188, 12)");
    const existingResult = await client.query<{
      id: string; name: string; email: string | null; active: boolean; version: number; is_super_admin: boolean;
      email_verified_at: Date | null; must_change_password: boolean;
    }>("SELECT id, name, email, active, version, is_super_admin, email_verified_at, must_change_password FROM admin_user WHERE id = $1 FOR UPDATE", [userId]);
    const existing = existingResult.rows[0];
    if (!existing) throw new AppError(404, "ADMIN_USER_NOT_FOUND", "Usuario administrativo nao encontrado.");
    if (existing.version !== input.version) throw new AppError(409, "ADMIN_USER_VERSION_CONFLICT", "O usuario foi alterado em outra sessao. Atualize a pagina.");
    if (existing.is_super_admin && (input.active === false || input.roleIds || input.email)) {
      throw new AppError(403, "PROTECTED_SUPER_ADMIN", "A identidade protegida nao pode ser desativada, reatribuida ou ter o e-mail trocado pelo painel.");
    }
    if (input.active === true && existing.must_change_password && !existing.email_verified_at) {
      throw new AppError(409, "INVITATION_MUST_BE_ACCEPTED", "O acesso so pode ser ativado depois que a pessoa confirmar o e-mail e definir a senha pelo convite.");
    }
    if (userId === actorId && input.active === false) {
      throw new AppError(403, "SELF_DEACTIVATION_FORBIDDEN", "Nao e permitido desativar a propria conta.");
    }
    if (userId === actorId && input.roleIds) throw new AppError(403, "SELF_ROLE_CHANGE_FORBIDDEN", "Nao e permitido alterar os proprios papeis.");
    if (input.roleIds) await assertDelegableRoles(client, actorId, authz, input.roleIds);
    if (input.active === false || (input.roleIds && existing.active)) {
      const heldRole = await client.query<{ admin_role_id: string | null }>(
        `SELECT (SELECT r.id FROM admin_user_role ur JOIN role r ON r.id = ur.role_id
                WHERE ur.admin_user_id = $1 AND r.key = 'admin' LIMIT 1) AS admin_role_id`,
        [userId],
      );
      const adminRoleId = heldRole.rows[0]?.admin_role_id;
      const removesAdmin = input.active === false || (Boolean(adminRoleId && input.roleIds && !input.roleIds.includes(adminRoleId)));
      if (adminRoleId && removesAdmin) {
        const remaining = await client.query<{ total: string }>(
          `SELECT count(*)::text AS total FROM admin_user u
           WHERE u.active = true AND u.id <> $1 AND (
             u.is_super_admin = true OR EXISTS (
               SELECT 1 FROM admin_user_role ur JOIN role r ON r.id = ur.role_id
               WHERE ur.admin_user_id = u.id AND r.key = 'admin'
             )
           )`,
          [userId],
        );
        if (Number(remaining.rows[0]?.total ?? 0) === 0) {
          throw new AppError(409, "LAST_ACTIVE_ADMIN", "A ultima conta administrativa ativa nao pode ser desativada ou perder o papel admin.");
        }
      }
    }

    const nextEmail = input.email?.trim();
    const emailChanged = nextEmail !== undefined && nextEmail.toLocaleLowerCase("en-US") !== existing.email?.toLocaleLowerCase("en-US");
    const updated = await client.query(
      `UPDATE admin_user SET
         name = COALESCE($2, name),
         email = CASE WHEN $3::boolean THEN $4 ELSE email END,
         email_normalized = CASE WHEN $3::boolean THEN lower($4) ELSE email_normalized END,
         email_verified_at = CASE WHEN $3::boolean THEN NULL ELSE email_verified_at END,
         phone = CASE WHEN $5::boolean THEN $6 ELSE phone END,
         phone_normalized = CASE WHEN $5::boolean THEN $6 ELSE phone_normalized END,
         active = COALESCE($7, active),
         authz_version = authz_version + CASE WHEN $7::boolean IS NOT NULL OR $8::boolean THEN 1 ELSE 0 END,
         version = version + 1,
         updated_at = now()
       WHERE id = $1 AND version = $9
       RETURNING id, name, username, email, email_verified_at, phone, active, is_super_admin, role, version, last_login_at`,
      [userId, input.name ?? null, emailChanged, nextEmail ?? null, input.phone !== undefined, input.phone ?? null, input.active ?? null, Boolean(input.roleIds), input.version],
    );
    const user = updated.rows[0];
    if (!user) throw new AppError(409, "ADMIN_USER_VERSION_CONFLICT", "O usuario foi alterado em outra sessao. Atualize a pagina.");
    if (input.roleIds) await assignRoles(client, userId, input.roleIds);
    if (input.active === false || input.roleIds) {
      await client.query(
        `UPDATE admin_session SET revoked_at = now(), revoke_reason = 'access_changed'
         WHERE admin_user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
    }
    if (input.active === false || emailChanged) {
      await client.query(
        `UPDATE admin_identity_token
         SET revoked_at = now()
         WHERE admin_user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
        [userId],
      );
    }
    if (emailChanged && nextEmail) emailVerification = { email: nextEmail, name: input.name ?? existing.name };
    await audit(client, actorId, "admin_user.updated", "admin_user", userId, {
      changed: [input.name && "name", emailChanged && "email", input.phone !== undefined && "phone", input.active !== undefined && "active", input.roleIds && "roles"].filter(Boolean),
      active: user.active,
    });
    await client.query("COMMIT");
    committed = true;
    let emailDeliveryStatus: string | undefined;
    if (emailVerification) {
      const delivery = await deliverIdentityToken({ adminUserId: userId, email: emailVerification.email, name: emailVerification.name, kind: "email_verification", createdByAdminUserId: actorId });
      emailDeliveryStatus = delivery.status;
    }
    return { user, emailDeliveryStatus };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(409, "ADMIN_EMAIL_EXISTS", "Ja existe um usuario com esse e-mail ou identificador.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAdminOverrides(
  userId: string,
  overrides: Array<{ permissionKey: string; effect: "ALLOW" | "DENY"; scopeType?: ScopeType; departmentId?: string | null; reason: string }>,
  actorId: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(881188, 12)");
    if (!await actorIsSuperAdmin(client, actorId)) {
      throw new AppError(403, "OVERRIDE_DELEGATION_FORBIDDEN", "Somente o Super Admin pode gerenciar excecoes individuais de acesso.");
    }
    if (actorId === userId) throw new AppError(403, "SELF_PERMISSION_CHANGE_FORBIDDEN", "Nao e permitido alterar as proprias excecoes de acesso.");
    const target = await client.query<{ is_super_admin: boolean }>("SELECT is_super_admin FROM admin_user WHERE id = $1 FOR UPDATE", [userId]);
    if (!target.rows[0]) throw new AppError(404, "ADMIN_USER_NOT_FOUND", "Usuario administrativo nao encontrado.");
    if (target.rows[0].is_super_admin) throw new AppError(403, "PROTECTED_SUPER_ADMIN", "Nao e permitido alterar overrides da conta protegida.");
    await client.query("DELETE FROM admin_permission_override WHERE admin_user_id = $1", [userId]);
    for (const item of overrides) {
      if (privilegedPermissions.has(item.permissionKey) && item.effect === "ALLOW") {
        throw new AppError(403, "PROTECTED_PERMISSION", "Overrides de permissoes administrativas protegidas nao sao permitidos.");
      }
      const permission = await client.query<{ id: string }>("SELECT id FROM permission WHERE key = $1", [item.permissionKey]);
      if (!permission.rows[0]) throw new AppError(400, "UNKNOWN_PERMISSION", "O catalogo de permissoes mudou. Atualize a pagina.");
      if (item.effect === "ALLOW" && !item.scopeType) throw new AppError(400, "OVERRIDE_SCOPE_REQUIRED", "Uma permissao ALLOW exige escopo explicito.");
      await client.query(
        `INSERT INTO admin_permission_override
           (admin_user_id, permission_id, effect, scope_type, department_id, reason, created_by_admin_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (admin_user_id, permission_id) DO UPDATE SET
           effect = EXCLUDED.effect, scope_type = EXCLUDED.scope_type,
           department_id = EXCLUDED.department_id, reason = EXCLUDED.reason,
           created_by_admin_user_id = EXCLUDED.created_by_admin_user_id, created_at = now()`,
        [userId, permission.rows[0].id, item.effect, item.effect === "ALLOW" ? item.scopeType : null, item.effect === "ALLOW" ? item.departmentId ?? null : null, item.reason, actorId],
      );
    }
    await client.query("UPDATE admin_user SET authz_version = authz_version + 1, version = version + 1, updated_at = now() WHERE id = $1", [userId]);
    await client.query("UPDATE admin_session SET revoked_at = now(), revoke_reason = 'permissions_changed' WHERE admin_user_id = $1 AND revoked_at IS NULL", [userId]);
    await audit(client, actorId, "admin_user.overrides_updated", "admin_user", userId, { count: overrides.length });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeAdminUserSession(sessionId: string, targetUserId: string, actorId: string) {
  const result = await pool.query(
    `UPDATE admin_session SET revoked_at = now(), revoke_reason = 'admin_revoked'
     WHERE id = $1 AND admin_user_id = $2 AND revoked_at IS NULL RETURNING id`,
    [sessionId, targetUserId],
  );
  if (!result.rowCount) throw new AppError(404, "ADMIN_SESSION_NOT_FOUND", "Sessao ativa nao encontrada.");
  await pool.query(
    `INSERT INTO admin_audit_log (admin_user_id, action, resource_type, resource_id, metadata)
     VALUES ($1, 'admin_session.revoked', 'admin_session', $2, '{}'::jsonb)`,
    [actorId, sessionId],
  );
}

export async function sendAdminPasswordReset(userId: string, reason: string, actorId: string) {
  const result = await pool.query<{ id: string; email: string | null; name: string; email_verified_at: Date | null; is_super_admin: boolean }>(
    "SELECT id, email, name, email_verified_at, is_super_admin FROM admin_user WHERE id = $1",
    [userId],
  );
  const user = result.rows[0];
  if (!user) throw new AppError(404, "ADMIN_USER_NOT_FOUND", "Usuario administrativo nao encontrado.");
  if (user.is_super_admin) throw new AppError(403, "ROOT_RECOVERY_SELF_SERVICE_ONLY", "O Super Admin deve iniciar a recuperacao pelo fluxo proprio de esqueci minha senha.");
  if (!user.email || !user.email_verified_at) throw new AppError(409, "VERIFIED_EMAIL_REQUIRED", "O usuario precisa confirmar um e-mail antes da recuperacao por link.");
  const delivery = await deliverIdentityToken({ adminUserId: user.id, email: user.email, name: user.name, kind: "password_reset", createdByAdminUserId: actorId });
  const client = await pool.connect();
  try {
    await audit(client, actorId, "admin_user.password_reset_requested", "admin_user", user.id, { reason, deliveryStatus: delivery.status });
  } finally {
    client.release();
  }
  return { deliveryStatus: delivery.status };
}
