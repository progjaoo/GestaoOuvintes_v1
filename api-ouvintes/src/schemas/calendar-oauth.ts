import { z } from 'zod';

export const calendarOAuthCallbackSchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(32).max(256).optional(),
  error: z.string().max(128).optional(),
  error_description: z.string().max(1024).optional(),
  iss: z.literal('https://accounts.google.com').optional(),
  // Advisory callback metadata; only the token response authorizes scopes.
  scope: z.string().max(4096).optional(),
  authuser: z.string().regex(/^\d{1,3}$/).optional(),
  prompt: z.string().max(128).optional(),
}).strict();
