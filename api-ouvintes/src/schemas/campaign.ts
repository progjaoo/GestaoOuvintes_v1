import { z } from "zod";

export const campaignStatusSchema = z.enum(["draft", "active", "paused", "closed"]);

export const campaignSlugParamsSchema = z.object({
  slug: z.string().trim().min(3).max(100),
});

export const campaignIdParamsSchema = z.object({
  id: z.uuid(),
});

const campaignFields = {
  slug: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(3).max(180),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(3).max(1_000),
  status: campaignStatusSchema,
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  privacyNoticeVersion: z.string().trim().min(1).max(30),
  privacyNoticeUrl: z.string().trim().min(1).max(2_000),
  termsUrl: z.string().trim().max(2_000).nullable().optional(),
};

export const createCampaignSchema = z
  .object(campaignFields)
  .refine(
    (data) => !data.endsAt || new Date(data.endsAt) > new Date(data.startsAt),
    {
      message: "A data final deve ser posterior a data inicial.",
      path: ["endsAt"],
    },
  );

export const updateCampaignSchema = z
  .object(campaignFields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });
