import type { FastifyPluginAsync } from "fastify";
import { env } from "../config/env.js";
import { requireAuthentication } from "../plugins/auth.js";
import { bootstrapAdminSchema, loginSchema, selectTenantSchema } from "../schemas/auth.js";
import {
  authenticateAdmin,
  bootstrapFirstAdmin,
  canBootstrapAdmin,
  getActiveAdmin,
} from "../services/auth-service.js";
import {
  ensureAdminDefaultMembership,
  listAdminTenants,
  resolveAdminTenantContext,
} from "../services/tenant-service.js";

function signAdminToken(
  app: Parameters<FastifyPluginAsync>[0],
  user: { id: string; role: string; name: string; username: string },
  context: Awaited<ReturnType<typeof resolveAdminTenantContext>>,
) {
  return app.jwt.sign(
    {
      sub: user.id,
      role: user.role === "viewer" ? "viewer" : "admin",
      name: user.name,
      username: user.username,
      tenantId: context.tenantId,
      membershipId: context.membershipId,
      roleKeys: context.roleKeys,
      permissionKeys: context.permissionKeys,
    },
    { expiresIn: env.JWT_EXPIRES_IN },
  );
}

export const adminAuthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/bootstrap-status", async () => ({
    canBootstrap: await canBootstrapAdmin(),
  }));

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
    async (request, reply) => {
      const input = bootstrapAdminSchema.parse(request.body);
      const user = await bootstrapFirstAdmin(input);
      await ensureAdminDefaultMembership(user.id);
      const context = await resolveAdminTenantContext(user.id);
      const accessToken = signAdminToken(app, user, context);

      return reply.code(201).send({
        accessToken,
        expiresIn: env.JWT_EXPIRES_IN,
        user,
        tenant: context,
      });
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
      const user = await authenticateAdmin(input.username, input.password);
      const context = await resolveAdminTenantContext(user.id);
      const accessToken = signAdminToken(app, user, context);

      return {
        accessToken,
        expiresIn: env.JWT_EXPIRES_IN,
        user,
        tenant: context,
      };
    },
  );

  app.get(
    "/me",
    { preHandler: requireAuthentication },
    async (request) => {
      const user = await getActiveAdmin(request.user.sub);
      return { user, tenant: request.tenant ?? null };
    },
  );

  app.get(
    "/tenants",
    { preHandler: requireAuthentication },
    async (request) => ({ items: await listAdminTenants(request.user.sub) }),
  );

  app.post(
    "/select-tenant",
    { preHandler: requireAuthentication },
    async (request) => {
      const { tenantId } = selectTenantSchema.parse(request.body);
      const user = await getActiveAdmin(request.user.sub);
      const context = await resolveAdminTenantContext(user.id, tenantId);
      return {
        accessToken: signAdminToken(app, user, context),
        expiresIn: env.JWT_EXPIRES_IN,
        user,
        tenant: context,
      };
    },
  );

  app.post(
    "/logout",
    { preHandler: requireAuthentication },
    async (_request, reply) => reply.code(204).send(),
  );
};
