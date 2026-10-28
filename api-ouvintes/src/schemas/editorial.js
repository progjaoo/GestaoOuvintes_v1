import { z } from "zod";
const slugSchema = z.string().trim().min(2).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const assetIdSchema = z.uuid();
const allowedNodes = new Set([
    "doc", "paragraph", "heading", "bulletList", "orderedList", "listItem",
    "blockquote", "horizontalRule", "text",
]);
const allowedMarks = new Set(["bold", "italic", "strike", "link"]);
function sanitizeRichText(value, depth = 0) {
    if (depth > 12 || !value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Estrutura de texto invalida.");
    }
    const input = value;
    if (typeof input.type !== "string" || !allowedNodes.has(input.type)) {
        throw new Error("Tipo de bloco de texto nao permitido.");
    }
    const result = { type: input.type };
    if (input.type === "text") {
        if (typeof input.text !== "string" || input.text.length > 20_000)
            throw new Error("Texto invalido.");
        result.text = input.text;
    }
    if (input.type === "heading") {
        const level = Number(input.attrs?.level ?? 2);
        if (level !== 2 && level !== 3)
            throw new Error("Use apenas titulos H2 ou H3.");
        result.attrs = { level };
    }
    if (input.type === "orderedList") {
        const start = Number(input.attrs?.start ?? 1);
        result.attrs = { start: Number.isInteger(start) && start > 0 && start < 1000 ? start : 1 };
    }
    if (input.marks !== undefined) {
        if (!Array.isArray(input.marks) || input.marks.length > 8)
            throw new Error("Formatacao invalida.");
        result.marks = input.marks.map((mark) => {
            if (!mark || typeof mark !== "object" || Array.isArray(mark))
                throw new Error("Formatacao invalida.");
            const typedMark = mark;
            if (typeof typedMark.type !== "string" || !allowedMarks.has(typedMark.type))
                throw new Error("Formatacao nao permitida.");
            if (typedMark.type !== "link")
                return { type: typedMark.type };
            const href = typedMark.attrs?.href;
            if (typeof href !== "string" || href.length > 2048)
                throw new Error("Link invalido.");
            let parsed;
            try {
                parsed = new URL(href);
            }
            catch {
                throw new Error("Informe uma URL completa no link.");
            }
            if (!["http:", "https:", "mailto:"].includes(parsed.protocol))
                throw new Error("Protocolo de link nao permitido.");
            return { type: "link", attrs: { href: parsed.href } };
        });
    }
    if (input.content !== undefined) {
        if (!Array.isArray(input.content) || input.content.length > 100)
            throw new Error("Conteudo de texto excedeu o limite.");
        result.content = input.content.map((node) => sanitizeRichText(node, depth + 1));
    }
    return result;
}
const richTextSchema = z.unknown().transform((value, context) => {
    try {
        return sanitizeRichText(value);
    }
    catch (error) {
        context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Texto invalido." });
        return z.NEVER;
    }
});
const textBlock = z.object({ id: z.uuid(), type: z.literal("text"), content: richTextSchema, width: z.enum(["reading", "wide"]).default("reading") }).strict();
const imageBlock = z.object({ id: z.uuid(), type: z.literal("image"), assetId: assetIdSchema, alt: z.string().trim().min(2).max(220), caption: z.string().max(500).default(""), credit: z.string().max(160).default(""), width: z.enum(["reading", "wide"]).default("wide") }).strict();
const galleryBlock = z.object({ id: z.uuid(), type: z.literal("gallery"), items: z.array(z.object({ assetId: assetIdSchema, alt: z.string().trim().min(2).max(220), caption: z.string().max(300).default("") }).strict()).min(2).max(12), layout: z.enum(["mosaic", "carousel"]).default("mosaic") }).strict();
const videoBlock = z.object({ id: z.uuid(), type: z.literal("video"), source: z.discriminatedUnion("kind", [z.object({ kind: z.literal("asset"), assetId: assetIdSchema }).strict(), z.object({ kind: z.literal("youtube"), videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }).strict()]), posterAssetId: assetIdSchema.optional(), title: z.string().trim().min(2).max(180), caption: z.string().max(500).default(""), captionsAssetId: assetIdSchema.optional() }).strict();
const gifBlock = z.object({ id: z.uuid(), type: z.literal("gif"), assetId: assetIdSchema, alt: z.string().trim().min(2).max(220), caption: z.string().max(500).default(""), posterAssetId: assetIdSchema.optional() }).strict();
const quoteBlock = z.object({ id: z.uuid(), type: z.literal("quote"), text: z.string().trim().min(2).max(1200), attribution: z.string().max(180).default("") }).strict();
const dividerBlock = z.object({ id: z.uuid(), type: z.literal("divider") }).strict();
export const editorialBlockSchema = z.discriminatedUnion("type", [textBlock, imageBlock, galleryBlock, videoBlock, gifBlock, quoteBlock, dividerBlock]);
export const editorialRevisionSchema = z.object({
    title: z.string().trim().min(3).max(180),
    excerpt: z.string().trim().min(10).max(320),
    slug: slugSchema,
    categoryId: z.uuid(),
    coverAssetId: assetIdSchema,
    coverAlt: z.string().trim().min(2).max(220),
    coverFocusX: z.number().min(0).max(100).default(50),
    coverFocusY: z.number().min(0).max(100).default(50),
    openingAssetId: assetIdSchema.optional(),
    openingAlt: z.string().trim().min(2).max(220).optional(),
    openingFocusX: z.number().min(0).max(100).default(50),
    openingFocusY: z.number().min(0).max(100).default(50),
    seoTitle: z.string().trim().min(3).max(70),
    seoDescription: z.string().trim().min(20).max(180),
    eventDate: z.iso.date().nullable().default(null),
    publicCredits: z.string().max(500).default(""),
    blocks: z.array(editorialBlockSchema).max(50),
}).strict().superRefine((revision, context) => {
    for (const [index, block] of revision.blocks.entries()) {
        if (block.type === "video" && block.source.kind === "asset" && !block.posterAssetId) {
            context.addIssue({ code: "custom", path: ["blocks", index, "posterAssetId"], message: "Video proprio exige um poster estatico." });
        }
        if (block.type === "video" && block.captionsAssetId) {
            context.addIssue({ code: "custom", path: ["blocks", index, "captionsAssetId"], message: "Upload de legendas ainda nao e suportado." });
        }
    }
});
export const editorialListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).max(500).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    q: z.string().trim().max(120).optional(),
    status: z.enum(["draft", "published", "archived", "all"]).default("all"),
    categoryId: z.uuid().optional(),
});
export const editorialMediaQuerySchema = editorialListQuerySchema.pick({ page: true, pageSize: true });
export const editorialIdParamsSchema = z.object({ id: z.uuid() });
export const editorialSlugParamsSchema = z.object({ slug: slugSchema });
export const editorialSaveSchema = z.object({ expectedVersion: z.number().int().min(0).optional(), revision: editorialRevisionSchema }).strict();
export const editorialCategorySchema = z.object({ name: z.string().trim().min(2).max(80), slug: z.string().trim().min(2).max(90).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }).strict();
export const editorialPublishSchema = z.object({ revisionId: z.uuid(), idempotencyKey: z.uuid() }).strict();
export const editorialCheckReleaseParamsSchema = z.object({ id: z.uuid() });
export const editorialUploadSchema = z.object({ mediaType: z.enum(["image", "gif", "video"]), mimeType: z.string().max(100), byteSize: z.number().int().positive().max(50 * 1024 * 1024), filename: z.string().trim().min(1).max(255), checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional() }).strict().superRefine((input, context) => {
    const allowed = input.mediaType === "image"
        ? ["image/jpeg", "image/png", "image/webp", "image/avif"]
        : input.mediaType === "gif" ? ["image/gif"] : ["video/mp4"];
    const limit = input.mediaType === "video" ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (!allowed.includes(input.mimeType))
        context.addIssue({ code: "custom", path: ["mimeType"], message: "Formato nao permitido para este tipo de midia." });
    if (input.byteSize > limit)
        context.addIssue({ code: "custom", path: ["byteSize"], message: "Arquivo excede o limite deste tipo de midia." });
});
export function extractEditorialAssetIds(revision) {
    const ids = new Set([revision.coverAssetId, revision.openingAssetId ?? revision.coverAssetId]);
    for (const block of revision.blocks) {
        if (block.type === "image" || block.type === "gif")
            ids.add(block.assetId);
        if (block.type === "gif" && block.posterAssetId)
            ids.add(block.posterAssetId);
        if (block.type === "gallery")
            for (const item of block.items)
                ids.add(item.assetId);
        if (block.type === "video") {
            if (block.source.kind === "asset")
                ids.add(block.source.assetId);
            if (block.posterAssetId)
                ids.add(block.posterAssetId);
            if (block.captionsAssetId)
                ids.add(block.captionsAssetId);
        }
    }
    return [...ids];
}
