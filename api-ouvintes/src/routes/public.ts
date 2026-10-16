import type { FastifyPluginAsync } from "fastify";
import { env } from "../config/env.js";
import { campaignSlugParamsSchema, placementParamsSchema } from "../schemas/campaign.js";
import {
  campaignParticipationParamsSchema,
  createRegistrationAndParticipationSchema,
  createRegistrationSchema,
  resolvePublicSessionSchema,
  updateDeviceStateSchema,
} from "../schemas/registration.js";
import { getPublicCampaign, getPublicPlacementCampaign } from "../services/campaign-service.js";
import { createListenerRegistration } from "../services/registration-service.js";
import {
  participateKnownListener,
  registerAndParticipate,
  requireDeviceToken,
  resolvePublicSession,
  updateCampaignDeviceState,
} from "../services/public-session-service.js";
import {
  getSnapshotCampaign,
  getSnapshotPlacement,
  isPublicConfigSnapshotReadEnabled,
  publicConfigCacheControl,
  readPublicConfigSnapshot,
} from "../services/public-config-snapshot.js";

const PUBLIC_CONFIG_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=60";

export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/campaigns/:slug", async (request, reply) => {
    const { slug } = campaignSlugParamsSchema.parse(request.params);
    reply.header("Vary", "Origin");
    if (isPublicConfigSnapshotReadEnabled()) {
      const snapshot = await readPublicConfigSnapshot();
      const campaign = snapshot.campaigns.find((item) => item.slug === slug);
      reply.header("Cache-Control", publicConfigCacheControl(snapshot, campaign));
      return getSnapshotCampaign(snapshot, slug);
    }
    reply.header("Cache-Control", PUBLIC_CONFIG_CACHE_CONTROL);
    return getPublicCampaign(slug);
  });

  app.get("/placements/:placementKey/campaign", async (request, reply) => {
    const { placementKey } = placementParamsSchema.parse(request.params);

    reply.header("Vary", "Origin");
    if (isPublicConfigSnapshotReadEnabled()) {
      const snapshot = await readPublicConfigSnapshot();
      const result = getSnapshotPlacement(snapshot, placementKey);
      reply.header("Cache-Control", publicConfigCacheControl(snapshot, result.sourceCampaign));
      const { sourceCampaign: _sourceCampaign, ...response } = result;
      return response;
    }
    reply.header("Cache-Control", PUBLIC_CONFIG_CACHE_CONTROL);
    return getPublicPlacementCampaign(placementKey);
  });

  app.post("/session/resolve", async (request, reply) => {
    const input = resolvePublicSessionSchema.parse(request.body);
    const deviceToken = requireDeviceToken(request.headers["x-device-token"]);
    reply.header("Cache-Control", "no-store, max-age=0");
    if (isPublicConfigSnapshotReadEnabled()) {
      const snapshot = await readPublicConfigSnapshot();
      const placement = getSnapshotPlacement(snapshot, input.placement);
      if (!placement.campaign) {
        return {
          placement: input.placement,
          placementVersion: placement.version,
          campaign: null,
          listenerState: "anonymous" as const,
          experience: "campaign_unavailable",
          participation: null,
          dismissedUntil: null,
        };
      }
    }
    return resolvePublicSession({ ...input, deviceToken });
  });

  app.get("/events", async (_request, reply) => {
    // HTTP 204 tells EventSource clients to stop reconnecting instead of holding
    // serverless invocations open for heartbeats that no longer drive the UI.
    return reply.code(204).header("Cache-Control", "no-store").send();
  });

  app.post(
    "/listener-registrations",
    {
      config: {
        rateLimit: {
          max: env.REGISTRATION_RATE_LIMIT_PER_MINUTE,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const input = createRegistrationSchema.parse(request.body);

      const result = await createListenerRegistration(input, {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });

      return reply.code(result.created ? 201 : 200).send({
        id: result.id,
        status: result.created ? "created" : "already_processed",
        createdAt: result.createdAt,
      });
    },
  );

  app.post(
    "/listeners/register-and-participate",
    {
      config: {
        rateLimit: {
          max: env.REGISTRATION_RATE_LIMIT_PER_MINUTE,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const input = createRegistrationAndParticipationSchema.parse(request.body);
      const deviceToken = requireDeviceToken(request.headers["x-device-token"]);
      const platform = resolvePublicSessionSchema.shape.platform.parse(
        request.headers["x-platform"] ?? "web_desktop",
      );

      const idempotencyKey = request.headers["idempotency-key"];
      const submissionToken =
        typeof idempotencyKey === "string" && idempotencyKey.length > 0
          ? idempotencyKey
          : input.submissionToken;

      const result = await registerAndParticipate(
        { ...input, submissionToken, deviceToken, platform },
        {
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        },
      );

      return reply.code(result.status === "created" ? 201 : 200).send(result);
    },
  );

  app.post("/campaigns/:campaignId/participations", async (request, reply) => {
    const { campaignId } = campaignParticipationParamsSchema.parse(request.params);
    const deviceToken = requireDeviceToken(request.headers["x-device-token"]);
    const platform = resolvePublicSessionSchema.shape.platform.parse(
      request.headers["x-platform"] ?? "web_desktop",
    );

    const result = await participateKnownListener({ campaignId, deviceToken, platform });
    return reply.code(result.status === "created" ? 201 : 200).send(result);
  });

  app.put("/campaigns/:campaignId/device-state", async (request) => {
    const { campaignId } = campaignParticipationParamsSchema.parse(request.params);
    const input = updateDeviceStateSchema.parse(request.body);
    const deviceToken = requireDeviceToken(request.headers["x-device-token"]);
    const platform = resolvePublicSessionSchema.shape.platform.parse(
      request.headers["x-platform"] ?? "web_desktop",
    );

    return updateCampaignDeviceState({
      campaignId,
      deviceToken,
      platform,
      dismissedUntil: input.dismissedUntil,
      incrementOpenCount: input.incrementOpenCount,
    });
  });
};
