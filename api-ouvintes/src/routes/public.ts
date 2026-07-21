import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
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
import { addCampaignEventClient } from "../services/campaign-events.js";

export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/campaigns/:slug", async (request) => {
    const { slug } = campaignSlugParamsSchema.parse(request.params);
    return getPublicCampaign(slug);
  });

  app.get("/placements/:placementKey/campaign", async (request, reply) => {
    const { placementKey } = placementParamsSchema.parse(request.params);

    reply.header("Cache-Control", "no-store, max-age=0");
    return getPublicPlacementCampaign(placementKey);
  });

  app.post("/session/resolve", async (request, reply) => {
    const input = resolvePublicSessionSchema.parse(request.body);
    const deviceToken = requireDeviceToken(request.headers["x-device-token"]);
    reply.header("Cache-Control", "no-store, max-age=0");
    return resolvePublicSession({ ...input, deviceToken });
  });

  app.get("/events", async (request, reply) => {
    const query = request.query as { placement?: string };
    const placement = placementParamsSchema.shape.placementKey.parse(
      query.placement ?? "institutional_modal",
    );

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send("heartbeat", { placement, now: new Date().toISOString() });
    const removeClient = addCampaignEventClient({
      id: randomUUID(),
      placement,
      send,
    });
    const heartbeat = setInterval(() => {
      send("heartbeat", { placement, now: new Date().toISOString() });
    }, 25_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      removeClient();
    });
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

      return reply.code(201).send(result);
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
