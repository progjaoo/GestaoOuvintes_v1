import type { FastifyPluginAsync } from "fastify";
import { env } from "../config/env.js";
import { requireAuthentication } from "../plugins/auth.js";
import { pool } from "../database/client.js";
import { AppError } from "../lib/errors.js";
import {
  identityTokenConsumeSchema,
  loginSchema,
  passwordResetRequestSchema,
  reauthenticateSchema,
} from "../schemas/auth.js";
import {
  createAdminSession,
  loadAuthorizationContext,
  revokeAdminSession,
} from "../services/authorization-service.js";
import {
  authenticateAdmin,
  canBootstrapAdmin,
  getActiveAdmin,
  jwtExpiresAt,
  verifyAdminPassword,
} from "../services/auth-service.js";
import { consumeIdentityToken, requestAdminEmailVerification, requestPasswordReset } from "../services/admin-identity-service.js";

async function createAuthenticatedSession(adminUserId: string) {
  const session = await createAdminSession(adminUserId, jwtExpiresAt(env.JWT_EXPIRES_IN));
  if (!session) {
    throw new AppError(401, "ADMIN_INACTIVE", "Usuario administrativo inativo.");
  }

  const authorization = await loadAuthorizationContext({
    adminUserId,
    sessionId: session.id,
    authzVersion: Number(session.authz_version),
  });
  if (!authorization) {
    await revokeAdminSession(session.id, adminUserId);
    throw new AppError(403, "NO_EFFECTIVE_PERMISSIONS", "Usuario sem permissoes ativas.");
  }

  return { session, authorization };
}

export const adminAuthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/bootstrap-status", async () => ({ canBootstrap: false }));

  app.post(
    "/bootstrap",
    {
      config: {
        rateLimit: {
          max: env.LOGIN_RATE_LIMIT_PER_MINUTE,
          timeWindow: "1 minute",
        },
      },
    },
    async (_request, reply) => {
      throw new AppError(410, "ADMIN_BOOTSTRAP_DISABLED", "O primeiro acesso deve ser provisionado pelo comando administrativo seguro.");
    },
  );

  app.post(
    "/forgot-password",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = passwordResetRequestSchema.parse(request.body);
      await requestPasswordReset(input.email);
      return reply.code(202).send({ message: "Se o e-mail estiver associado a uma conta, enviaremos as instrucoes de recuperacao." });
    },
  );

  app.post(
    "/identity/consume",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = identityTokenConsumeSchema.parse(request.body);
      await consumeIdentityToken(input.token, input.password);
      return reply.code(204).send();
    },
  );

  app.post(
    "/email-verification/request",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const context = request.authz;
      if (!context) throw new AppError(401, "ADMIN_SESSION_INVALID", "Sessao invalida.");
      await requestAdminEmailVerification(context.adminUserId);
      return reply.code(202).send({ message: "Se a verificacao estiver disponivel, enviaremos as instrucoes para o e-mail da conta." });
    },
  );

  app.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: env.LOGIN_RATE_LIMIT_PER_MINUTE,
          timeWindow: "1 minute",
        },
      },
    },
    async (request) => {
      const input = loginSchema.parse(request.body);
      const user = await authenticateAdmin(input.identifier, input.password);
      const { session, authorization } = await createAuthenticatedSession(user.id);
      const accessToken = app.jwt.sign(
        {
          sub: user.id,
          role: user.role,
          name: user.name,
          username: user.username,
          sid: session.id,
          authzVersion: Number(session.authz_version),
        },
        { expiresIn: env.JWT_EXPIRES_IN },
      );

      return {
        accessToken,
        expiresIn: env.JWT_EXPIRES_IN,
        user: { ...user, permissions: [...authorization.permissions].sort() },
      };
    },
  );

  app.post(
    "/reauthenticate",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const input = reauthenticateSchema.parse(request.body);
      const adminUserId = request.authz?.adminUserId;
      const sessionId = request.authz?.sessionId;
      if (!adminUserId || !sessionId || !await verifyAdminPassword(adminUserId, input.password)) {
        throw new AppError(401, "REAUTHENTICATION_FAILED", "Autenticacao recente nao confirmada.");
      }
      await pool.query(
        "UPDATE admin_session SET reauthenticated_at = now() WHERE id = $1 AND admin_user_id = $2 AND revoked_at IS NULL",
        [sessionId, adminUserId],
      );
      await pool.query(
        `INSERT INTO admin_audit_log (admin_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, 'admin.reauthenticated', 'admin_session', $2, '{}'::jsonb)`,
        [adminUserId, sessionId],
      );
      return reply.code(204).send();
    },
  );

  app.get(
    "/me",
    {
      preHandler: requireAuthentication,
    },
    async (request) => {
      const user = await getActiveAdmin(
        request.user.sub,
        [...(request.authz?.permissions ?? [])].sort(),
      );
      return { user };
    },
  );

  app.post(
    "/logout",
    {
      preHandler: requireAuthentication,
    },
    async (request, reply) => {
      if (request.authz) {
        await revokeAdminSession(request.authz.sessionId, request.authz.adminUserId);
      }
      return reply.code(204).send();
    },
  );
};
