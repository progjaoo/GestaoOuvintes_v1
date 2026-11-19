import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { pollInput } from '../schemas/poll.js';
import type { AuthorizationContext } from './authorization-service.js';
import { commandPoll, savePoll } from './poll-service.js';

const RADIO = 'radio-88';
const payloadSchema = z.object({ programId: z.uuid(), poll: pollInput }).strict();
type Result = { scheduled: number; alreadyLinked: number; canceled: number; needsReview: number; failed: number };

function sameInstant(left: Date | string, right: string) {
  return new Date(left).getTime() === Date.parse(right);
}

function externalSlug(base: string, sourceId: string, eventId: string) {
  const suffix = createHash('sha256').update(`${sourceId}:${eventId}`).digest('hex').slice(0, 8);
  return `${base.slice(0, 111).replace(/-+$/g, '')}-${suffix}`;
}

// Promotes only complete, future/current events after the Calendar sync cursor commits.
// The database link and deterministic slug make retries safe if the process stops mid-promotion.
export function createCalendarPollMaterializer(db: Pool) {
  return async function materialize(ctx: AuthorizationContext, sourceId: string, parserRevision: number): Promise<Result> {
    const result: Result = { scheduled: 0, alreadyLinked: 0, canceled: 0, needsReview: 0, failed: 0 };
    const source = await db.query(`SELECT active FROM radio_calendar_source WHERE radio_key=$1 AND id=$2`, [RADIO, sourceId]);
    if (!source.rows[0]?.active) return result;

    await db.query(`UPDATE radio_calendar_poll_link l SET parser_revision=$3
      FROM radio_calendar_event_stage st
      WHERE (l.radio_key,l.source_id,l.event_id)=(st.radio_key,st.source_id,st.event_id)
        AND l.radio_key=$1 AND l.source_id=$2 AND st.content_hash=l.content_hash
        AND l.external_state='active' AND l.parser_revision<$3`, [RADIO, sourceId, parserRevision]);

    const stages = await db.query(`SELECT st.event_id,st.state,st.content_hash,st.payload,
        l.poll_id,l.content_hash AS linked_hash,l.external_state,l.parser_revision AS linked_parser_revision,
        p.state AS poll_state,p.version AS poll_version,p.program_id AS linked_program_id,p.slug AS linked_slug,
        (p.starts_at>clock_timestamp()) AS linked_future,(p.updated_at<=l.linked_at) AS linked_unchanged,
        (e.starts_at=(st.payload#>>'{poll,editionStartsAt}')::timestamptz
          AND e.ends_at=(st.payload#>>'{poll,editionEndsAt}')::timestamptz) AS same_edition,
        (NOT EXISTS(SELECT 1 FROM radio_poll_submission sub WHERE sub.poll_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM radio_poll_vote v WHERE v.poll_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM radio_program_participation part WHERE part.poll_id=p.id)) AS no_responses
      FROM radio_calendar_event_stage st
      LEFT JOIN radio_calendar_poll_link l ON (l.radio_key,l.source_id,l.event_id)=(st.radio_key,st.source_id,st.event_id)
      LEFT JOIN radio_poll p ON (p.radio_key,p.program_id,p.id)=(l.radio_key,l.program_id,l.poll_id)
      LEFT JOIN radio_program_edition e ON (e.radio_key,e.program_id,e.id)=(p.radio_key,p.program_id,p.edition_id)
      WHERE st.radio_key=$1 AND st.source_id=$2
        AND (st.state IN ('canceled','invalid') OR (st.state='review' AND
          (l.poll_id IS NULL OR st.content_hash IS DISTINCT FROM l.content_hash OR l.external_state<>'active')))
        AND (st.state<>'review' OR (st.payload#>>'{poll,endsAt}')::timestamptz>clock_timestamp())
      ORDER BY CASE WHEN st.state='canceled' THEN 0 WHEN st.state='review' THEN 1 ELSE 2 END,
        (st.payload#>>'{poll,startsAt}')::timestamptz ASC NULLS LAST,st.updated_at ASC,st.id ASC LIMIT 500`, [RADIO, sourceId]);

    const linked = await db.query(`SELECT count(*)::int AS count
      FROM radio_calendar_event_stage st
      JOIN radio_calendar_poll_link l ON (l.radio_key,l.source_id,l.event_id)=(st.radio_key,st.source_id,st.event_id)
      WHERE st.radio_key=$1 AND st.source_id=$2 AND st.state='review'
        AND st.content_hash=l.content_hash AND l.external_state='active'`, [RADIO, sourceId]);
    result.alreadyLinked = Number(linked.rows[0]?.count ?? 0);

    for (const stage of stages.rows) {
      try {
        if (stage.state === 'canceled') {
          if (!stage.poll_id) continue;
          if (['scheduled', 'published'].includes(stage.poll_state)) {
            await commandPoll(ctx, stage.poll_id, 'cancel', stage.poll_version);
          }
          await db.query(`UPDATE radio_calendar_poll_link SET external_state='canceled',updated_at=clock_timestamp()
            WHERE radio_key=$1 AND source_id=$2 AND event_id=$3`, [RADIO, sourceId, stage.event_id]);
          result.canceled++;
          continue;
        }

        if (stage.state === 'invalid') {
          if (stage.poll_id) await db.query(`UPDATE radio_calendar_poll_link SET external_state='review',updated_at=clock_timestamp()
            WHERE radio_key=$1 AND source_id=$2 AND event_id=$3`, [RADIO, sourceId, stage.event_id]);
          result.needsReview++;
          continue;
        }

        if (stage.poll_id) {
          const parsed = payloadSchema.safeParse(stage.payload);
          const canRefreshScheduled = parsed.success
            && Number(stage.linked_parser_revision ?? 0) < parserRevision
            && stage.external_state === 'active'
            && stage.poll_state === 'scheduled'
            && stage.linked_future === true
            && stage.linked_unchanged === true
            && stage.same_edition === true
            && stage.no_responses === true
            && parsed.data.programId === stage.linked_program_id;
          if (canRefreshScheduled && parsed.success) {
            const refreshed = await savePoll(ctx, parsed.data.programId, {
              ...parsed.data.poll,
              slug: stage.linked_slug,
              version: Number(stage.poll_version),
            }, stage.poll_id);
            await db.query(`UPDATE radio_calendar_poll_link SET content_hash=$4,parser_revision=$5,
              linked_at=clock_timestamp(),updated_at=clock_timestamp()
              WHERE radio_key=$1 AND source_id=$2 AND event_id=$3 AND external_state='active'`,
            [RADIO, sourceId, stage.event_id, stage.content_hash, parserRevision]);
            result.scheduled++;
            continue;
          }
          await db.query(`UPDATE radio_calendar_poll_link SET external_state='review',updated_at=clock_timestamp()
            WHERE radio_key=$1 AND source_id=$2 AND event_id=$3`, [RADIO, sourceId, stage.event_id]);
          result.needsReview++;
          continue;
        }

        const parsed = payloadSchema.safeParse(stage.payload);
        if (!parsed.success) {
          result.needsReview++;
          continue;
        }
        const { programId } = parsed.data;
        const poll = parsed.data.poll;
        // The calendar may contain non-poll reminders; only a complete question can be published.
        if (!/[?？]\s*$/.test(poll.question)) {
          result.needsReview++;
          continue;
        }
        const allowed = await db.query(`SELECT 1 FROM radio_calendar_source_program sp
          JOIN radio_program p ON (p.radio_key,p.id)=(sp.radio_key,sp.program_id)
          WHERE sp.radio_key=$1 AND sp.source_id=$2 AND sp.program_id=$3 AND sp.active AND p.active`, [RADIO, sourceId, programId]);
        if (!allowed.rowCount) {
          result.needsReview++;
          continue;
        }

        const slug = externalSlug(poll.slug, sourceId, stage.event_id);
        const existing = await db.query(`SELECT id,state,version,question,context,mode,identification_policy,
            starts_at,ends_at,edition_id,program_id
          FROM radio_poll WHERE radio_key=$1 AND program_id=$2 AND slug=$3`, [RADIO, programId, slug]);
        let saved: Record<string, any>;
        if (existing.rows[0]) {
          const row = existing.rows[0];
          const matches = row.question === poll.question && row.context === poll.context && row.mode === poll.mode
            && row.identification_policy === poll.identificationPolicy && sameInstant(row.starts_at, poll.startsAt)
            && sameInstant(row.ends_at, poll.endsAt);
          if (!matches || !['draft', 'scheduled', 'published'].includes(row.state)) {
            result.needsReview++;
            continue;
          }
          const options = await db.query(`SELECT text FROM radio_poll_option WHERE radio_key=$1 AND program_id=$2 AND poll_id=$3 AND active ORDER BY position`, [RADIO, programId, row.id]);
          if (options.rows.map((option: { text: string }) => option.text).join('\0') !== poll.options.join('\0')) {
            result.needsReview++;
            continue;
          }
          saved = row;
        } else {
          const occupied = await db.query(`SELECT p.id FROM radio_poll p
            JOIN radio_program_edition e ON (e.radio_key,e.program_id,e.id)=(p.radio_key,p.program_id,p.edition_id)
            WHERE p.radio_key=$1 AND p.program_id=$2 AND p.state IN ('scheduled','published')
              AND e.starts_at=$3 AND e.ends_at=$4 LIMIT 1`, [RADIO, programId, poll.editionStartsAt, poll.editionEndsAt]);
          if (occupied.rowCount) {
            result.needsReview++;
            continue;
          }
          saved = await savePoll(ctx, programId, { ...poll, slug });
        }

        if (saved.state === 'draft') saved = await commandPoll(ctx, saved.id, 'publish', saved.version);
        await db.query(`INSERT INTO radio_calendar_poll_link
          (radio_key,source_id,event_id,program_id,poll_id,content_hash,external_state,linked_by,parser_revision)
          VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8)
          ON CONFLICT(radio_key,source_id,event_id) DO NOTHING`,
        [RADIO, sourceId, stage.event_id, programId, saved.id, stage.content_hash, ctx.adminUserId, parserRevision]);
        result.scheduled++;
      } catch (error) {
        result.failed++;
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'PROMOTION_FAILED';
        console.warn('Calendar poll promotion deferred.', { sourceId, code });
      }
    }
    return result;
  };
}
