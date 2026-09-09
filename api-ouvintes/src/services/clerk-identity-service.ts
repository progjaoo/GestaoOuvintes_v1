import { verifyToken, type VerifyTokenOptions } from "@clerk/backend";
import { TokenVerificationErrorReason } from "@clerk/backend/errors";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import type { TenantContext } from "./tenant-service.js";

export interface ClerkTokenPayload {
  __raw: string;
  iss: string;
  sub: string;
  sid: string;
  nbf: number;
  exp: number;
  iat: number;
  azp?: string;
  [claim: string]: unknown;
}
export type ClerkTokenVerifier = (
  token: string,
  options: VerifyTokenOptions,
) => Promise<ClerkTokenPayload>;

export interface ListenerAuthContext extends TenantContext {
  clerkUserId: string;
  listenerIdentityId: string | null;
  listenerProfileId: string | null;
  profileComplete: boolean;
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

function isAuthorizedPartyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "reason" in error &&
    error.reason === TokenVerificationErrorReason.TokenInvalidAuthorizedParties
  );
}

function listenerAuthNotConfigured(): AppError {
  return new AppError(
    503,
    "LISTENER_AUTH_NOT_CONFIGURED",
    "A autenticacao de ouvintes ainda nao foi configurada.",
  );
}

function invalidListenerToken(cause?: unknown): AppError {
  return new AppError(
    401,
    "LISTENER_AUTH_REQUIRED",
    "Autenticacao de ouvinte necessaria ou token invalido.",
    undefined,
    cause instanceof Error ? { cause } : undefined,
  );
}

function unauthorizedParty(cause?: unknown): AppError {
  return new AppError(
    403,
    "AUTHORIZED_PARTY_REJECTED",
    "A origem da sessao de ouvinte nao foi autorizada.",
    undefined,
    cause instanceof Error ? { cause } : undefined,
  );
}

export async function verifyClerkSessionToken(
  token: string,
  verifier: ClerkTokenVerifier = verifyToken,
): Promise<ClerkTokenPayload> {
  if (
    !env.CLERK_JWT_KEY ||
    !env.CLERK_JWT_ISSUER ||
    env.clerkAuthorizedParties.length === 0
  ) {
    throw listenerAuthNotConfigured();
  }

  let claims: ClerkTokenPayload;

  try {
    claims = await verifier(token, {
      jwtKey: env.CLERK_JWT_KEY,
      authorizedParties: env.clerkAuthorizedParties,
    });
  } catch (error) {
    if (isAuthorizedPartyError(error)) {
      throw unauthorizedParty(error);
    }

    throw invalidListenerToken(error);
  }

  if (normalizeIssuer(claims.iss) !== normalizeIssuer(env.CLERK_JWT_ISSUER)) {
    throw invalidListenerToken();
  }

  return claims;
}

export function createListenerAuthContext(
  tenant: TenantContext,
  claims: ClerkTokenPayload,
): ListenerAuthContext {
  return {
    ...tenant,
    clerkUserId: claims.sub,
    // A identidade e o perfil locais sao resolvidos sob demanda no servico de perfil.
    listenerIdentityId: null,
    listenerProfileId: null,
    profileComplete: false,
  };
}
