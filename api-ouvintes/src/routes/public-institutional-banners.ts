import type { FastifyPluginAsync } from "fastify";
import { publicBannerQuerySchema } from "../schemas/institutional-banner.js";
import { listPublicInstitutionalBanners } from "../services/institutional-banner-service.js";

export const publicInstitutionalBannerRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const { placement } = publicBannerQuerySchema.parse(request.query);
    const result = await listPublicInstitutionalBanners(placement);
    const etag = 'W/"institutional-banners-' + result.version + '"';

    reply.header("Cache-Control", result.cacheControl);
    reply.header("ETag", etag);
    if (request.headers["if-none-match"] === etag) {
      return reply.code(304).send();
    }
    return { version: result.version, items: result.items };
  });
};
