import type { FastifyPluginAsync } from "fastify";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { requireAuthentication, requirePermission } from "../plugins/auth.js";
import {
  bannerIdParamsSchema,
  createInstitutionalBannerFromR2ObjectSchema,
  createInstitutionalBannerSchema,
  publicBannerQuerySchema,
  reorderInstitutionalBannersSchema,
  updateInstitutionalBannerSchema,
} from "../schemas/institutional-banner.js";
import {
  createInstitutionalBanner,
  createInstitutionalBannerFromR2Object,
  deleteInstitutionalBanner,
  listAdminInstitutionalBanners,
  reorderInstitutionalBanners,
  setInstitutionalBannerActive,
  updateInstitutionalBanner,
  uploadInstitutionalBannerAsset,
} from "../services/institutional-banner-service.js";
import { createMediaStorage } from "../services/media-storage/r2-media-storage.js";

export const adminInstitutionalBannerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuthentication);
  const canRead = requirePermission("institutional_banner.read");
  const canManage = requirePermission("institutional_banner.manage");
  const canUpload = requirePermission("media.upload");

  app.get("/", { preHandler: canRead }, async (request) => {
    const { placement } = publicBannerQuerySchema.parse(request.query);
    return { items: await listAdminInstitutionalBanners(placement) };
  });

  app.post(
    "/assets",
    { bodyLimit: env.INSTITUTIONAL_BANNER_MAX_BYTES + 64 * 1024, preHandler: canUpload },
    async (request, reply) => {
      const part = await request.file({
        limits: { files: 1, fileSize: env.INSTITUTIONAL_BANNER_MAX_BYTES },
      });
      if (!part) throw new AppError(400, "FILE_REQUIRED", "Selecione uma imagem.");
      const asset = await uploadInstitutionalBannerAsset({
        buffer: await part.toBuffer(),
        filename: part.filename,
        adminUserId: request.user.sub,
        storage: createMediaStorage(),
      });
      return reply.code(201).send(asset);
    },
  );

  app.put("/reorder", { preHandler: canManage }, async (request, reply) => {
    const input = reorderInstitutionalBannersSchema.parse(request.body);
    await reorderInstitutionalBanners(input.placementKey, input.orderedIds, request.user.sub);
    return reply.code(204).send();
  });

  app.post("/r2-object", { preHandler: canManage }, async (request, reply) => {
    const input = createInstitutionalBannerFromR2ObjectSchema.parse(request.body);
    return reply
      .code(201)
      .send(await createInstitutionalBannerFromR2Object(input, request.user.sub));
  });

  app.post("/", { preHandler: canManage }, async (request, reply) => {
    const input = createInstitutionalBannerSchema.parse(request.body);
    return reply.code(201).send(await createInstitutionalBanner(input, request.user.sub));
  });

  app.put("/:id", { preHandler: canManage }, async (request) => {
    const { id } = bannerIdParamsSchema.parse(request.params);
    return updateInstitutionalBanner(
      id,
      updateInstitutionalBannerSchema.parse(request.body),
      request.user.sub,
    );
  });

  app.post("/:id/activate", { preHandler: canManage }, async (request) => {
    const { id } = bannerIdParamsSchema.parse(request.params);
    return setInstitutionalBannerActive(id, true, request.user.sub);
  });

  app.post("/:id/deactivate", { preHandler: canManage }, async (request) => {
    const { id } = bannerIdParamsSchema.parse(request.params);
    return setInstitutionalBannerActive(id, false, request.user.sub);
  });

  app.delete("/:id", { preHandler: canManage }, async (request, reply) => {
    const { id } = bannerIdParamsSchema.parse(request.params);
    await deleteInstitutionalBanner(id, request.user.sub);
    return reply.code(204).send();
  });
};
