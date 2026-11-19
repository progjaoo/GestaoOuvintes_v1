import type { Pool } from 'pg';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { previewCalendarPoll, type CalendarPollSchedule, type CalendarPollSource } from './calendar-poll-parser.js';
import { createCalendarPollStaging } from './calendar-poll-staging.js';
import { createCalendarPollMaterializer } from './calendar-poll-materializer.js';
import { createGoogleCalendarApi, GoogleCalendarSyncTokenExpired } from './google-calendar-api.js';
import { calendarEncryptionKey, decryptCalendarSecret, type CalendarOAuthConfig } from './google-calendar-oauth.js';
import type { AuthorizationContext } from './authorization-service.js';
import type { ProgrammingException, WeeklySlot } from './programming-resolver.js';

const RADIO = 'radio-88';
const CALENDAR_PARSER_REVISION = 4;
const zone = 'America/Sao_Paulo';
const localDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function localDate(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  const parts = Object.fromEntries(localDateFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localDateTimeIso(date: string, minute: number): string {
  const dayOffset = Math.floor(minute / 1440), minuteOfDay = minute % 1440;
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + dayOffset);
  const datePart = d.toISOString().slice(0, 10), hour = Math.floor(minuteOfDay / 60), min = minuteOfDay % 60;
  const targetAsUtc = Date.parse(`${datePart}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`);
  let guess = targetAsUtc;
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(timeFormatter.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const represented = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    guess += targetAsUtc - represented;
  }
  return new Date(guess).toISOString();
}

function weekday(date: string) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }
function previousDate(date: string) { const result = new Date(`${date}T00:00:00Z`); result.setUTCDate(result.getUTCDate() - 1); return result.toISOString().slice(0, 10); }

interface ScheduleBase {
  programs: CalendarPollSchedule['programs'];
  slots: WeeklySlot[];
  exceptions: ProgrammingException[];
}

export function createCalendarPollSync(db: Pool, oauth: CalendarOAuthConfig, allowedCalendarId: string, fetcher: typeof fetch = fetch) {
  const staging = createCalendarPollStaging(db), key = calendarEncryptionKey(oauth.encryptionKey);
  const materialize = createCalendarPollMaterializer(db);
  const api = createGoogleCalendarApi({ clientId: oauth.clientId, clientSecret: oauth.clientSecret, allowedCalendarId,
    loadRefreshToken: async () => {
      const result = await db.query('SELECT refresh_token_ciphertext FROM radio_calendar_oauth_connection WHERE radio_key=$1', [RADIO]);
      if (!result.rowCount) throw new AppError(409, 'CALENDAR_NOT_CONNECTED', 'Conecte a conta Google antes de sincronizar.');
      return decryptCalendarSecret(result.rows[0].refresh_token_ciphertext, key);
    } }, fetcher);

  async function loadSchedule(programIds: string[]): Promise<ScheduleBase> {
    const [programs, slotRows, exceptionRows] = await Promise.all([
      db.query('SELECT id,name,active FROM radio_program WHERE radio_key=$1 AND id=ANY($2::uuid[])', [RADIO, programIds]),
      db.query(`SELECT s.id,s.radio_key AS "radioKey",s.program_id AS "programId",s.weekday,s.start_minute AS "startMinute",s.end_minute AS "endMinute",
        s.valid_from::text AS "validFrom",s.valid_until::text AS "validUntil",s.active,p.active AS "programActive"
        FROM radio_program_slot s JOIN radio_program p ON (p.radio_key,p.id)=(s.radio_key,s.program_id) WHERE s.radio_key=$1 AND s.program_id=ANY($2::uuid[])`, [RADIO,programIds]),
      db.query(`SELECT o.id,o.radio_key AS "radioKey",o.program_id AS "programId",o.active,o.starts_at AS "startsAt",o.ends_at AS "endsAt",p.active AS "programActive"
        FROM radio_program_override o LEFT JOIN radio_program p ON (p.radio_key,p.id)=(o.radio_key,o.program_id) WHERE o.radio_key=$1 AND o.program_id=ANY($2::uuid[])`, [RADIO,programIds]),
    ]);
    return {
      programs: programs.rows.map(p => ({ ...p, active: Boolean(p.active) })),
      slots: slotRows.rows.map(row => ({ ...row, active: Boolean(row.active), programActive: Boolean(row.programActive) })) as WeeklySlot[],
      exceptions: exceptionRows.rows.map(row => ({ ...row, startsAt: new Date(row.startsAt).toISOString(), endsAt: new Date(row.endsAt).toISOString(), active: Boolean(row.active), programActive: Boolean(row.programActive) })) as ProgrammingException[],
    };
  }

  function scheduleFor(base: ScheduleBase, programIds: string[], event: unknown): CalendarPollSchedule {
    const raw = event && typeof event === 'object' ? event as Record<string, unknown> : {};
    const start = raw.start && typeof raw.start === 'object' ? raw.start as { date?: unknown; dateTime?: unknown } : undefined;
    const eventDate = localDate(start?.date ?? start?.dateTime);
    const isTimed = typeof start?.dateTime === 'string';
    const anchorDates = eventDate ? (isTimed ? [eventDate, previousDate(eventDate)] : [eventDate]) : [];
    const editions: { programId: string; startsAt: string; endsAt: string }[] = [];
    for (const anchor of anchorDates) {
      for (const slot of base.slots) {
        if (!programIds.includes(slot.programId) || !slot.active || !slot.programActive || slot.weekday !== weekday(anchor) || anchor < slot.validFrom || (slot.validUntil && anchor > slot.validUntil)) continue;
        const endMinute = slot.endMinute < slot.startMinute ? slot.endMinute + 1440 : slot.endMinute;
        editions.push({ programId:slot.programId, startsAt: localDateTimeIso(anchor, slot.startMinute), endsAt: localDateTimeIso(anchor, endMinute) });
      }
    }
    for (const exception of base.exceptions) {
      const startsOn = localDate(exception.startsAt);
      if (exception.active && exception.programId && programIds.includes(exception.programId) && startsOn && anchorDates.includes(startsOn)) {
        editions.push({ programId:exception.programId, startsAt: exception.startsAt, endsAt: exception.endsAt });
      }
    }
    return { programs: base.programs, editions, slots: base.slots, exceptions: base.exceptions };
  }

  return {
    async listSources(ctx: AuthorizationContext) {
      return (await staging.listSources(ctx)).filter(source => source.calendarId === allowedCalendarId);
    },
    listPrograms: (ctx: AuthorizationContext) => staging.availablePrograms(ctx),
    createSource: (ctx: AuthorizationContext, programId: string) => staging.createSource(ctx, { calendarId: allowedCalendarId, programId }),
    configurePrograms: (ctx: AuthorizationContext, id: string, version: number, defaultProgramId: string, programIds: string[]) =>
      staging.configurePrograms(ctx,id,version,defaultProgramId,programIds),
    setActive: (ctx: AuthorizationContext, id: string, version: number, active: boolean) => staging.setActive(ctx, id, version, active),
    async stagedEvents(ctx: AuthorizationContext, id: string, after?: string, limit?: number) {
      const sources = await staging.listSources(ctx);
      if (!sources.some(source => source.id === id && source.calendarId === allowedCalendarId)) {
        throw new AppError(404, 'CALENDAR_SOURCE_UNAVAILABLE', 'Fonte indisponivel.');
      }
      return staging.list(ctx, id, after, limit);
    },
    calendar: (ctx: AuthorizationContext, filter: import('../schemas/poll-calendar.js').PollCalendarQuery) =>
      staging.calendar(ctx, allowedCalendarId, filter),
    async sync(ctx: AuthorizationContext, sourceId: string) {
      const claim = await staging.claim(ctx, sourceId);
      if (claim.calendarId !== allowedCalendarId) {
        await staging.abort(ctx, sourceId, claim.token).catch(() => undefined);
        throw new AppError(403, 'CALENDAR_ID_NOT_ALLOWED', 'Agenda fora da allowlist configurada.');
      }
      const source: CalendarPollSource = { calendarId: allowedCalendarId, allowedProgramIds: claim.allowedProgramIds, defaultProgramId: claim.programId, defaultMode: 'mixed', identificationPolicy: 'optional' };
      const parserRevisionRescan = claim.parserRevision < CALENDAR_PARSER_REVISION;
      const syncToken = parserRevisionRescan ? null : claim.syncToken;
      let pageToken: string | undefined, nextSyncToken: string | undefined, scanned = 0, changed = 0, pending = 0, canceled = 0;
      try {
        const schedule = await loadSchedule(claim.allowedProgramIds);
        do {
          await staging.renew(ctx, sourceId, claim.token);
          const page = await api.listEvents({ calendarId: claim.calendarId, syncToken, pageToken });
          for (let i = 0; i < page.items.length; i++) {
            if (i > 0 && i % 20 === 0) await staging.renew(ctx, sourceId, claim.token);
            const raw = page.items[i], id = z.string().min(1).max(1024).safeParse((raw as { id?: unknown })?.id);
            if (!id.success) throw new AppError(502, 'CALENDAR_EVENT_ID_MISSING', 'O Google retornou evento sem identificador; sincronizacao incompleta.');
            scanned++;
            const preview = previewCalendarPoll(raw, source, scheduleFor(schedule, claim.allowedProgramIds, raw));
            const result = await staging.stage(ctx, sourceId, claim.token, id.data, preview);
            if (result.changed) changed++;
            if (preview.kind === 'pending') pending++;
            if (preview.kind === 'canceled') canceled++;
          }
          pageToken = page.nextPageToken;
          if (!pageToken) nextSyncToken = page.nextSyncToken;
          if (!pageToken && !nextSyncToken) throw new AppError(502, 'CALENDAR_CURSOR_MISSING', 'Sincronizacao incompleta: o Google nao retornou cursor final.');
        } while (pageToken);
        const publication = await materialize(ctx, sourceId, CALENDAR_PARSER_REVISION);
        await staging.finish(ctx, sourceId, claim.token, nextSyncToken!, CALENDAR_PARSER_REVISION);
        return { scanned, changed, pending, canceled, skippedPast: 0, parserRevisionRescan, publication, reviewRequired: publication.needsReview > 0, readOnly: true };
      } catch (error) {
        if (error instanceof GoogleCalendarSyncTokenExpired) {
          await staging.restartFullSync(ctx, sourceId, claim.token);
          return { scanned, changed, pending, canceled, skippedPast: 0, fullSyncRequired: true, readOnly: true };
        }
        await staging.abort(ctx, sourceId, claim.token).catch(() => undefined);
        throw error;
      }
    },
  };
}
