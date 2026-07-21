import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "./config/env.js";
import { AppError } from "./lib/errors.js";
import { adminAuthRoutes } from "./routes/admin-auth.js";
import { adminCampaignRoutes } from "./routes/admin-campaigns.js";
import { adminRegistrationRoutes } from "./routes/admin-registrations.js";
import { adminInstitutionalBannerRoutes } from "./routes/admin-institutional-banners.js";
import { healthRoutes } from "./routes/health.js";
import { publicRoutes } from "./routes/public.js";
import { publicInstitutionalBannerRoutes } from "./routes/public-institutional-banners.js";

function isDevelopmentLocalOrigin(origin: string) {
  if (env.NODE_ENV !== "development") return false;

  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "192.168.70.87") return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;

    const private172 = hostname.match(/^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/);
    if (private172) {
      const secondOctet = Number(private172[1]);
      return secondOctet >= 16 && secondOctet <= 31;
    }
  } catch {
    return false;
  }

  return false;
}

function isErrorRecord(error: unknown): error is Record<string, unknown> {
  return typeof error === "object" && error !== null;
}

function getPostgresErrorCode(error: unknown): string | undefined {
  if (!isErrorRecord(error)) return undefined;

  if (typeof error.code === "string") {
    return error.code;
  }

  return getPostgresErrorCode(error.cause);
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
    routerOptions: { ignoreTrailingSlash: true },
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
      const cause = error.cause instanceof Error ? error.cause : undefined;
      request.log.warn(
        {
          requestId: request.id,
          code: error.code,
          statusCode: error.statusCode,
          errorName: error.name,
          causeName: cause?.name,
          causeMessage: env.NODE_ENV === "production" ? undefined : cause?.message,
        },
        "Erro operacional tratado.",
      );
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        requestId: request.id,
        ...(error.details !== undefined && { details: error.details }),
      });
    }

    if (getPostgresErrorCode(error) === "23505") {
      return reply.code(409).send({
        statusCode: 409,
        code: "RESOURCE_CONFLICT",
        message: "Ja existe um registro com esses dados unicos. Verifique o slug informado.",
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
      if (
        !origin ||
        env.corsAllowedOrigins.includes(origin) ||
        isDevelopmentLocalOrigin(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(new AppError(403, "ORIGIN_NOT_ALLOWED", "Origem nao autorizada."), false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Device-Token",
      "X-Platform",
      "Idempotency-Key",
    ],
  });

  await app.register(multipart, {
    limits: { files: 1, fileSize: env.INSTITUTIONAL_BANNER_MAX_BYTES },
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
  await app.register(publicInstitutionalBannerRoutes, {
    prefix: "/api/public/institutional-banners",
  });
  await app.register(adminAuthRoutes, { prefix: "/api/admin/auth" });
  await app.register(adminCampaignRoutes, { prefix: "/api/admin/campaigns" });
  await app.register(adminRegistrationRoutes, {
    prefix: "/api/admin/listener-registrations",
  });
  await app.register(adminInstitutionalBannerRoutes, {
    prefix: "/api/admin/institutional-banners",
  });

  return app;
}
