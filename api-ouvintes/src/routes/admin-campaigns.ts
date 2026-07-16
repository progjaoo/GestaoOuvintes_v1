import type { FastifyPluginAsync } from "fastify";
import { requireAdminRole, requireAuthentication } from "../plugins/auth.js";
import {
  campaignIdParamsSchema,
  createCampaignSchema,
  updateCampaignSchema,
} from "../schemas/campaign.js";
import {
  createCampaign,
  listCampaigns,
  updateCampaign,
} from "../services/campaign-service.js";

export const adminCampaignRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuthentication);

  app.get("/", async () => ({
    items: await listCampaigns(),
  }));

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
};
