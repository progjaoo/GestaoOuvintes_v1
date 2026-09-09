import type { FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import {
  createListenerAuthContext,
  verifyClerkSessionToken,
} from "../services/clerk-identity-service.js";
import { resolvePublicTenant } from "../services/tenant-service.js";

function missingListenerToken(): AppError {
  return new AppError(
    401,
    "LISTENER_AUTH_REQUIRED",
    "Autenticacao de ouvinte necessaria ou token invalido.",
  );
}

function getRequestHost(request: FastifyRequest): string | undefined {
  const forwardedHost = request.headers["x-forwarded-host"];
  return typeof forwardedHost === "string"
    ? forwardedHost
    : request.headers.host;
}

function parseBearerToken(value: string): string | null {
  const match = value.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

async function getTenant(request: FastifyRequest) {
  if (request.tenant) return request.tenant;

  const tenant = await resolvePublicTenant(getRequestHost(request));
  request.tenant = tenant;
  return tenant;
}

export async function resolveListenerContext(
  request: FastifyRequest,
) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") {
    throw missingListenerToken();
  }

  const token = parseBearerToken(authorization);
  if (!token) {
    throw missingListenerToken();
  }

  const claims = await verifyClerkSessionToken(token);
  return createListenerAuthContext(await getTenant(request), claims);
}

export async function requireListenerAuthentication(
  request: FastifyRequest,
): Promise<void> {
  request.listener = await resolveListenerContext(request);
}

export async function optionalListenerAuthentication(
  request: FastifyRequest,
): Promise<void> {
  if (!request.headers.authorization) return;
  request.listener = await resolveListenerContext(request);
}
