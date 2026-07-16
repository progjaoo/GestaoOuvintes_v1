import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(3).max(100),
  password: z.string().min(8).max(200),
});

export const bootstrapAdminSchema = z.object({
  name: z.string().trim().min(2).max(160),
  username: z.string().trim().min(3).max(100),
  password: z
    .string()
    .min(12, "A senha precisa ter pelo menos 12 caracteres.")
    .max(200),
});
