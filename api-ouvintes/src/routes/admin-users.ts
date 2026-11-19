import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { requireAuthentication, requirePermission } from "../plugins/auth.js";
import { AppError } from "../lib/errors.js";
import { hasGlobalPermission } from "../services/authorization-service.js";
import {
  adminPermissionOverrideSchema,
  adminUserListQuerySchema,
  createAdminUserSchema,
  passwordResetAdminSchema,
  updateAdminUserSchema,
} from "../schemas/admin-user.js";
import {
  createAdminUser,
  getAdminUserDetail,
  listAdminUsers,
  resendAdminInvitation,
  requireRecentAdminReauthentication,
  revokeAdminUserSession,
  sendAdminPasswordReset,
  updateAdminOverrides,
  updateAdminUser,
} from "../services/admin-user-service.js";

function actor(request: FastifyRequest) {
  if (!request.authz) throw new AppError(401, "ADMIN_SESSION_INVALID", "Sessao invalida.");
  return request.authz;
}

function requireGlobal(request: FastifyRequest, permission: string) {
  if (!hasGlobalPermission(actor(request), permission)) {
    throw new AppError(403, "GLOBAL_SCOPE_REQUIRED", "Esta operacao exige permissao global sobre a equipe administrativa.");
  }
}

export const adminUserRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    { preHandler: [requireAuthentication, requirePermission("user.read")] },
    async (request) => {
      requireGlobal(request, "user.read");
      return listAdminUsers(adminUserListQuerySchema.parse(request.query));
    },
  );

  app.post(
    "/",
    { preHandler: [requireAuthentication, requirePermission("user.create")] },
    async (request, reply) => {
      const authz = actor(request);
      requireGlobal(request, "user.create");
      await requireRecentAdminReauthentication(authz.sessionId, authz.adminUserId);
      const input = createAdminUserSchema.parse(request.body);
      const result = await createAdminUser(input, authz.adminUserId, authz);
      return reply.code(201).send(result);
    },
  );

  app.get(
    "/:userId",
    { preHandler: [requireAuthentication, requirePermission("user.permissions.read")] },
    async (request) => {
      requireGlobal(request, "user.permissions.read");
      const { userId } = request.params as { userId: string };
      return { user: await getAdminUserDetail(userId) };
    },
  );

  app.patch(
    "/:userId",
    { preHandler: [requireAuthentication, requirePermission("user.update")] },
    async (request) => {
      const authz = actor(request);
      requireGlobal(request, "user.update");
      await requireRecentAdminReauthentication(authz.sessionId, authz.adminUserId);
      const { userId } = request.params as { userId: string };
      const input = updateAdminUserSchema.parse(request.body);
      if (input.active !== undefined && !hasGlobalPermission(authz, "user.deactivate")) {
        throw new AppError(403, "INSUFFICIENT_PERMISSION", "Permissao insuficiente para ativar ou desativar usuarios.");
      }
      return updateAdminUser(userId, input, authz.adminUserId, authz);
    },
  );

  app.post(
    "/:userId/invitation/resend",
    { preHandler: [requireAuthentication, requirePermission("user.create")] },
    async (request) => {
      const authz = actor(request);
      requireGlobal(request, "user.create");
      await requireRecentAdminReauthentication(authz.sessionId, authz.adminUserId);
      const { userId } = request.params as { userId: string };
      return resendAdminInvitation(userId, authz.adminUserId);
    },
  );

  app.put(
    "/:userId/overrides",
    { preHandler: [requireAuthentication, requirePermission("user.permissions.manage")] },
    async (request, reply) => {
      const authz = actor(request);
      requireGlobal(request, "user.permissions.manage");
      await requireRecentAdminReauthentication(authz.sessionId, authz.adminUserId);
      const { userId } = request.params as { userId: string };
      const input = adminPermissionOverrideSchema.parse(request.body);
      await updateAdminOverrides(userId, input.overrides, authz.adminUserId);
      return reply.code(204).send();
    },
  );

  app.post(
    "/:userId/password-reset",
    { preHandler: [requireAuthentication, requirePermission("user.password.reset")] },
    async (request) => {
      const authz = actor(request);
      requireGlobal(request, "user.password.reset");
      await requireRecentAdminReauthentication(authz.sessionId, authz.adminUserId);
      const { userId } = request.params as { userId: string };
      const input = passwordResetAdminSchema.parse(request.body);
      return sendAdminPasswordReset(userId, input.reason, authz.adminUserId);
    },
  );

  app.get(
    "/:userId/sessions",
    { preHandler: [requireAuthentication, requirePermission("user.read")] },
    async (request) => {
      requireGlobal(request, "user.read");
      const { userId } = request.params as { userId: string };
      const user = await getAdminUserDetail(userId);
      return { items: user.sessions };
    },
  );

  app.delete(
    "/:userId/sessions/:sessionId",
    { preHandler: [requireAuthentication, requirePermission("user.session.revoke")] },
    async (request, reply) => {
      const authz = actor(request);
      requireGlobal(request, "user.session.revoke");
      await requireRecentAdminReauthentication(authz.sessionId, authz.adminUserId);
      const { userId, sessionId } = request.params as { userId: string; sessionId: string };
      await revokeAdminUserSession(sessionId, userId, authz.adminUserId);
      return reply.code(204).send();
    },
  );
};
