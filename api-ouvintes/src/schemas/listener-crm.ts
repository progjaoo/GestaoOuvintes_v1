import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional();

const dateText = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.")
  .optional();

export const listenerProfileListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    q: optionalText(120),
    city: optionalText(120),
    neighborhood: optionalText(120),
    campaignId: z.string().uuid().optional(),
    consentType: z.string().trim().max(40).optional(),
    status: z.enum(["active", "inactive"]).optional(),
    startDate: dateText,
    endDate: dateText,
    sortBy: z
      .enum(["createdAt", "updatedAt", "name", "city", "participations"])
      .default("createdAt"),
    sortDirection: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();

export const listenerProfileIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export type ListenerProfileListQuery = z.infer<
  typeof listenerProfileListQuerySchema
>;
