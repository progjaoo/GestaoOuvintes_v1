import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { pool } from "../database/client.js";
import { AppError } from "../lib/errors.js";
import { requireAuthentication, requirePermission } from "../plugins/auth.js";
import { createRoleSchema, updateRoleSchema } from "../schemas/admin-user.js";
import { requireRecentAdminReauthentication } from "../services/admin-user-service.js";
import { hasGlobalPermission, type AuthorizationContext } from "../services/authorization-service.js";

const protectedPermissions = new Set([
  "user.manage", "user.permissions.manage", "role.manage", "user.deactivate",
  "user.password.reset", "user.session.revoke", "role.create", "role.update",
]);

function authz(request: FastifyRequest): AuthorizationContext {
  if (!request.authz) throw new AppError(401, "ADMIN_SESSION_INVALID", "Sessao invalida.");
  return request.authz;
}

function requireGlobalRoleAccess(request: FastifyRequest, permission: string) {
  if (!hasGlobalPermission(authz(request), permission)) {
    throw new AppError(403, "GLOBAL_SCOPE_REQUIRED", "Esta operacao exige permissao global para administrar papeis.");
  }
}

async function canGrant(request: FastifyRequest, grants: Array<{ permissionKey: string; scopeType: "global" | "own" | "participation" | "department"; departmentId?: string | null }>) {
  const context = authz(request);
  const actor = await pool.query<{ is_super_admin: boolean }>("SELECT is_super_admin FROM admin_user WHERE id = $1", [context.adminUserId]);
  const isSuperAdmin = actor.rows[0]?.is_super_admin === true;
  for (const grant of grants) {
    if (protectedPermissions.has(grant.permissionKey) && !isSuperAdmin) {
      throw new AppError(403, "ROLE_DELEGATION_FORBIDDEN", "Somente o Super Admin pode delegar permissoes administrativas protegidas.");
    }
    if (isSuperAdmin) continue;
    const ownScopes = context.scopes.get(grant.permissionKey) ?? [];
    const scopeAllowed = ownScopes.some((scope) =>
      scope.type === "global" ||
      (scope.type === grant.scopeType &&
        (scope.type !== "department" || scope.departmentId === grant.departmentId || scope.departmentId === null)),
    );
    if (!scopeAllowed || (grant.scopeType === "global" && !hasGlobalPermission(context, grant.permissionKey))) {
      throw new AppError(403, "ROLE_DELEGATION_FORBIDDEN", "Nao e permitido delegar acesso alem do seu escopo.");
    }
  }
}

async function replaceRoleGrants(
  client: import("pg").PoolClient,
  roleId: string,
  grants: Array<{ permissionKey: string; scopeType: "global" | "own" | "participation" | "department"; departmentId?: string | null }>,
) {
  const keys = [...new Set(grants.map((grant) => grant.permissionKey))];
  const permissions = await client.query<{ id: string; key: string }>(
    "SELECT id, key FROM permission WHERE key = ANY($1::varchar[])",
    [keys],
  );
  if (permissions.rows.length !== keys.length) throw new AppError(400, "UNKNOWN_PERMISSION", "Uma permissao nao existe no catalogo.");
  await client.query("DELETE FROM role_permission WHERE role_id = $1", [roleId]);
  const insertedScopes = new Set<string>();
  for (const grant of grants) {
    const permission = permissions.rows.find((item) => item.key === grant.permissionKey);
    if (!permission) continue;
    await client.query("INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [roleId, permission.id]);
    const scopeKey = `${permission.id}:${grant.scopeType}:${grant.scopeType === "department" ? grant.departmentId ?? "" : ""}`;
    if (insertedScopes.has(scopeKey)) continue;
    insertedScopes.add(scopeKey);
    await client.query(
      `INSERT INTO role_permission_scope (role_id, permission_id, scope_type, department_id)
       VALUES ($1, $2, $3, $4)`,
      [roleId, permission.id, grant.scopeType, grant.scopeType === "department" ? grant.departmentId ?? null : null],
    );
  }
}

export const adminRoleRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    { preHandler: [requireAuthentication, requirePermission("role.read")] },
    async (request) => {
      requireGlobalRoleAccess(request, "role.read");
      const result = await pool.query(
        `SELECT r.id, r.key, r.name, r.description, r.version, r.updated_at,
                count(DISTINCT ur.admin_user_id)::int AS user_count,
                COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                  'permissionKey', p.key, 'description', p.description,
                  'scopeType', rps.scope_type, 'departmentId', rps.department_id
                )) FILTER (WHERE p.key IS NOT NULL), '[]'::jsonb) AS grants
         FROM role r
         LEFT JOIN admin_user_role ur ON ur.role_id = r.id
         LEFT JOIN role_permission rp ON rp.role_id = r.id
         LEFT JOIN permission p ON p.id = rp.permission_id
         LEFT JOIN role_permission_scope rps ON rps.role_id = rp.role_id AND rps.permission_id = rp.permission_id
         GROUP BY r.id ORDER BY r.name`,
      );
      return { items: result.rows };
    },
  );

  app.post(
    "/",
    { preHandler: [requireAuthentication, requirePermission("role.create")] },
    async (request, reply) => {
      const context = authz(request);
      requireGlobalRoleAccess(request, "role.create");
      await requireRecentAdminReauthentication(context.sessionId, context.adminUserId);
      const input = createRoleSchema.parse(request.body);
      await canGrant(request, input.grants);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(881188, 12)");
        const created = await client.query(
          "INSERT INTO role (key, name, description) VALUES ($1, $2, $3) RETURNING id, key, name, description, version",
          [input.key, input.name, input.description ?? null],
        );
        const role = created.rows[0];
        if (!role) throw new AppError(500, "ROLE_CREATE_FAILED", "Nao foi possivel criar o papel.");
        await replaceRoleGrants(client, role.id, input.grants);
        await client.query(
          `INSERT INTO admin_audit_log (admin_user_id, action, resource_type, resource_id, metadata)
           VALUES ($1, 'role.created', 'role', $2, $3::jsonb)`,
          [context.adminUserId, role.id, JSON.stringify({ key: input.key, grantCount: input.grants.length })],
        );
        await client.query("COMMIT");
        return reply.code(201).send(role);
      } catch (error) {
        await client.query("ROLLBACK");
        if ((error as { code?: string }).code === "23505") throw new AppError(409, "ROLE_KEY_EXISTS", "Ja existe um papel com essa chave.");
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.patch(
    "/:roleId",
    { preHandler: [requireAuthentication, requirePermission("role.update")] },
    async (request) => {
      const context = authz(request);
      requireGlobalRoleAccess(request, "role.update");
      await requireRecentAdminReauthentication(context.sessionId, context.adminUserId);
      const { roleId } = request.params as { roleId: string };
      const input = updateRoleSchema.parse(request.body);
      await canGrant(request, input.grants);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(881188, 12)");
        const currentResult = await client.query<{ key: string; version: number }>("SELECT key, version FROM role WHERE id = $1 FOR UPDATE", [roleId]);
        const current = currentResult.rows[0];
        if (!current) throw new AppError(404, "ROLE_NOT_FOUND", "Papel nao encontrado.");
        if (current.key === "admin") throw new AppError(403, "PROTECTED_ROLE", "O papel estrutural de administrador nao pode ser editado pelo painel.");
        if (current.version !== input.version) throw new AppError(409, "ROLE_VERSION_CONFLICT", "O papel foi alterado em outra sessao.");
        const linked = await client.query<{ admin_user_id: string; is_super_admin: boolean }>(
          `SELECT ur.admin_user_id, u.is_super_admin
           FROM admin_user_role ur JOIN admin_user u ON u.id = ur.admin_user_id
           WHERE ur.role_id = $1 FOR UPDATE`,
          [roleId],
        );
        if (linked.rows.some((row) => row.is_super_admin)) throw new AppError(403, "PROTECTED_ROLE", "Este papel esta associado a identidade Super Admin e nao pode ser alterado.");
        if (linked.rows.some((row) => row.admin_user_id === context.adminUserId)) throw new AppError(403, "SELF_ROLE_CHANGE_FORBIDDEN", "Nao e permitido alterar um papel atribuido a sua propria conta.");
        const updated = await client.query(
          `UPDATE role SET name = $2, description = $3, version = version + 1, updated_at = now()
           WHERE id = $1 AND version = $4 RETURNING id, key, name, description, version`,
          [roleId, input.name, input.description ?? null, input.version],
        );
        if (!updated.rows[0]) throw new AppError(409, "ROLE_VERSION_CONFLICT", "O papel foi alterado em outra sessao.");
        await replaceRoleGrants(client, roleId, input.grants);
        const userIds = linked.rows.map((row) => row.admin_user_id);
        if (userIds.length) {
          await client.query("UPDATE admin_user SET authz_version = authz_version + 1, version = version + 1, updated_at = now() WHERE id = ANY($1::uuid[])", [userIds]);
          await client.query("UPDATE admin_session SET revoked_at = now(), revoke_reason = 'role_changed' WHERE admin_user_id = ANY($1::uuid[]) AND revoked_at IS NULL", [userIds]);
        }
        await client.query(
          `INSERT INTO admin_audit_log (admin_user_id, action, resource_type, resource_id, metadata)
           VALUES ($1, 'role.updated', 'role', $2, $3::jsonb)`,
          [context.adminUserId, roleId, JSON.stringify({ grantCount: input.grants.length, affectedUsers: userIds.length })],
        );
        await client.query("COMMIT");
        return updated.rows[0];
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.delete(
    "/:roleId",
    { preHandler: [requireAuthentication, requirePermission("role.update")] },
    async (request, reply) => {
      const context = authz(request);
      requireGlobalRoleAccess(request, "role.update");
      await requireRecentAdminReauthentication(context.sessionId, context.adminUserId);
      const { roleId } = request.params as { roleId: string };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(881188, 12)");
        const current = await client.query<{ key: string }>("SELECT key FROM role WHERE id = $1 FOR UPDATE", [roleId]);
        if (!current.rows[0]) throw new AppError(404, "ROLE_NOT_FOUND", "Papel nao encontrado.");
        if (["admin", "viewer", "campaign_manager", "receptionist", "announcer", "auditor"].includes(current.rows[0].key)) {
          throw new AppError(403, "PROTECTED_ROLE", "Papeis base nao podem ser removidos.");
        }
        const users = await client.query("SELECT 1 FROM admin_user_role WHERE role_id = $1 LIMIT 1", [roleId]);
        if (users.rowCount) throw new AppError(409, "ROLE_IN_USE", "Remova o papel dos usuarios antes de exclui-lo.");
        await client.query("DELETE FROM role WHERE id = $1", [roleId]);
        await client.query(
          `INSERT INTO admin_audit_log (admin_user_id, action, resource_type, resource_id, metadata)
           VALUES ($1, 'role.deleted', 'role', $2, '{}'::jsonb)`,
          [context.adminUserId, roleId],
        );
        await client.query("COMMIT");
        return reply.code(204).send();
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );
};
