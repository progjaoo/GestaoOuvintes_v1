import { z } from "zod";
import { env } from "../config/env.js";

export const institutionalBannerActionTypes = [
  "none",
  "external_url",
  "listener_registration_modal",
] as const;

export type InstitutionalBannerActionType =
  (typeof institutionalBannerActionTypes)[number];

const placementKey = z.string().trim().min(2).max(80).regex(/^[a-z0-9_:-]+$/);
const secureDestinationUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || (env.NODE_ENV !== "production" && url.protocol === "http:");
  }, "Use uma URL HTTPS valida.");
const objectKey = z.string()
  .trim()
  .min(3)
  .max(1024)
  .regex(/^[a-zA-Z0-9._/\-]+$/, "Use um caminho valido do bucket.");

const actionStateSchema = z.discriminatedUnion("actionType", [
  z.object({
    actionType: z.literal("none"),
    destinationUrl: z.null().optional().default(null),
    openInNewTab: z.boolean().optional().transform(() => false),
  }),
  z.object({
    actionType: z.literal("external_url"),
    destinationUrl: secureDestinationUrl,
    openInNewTab: z.boolean().default(false),
  }),
  z.object({
    actionType: z.literal("listener_registration_modal"),
    destinationUrl: z.null().optional().default(null),
    openInNewTab: z.boolean().optional().transform(() => false),
  }),
]);

function inferLegacyAction(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  if (input.actionType) return input;
  return {
    ...input,
    actionType: input.destinationUrl ? "external_url" : "none",
  };
}

export const institutionalBannerActionStateSchema = z.preprocess(
  inferLegacyAction,
  actionStateSchema,
);

const commonCreateShape = {
  title: z.string().trim().min(2).max(160),
  altText: z.string().trim().min(2).max(220),
  placementKey: placementKey.default("home_hero"),
  active: z.boolean().default(false),
};

export const bannerIdParamsSchema = z.object({ id: z.uuid() });
export const publicBannerQuerySchema = z.object({
  placement: placementKey.default("home_hero"),
});
export const createInstitutionalBannerSchema = z.preprocess(
  inferLegacyAction,
  z.discriminatedUnion("actionType", [
    z.object({ ...commonCreateShape, mediaAssetId: z.uuid() }).extend(
      actionStateSchema.options[0].shape,
    ),
    z.object({ ...commonCreateShape, mediaAssetId: z.uuid() }).extend(
      actionStateSchema.options[1].shape,
    ),
    z.object({ ...commonCreateShape, mediaAssetId: z.uuid() }).extend(
      actionStateSchema.options[2].shape,
    ),
  ]),
);
export const createInstitutionalBannerFromR2ObjectSchema = z.preprocess(
  inferLegacyAction,
  z.discriminatedUnion("actionType", [
    z.object({ ...commonCreateShape, objectKey }).extend(actionStateSchema.options[0].shape),
    z.object({ ...commonCreateShape, objectKey }).extend(actionStateSchema.options[1].shape),
    z.object({ ...commonCreateShape, objectKey }).extend(actionStateSchema.options[2].shape),
  ]),
);
export const updateInstitutionalBannerSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  altText: z.string().trim().min(2).max(220).optional(),
  placementKey: placementKey.optional(),
  mediaAssetId: z.uuid().optional(),
  actionType: z.enum(institutionalBannerActionTypes).optional(),
  destinationUrl: secureDestinationUrl.nullable().optional(),
  openInNewTab: z.boolean().optional(),
  active: z.boolean().optional(),
});
export const reorderInstitutionalBannersSchema = z.object({
  placementKey: placementKey.default("home_hero"),
  orderedIds: z.array(z.uuid()).min(1).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    "A lista de ordenacao contem IDs duplicados.",
  ),
});
