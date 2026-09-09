import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import {
  createListenerAuthContext,
  type ClerkTokenPayload,
  type ClerkTokenVerifier,
  verifyClerkSessionToken,
} from "../../src/services/clerk-identity-service.js";
import {
  optionalListenerAuthentication,
  requireListenerAuthentication,
} from "../../src/plugins/listener-auth.js";
import { env } from "../../src/config/env.js";
import { getDefaultTenantContext } from "../../src/services/tenant-service.js";

function makeRequest(authorization?: string): FastifyRequest {
  return {
    headers: {
      authorization,
    },
    tenant: getDefaultTenantContext(),
  } as unknown as FastifyRequest;
}

function verificationFailure(reason: string): ClerkTokenVerifier {
  return vi.fn(async () => {
    throw Object.assign(new Error("verification failed"), { reason });
  }) as unknown as ClerkTokenVerifier;
}

const validClaims = {
  __raw: "redacted-test-token",
  iss: env.CLERK_JWT_ISSUER ?? "https://clerk.example",
  sub: "user_test_listener",
  sid: "sess_test_listener",
  nbf: 1_699_000_000,
  iat: 1_700_000_000,
  exp: 1_900_000_000,
  azp: env.clerkAuthorizedParties[0],
} as ClerkTokenPayload;

describe("listener Clerk authentication", () => {
  it("rejects a missing token with the stable 401 contract", async () => {
    await expect(
      requireListenerAuthentication(makeRequest()),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "LISTENER_AUTH_REQUIRED",
    });
  });

  it("keeps optional authentication anonymous when no token is sent", async () => {
    const request = makeRequest();

    await optionalListenerAuthentication(request);

    expect(request.listener).toBeUndefined();
  });

  it("maps expired tokens and invalid signatures to 401", async () => {
    for (const reason of ["token-expired", "token-invalid-signature"]) {
      await expect(
        verifyClerkSessionToken("token", verificationFailure(reason)),
      ).rejects.toMatchObject({
        statusCode: 401,
        code: "LISTENER_AUTH_REQUIRED",
      });
    }
  });

  it("maps an unauthorized azp to 403", async () => {
    await expect(
      verifyClerkSessionToken(
        "token",
        verificationFailure("token-invalid-authorized-parties"),
      ),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTHORIZED_PARTY_REJECTED",
    });
  });

  it("passes the local JWT key and authorized parties to the verifier", async () => {
    const verifier = vi.fn(async (_token, options) => {
      expect(options.jwtKey).toBeTruthy();
      expect(options.authorizedParties).toEqual(env.clerkAuthorizedParties);
      return validClaims;
    }) as unknown as ClerkTokenVerifier;

    const claims = await verifyClerkSessionToken("token", verifier);

    expect(claims.sub).toBe("user_test_listener");
  });

  it("creates a tenant-scoped context without persisting Clerk tokens", () => {
    const context = createListenerAuthContext(
      getDefaultTenantContext(),
      validClaims,
    );

    expect(context).toMatchObject({
      clerkUserId: "user_test_listener",
      tenantSlug: env.DEFAULT_TENANT_SLUG,
      listenerIdentityId: null,
      listenerProfileId: null,
      profileComplete: false,
    });
    expect(context).not.toHaveProperty("token");
  });

  it("rejects a token from a different issuer", async () => {
    const verifier = vi.fn(async () => ({
      ...validClaims,
      iss: "https://other-issuer.example",
    }));

    await expect(
      verifyClerkSessionToken("token", verifier),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "LISTENER_AUTH_REQUIRED",
    });
  });
});
