import type { FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import {
  hasGlobalPermission,
  hasPermissionScope,
  loadAuthorizationContext,
  type AuthorizationContext,
} from "../services/authorization-service.js";

export async function requireAuthentication(request: FastifyRequest) {
  await request.jwtVerify();
  const context = await loadAuthorizationContext({
    adminUserId: request.user.sub,
    sessionId: request.user.sid,
    authzVersion: request.user.authzVersion,
  });

  if (!context) {
    throw new AppError(401, "ADMIN_SESSION_INVALID", "Sessao invalida ou revogada.");
  }

  request.authz = context;
}

export const requireAdminRole = requirePermission("user.manage");

export function requirePermission(permissionKey: string) {
  return async function permissionPreHandler(request: FastifyRequest) {
    // Existing collection/administrative routes are not resource-filtered yet.
    // A scoped grant must not silently become global access to those endpoints.
    if (!hasGlobalPermission(request.authz, permissionKey)) {
      throw new AppError(403, "INSUFFICIENT_PERMISSION", "Permissao insuficiente.");
    }
  };
}

export function requireResourcePermission(
  permissionKey: string,
  resolveResource: (
    request: FastifyRequest,
  ) => Promise<{ ownerId?: string | null; participantIds?: string[]; departmentId?: string | null } | null>,
) {
  return async function resourcePermissionPreHandler(request: FastifyRequest) {
    if (!request.authz?.permissions.has(permissionKey)) {
      throw new AppError(403, "INSUFFICIENT_PERMISSION", "Permissao insuficiente.");
    }
    const resource = await resolveResource(request);
    if (!resource || !hasPermissionScope(request.authz, permissionKey, resource)) {
      throw new AppError(403, "INSUFFICIENT_PERMISSION", "Permissao insuficiente.");
    }
  };
}
