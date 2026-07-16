import type { FastifyPluginAsync } from "fastify";
import { env } from "../config/env.js";
import { requireAuthentication } from "../plugins/auth.js";
import { bootstrapAdminSchema, loginSchema } from "../schemas/auth.js";
import {
  authenticateAdmin,
  bootstrapFirstAdmin,
  canBootstrapAdmin,
  getActiveAdmin,
} from "../services/auth-service.js";

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
      const accessToken = app.jwt.sign(
        {
          sub: user.id,
          role: user.role,
          name: user.name,
          username: user.username,
        },
        { expiresIn: env.JWT_EXPIRES_IN },
      );

      return reply.code(201).send({
        accessToken,
        expiresIn: env.JWT_EXPIRES_IN,
        user,
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
      const accessToken = app.jwt.sign(
        {
          sub: user.id,
          role: user.role,
          name: user.name,
          username: user.username,
        },
        { expiresIn: env.JWT_EXPIRES_IN },
      );

      return {
        accessToken,
        expiresIn: env.JWT_EXPIRES_IN,
        user,
      };
    },
  );

  app.get(
    "/me",
    {
      preHandler: requireAuthentication,
    },
    async (request) => {
      const user = await getActiveAdmin(request.user.sub);
      return { user };
    },
  );

  app.post(
    "/logout",
    {
      preHandler: requireAuthentication,
    },
    async (_request, reply) => reply.code(204).send(),
  );
};
