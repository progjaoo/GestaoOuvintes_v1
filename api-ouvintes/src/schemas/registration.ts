import { z } from "zod";

const optionalTrackingField = z.string().trim().max(120).nullable().optional();

export const createRegistrationSchema = z.object({
  campaignSlug: z.string().trim().min(3).max(100),
  name: z.string().trim().min(2).max(160),
  neighborhood: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  submissionToken: z.uuid(),
  privacyNoticeVersion: z.string().trim().min(1).max(30),
  privacyAcknowledged: z.literal(true),
  marketingOptIn: z.boolean().default(false),
  source: z
    .enum(["institutional_web", "institutional_mobile", "admin_import"])
    .default("institutional_web"),
  website: z.string().max(0).optional(),
  utm: z
    .object({
      source: optionalTrackingField,
      medium: optionalTrackingField,
      campaign: optionalTrackingField,
      content: optionalTrackingField,
    })
    .optional(),
});

export const registrationIdParamsSchema = z.object({
  id: z.uuid(),
});

export const registrationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  campaignId: z.uuid().optional(),
  startDate: z.iso.datetime({ offset: true }).optional(),
  endDate: z.iso.datetime({ offset: true }).optional(),
  city: z.string().trim().max(120).optional(),
  neighborhood: z.string().trim().max(120).optional(),
  name: z.string().trim().max(160).optional(),
  hasPhone: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const registrationExportQuerySchema = registrationListQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({
    format: z.enum(["csv", "xlsx"]),
  });

export type RegistrationFilters = z.infer<typeof registrationExportQuerySchema>;
