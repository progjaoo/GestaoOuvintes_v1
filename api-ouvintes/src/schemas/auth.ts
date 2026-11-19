import { z } from "zod";

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(320).optional(),
  username: z.string().trim().min(3).max(100).optional(),
  password: z.string().min(8).max(200),
}).transform((input, context) => {
  const identifier = input.identifier ?? input.username;
  if (!identifier) {
    context.addIssue({ code: "custom", path: ["identifier"], message: "Informe usuario ou e-mail." });
    return z.NEVER;
  }
  return { identifier, password: input.password };
});

export const bootstrapAdminSchema = z.object({
  name: z.string().trim().min(2).max(160),
  username: z.string().trim().min(3).max(100),
  password: z
    .string()
    .min(12, "A senha precisa ter pelo menos 12 caracteres.")
    .max(200),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(320),
});

export const identityTokenConsumeSchema = z.object({
  token: z.string().min(32).max(128),
  password: z.string().min(12).max(200).optional(),
});

export const reauthenticateSchema = z.object({
  password: z.string().min(8).max(200),
});
