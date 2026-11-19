import { z } from 'zod';
import { pollInput, type PollInput } from '../schemas/poll.js';
import { assertConcreteEdition } from './poll-edition.js';
import { pollWindow } from './poll-policy.js';
import type { WeeklySlot, ProgrammingException } from './programming-resolver.js';

// Pure preview: no Google calls, database writes, credentials or publication.
export interface CalendarPollSource {
  calendarId: string;
  allowedProgramIds: readonly string[];
  defaultProgramId: string;
  defaultMode: 'vote' | 'message' | 'mixed';
  identificationPolicy: 'anonymous' | 'optional' | 'required';
}
export interface CalendarPollProgram { id: string; name: string; active: boolean }
export interface CalendarPollEdition { programId: string; startsAt: string; endsAt: string }
export interface CalendarEventProjection {
  title: string | null;
  programId: string | null;
  startDate: string | null;
  endDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
}
export interface CalendarPollSchedule {
  programs: readonly CalendarPollProgram[];
  editions: readonly CalendarPollEdition[];
  slots: WeeklySlot[];
  exceptions: ProgrammingException[];
}
export type CalendarPollIssue =
  | 'INVALID_SOURCE' | 'INVALID_EVENT' | 'UNSUPPORTED_EVENT' | 'UNSAFE_DESCRIPTION'
  | 'INVALID_CONFIG' | 'PROGRAM_UNAVAILABLE' | 'EDITION_UNAVAILABLE'
  | 'INVALID_WINDOW' | 'INVALID_POLL';
export type CalendarPollPreview =
  | { kind: 'pending'; issues: CalendarPollIssue[]; calendarEvent: CalendarEventProjection }
  | { kind: 'canceled'; external: { calendarId: string; eventId: string }; calendarEvent: CalendarEventProjection }
  | { kind: 'preview'; requiresReview: true; external: { calendarId: string; eventId: string; etag?: string; updated?: string };
      programId: string; poll: PollInput; calendarEvent: CalendarEventProjection };

const sourceSchema = z.object({
  calendarId: z.string().min(1).max(1024),
  allowedProgramIds: z.array(z.uuid()).min(1).max(100), defaultProgramId: z.uuid(),
  defaultMode: z.enum(['vote', 'message', 'mixed']),
  identificationPolicy: z.enum(['anonymous', 'optional', 'required']),
});
const eventSchema = z.object({
  id: z.string().min(1).max(1024), status: z.enum(['confirmed', 'tentative', 'cancelled']).default('confirmed'),
  summary: z.string().max(10000).optional(), description: z.string().max(20000).optional(),
  etag: z.string().max(1024).optional(), updated: z.iso.datetime({ offset: true }).optional(),
  start: z.object({ date: z.iso.date().optional(), dateTime: z.iso.datetime({ offset: true }).optional() }).optional(),
  end: z.object({ date: z.iso.date().optional(), dateTime: z.iso.datetime({ offset: true }).optional() }).optional(),
  recurrence: z.array(z.string()).optional(), recurringEventId: z.string().optional(),
  eventType: z.string().optional(),
});
const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
const pending = (issue: CalendarPollIssue, calendarEvent: CalendarEventProjection): CalendarPollPreview => ({ kind: 'pending', issues: [issue], calendarEvent });

function descriptionText(value: string): string | null {
  // Accept only formatting HTML and emit plain text; unsupported markup needs human review.
  if (/<\s*[!?]|<\s*\/?\s*(?:script|style|iframe|object|svg|math|template)\b/i.test(value)) return null;
  const allowed = new Set(['div', 'p', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li']);
  let invalid = false;
  let text = value.replace(/<\s*(\/?)\s*([a-z][a-z0-9]*)\b[^>]*>/gi, (_tag, closing: string, name: string) => {
    const lower = name.toLowerCase();
    if (!allowed.has(lower)) invalid = true;
    return lower === 'br' || (closing && ['div', 'p', 'li'].includes(lower)) ? '\n' : '';
  });
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (raw, key: string) => {
    if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? raw;
    const n = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
  if (invalid || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return null;
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

type EditorialConfig = { context: string; program?: string; mode?: 'vote' | 'message' | 'mixed'; options: string[] };
function editorialConfig(text: string): EditorialConfig | null {
  const lines = text.split('\n');
  const open = lines.findIndex(line => line === '[CONFIG ENQUETE 88]');
  const hasMarkers = text.includes('[CONFIG ENQUETE 88]') || text.includes('[/CONFIG ENQUETE 88]');
  let begin = open;
  let body: string[];
  if (hasMarkers) {
    if (open < 0 || lines.at(-1) !== '[/CONFIG ENQUETE 88]' || lines.filter(l => l === '[CONFIG ENQUETE 88]').length !== 1
      || lines.filter(l => l === '[/CONFIG ENQUETE 88]').length !== 1) return null;
    body = lines.slice(open + 1, -1);
  } else {
    begin = lines.findIndex(line => /^(?:PROGRAMA|TIPO|ALTERNATIVAS):/i.test(line));
    if (begin < 0) return { context: text, options: [] };
    body = lines.slice(begin);
  }
  const result: EditorialConfig = { context: lines.slice(0, begin).join('\n').trim(), options: [] };
  const seen = new Set<string>();
  let alternatives = false;
  for (const line of body.filter(Boolean)) {
    if (line.startsWith('- ')) {
      if (!alternatives || !line.slice(2).trim()) return null;
      result.options.push(line.slice(2).trim());
      continue;
    }
    const match = /^(PROGRAMA|TIPO|ALTERNATIVAS):\s*(.*)$/i.exec(line);
    if (!match) return null;
    const key = match[1]!.toUpperCase(), value = match[2]!.trim();
    if (seen.has(key)) return null;
    seen.add(key); alternatives = key === 'ALTERNATIVAS';
    if (key === 'PROGRAMA') { if (!value) return null; result.program = value; }
    if (key === 'TIPO') {
      const modes: Record<string, 'vote' | 'message' | 'mixed'> = {
        'somente voto': 'vote', voto: 'vote', 'somente mensagem': 'message', mensagem: 'message', 'voto e mensagem': 'mixed',
      };
      result.mode = modes[fold(value)];
      if (!result.mode) return null;
    }
    if (alternatives && value) return null;
  }
  if (!seen.size || (seen.has('ALTERNATIVAS') && result.options.length < 2)) return null;
  return result;
}
const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
function day(at: string): string {
  const p = Object.fromEntries(localDay.formatToParts(new Date(at)).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function eventProjection(raw: unknown): CalendarEventProjection {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const start = value.start && typeof value.start === 'object' ? value.start as Record<string, unknown> : {};
  const end = value.end && typeof value.end === 'object' ? value.end as Record<string, unknown> : {};
  const rawTitle = typeof value.summary === 'string' ? value.summary : '';
  const title = rawTitle.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) || null;
  const startDate = z.iso.date().safeParse(start.date);
  const endDate = z.iso.date().safeParse(end.date);
  if (startDate.success && endDate.success && endDate.data > startDate.data) {
    return { title, programId: null, startDate: startDate.data, endDate: endDate.data, startsAt: null, endsAt: null, allDay: true };
  }
  const startAt = z.iso.datetime({ offset: true }).safeParse(start.dateTime);
  const endAt = z.iso.datetime({ offset: true }).safeParse(end.dateTime);
  if (startAt.success && endAt.success && Date.parse(endAt.data) > Date.parse(startAt.data)) {
    return { title, programId: null, startDate: day(startAt.data), endDate: day(endAt.data), startsAt: new Date(startAt.data).toISOString(), endsAt: new Date(endAt.data).toISOString(), allDay: false };
  }
  return { title, programId: null, startDate: null, endDate: null, startsAt: null, endsAt: null, allDay: false };
}

export function previewCalendarPoll(raw: unknown, source: CalendarPollSource, schedule: CalendarPollSchedule): CalendarPollPreview {
  let calendarEvent = eventProjection(raw);
  if (!sourceSchema.safeParse(source).success || !source.allowedProgramIds.includes(source.defaultProgramId)) return pending('INVALID_SOURCE', calendarEvent);
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) return pending('INVALID_EVENT', calendarEvent);
  const event = parsed.data;
  const external = { calendarId: source.calendarId, eventId: event.id, ...(event.etag ? { etag: event.etag } : {}), ...(event.updated ? { updated: event.updated } : {}) };
  if (event.status === 'cancelled') return { kind: 'canceled', external, calendarEvent };
  if (event.status !== 'confirmed' || event.recurrence || event.recurringEventId || (event.eventType && event.eventType !== 'default')) return pending('UNSUPPORTED_EVENT', calendarEvent);
  if (!event.summary?.trim() || !event.start || !event.end) return pending('INVALID_EVENT', calendarEvent);
  const description = descriptionText(event.description ?? '');
  if (description === null) return pending('UNSAFE_DESCRIPTION', calendarEvent);
  const config = editorialConfig(description);
  if (!config) return pending('INVALID_CONFIG', calendarEvent);
  const candidates = schedule.programs.filter(p => p.active && source.allowedProgramIds.includes(p.id)
    && (config.program ? fold(p.name) === fold(config.program) : p.id === source.defaultProgramId));
  if (candidates.length !== 1) return pending('PROGRAM_UNAVAILABLE', calendarEvent);
  const programId = candidates[0]!.id;
  calendarEvent = { ...calendarEvent, programId };
  const s = event.start, e = event.end;
  const allDay = !!s.date && !!e.date && !s.dateTime && !e.dateTime;
  const timed = !!s.dateTime && !!e.dateTime && !s.date && !e.date;
  if (!allDay && !timed) return pending('INVALID_WINDOW', calendarEvent);
  if (allDay && Date.parse(e.date!) - Date.parse(s.date!) !== 86400000) return pending('INVALID_WINDOW', calendarEvent);
  if (timed && Date.parse(e.dateTime!) <= Date.parse(s.dateTime!)) return pending('INVALID_WINDOW', calendarEvent);
  const editions = schedule.editions.filter(ed => {
    if (ed.programId !== programId) return false;
    try {
      assertConcreteEdition(programId, ed.startsAt, ed.endsAt, schedule.slots, schedule.exceptions);
      return allDay ? day(ed.startsAt) === s.date : Date.parse(s.dateTime!) >= Date.parse(ed.startsAt) && Date.parse(e.dateTime!) <= Date.parse(ed.endsAt);
    } catch { return false; }
  });
  if (editions.length !== 1) return pending('EDITION_UNAVAILABLE', calendarEvent);
  const edition = editions[0]!;
  const title = descriptionText(event.summary);
  if (title === null) return pending('UNSAFE_DESCRIPTION', calendarEvent);
  const question = title.replace(/\s+/g, ' ').trim();
  if (!/[?？]\s*$/.test(question)) return pending('INVALID_POLL', calendarEvent);
  const options = config.options.length ? config.options : ['Sim', 'Não'];
  const mode = config.mode ?? 'mixed';
  if (new Set(options.map(fold)).size !== options.length) return pending('INVALID_POLL', calendarEvent);
  const slug = fold(question).replace(/[^a-z0-9]+/g, '-').slice(0, 120).replace(/^-|-$/g, '') || 'enquete';
  const poll = pollInput.safeParse({ slug, question, context: config.context, mode,
    identificationPolicy: source.identificationPolicy, allowMessage: mode !== 'vote', options,
    editionStartsAt: edition.startsAt, editionEndsAt: edition.endsAt,
    startsAt: allDay ? edition.startsAt : s.dateTime, endsAt: allDay ? edition.endsAt : e.dateTime,
  });
  if (!poll.success) return pending('INVALID_POLL', calendarEvent);
  try { pollWindow(edition, poll.data); } catch { return pending('INVALID_WINDOW', calendarEvent); }
  return { kind: 'preview', requiresReview: true, external, programId, poll: poll.data, calendarEvent };
}
