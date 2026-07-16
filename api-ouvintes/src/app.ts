import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "./config/env.js";
import { AppError } from "./lib/errors.js";
import { adminAuthRoutes } from "./routes/admin-auth.js";
import { adminCampaignRoutes } from "./routes/admin-campaigns.js";
import { adminRegistrationRoutes } from "./routes/admin-registrations.js";
import { healthRoutes } from "./routes/health.js";
import { publicRoutes } from "./routes/public.js";

function isErrorRecord(error: unknown): error is Record<string, unknown> {
  return typeof error === "object" && error !== null;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      env.NODE_ENV === "test"
        ? false
        : {
            level: env.NODE_ENV === "production" ? "info" : "debug",
            redact: {
              paths: [
                "req.headers.authorization",
                "req.body.name",
                "req.body.phone",
                "req.body.password",
                "res.body.accessToken",
              ],
              censor: "[REDACTED]",
            },
          },
    bodyLimit: 32 * 1024,
    trustProxy: true,
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({
      statusCode: 404,
      code: "ROUTE_NOT_FOUND",
      message: "Rota nao encontrada.",
    }),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        statusCode: 400,
        code: "VALIDATION_ERROR",
        message: "Dados invalidos.",
        fields: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        ...(error.details !== undefined && { details: error.details }),
      });
    }

    if (isErrorRecord(error) && error.code === "23505") {
      return reply.code(409).send({
        statusCode: 409,
        code: "RESOURCE_CONFLICT",
        message: "Ja existe um registro com esses dados unicos.",
      });
    }

    if (isErrorRecord(error) && error.statusCode === 401) {
      return reply.code(401).send({
        statusCode: 401,
        code: "UNAUTHORIZED",
        message: "Autenticacao necessaria ou token invalido.",
      });
    }

    const normalizedError =
      error instanceof Error ? error : new Error("Erro desconhecido.");

    request.log.error(
      {
        errorName: normalizedError.name,
        errorMessage: normalizedError.message,
        stack: env.NODE_ENV === "production" ? undefined : normalizedError.stack,
      },
      "Erro nao tratado.",
    );

    return reply.code(500).send({
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "Erro interno do servidor.",
    });
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || env.corsAllowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new AppError(403, "ORIGIN_NOT_ALLOWED", "Origem nao autorizada."), false);
    },
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.register(rateLimit, {
    global: false,
    hook: "onRequest",
    errorResponseBuilder: () => ({
      statusCode: 429,
      code: "RATE_LIMIT_EXCEEDED",
      message: "Muitas tentativas. Aguarde antes de tentar novamente.",
    }),
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
  });

  await app.register(healthRoutes);
  await app.register(publicRoutes, { prefix: "/api/public" });
  await app.register(adminAuthRoutes, { prefix: "/api/admin/auth" });
  await app.register(adminCampaignRoutes, { prefix: "/api/admin/campaigns" });
  await app.register(adminRegistrationRoutes, {
    prefix: "/api/admin/listener-registrations",
  });

  return app;
}
