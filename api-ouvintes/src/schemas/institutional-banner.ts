import { z } from "zod";
import { env } from "../config/env.js";

const placementKey = z.string().trim().min(2).max(80).regex(/^[a-z0-9_:-]+$/);
const destinationUrl = z
  .string().trim().max(2048).nullable().optional()
  .transform((value) => value || null)
  .refine((value) => {
    if (!value) return true;
    const url = new URL(value);
    return url.protocol === "https:" || (env.NODE_ENV !== "production" && url.protocol === "http:");
  }, "Use uma URL HTTPS valida.");
const objectKey = z.string()
  .trim()
  .min(3)
  .max(1024)
  .regex(/^[a-zA-Z0-9._/\-]+$/, "Use um caminho valido do bucket.");

export const bannerIdParamsSchema = z.object({ id: z.uuid() });
export const publicBannerQuerySchema = z.object({
  placement: placementKey.default("home_hero"),
});
export const createInstitutionalBannerSchema = z.object({
  title: z.string().trim().min(2).max(160),
  altText: z.string().trim().min(2).max(220),
  placementKey: placementKey.default("home_hero"),
  mediaAssetId: z.uuid(),
  destinationUrl,
  openInNewTab: z.boolean().default(false),
  active: z.boolean().default(false),
});
export const createInstitutionalBannerFromR2ObjectSchema = z.object({
  title: z.string().trim().min(2).max(160),
  altText: z.string().trim().min(2).max(220),
  placementKey: placementKey.default("home_hero"),
  objectKey,
  destinationUrl,
  openInNewTab: z.boolean().default(false),
  active: z.boolean().default(false),
});
export const updateInstitutionalBannerSchema = createInstitutionalBannerSchema.partial();
export const reorderInstitutionalBannersSchema = z.object({
  placementKey: placementKey.default("home_hero"),
  orderedIds: z.array(z.uuid()).min(1).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    "A lista de ordenacao contem IDs duplicados.",
  ),
});
