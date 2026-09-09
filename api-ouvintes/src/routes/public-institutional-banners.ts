import type { FastifyPluginAsync } from "fastify";
import { publicBannerQuerySchema } from "../schemas/institutional-banner.js";
import { listPublicInstitutionalBanners } from "../services/institutional-banner-service.js";
import { resolvePublicTenant } from "../services/tenant-service.js";

export const publicInstitutionalBannerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    const forwardedHost = request.headers["x-forwarded-host"];
    const host = typeof forwardedHost === "string" ? forwardedHost : request.headers.host;
    request.tenant = await resolvePublicTenant(host);
  });

  app.get("/", async (request, reply) => {
    const { placement } = publicBannerQuerySchema.parse(request.query);
    const result = await listPublicInstitutionalBanners(
      placement,
      request.tenant!.tenantId,
    );
    const etag = `W/"institutional-banners-${request.tenant!.tenantId}-${result.version}"`;

    reply.header("Cache-Control", result.cacheControl);
    reply.header("ETag", etag);
    if (request.headers["if-none-match"] === etag) {
      return reply.code(304).send();
    }
    return { version: result.version, items: result.items };
  });
};
