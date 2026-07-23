import type { FastifyPluginAsync } from "fastify";
import { requireAdminRole, requireAuthentication } from "../plugins/auth.js";
import {
  campaignIdParamsSchema,
  campaignListQuerySchema,
  createCampaignSchema,
  placementParamsSchema,
  publishCampaignSchema,
  updateCampaignSchema,
} from "../schemas/campaign.js";
import {
  createCampaign,
  listPlacements,
  listCampaigns,
  publishCampaignToPlacement,
  updateCampaign,
} from "../services/campaign-service.js";

export const adminCampaignRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuthentication);

  app.get("/", async (request) => {
    const filters = campaignListQuerySchema.parse(request.query);
    return {
      items: await listCampaigns(filters),
    };
  });

  app.get("/placements/list", async () => ({
    items: await listPlacements(),
  }));

  app.post(
    "/placements/:placementKey/unpublish",
    {
      preHandler: requireAdminRole,
    },
    async (request, reply) => {
      // Endpoint reservado para a proxima etapa do painel; mantido fora para evitar comportamento parcial.
      placementParamsSchema.parse(request.params);
      return reply.code(501).send({
        code: "NOT_IMPLEMENTED",
        message: "Despublicacao sera liberada na proxima etapa.",
      });
    },
  );

  app.post(
    "/",
    {
      preHandler: requireAdminRole,
    },
    async (request, reply) => {
      const input = createCampaignSchema.parse(request.body);
      const campaign = await createCampaign(input);
      return reply.code(201).send(campaign);
    },
  );

  app.put(
    "/:id",
    {
      preHandler: requireAdminRole,
    },
    async (request) => {
      const { id } = campaignIdParamsSchema.parse(request.params);
      const input = updateCampaignSchema.parse(request.body);
      return updateCampaign(id, input);
    },
  );

  app.post(
    "/:id/publish",
    {
      preHandler: requireAdminRole,
    },
    async (request) => {
      const { id } = campaignIdParamsSchema.parse(request.params);
      const input = publishCampaignSchema.parse(request.body);
      return publishCampaignToPlacement({
        campaignId: id,
        placementKey: input.placementKey,
        adminUserId: request.user.sub,
      });
    },
  );
};
