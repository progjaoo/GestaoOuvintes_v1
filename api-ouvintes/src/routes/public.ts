import type { FastifyPluginAsync } from "fastify";
import { env } from "../config/env.js";
import { campaignSlugParamsSchema } from "../schemas/campaign.js";
import { createRegistrationSchema } from "../schemas/registration.js";
import { getPublicCampaign } from "../services/campaign-service.js";
import { createListenerRegistration } from "../services/registration-service.js";

export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/campaigns/:slug", async (request) => {
    const { slug } = campaignSlugParamsSchema.parse(request.params);
    return getPublicCampaign(slug);
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
};
