import { z } from 'zod';

export const participationState = z.enum(['received', 'reviewed', 'selected', 'rejected']);
export const participationFilters = z.object({
  programId: z.uuid().optional(),
  pollId: z.uuid().optional(),
  state: participationState.optional(),
  after: z.uuid().optional(),
}).strict();
export const participationModeration = z.object({
  version: z.number().int().positive(),
  state: z.enum(['reviewed', 'selected', 'rejected']),
  note: z.string().max(500).optional(),
}).strict();
export type ParticipationFilters = z.infer<typeof participationFilters>;
export type ParticipationModeration = z.infer<typeof participationModeration>;
