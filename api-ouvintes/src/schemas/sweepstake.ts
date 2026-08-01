import { z } from "zod";

export const sweepstakeCampaignParamsSchema = z.object({
  campaignId: z.uuid(),
});

export const sweepstakeIdempotencyHeadersSchema = z.object({
  "idempotency-key": z.uuid(),
});

export const redrawSweepstakeSchema = z.object({
  previousDrawId: z.uuid(),
});

