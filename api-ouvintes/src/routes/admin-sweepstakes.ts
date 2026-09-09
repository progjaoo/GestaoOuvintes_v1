import type { FastifyPluginAsync } from "fastify";
import { requireAuthentication, requirePermission } from "../plugins/auth.js";
import {
  redrawSweepstakeSchema,
  sweepstakeCampaignParamsSchema,
  sweepstakeIdempotencyHeadersSchema,
} from "../schemas/sweepstake.js";
import {
  drawSweepstake,
  getSweepstakeStatus,
  redrawSweepstake,
} from "../services/sweepstake-service.js";

const noStoreHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export const adminSweepstakeRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuthentication);

  app.get(
    "/:campaignId/status",
    {
      preHandler: [
        requirePermission("sweepstake.read"),
        requirePermission("listener.phone.read"),
      ],
    },
    async (request, reply) => {
      const { campaignId } = sweepstakeCampaignParamsSchema.parse(request.params);
      reply.headers(noStoreHeaders);
      return getSweepstakeStatus(campaignId, request.tenant!.tenantId);
    },
  );

  app.post(
    "/:campaignId/draw",
    {
      preHandler: [
        requirePermission("sweepstake.draw"),
        requirePermission("listener.phone.read"),
      ],
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const { campaignId } = sweepstakeCampaignParamsSchema.parse(request.params);
      const headers = sweepstakeIdempotencyHeadersSchema.parse(request.headers);
      const result = await drawSweepstake({
        campaignId,
        adminUserId: request.user.sub,
        requestToken: headers["idempotency-key"],
        tenantId: request.tenant!.tenantId,
      });

      reply.headers(noStoreHeaders);
      return reply.code(result.replayed ? 200 : 201).send(result.draw);
    },
  );

  app.post(
    "/:campaignId/redraw",
    {
      preHandler: [
        requirePermission("sweepstake.redraw"),
        requirePermission("listener.phone.read"),
      ],
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const { campaignId } = sweepstakeCampaignParamsSchema.parse(request.params);
      const headers = sweepstakeIdempotencyHeadersSchema.parse(request.headers);
      const input = redrawSweepstakeSchema.parse(request.body);
      const result = await redrawSweepstake({
        campaignId,
        adminUserId: request.user.sub,
        requestToken: headers["idempotency-key"],
        previousDrawId: input.previousDrawId,
        tenantId: request.tenant!.tenantId,
      });

      reply.headers(noStoreHeaders);
      return reply.code(result.replayed ? 200 : 201).send(result.draw);
    },
  );
};
