import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { pool } from "../database/client.js";
import { getActiveAdminByClerkUserId } from "../services/auth-service.js";
import { verifyClerkSessionToken } from "../services/clerk-identity-service.js";
import { resolveAdminTenantContext } from "../services/tenant-service.js";

function parseBearerToken(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

async function requireClerkAuthentication(request: FastifyRequest): Promise<void> {
  const token = parseBearerToken(request.headers.authorization);
  if (!token) {
    throw new AppError(401, "UNAUTHORIZED", "Autenticacao necessaria ou token invalido.");
  }

  const claims = await verifyClerkSessionToken(token);
  const user = await getActiveAdminByClerkUserId(claims.sub);
  const context = await resolveAdminTenantContext(user.id);

  request.user = {
    sub: user.id,
    role: user.role === "viewer" ? "viewer" : "admin",
    name: user.name,
    username: user.username,
    tenantId: context.tenantId,
    membershipId: context.membershipId,
    roleKeys: context.roleKeys,
    permissionKeys: context.permissionKeys,
  };
  request.tenant = context;
}

export async function requireAuthentication(request: FastifyRequest) {
  try {
    await request.jwtVerify();
  } catch (legacyError) {
    if (!env.CLERK_ADMIN_AUTH_ENABLED) throw legacyError;
    await requireClerkAuthentication(request);
    return;
  }

  const tenant = await resolveAdminTenantContext(
    request.user.sub,
    request.user.tenantId,
  );
  request.tenant = tenant;
}

export function requireAdminRole(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: (error?: Error) => void,
) {
  const hasTenantAdminRole = request.user.roleKeys?.includes("admin") ?? false;
  const hasRequiredRole = env.TENANT_MEMBERSHIP_RBAC_ENABLED
    ? hasTenantAdminRole
    : env.LEGACY_ADMIN_RBAC_FALLBACK && request.user.role === "admin";
  if (!hasRequiredRole) {
    done(new AppError(403, "INSUFFICIENT_PERMISSION", "Permissao insuficiente."));
    return;
  }

  done();
}

export function requirePermission(permissionKey: string) {
  return async function permissionPreHandler(request: FastifyRequest) {
    if (!env.TENANT_MEMBERSHIP_RBAC_ENABLED && !env.LEGACY_ADMIN_RBAC_FALLBACK) {
      throw new AppError(403, "INSUFFICIENT_PERMISSION", "Permissao insuficiente.");
    }

    const tenantId = request.tenant?.tenantId;
    const query = env.TENANT_MEMBERSHIP_RBAC_ENABLED
      ? `SELECT 1
           FROM tenant_admin_membership tam
           JOIN role_permission rp ON rp.role_id = tam.role_id
           JOIN permission p ON p.id = rp.permission_id
          WHERE tam.admin_user_id = $1
            AND tam.tenant_id = $2
            AND tam.active = true
            AND p.key = $3
          LIMIT 1`
      : `SELECT 1
           FROM admin_user_role aur
           JOIN role_permission rp ON rp.role_id = aur.role_id
           JOIN permission p ON p.id = rp.permission_id
          WHERE aur.admin_user_id = $1 AND p.key = $2
          LIMIT 1`;
    const params = env.TENANT_MEMBERSHIP_RBAC_ENABLED
      ? [request.user.sub, tenantId, permissionKey]
      : [request.user.sub, permissionKey];

    const result = await pool.query(query, params);
    if (!result.rowCount) {
      throw new AppError(403, "INSUFFICIENT_PERMISSION", "Permissao insuficiente.");
    }
  };
}
