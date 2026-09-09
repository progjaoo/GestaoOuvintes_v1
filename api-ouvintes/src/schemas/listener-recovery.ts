import { z } from "zod";

export const recoveryPurposeSchema = z.enum(["listener_profile"]);

export const createRecoveryHandoffSchema = z
  .object({
    purpose: recoveryPurposeSchema.default("listener_profile"),
  })
  .strict();

export const consumeRecoveryHandoffSchema = z
  .object({
    token: z.string().trim().min(32).max(256),
    purpose: recoveryPurposeSchema.default("listener_profile"),
  })
  .strict();

export type RecoveryPurpose = z.infer<typeof recoveryPurposeSchema>;
