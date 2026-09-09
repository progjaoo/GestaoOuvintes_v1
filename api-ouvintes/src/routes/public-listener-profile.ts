import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { resolvePublicSessionSchema } from "../schemas/registration.js";
import {
  consumeRecoveryHandoffSchema,
  createRecoveryHandoffSchema,
} from "../schemas/listener-recovery.js";
import { requireListenerAuthentication } from "../plugins/listener-auth.js";
import {
  createListenerRecoveryHandoff,
  consumeListenerRecoveryHandoff,
} from "../services/listener-recovery-handoff-service.js";
import {
  getListenerAccount,
  linkClerkIdentityToDevice,
  unlinkClerkIdentity,
} from "../services/listener-account-service.js";
import {
  getListenerMe,
  linkAnonymousDeviceToListener,
  listListenerParticipations,
  updateListenerProfile,
} from "../services/listener-profile-service.js";
import { listenerProfileUpdateSchema } from "../schemas/listener-profile.js";
import { requireDeviceToken } from "../services/public-session-service.js";
import { resolvePublicTenant } from "../services/tenant-service.js";
import { AppError } from "../lib/errors.js";

function getRequestHost(request: FastifyRequest): string | undefined {
  const forwardedHost = request.headers["x-forwarded-host"];
  return typeof forwardedHost === "string"
    ? forwardedHost
    : request.headers.host;
}

function getPlatform(request: FastifyRequest) {
  return resolvePublicSessionSchema.shape.platform.parse(
    request.headers["x-platform"] ?? "web_desktop",
  );
}

function assertAccountEnabled() {
  if (!env.LISTENER_ACCOUNT_ENABLED) {
    throw new AppError(
      404,
      "LISTENER_ACCOUNT_DISABLED",
      "A conta do ouvinte esta temporariamente indisponivel.",
    );
  }
}

function assertClerkLinkEnabled() {
  if (!env.LISTENER_CLERK_LINK_ENABLED) {
    throw new AppError(
      404,
      "LISTENER_CLERK_LINK_DISABLED",
      "O vinculo de conta esta temporariamente indisponivel.",
    );
  }
}

export const publicListenerProfileRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    if (!request.tenant) {
      request.tenant = await resolvePublicTenant(getRequestHost(request));
    }
  });

  app.post(
    "/me/recovery-handoffs",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "1 hour",
        },
      },
    },
    async (request) => {
      const input = createRecoveryHandoffSchema.parse(request.body ?? {});
      return createListenerRecoveryHandoff({
        deviceToken: requireDeviceToken(request.headers["x-device-token"]),
        purpose: input.purpose,
        platform: getPlatform(request),
        tenantId: request.tenant!.tenantId,
      });
    },
  );

  app.post(
    "/recovery-handoffs/consume",
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: "1 hour",
        },
      },
    },
    async (request) => {
      const input = consumeRecoveryHandoffSchema.parse(request.body);
      return consumeListenerRecoveryHandoff({
        token: input.token,
        purpose: input.purpose,
        deviceToken: requireDeviceToken(request.headers["x-device-token"]),
        platform: getPlatform(request),
        tenantId: request.tenant!.tenantId,
      });
    },
  );

  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook("preHandler", requireListenerAuthentication);

    protectedRoutes.get("/me", async (request) => getListenerMe(request.listener!));

    protectedRoutes.get("/me/account", async (request) => {
      assertAccountEnabled();
      return getListenerAccount(request.listener!);
    });

    protectedRoutes.post("/me/link-clerk", async (request) => {
      assertAccountEnabled();
      assertClerkLinkEnabled();
      return linkClerkIdentityToDevice(
        request.listener!,
        requireDeviceToken(request.headers["x-device-token"]),
      );
    });

    protectedRoutes.delete("/me/link-clerk", async (request) => {
      assertAccountEnabled();
      assertClerkLinkEnabled();
      return unlinkClerkIdentity(request.listener!);
    });

    protectedRoutes.put("/me/profile", async (request) => {
      const input = listenerProfileUpdateSchema.parse(request.body);
      return updateListenerProfile(request.listener!, input);
    });

    protectedRoutes.get("/me/participations", async (request) =>
      listListenerParticipations(request.listener!),
    );

    protectedRoutes.post("/me/link-anonymous-device", async (request) => {
      const deviceToken = requireDeviceToken(request.headers["x-device-token"]);
      return linkAnonymousDeviceToListener(request.listener!, deviceToken);
    });
  });
};
