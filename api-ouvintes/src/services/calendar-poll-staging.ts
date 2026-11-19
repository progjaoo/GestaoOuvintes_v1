import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import type { AuthorizationContext } from './authorization-service.js';
import { pollInput } from '../schemas/poll.js';
import { decodePollCalendarCursor, encodePollCalendarCursor, type PollCalendarQuery } from '../schemas/poll-calendar.js';
import type { CalendarPollPreview } from './calendar-poll-parser.js';

const RADIO = 'radio-88';
const denied = () => new AppError(403, 'CALENDAR_ACCESS_DENIED', 'Acesso a integracao indisponivel.');
const conflict = () => new AppError(409, 'CALENDAR_LEASE_LOST', 'Sincronizacao expirada ou substituida.');
const uuid = z.uuid();
const text = z.string().trim().min(1).max(1024);
const pendingIssue = z.enum(['INVALID_SOURCE','INVALID_EVENT','UNSUPPORTED_EVENT','UNSAFE_DESCRIPTION','INVALID_CONFIG','PROGRAM_UNAVAILABLE','EDITION_UNAVAILABLE','INVALID_WINDOW','INVALID_POLL']);

// Private staging only. No route/Google client/publication. All reads and writes revalidate live RBAC.
export function createCalendarPollStaging(db: Pool) {
  async function tx<T>(ctx: AuthorizationContext, key: string, operation: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const valid = await c.query(`SELECT u.id FROM admin_user u JOIN admin_session s ON s.admin_user_id=u.id
        WHERE u.id=$1 AND s.id=$2 AND u.active AND u.authz_version=$3 AND s.authz_version=u.authz_version
        AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() FOR SHARE OF u,s`, [ctx.adminUserId,ctx.sessionId,ctx.authzVersion]);
      if (!valid.rowCount) throw denied();
      const grant = await c.query(`SELECT 1 WHERE NOT EXISTS (
        SELECT 1 FROM admin_permission_override o JOIN permission p ON p.id=o.permission_id
        WHERE o.admin_user_id=$1 AND p.key=$2 AND o.effect='DENY') AND EXISTS (
        SELECT 1 FROM admin_user_role ur JOIN role_permission rp ON rp.role_id=ur.role_id
        JOIN role_permission_scope rs ON (rs.role_id,rs.permission_id)=(rp.role_id,rp.permission_id)
        JOIN permission p ON p.id=rp.permission_id WHERE ur.admin_user_id=$1 AND p.key=$2 AND rs.scope_type='global'
        UNION ALL SELECT 1 FROM admin_permission_override o JOIN permission p ON p.id=o.permission_id
        WHERE o.admin_user_id=$1 AND p.key=$2 AND o.effect='ALLOW' AND o.scope_type='global')`, [ctx.adminUserId,key]);
      if (!grant.rowCount) throw denied();
      const result = await operation(c); await c.query('COMMIT'); return result;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async function audit(c: PoolClient, ctx: AuthorizationContext, action: string, id: string) {
    await c.query(`INSERT INTO admin_audit_log(admin_user_id,action,resource_type,resource_id,metadata)
      VALUES($1,$2,'radio_calendar_source',$3,$4::jsonb)`, [ctx.adminUserId,action,id,JSON.stringify({radioKey:RADIO})]);
  }
  async function leased(c: PoolClient, ctx: AuthorizationContext, sourceId: string, token: string) {
    uuid.parse(sourceId); uuid.parse(token);
    const r = await c.query(`SELECT * FROM radio_calendar_source s WHERE radio_key=$1 AND id=$2
      AND active AND lease_token=$3 AND lease_until>clock_timestamp() AND EXISTS (
        SELECT 1 FROM radio_calendar_sync_run r WHERE r.radio_key=s.radio_key AND r.source_id=s.id
        AND r.lease_token=$3 AND r.actor_id=$4 AND r.state='running') FOR UPDATE`, [RADIO,sourceId,token,ctx.adminUserId]);
    if (!r.rowCount) throw conflict();
    return r.rows[0]!;
  }
  return {
    availablePrograms(ctx: AuthorizationContext) {
      return tx(ctx,'calendar_integration.manage',async c => (await c.query(
        'SELECT id,name FROM radio_program WHERE radio_key=$1 AND active ORDER BY name',[RADIO])).rows);
    },
    listSources(ctx: AuthorizationContext) {
      return tx(ctx,'calendar_integration.read',async c => (await c.query(`SELECT s.id,s.calendar_id AS "calendarId",s.program_id AS "programId",
        p.name AS "programName",s.active,s.version,s.sync_token IS NOT NULL AS "incrementalReady",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',sp.program_id,'name',allowed.name) ORDER BY allowed.name)
          FROM radio_calendar_source_program sp JOIN radio_program allowed ON (allowed.radio_key,allowed.id)=(sp.radio_key,sp.program_id)
          WHERE sp.radio_key=s.radio_key AND sp.source_id=s.id AND sp.active),'[]'::jsonb) AS "allowedPrograms",
        (SELECT max(r.finished_at) FROM radio_calendar_sync_run r WHERE r.radio_key=s.radio_key AND r.source_id=s.id AND r.state='completed') AS "lastSyncAt"
        FROM radio_calendar_source s JOIN radio_program p ON (p.radio_key,p.id)=(s.radio_key,s.program_id)
        WHERE s.radio_key=$1 ORDER BY s.created_at DESC`,[RADIO])).rows);
    },
    createSource(ctx: AuthorizationContext, input: {calendarId: string; programId: string}) {
      const calendarId = text.parse(input.calendarId), programId = uuid.parse(input.programId);
      return tx(ctx, 'calendar_integration.manage', async c => {
        const p = await c.query('SELECT id FROM radio_program WHERE radio_key=$1 AND id=$2 AND active FOR SHARE', [RADIO,programId]);
        if (!p.rowCount) throw new AppError(404,'CALENDAR_PROGRAM_UNAVAILABLE','Programa indisponivel.');
        const r = await c.query(`INSERT INTO radio_calendar_source(radio_key,calendar_id,program_id)
          VALUES($1,$2,$3) RETURNING id,version,active`, [RADIO,calendarId,programId]).catch(error => {
            if ((error as {code?:string}).code === '23505') throw new AppError(409,'CALENDAR_SOURCE_EXISTS','Esta agenda ja tem uma fonte configurada.');
            throw error;
          });
        await c.query(`INSERT INTO radio_calendar_source_program(radio_key,source_id,program_id) VALUES($1,$2,$3)`,[RADIO,r.rows[0].id,programId]);
        await audit(c,ctx,'calendar.source.create',r.rows[0].id); return r.rows[0] as {id:string;version:number;active:boolean};
      });
    },
    configurePrograms(ctx: AuthorizationContext, id: string, version: number, defaultProgramId: string, inputProgramIds: string[]) {
      uuid.parse(id); z.number().int().positive().parse(version);
      const defaultId=uuid.parse(defaultProgramId);
      const programIds=z.array(z.uuid()).min(1).max(100).refine(ids=>new Set(ids).size===ids.length).parse(inputProgramIds);
      if (!programIds.includes(defaultId)) throw new AppError(422,'CALENDAR_DEFAULT_PROGRAM_REQUIRED','O programa padrao precisa estar entre os programas permitidos.');
      return tx(ctx,'calendar_integration.manage',async c=>{
        const activePrograms=await c.query('SELECT id FROM radio_program WHERE radio_key=$1 AND active AND id=ANY($2::uuid[]) FOR SHARE',[RADIO,programIds]);
        if(activePrograms.rowCount!==programIds.length)throw new AppError(404,'CALENDAR_PROGRAM_UNAVAILABLE','Um ou mais programas estao indisponiveis.');
        const updated=await c.query(`UPDATE radio_calendar_source SET program_id=$4,version=version+1
          WHERE radio_key=$1 AND id=$2 AND version=$3 AND NOT active AND lease_token IS NULL
          RETURNING id,version,active,program_id AS "defaultProgramId"`,[RADIO,id,version,defaultId]);
        if(!updated.rowCount)throw new AppError(409,'CALENDAR_SOURCE_VERSION_CONFLICT','Desative a fonte e atualize a tela antes de alterar os programas.');
        await c.query(`UPDATE radio_calendar_source_program SET active=false WHERE radio_key=$1 AND source_id=$2`,[RADIO,id]);
        for(const programId of programIds)await c.query(`INSERT INTO radio_calendar_source_program(radio_key,source_id,program_id,active)
          VALUES($1,$2,$3,true) ON CONFLICT(radio_key,source_id,program_id) DO UPDATE SET active=true`,[RADIO,id,programId]);
        await audit(c,ctx,'calendar.source.programs.configure',id);
        return updated.rows[0] as {id:string;version:number;active:boolean;defaultProgramId:string};
      });
    },
    setActive(ctx: AuthorizationContext, id: string, version: number, active: boolean) {
      uuid.parse(id); z.number().int().positive().parse(version); z.boolean().parse(active);
      return tx(ctx, 'calendar_integration.manage', async c => {
        const r = await c.query(`UPDATE radio_calendar_source SET active=$4,version=version+1,lease_token=NULL,lease_until=NULL
          WHERE radio_key=$1 AND id=$2 AND version=$3 RETURNING id,version,active`,[RADIO,id,version,active]);
        if (!r.rowCount) throw new AppError(409,'CALENDAR_VERSION_CONFLICT','Fonte alterada. Atualize a tela.');
        await c.query(`UPDATE radio_calendar_sync_run SET state='superseded',finished_at=clock_timestamp()
          WHERE radio_key=$1 AND source_id=$2 AND state='running'`,[RADIO,id]);
        await audit(c,ctx,'calendar.source.configure',id); return r.rows[0] as {id:string;version:number;active:boolean};
      });
    },
    claim(ctx: AuthorizationContext, id: string) {
      uuid.parse(id);
      return tx(ctx,'calendar_integration.sync',async c => {
        const token = randomUUID();
        const r = await c.query(`UPDATE radio_calendar_source SET lease_token=$3,lease_until=clock_timestamp()+interval '60 seconds'
          WHERE radio_key=$1 AND id=$2 AND active AND (lease_until IS NULL OR lease_until<=clock_timestamp())
          RETURNING id,calendar_id,program_id,sync_token,parser_revision AS "parserRevision"`,[RADIO,id,token]);
        if (!r.rowCount) throw conflict();
        await c.query(`UPDATE radio_calendar_sync_run SET state='superseded',finished_at=clock_timestamp()
          WHERE radio_key=$1 AND source_id=$2 AND state='running'`,[RADIO,id]);
        await c.query(`INSERT INTO radio_calendar_sync_run(radio_key,source_id,lease_token,actor_id) VALUES($1,$2,$3,$4)`,[RADIO,id,token,ctx.adminUserId]);
        const allowed=await c.query(`SELECT program_id FROM radio_calendar_source_program WHERE radio_key=$1 AND source_id=$2 AND active ORDER BY program_id`,[RADIO,id]);
        if(!allowed.rowCount)throw new AppError(409,'CALENDAR_PROGRAM_MAPPING_MISSING','Configure ao menos um programa permitido para esta fonte.');
        return {token,calendarId:r.rows[0].calendar_id as string,programId:r.rows[0].program_id as string,
          allowedProgramIds:allowed.rows.map(row=>row.program_id as string),syncToken:r.rows[0].sync_token as string|null,
          parserRevision:Number(r.rows[0].parserRevision)};
      });
    },
    renew(ctx: AuthorizationContext, sourceId: string, token: string) {
      return tx(ctx,'calendar_integration.sync',async c => {
        await leased(c,ctx,sourceId,token);
        await c.query(`UPDATE radio_calendar_source SET lease_until=clock_timestamp()+interval '60 seconds'
          WHERE radio_key=$1 AND id=$2 AND lease_token=$3`,[RADIO,sourceId,token]);
      });
    },
    stage(ctx: AuthorizationContext, sourceId: string, token: string, eventId: string, preview: CalendarPollPreview) {
      text.parse(eventId);
      return tx(ctx,'calendar_integration.sync',async c => {
        const source = await leased(c,ctx,sourceId,token);
        let state: 'review'|'canceled'|'invalid' = 'invalid', payload: unknown = null, reason: string|null = null;
        if (preview.kind === 'preview' || preview.kind === 'canceled') {
          if (preview.external.calendarId !== source.calendar_id || preview.external.eventId !== eventId) throw new AppError(422,'CALENDAR_ORIGIN_MISMATCH','Origem do evento invalida.');
          if (preview.kind === 'preview') {
            const allowed=await c.query(`SELECT 1 FROM radio_calendar_source_program WHERE radio_key=$1 AND source_id=$2 AND program_id=$3 AND active`,[RADIO,sourceId,preview.programId]);
            if (!allowed.rowCount || preview.requiresReview !== true) throw new AppError(422,'CALENDAR_PROGRAM_MISMATCH','Programa fora do escopo da fonte.');
            payload = { programId: preview.programId, poll: pollInput.parse(preview.poll) }; state = 'review';
          } else { state = 'canceled'; }
        } else if (preview.kind === 'pending') {
          reason = z.array(pendingIssue).min(1).max(10).parse(preview.issues)[0]!;
        } else { throw new AppError(422,'CALENDAR_INVALID_PREVIEW','Previa invalida.'); }
        const event = preview.calendarEvent;
        const hash = createHash('sha256').update(JSON.stringify({state,payload,reason,event})).digest('hex');
        const previous = await c.query(`SELECT id,content_hash FROM radio_calendar_event_stage
          WHERE radio_key=$1 AND source_id=$2 AND event_id=$3 FOR UPDATE`,[RADIO,sourceId,eventId]);
        if (previous.rows[0]?.content_hash === hash) return {id:previous.rows[0].id as string,changed:false};
        const r = await c.query(`INSERT INTO radio_calendar_event_stage(
            radio_key,source_id,event_id,state,content_hash,payload,reason,event_summary,event_program_id,
            event_start_date,event_end_date,event_starts_at,event_ends_at,event_all_day
          ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::date,$11::date,$12::timestamptz,$13::timestamptz,$14)
          ON CONFLICT(radio_key,source_id,event_id) DO UPDATE
          SET state=EXCLUDED.state,content_hash=EXCLUDED.content_hash,payload=EXCLUDED.payload,reason=EXCLUDED.reason,
          event_summary=EXCLUDED.event_summary,event_program_id=EXCLUDED.event_program_id,
          event_start_date=EXCLUDED.event_start_date,event_end_date=EXCLUDED.event_end_date,
          event_starts_at=EXCLUDED.event_starts_at,event_ends_at=EXCLUDED.event_ends_at,event_all_day=EXCLUDED.event_all_day,
          version=radio_calendar_event_stage.version+1,updated_at=clock_timestamp() RETURNING id`,[
            RADIO,sourceId,eventId,state,hash,JSON.stringify(payload),reason,event.title,event.programId,
            event.startDate,event.endDate,event.startsAt,event.endsAt,event.allDay,
          ]);
        await audit(c,ctx,'calendar.event.stage',sourceId); return {id:r.rows[0].id as string,changed:true};
      });
    },
    // Call only after every page has been staged durably. Failed/incomplete runs retain the old cursor.
    finish(ctx: AuthorizationContext, sourceId: string, token: string, nextSyncToken: string, parserRevision = 0) {
      z.string().min(1).max(16000).parse(nextSyncToken);
      z.number().int().min(0).parse(parserRevision);
      return tx(ctx,'calendar_integration.sync',async c => {
        await leased(c,ctx,sourceId,token);
        await c.query(`UPDATE radio_calendar_sync_run SET state='completed',finished_at=clock_timestamp()
          WHERE radio_key=$1 AND source_id=$2 AND lease_token=$3 AND state='running'`,[RADIO,sourceId,token]);
        await c.query(`UPDATE radio_calendar_source SET sync_token=$4,parser_revision=$5,lease_token=NULL,lease_until=NULL
          WHERE radio_key=$1 AND id=$2 AND lease_token=$3`,[RADIO,sourceId,token,nextSyncToken,parserRevision]);
        await audit(c,ctx,'calendar.sync.complete',sourceId);
      });
    },
    restartFullSync(ctx: AuthorizationContext, sourceId: string, token: string) {
      return tx(ctx,'calendar_integration.sync',async c => {
        await leased(c,ctx,sourceId,token);
        await c.query(`UPDATE radio_calendar_sync_run SET state='completed',finished_at=clock_timestamp()
          WHERE radio_key=$1 AND source_id=$2 AND lease_token=$3 AND state='running'`,[RADIO,sourceId,token]);
        await c.query(`UPDATE radio_calendar_source SET sync_token=NULL,lease_token=NULL,lease_until=NULL
          WHERE radio_key=$1 AND id=$2 AND lease_token=$3`,[RADIO,sourceId,token]);
        await audit(c,ctx,'calendar.sync.cursor_reset',sourceId);
      });
    },
    abort(ctx: AuthorizationContext, sourceId: string, token: string) {
      uuid.parse(sourceId); uuid.parse(token);
      return tx(ctx,'calendar_integration.sync',async c => {
        await c.query(`UPDATE radio_calendar_sync_run SET state='superseded',finished_at=clock_timestamp()
          WHERE radio_key=$1 AND source_id=$2 AND lease_token=$3 AND actor_id=$4 AND state='running'`,[RADIO,sourceId,token,ctx.adminUserId]);
        await c.query(`UPDATE radio_calendar_source SET lease_token=NULL,lease_until=NULL
          WHERE radio_key=$1 AND id=$2 AND lease_token=$3`,[RADIO,sourceId,token]);
        await audit(c,ctx,'calendar.sync.interrupted',sourceId);
      });
    },
    list(ctx: AuthorizationContext, sourceId: string, after?: string, limit = 50) {
      uuid.parse(sourceId);
      if (after) uuid.parse(after);
      z.number().int().min(1).max(100).parse(limit);
      return tx(ctx,'calendar_integration.read',async c => {
        const source = await c.query('SELECT id FROM radio_calendar_source WHERE radio_key=$1 AND id=$2',[RADIO,sourceId]);
        if (!source.rowCount) throw new AppError(404,'CALENDAR_SOURCE_UNAVAILABLE','Fonte indisponivel.');
        const rows = (await c.query(`SELECT st.id,st.event_id AS "eventId",st.state,st.payload,st.reason,st.version,
            st.updated_at AS "updatedAt",l.poll_id AS "linkedPollId",l.external_state AS "externalState",p.state AS "linkedPollState"
          FROM radio_calendar_event_stage st
          LEFT JOIN radio_calendar_poll_link l ON (l.radio_key,l.source_id,l.event_id)=(st.radio_key,st.source_id,st.event_id)
          LEFT JOIN radio_poll p ON (p.radio_key,p.program_id,p.id)=(l.radio_key,l.program_id,l.poll_id)
          WHERE st.radio_key=$1 AND st.source_id=$2 AND ($3::uuid IS NULL OR st.id>$3::uuid)
          ORDER BY st.id LIMIT $4`,[RADIO,sourceId,after ?? null,limit+1])).rows;
        const hasMore=rows.length>limit,items=hasMore?rows.slice(0,limit):rows;
        return {items,nextCursor:hasMore?(items.at(-1)?.id as string):null};
      });
    },
    calendar(ctx: AuthorizationContext, allowedCalendarId: string, filter: PollCalendarQuery) {
      let cursor;
      try { cursor = decodePollCalendarCursor(filter.after); }
      catch { throw new AppError(400,'CALENDAR_CURSOR_INVALID','Cursor de calendario invalido.'); }
      return tx(ctx,'calendar_integration.read',async c => {
        const sourceStatus = await c.query(`SELECT count(*)::int AS configured,
            (SELECT max(r.finished_at) FROM radio_calendar_sync_run r JOIN radio_calendar_source ss
              ON (ss.radio_key,ss.id)=(r.radio_key,r.source_id)
              WHERE ss.radio_key=$1 AND ss.calendar_id=$2 AND r.state='completed') AS "lastSyncedAt",
            EXISTS(SELECT 1 FROM radio_calendar_oauth_connection o WHERE o.radio_key=$1) AS connected
          FROM radio_calendar_source s WHERE s.radio_key=$1 AND s.calendar_id=$2`,[RADIO,allowedCalendarId]);
        const stateExpr = `CASE
          WHEN st.state='invalid' THEN 'invalid'
          WHEN st.state='conflict' THEN 'conflict'
          WHEN st.state='canceled' OR l.external_state='canceled' OR p.state='canceled' THEN 'canceled'
          WHEN p.state IS NOT NULL THEN p.state
          WHEN l.external_state='review' OR st.state='review' THEN 'review'
          ELSE 'invalid' END`;
        const startDateExpr = `COALESCE(st.event_start_date,(COALESCE(p.starts_at,st.event_starts_at) AT TIME ZONE 'America/Sao_Paulo')::date)`;
        const rows = await c.query(`WITH base AS (
            SELECT st.id, COALESCE(st.event_summary,p.question,'Evento sem titulo') AS title,
              COALESCE(p.program_id,st.event_program_id) AS "programId", COALESCE(pr.name,staged_program.name) AS "programName",
              to_char(${startDateExpr},'YYYY-MM-DD') AS "startDate",
              to_char(st.event_end_date,'YYYY-MM-DD') AS "endDate",
              COALESCE(p.starts_at,st.event_starts_at) AS "startsAt",
              COALESCE(p.ends_at,st.event_ends_at) AS "endsAt",
              (st.event_all_day AND p.id IS NULL) AS "allDay",
              st.state AS "importState", ${stateExpr} AS state, st.reason,
              p.id AS "linkedPollId", p.state AS "pollState", st.updated_at AS "updatedAt"
            FROM radio_calendar_event_stage st
            JOIN radio_calendar_source s ON (s.radio_key,s.id)=(st.radio_key,st.source_id)
            LEFT JOIN radio_calendar_poll_link l ON (l.radio_key,l.source_id,l.event_id)=(st.radio_key,st.source_id,st.event_id)
            LEFT JOIN radio_poll p ON (p.radio_key,p.program_id,p.id)=(l.radio_key,l.program_id,l.poll_id)
            LEFT JOIN radio_program pr ON (pr.radio_key,pr.id)=(p.radio_key,p.program_id)
            LEFT JOIN radio_program staged_program ON (staged_program.radio_key,staged_program.id)=(st.radio_key,st.event_program_id)
            WHERE st.radio_key=$1 AND s.calendar_id=$2
              AND (($5::uuid IS NULL) OR COALESCE(p.program_id,st.event_program_id)=$5)
              AND (($6::text IS NULL) OR ${stateExpr}=$6)
              AND (($7::text IS NULL) OR COALESCE(st.event_summary,p.question,'') ILIKE '%' || $7 || '%' OR COALESCE(pr.name,staged_program.name,'') ILIKE '%' || $7 || '%')
              AND (
                (st.event_all_day AND st.event_start_date IS NOT NULL
                  AND st.event_start_date < $4::date
                  AND COALESCE(st.event_end_date,st.event_start_date+1) > $3::date)
                OR (NOT st.event_all_day AND COALESCE(p.starts_at,st.event_starts_at) IS NOT NULL
                  AND COALESCE(p.starts_at,st.event_starts_at) < ($4::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
                  AND COALESCE(p.ends_at,st.event_ends_at) > ($3::date::timestamp AT TIME ZONE 'America/Sao_Paulo'))
                OR (st.event_start_date IS NULL AND st.event_starts_at IS NULL AND p.starts_at IS NULL)
              )
          )
          SELECT * FROM base
          WHERE ($8::uuid IS NULL
            OR ($9::date IS NOT NULL AND ("startDate"::date > $9::date OR "startDate" IS NULL OR ("startDate"::date=$9::date AND id>$8::uuid)))
            OR ($9::date IS NULL AND "startDate" IS NULL AND id>$8::uuid))
          ORDER BY "startDate" ASC NULLS LAST,id ASC LIMIT $10`,[
          RADIO,allowedCalendarId,filter.from,filter.to,filter.programId??null,filter.state??null,filter.q||null,
          cursor?.id??null,cursor?.startDate??null,filter.limit+1,
        ]);
        const hasMore=rows.rows.length>filter.limit,items=hasMore?rows.rows.slice(0,filter.limit):rows.rows;
        const last=items.at(-1) as {id:string;startDate:string|null}|undefined;
        return {
          items:items.map(item=>({
            ...item,origin:'google_calendar',state:item.state,importState:item.importState,
            allDay:Boolean(item.allDay),linkedPollId:item.linkedPollId??null,pollState:item.pollState??null,
          })),
          nextCursor:hasMore&&last?encodePollCalendarCursor({id:last.id,startDate:last.startDate}):null,
          from:filter.from,to:filter.to,timezone:'America/Sao_Paulo',readOnly:true,
          configured:Number(sourceStatus.rows[0]?.configured??0)>0,
          connected:Boolean(sourceStatus.rows[0]?.connected),lastSyncedAt:sourceStatus.rows[0]?.lastSyncedAt??null,
        };
      });
    },
  };
}
