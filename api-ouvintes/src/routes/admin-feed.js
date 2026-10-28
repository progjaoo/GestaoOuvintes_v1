import { AppError } from "../lib/errors.js";
import { env } from "../config/env.js";
import { requireAuthentication, requirePermission } from "../plugins/auth.js";
import { editorialCategorySchema, editorialIdParamsSchema, editorialListQuerySchema, editorialMediaQuerySchema, editorialSaveSchema, editorialUploadSchema, editorialPublishSchema, } from "../schemas/editorial.js";
import { completeEditorialUpload, createEditorialUpload, getEditorialMediaPreview, listEditorialMedia } from "../services/editorial/media-service.js";
import { checkEditorialRelease, getEditorialRelease, requestEditorialRelease, retryEditorialRelease } from "../services/editorial/release-service.js";
import { createEditorialCategory, getEditorialPost, listEditorialCategories, listEditorialPosts, saveEditorialDraft, updateEditorialCategory, } from "../services/editorial/post-service.js";
export const adminFeedRoutes = async (app) => {
    app.addHook("onRequest", async (_request, reply) => {
        reply.header("Cache-Control", "private, no-store");
        reply.header("Vary", "Authorization");
    });
    app.addHook("preHandler", requireAuthentication);
    app.addHook("preHandler", async () => {
        if (!env.FEED_ENABLED) {
            throw new AppError(503, "FEED_DISABLED", "O modulo Feed esta desativado.");
        }
    });
    const canRead = requirePermission("feed.read");
    const canEdit = requirePermission("feed.edit");
    const canManageMedia = requirePermission("feed.media.manage");
    const canPublish = requirePermission("feed.publish");
    app.get("/categories", { preHandler: canRead }, async () => ({ items: await listEditorialCategories() }));
    app.post("/categories", { preHandler: canEdit }, async (request, reply) => {
        const category = await createEditorialCategory(editorialCategorySchema.parse(request.body));
        return reply.code(201).send(category);
    });
    app.patch("/categories/:id", { preHandler: canEdit }, async (request) => {
        const { id } = editorialIdParamsSchema.parse(request.params);
        const patch = editorialCategorySchema.partial().parse(request.body);
        if (!Object.keys(patch).length)
            throw new AppError(400, "EMPTY_PATCH", "Informe ao menos um campo para atualizar.");
        return updateEditorialCategory(id, patch);
    });
    app.get("/posts", { preHandler: canRead }, async (request) => {
        return listEditorialPosts(editorialListQuerySchema.parse(request.query));
    });
    app.get("/posts/:id", { preHandler: canRead }, async (request) => {
        const { id } = editorialIdParamsSchema.parse(request.params);
        return getEditorialPost(id);
    });
    app.post("/posts", { bodyLimit: 1024 * 1024, preHandler: canEdit }, async (request, reply) => {
        const input = editorialSaveSchema.parse(request.body);
        const saved = await saveEditorialDraft({ ...input, adminUserId: request.user.sub });
        return reply.code(201).send(saved);
    });
    app.patch("/posts/:id", { bodyLimit: 1024 * 1024, preHandler: canEdit }, async (request) => {
        const { id } = editorialIdParamsSchema.parse(request.params);
        const input = editorialSaveSchema.parse(request.body);
        if (input.expectedVersion === undefined) {
            throw new AppError(400, "EXPECTED_VERSION_REQUIRED", "Informe a versao atual para evitar sobrescrever outra edicao.");
        }
        return saveEditorialDraft({ ...input, id, adminUserId: request.user.sub });
    });
    app.get("/assets", { preHandler: canRead }, async (request) => {
        const { page, pageSize } = editorialMediaQuerySchema.parse(request.query);
        return listEditorialMedia(request.user.sub, page, pageSize);
    });
    app.post("/assets/uploads", { preHandler: canManageMedia }, async (request, reply) => {
        const input = editorialUploadSchema.parse(request.body);
        const result = await createEditorialUpload({ ...input, adminUserId: request.user.sub });
        return reply.code(201).send(result);
    });
    app.post("/assets/:id/complete", { preHandler: canManageMedia }, async (request) => {
        const { id } = editorialIdParamsSchema.parse(request.params);
        return completeEditorialUpload(id, request.user.sub);
    });
    app.get("/assets/:id/preview", { preHandler: canRead }, async (request, reply) => {
        const { id } = editorialIdParamsSchema.parse(request.params);
        reply.header("Cache-Control", "no-store");
        return getEditorialMediaPreview(id, request.user.sub);
    });
    app.post("/posts/:id/publish", { preHandler: canPublish }, async (request, reply) => {
        const { id } = editorialIdParamsSchema.parse(request.params);
        const input = editorialPublishSchema.parse(request.body);
        const result = await requestEditorialRelease({ postId: id, revisionId: input.revisionId, idempotencyKey: input.idempotencyKey, adminUserId: request.user.sub });
        return reply.code(202).send(result);
    });
    app.post("/posts/:id/archive", { preHandler: canPublish }, async (request, reply) => {
        const { id } = editorialIdParamsSchema.parse(request.params);
        const input = editorialPublishSchema.parse(request.body);
        const result = await requestEditorialRelease({ postId: id, revisionId: input.revisionId, idempotencyKey: input.idempotencyKey, adminUserId: request.user.sub, operation: "archive" });
        return reply.code(202).send(result);
    });
    app.get("/releases/:id", { preHandler: canRead }, async (request) => {
        const { id } = editorialIdParamsSchema.parse(request.params);
        return getEditorialRelease(id);
    });
    app.post("/releases/:id/check", { preHandler: canPublish }, async (request) => {
        const { id } = editorialIdParamsSchema.parse(request.params);
        return checkEditorialRelease(id);
    });
    app.post("/releases/:id/retry", { preHandler: canPublish }, async (request, reply) => {
        const { id } = editorialIdParamsSchema.parse(request.params);
        return reply.code(202).send(await retryEditorialRelease(id, request.user.sub));
    });
};
