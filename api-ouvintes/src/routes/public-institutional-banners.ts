import type { FastifyPluginAsync } from "fastify";
import { createHash } from "node:crypto";
import { publicBannerQuerySchema } from "../schemas/institutional-banner.js";
import { listPublicInstitutionalBanners } from "../services/institutional-banner-service.js";

export const publicInstitutionalBannerRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const { placement } = publicBannerQuerySchema.parse(request.query);
    const result = await listPublicInstitutionalBanners(placement);
    const representation = JSON.stringify({ placement, items: result.items });
    const contentHash = createHash("sha256")
      .update(representation)
      .digest("base64url");
    const etag = `W/"institutional-banners-${contentHash}"`;

    reply.header("Cache-Control", result.cacheControl);
    reply.header("ETag", etag);
    reply.header("Vary", "Origin");
    if (request.headers["if-none-match"] === etag) {
      return reply.code(304).send();
    }
    return { version: result.version, items: result.items };
  });
};
