import { z } from "zod";

const optionalTrackingField = z.string().trim().max(120).nullable().optional();

const safeText = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .min(min, message)
    .max(max, `Use ate ${max} caracteres.`)
    .regex(/^[\p{L}\p{M}0-9 .,'’`´^~\-]+$/u, "Use apenas texto simples.");

export const phoneDigitsSchema = z
  .string()
  .trim()
  .min(1, "Informe seu telefone.")
  .max(30, "Use ate 30 caracteres.")
  .transform((value) => value.replace(/\D/g, ""))
  .refine((digits) => digits.length === 10 || digits.length === 11, {
    message: "Informe um telefone com DDD.",
  });

export const createRegistrationSchema = z
  .object({
    campaignSlug: z.string().trim().min(3).max(100),
    name: safeText(2, 160, "Informe seu nome."),
    neighborhood: safeText(2, 120, "Informe seu bairro."),
    city: safeText(2, 120, "Informe sua cidade."),
    phone: phoneDigitsSchema,
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
      .strict()
      .optional(),
  })
  .strict();

export const placementKeySchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9_:-]+$/);

export const publicPlatformSchema = z.enum([
  "web_mobile",
  "web_desktop",
  "web_tablet",
  "expo_ios",
  "expo_android",
]);

export const resolvePublicSessionSchema = z
  .object({
    placement: placementKeySchema,
    platform: publicPlatformSchema,
  })
  .strict();

export const createRegistrationAndParticipationSchema = createRegistrationSchema
  .omit({
    campaignSlug: true,
    submissionToken: true,
    source: true,
  })
  .extend({
    campaignId: z.uuid(),
    source: z.enum(["web", "expo", "receptionist", "import"]).default("web"),
    submissionToken: z.uuid().optional(),
  })
  .strict();

export const campaignParticipationParamsSchema = z.object({
  campaignId: z.uuid(),
});

export const updateDeviceStateSchema = z
  .object({
    dismissedUntil: z.iso.datetime({ offset: true }).nullable().optional(),
    incrementOpenCount: z.boolean().optional(),
  })
  .strict();

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
  q: z.string().trim().max(160).optional(),
  hasPhone: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  sortBy: z.enum(["createdAt", "name", "city"]).default("createdAt"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
});

export const registrationExportQuerySchema = registrationListQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({
    format: z.enum(["csv", "xlsx"]),
  });

export type RegistrationFilters = z.infer<typeof registrationExportQuerySchema>;
