import { z } from "zod";

const profileText = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .min(min, message)
    .max(max, `Use ate ${max} caracteres.`)
    .regex(/^[\p{L}\p{M}0-9 .,'’`´^~\-]+$/u, "Use apenas texto simples.");

const optionalBoolean = z.boolean().optional();

export const listenerProfileUpdateSchema = z
  .object({
    name: profileText(2, 160, "Informe seu nome.").optional(),
    neighborhood: profileText(2, 120, "Informe seu bairro.").optional(),
    city: profileText(2, 120, "Informe sua cidade.").optional(),
    phone: z
      .string()
      .trim()
      .min(1, "Informe seu telefone.")
      .max(30, "Use ate 30 caracteres.")
      .optional(),
    email: z.email().max(320).optional(),
    gender: profileText(2, 40, "Informe um genero valido.").optional(),
    ageRange: profileText(2, 40, "Informe uma faixa etaria valida.").optional(),
    privacyNoticeVersion: z.string().trim().min(1).max(40).optional(),
    privacyAcknowledged: z.boolean().optional(),
    marketingOptIn: optionalBoolean,
    receivePortalNews: optionalBoolean,
    receiveCampaignUpdates: optionalBoolean,
    receiveEmail: optionalBoolean,
    receiveWhatsapp: optionalBoolean,
  })
  .strict()
  .refine(
    (input) => Object.keys(input).some((key) => key !== "privacyAcknowledged"),
    "Informe ao menos um dado para atualizar.",
  );

export type ListenerProfileUpdate = z.infer<typeof listenerProfileUpdateSchema>;
