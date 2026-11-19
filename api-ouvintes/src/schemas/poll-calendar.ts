import { z } from 'zod';

export const pollCalendarState = z.enum([
  'review', 'scheduled', 'published', 'closed', 'archived', 'canceled', 'invalid', 'conflict',
]);

export const pollCalendarQuery = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  programId: z.uuid().optional(),
  state: pollCalendarState.optional(),
  q: z.string().trim().max(120).optional(),
  after: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200),
}).strict().superRefine((value, context) => {
  const from = Date.parse(`${value.from}T00:00:00.000Z`);
  const to = Date.parse(`${value.to}T00:00:00.000Z`);
  const days = (to - from) / 86_400_000;
  if (days <= 0 || days > 42) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'O intervalo deve ter entre 1 e 42 dias.' });
  }
});

const cursorPayload = z.object({
  startDate: z.iso.date().nullable(),
  id: z.uuid(),
}).strict();

export type PollCalendarQuery = z.infer<typeof pollCalendarQuery>;
export type PollCalendarCursor = z.infer<typeof cursorPayload>;

export function encodePollCalendarCursor(cursor: PollCalendarCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodePollCalendarCursor(value: string | undefined): PollCalendarCursor | null {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Cursor invalido.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Cursor invalido.');
  }
  const result = cursorPayload.safeParse(parsed);
  if (!result.success) throw new Error('Cursor invalido.');
  return result.data;
}
