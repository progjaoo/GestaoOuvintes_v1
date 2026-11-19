import { pool } from "../database/client.js";

export type ScopeType = "global" | "own" | "participation" | "department";

export interface PermissionScope {
  type: ScopeType;
  departmentId: string | null;
}

export interface AuthorizationContext {
  adminUserId: string;
  sessionId: string;
  authzVersion: number;
  permissions: Set<string>;
  scopes: Map<string, PermissionScope[]>;
  departmentIds: Set<string>;
}

export interface AuthorizationRow {
  admin_user_id: string;
  session_id: string;
  authz_version: number;
  permission_key: string | null;
  scope_type: ScopeType | null;
  department_id: string | null;
  department_ids: string[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidAuthorizationIdentity(userId: string, sessionId: string, version: unknown) {
  return UUID_PATTERN.test(userId) && UUID_PATTERN.test(sessionId) &&
    Number.isSafeInteger(version) && Number(version) > 0;
}

export function createAuthorizationContext(rows: AuthorizationRow[]): AuthorizationContext | null {
  const first = rows[0];
  if (!first) return null;

  const permissions = new Set<string>();
  const scopes = new Map<string, PermissionScope[]>();
  const departmentIds = new Set(first.department_ids ?? []);

  for (const row of rows) {
    if (!row.permission_key || !row.scope_type) continue;
    if (row.scope_type === "department") {
      const hasDepartmentScope = row.department_id
        ? departmentIds.has(row.department_id)
        : departmentIds.size > 0;
      if (!hasDepartmentScope) continue;
    }

    permissions.add(row.permission_key);
    const grants = scopes.get(row.permission_key) ?? [];
    grants.push({ type: row.scope_type, departmentId: row.department_id });
    scopes.set(row.permission_key, grants);
  }

  return {
    adminUserId: first.admin_user_id,
    sessionId: first.session_id,
    authzVersion: Number(first.authz_version),
    permissions,
    scopes,
    departmentIds,
  };
}

export function hasPermission(context: AuthorizationContext | null | undefined, key: string) {
  return context?.permissions.has(key) ?? false;
}

export function hasGlobalPermission(
  context: AuthorizationContext | null | undefined,
  key: string,
) {
  return (context?.scopes.get(key) ?? []).some((scope) => scope.type === "global");
}

export function hasPermissionScope(
  context: AuthorizationContext | null | undefined,
  key: string,
  resource: { ownerId?: string | null; participantIds?: string[]; departmentId?: string | null },
) {
  const grants = context?.scopes.get(key) ?? [];
  return grants.some((grant) => {
    if (grant.type === "global") return true;
    if (grant.type === "own") return resource.ownerId === context?.adminUserId;
    if (grant.type === "participation") {
      return resource.participantIds?.includes(context?.adminUserId ?? "") ?? false;
    }
    if (grant.type === "department" && resource.departmentId) {
      return context?.departmentIds.has(resource.departmentId) === true &&
        (grant.departmentId === null || grant.departmentId === resource.departmentId);
    }
    return false;
  });
}

export async function loadAuthorizationContext(input: {
  adminUserId: string;
  sessionId: string;
  authzVersion: number;
  sessionType?: 'interactive' | 'automation';
}): Promise<AuthorizationContext | null> {
  if (!isValidAuthorizationIdentity(input.adminUserId, input.sessionId, input.authzVersion)) {
    return null;
  }

  const result = await pool.query<AuthorizationRow>(
    `WITH current_identity AS (
       SELECT au.id AS admin_user_id,
              s.id AS session_id,
              au.authz_version,
              ARRAY(
                SELECT aud.department_id
                FROM admin_user_department aud
                JOIN admin_department d ON d.id = aud.department_id AND d.active = true
                WHERE aud.admin_user_id = au.id
              )::text[] AS department_ids
       FROM admin_user au
       JOIN admin_session s ON s.admin_user_id = au.id
       WHERE au.id = $1
         AND s.id = $2
         AND s.session_type = $4
         AND au.authz_version = $3
         AND s.authz_version = au.authz_version
         AND au.active = true
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
     ), effective_grants AS (
       SELECT p.key AS permission_key,
              rps.scope_type,
              rps.department_id
       FROM admin_user_role aur
       JOIN role_permission rp ON rp.role_id = aur.role_id
       JOIN permission p ON p.id = rp.permission_id
       JOIN role_permission_scope rps
         ON rps.role_id = rp.role_id AND rps.permission_id = rp.permission_id
       WHERE aur.admin_user_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM admin_permission_override denied
           WHERE denied.admin_user_id = $1
             AND denied.permission_id = p.id
             AND denied.effect = 'DENY'
         )
       UNION ALL
       SELECT p.key AS permission_key,
              allowed.scope_type,
              allowed.department_id
       FROM admin_permission_override allowed
       JOIN permission p ON p.id = allowed.permission_id
       WHERE allowed.admin_user_id = $1 AND allowed.effect = 'ALLOW'
     )
     SELECT ci.admin_user_id,
            ci.session_id,
            ci.authz_version,
            eg.permission_key,
            eg.scope_type,
            eg.department_id,
            ci.department_ids
     FROM current_identity ci
     LEFT JOIN effective_grants eg ON true`,
    [input.adminUserId, input.sessionId, input.authzVersion, input.sessionType ?? 'interactive'],
  );

  return createAuthorizationContext(result.rows);
}

export async function createAdminSession(adminUserId: string, expiresAt: Date) {
  const result = await pool.query<{ id: string; authz_version: number }>(
    `INSERT INTO admin_session (admin_user_id, authz_version, expires_at, reauthenticated_at)
     SELECT id, authz_version, $2, now()
     FROM admin_user
     WHERE id = $1 AND active = true
     RETURNING id, authz_version`,
    [adminUserId, expiresAt],
  );

  return result.rows[0] ?? null;
}

export async function createAdminAutomationSession(adminUserId: string, expiresAt: Date) {
  const result = await pool.query<{ id: string; authz_version: number }>(
    `INSERT INTO admin_session (admin_user_id, authz_version, expires_at, session_type)
     SELECT id, authz_version, $2, 'automation'
     FROM admin_user WHERE id = $1 AND active = true
     RETURNING id, authz_version`,
    [adminUserId, expiresAt],
  );
  return result.rows[0] ?? null;
}

export async function revokeAdminSession(sessionId: string, adminUserId: string) {
  await pool.query(
    `UPDATE admin_session
     SET revoked_at = now(), revoke_reason = 'logout'
     WHERE id = $1 AND admin_user_id = $2 AND revoked_at IS NULL`,
    [sessionId, adminUserId],
  );
}
