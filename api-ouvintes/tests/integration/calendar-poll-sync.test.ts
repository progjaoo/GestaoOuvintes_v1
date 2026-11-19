import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthorizationContext } from '../../src/services/authorization-service.js';
import { createCalendarPollStaging } from '../../src/services/calendar-poll-staging.js';
import { createCalendarPollSync } from '../../src/services/calendar-poll-sync.js';
import { encryptCalendarSecret } from '../../src/services/google-calendar-oauth.js';

const suite = process.env.RUN_CALENDAR_STAGING_TESTS === 'true' ? describe : describe.skip;
const readScope = 'https://www.googleapis.com/auth/calendar.events.readonly';

suite('Google Calendar sync - disposable PostgreSQL only', () => {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const key = Buffer.alloc(32, 19), calendarId = `fixture-${randomUUID()}@group.calendar.google.com`;
  const oauth = { clientId: 'fixture-client-id', clientSecret: 'fixture-client-secret', redirectUri: 'http://localhost:3012/api/admin/calendar-integrations/oauth/callback', encryptionKey: key.toString('base64') };
  async function actor(): Promise<AuthorizationContext> {
    const id = randomUUID(), sessionId = randomUUID();
    await db.query("INSERT INTO admin_user(id,name,username,password_hash,role,active) VALUES($1::uuid,'Sync Fixture',$1::text,'unused','viewer',true)", [id]);
    await db.query("INSERT INTO admin_session(id,admin_user_id,authz_version,expires_at) VALUES($1,$2,1,now()+interval '1 hour')", [sessionId,id]);
    await db.query(`INSERT INTO admin_permission_override(admin_user_id,permission_id,effect,scope_type,reason,created_by_admin_user_id)
      SELECT $1,id,'ALLOW','global','Synthetic automation test grant',$1 FROM permission
      WHERE key = ANY($2::text[])`, [id,['calendar_integration.manage','calendar_integration.read','calendar_integration.sync','poll.manage','poll.publish','poll.close','poll.read']]);
    return { adminUserId:id,sessionId,authzVersion:1,permissions:new Set(),scopes:new Map(),departmentIds:new Set() };
  }
  beforeAll(() => { if (!process.env.DATABASE_URL?.includes('calendar_staging_test')) throw Error('Disposable calendar_staging_test database required'); });
  afterAll(async () => { await db.query('DELETE FROM radio_calendar_oauth_connection WHERE radio_key=$1', ['radio-88']); await db.end(); });

  it('reads paginated events, stages review only, commits the final sync cursor, and recovers 410 without deletion', async () => {
    const ctx = await actor(), programId = randomUUID();
    await db.query("INSERT INTO radio_program(id,radio_key,name,slug) VALUES($1::uuid,'radio-88','Fixture Bom Dia',$2)", [programId,`fixture-${programId}`]);
    await db.query(`INSERT INTO radio_program_slot(radio_key,program_id,weekday,start_minute,end_minute,valid_from)
      VALUES('radio-88',$1,2,570,720,'2026-11-01')`, [programId]);
    const secondProgram=randomUUID();
    await db.query("INSERT INTO radio_program(id,radio_key,name,slug) VALUES($1::uuid,'radio-88','Fixture Evening',$2)",[secondProgram,`fixture-${secondProgram}`]);
    await db.query(`INSERT INTO radio_program_slot(radio_key,program_id,weekday,start_minute,end_minute,valid_from)
      VALUES('radio-88',$1,2,780,900,'2026-11-01')`,[secondProgram]);
    const store = createCalendarPollStaging(db), source = await store.createSource(ctx, { calendarId,programId });
    expect(source.active).toBe(false);
    await store.setActive(ctx,source.id,source.version,true);
    await store.setActive(ctx,source.id,2,false);
    const configured=await store.configurePrograms(ctx,source.id,3,programId,[programId,secondProgram]);
    await store.setActive(ctx,source.id,configured.version,true);
    await db.query(`INSERT INTO radio_calendar_oauth_connection(radio_key,refresh_token_ciphertext,granted_scopes,connected_by)
      VALUES('radio-88',$1,ARRAY[$2]::text[],$3) ON CONFLICT(radio_key) DO UPDATE
      SET refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,granted_scopes=EXCLUDED.granted_scopes,connected_by=EXCLUDED.connected_by`,
    [encryptCalendarSecret('synthetic-refresh-token',key),readScope,ctx.adminUserId]);

    const pages = [
      new Response(JSON.stringify({ items: [
        { id:'poll-event',status:'confirmed',summary:'Pergunta de teste?',description:'Contexto editorial',start:{date:'2030-11-19'},end:{date:'2030-11-20'} },
        { id:'program-override-event',status:'confirmed',summary:'Pergunta do segundo programa?',description:'[CONFIG ENQUETE 88]\nPROGRAMA: Fixture Evening\nTIPO: Somente voto\nALTERNATIVAS:\n- Sim\n- Nao\n[/CONFIG ENQUETE 88]',start:{date:'2030-11-19'},end:{date:'2030-11-20'} },
        { id:'past-event',status:'confirmed',summary:'Enquete anterior',description:'Nao importar',start:{date:'2026-11-15'},end:{date:'2026-11-16'} },
      ],nextPageToken:'page-two' }), { status:200 }),
      new Response(JSON.stringify({ items: [{ id:'incomplete-event',status:'confirmed',summary:'Evento incompleto' }],nextSyncToken:'cursor-committed' }), { status:200 }),
      new Response('', { status:410 }),
    ];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({ access_token:'synthetic-access',token_type:'Bearer',expires_in:3600,scope:readScope }), { status:200 });
      }
      expect(init?.method).toBe('GET');
      expect(new URL(String(input)).pathname).toContain(encodeURIComponent(calendarId));
      return pages.shift()!;
    });
    const sync = createCalendarPollSync(db,oauth,calendarId,fetcher);

    const result = await sync.sync(ctx,source.id);
    expect(result).toMatchObject({ scanned:4,changed:4,pending:2,canceled:0,skippedPast:0,parserRevisionRescan:true,
      publication:{scheduled:2,alreadyLinked:0,canceled:0,needsReview:2,failed:0},reviewRequired:true,readOnly:true });
    const staged = await store.list(ctx,source.id);
    expect(staged.items).toHaveLength(4);
    expect(staged.items.find(item=>item.eventId==='past-event')?.state).toBe('invalid');
    expect(staged.items.find(item=>item.eventId==='past-event')?.payload).toBeNull();
    expect(staged.items.find(item=>item.eventId==='poll-event')?.payload).toMatchObject({ programId,poll:{ question:'Pergunta de teste?',mode:'mixed',options:['Sim','Não'] } });
    expect(staged.items.find(item=>item.eventId==='program-override-event')?.payload).toMatchObject({ programId:secondProgram,poll:{ question:'Pergunta do segundo programa?',mode:'vote',options:['Sim','Nao'] } });
    expect((await db.query('SELECT sync_token,parser_revision FROM radio_calendar_source WHERE id=$1',[source.id])).rows[0]).toEqual({sync_token:'cursor-committed',parser_revision:4});
    expect((await db.query('SELECT event_summary,event_start_date,event_end_date,event_all_day FROM radio_calendar_event_stage WHERE source_id=$1 AND event_id=$2',[source.id,'incomplete-event'])).rows[0]).toMatchObject({event_summary:'Evento incompleto',event_start_date:null,event_end_date:null,event_all_day:false});
    const links=await db.query('SELECT event_id,poll_id FROM radio_calendar_poll_link WHERE source_id=$1',[source.id]);
    expect(links.rowCount).toBe(2);
    expect((await db.query("SELECT count(*) FROM radio_poll WHERE state='scheduled' AND program_id=ANY($1::uuid[])",[[programId,secondProgram]])).rows[0].count).toBe('2');
    expect(staged.items.find(item=>item.eventId==='poll-event')).toMatchObject({linkedPollState:'scheduled'});

    const expired = await sync.sync(ctx,source.id);
    expect(expired).toMatchObject({ scanned:0,fullSyncRequired:true,readOnly:true });
    expect((await db.query('SELECT sync_token FROM radio_calendar_source WHERE id=$1',[source.id])).rows[0].sync_token).toBeNull();
    expect((await store.list(ctx,source.id)).items).toHaveLength(4);
    expect(fetcher.mock.calls.slice(1).map(([,init])=>init?.method)).toEqual(['GET','GET','GET']);

    pages.push(new Response(JSON.stringify({items:[],nextSyncToken:'cursor-after-reset'}),{status:200}));
    const repeated=await sync.sync(ctx,source.id);
    expect(repeated).toMatchObject({parserRevisionRescan:false,publication:{scheduled:0,alreadyLinked:2,failed:0}});
    expect((await db.query('SELECT count(*) FROM radio_calendar_poll_link WHERE source_id=$1',[source.id])).rows[0].count).toBe('2');

    const foreign = await store.createSource(ctx,{calendarId:`other-${randomUUID()}@group.calendar.google.com`,programId});
    await store.setActive(ctx,foreign.id,foreign.version,true);
    expect((await sync.listSources(ctx)).map(row=>row.calendarId)).toEqual([calendarId]);
    await expect(sync.stagedEvents(ctx,foreign.id)).rejects.toMatchObject({code:'CALENDAR_SOURCE_UNAVAILABLE'});
    const requestsBeforeForeignSync=fetcher.mock.calls.length;
    await expect(sync.sync(ctx,foreign.id)).rejects.toMatchObject({code:'CALENDAR_ID_NOT_ALLOWED'});
    expect(fetcher).toHaveBeenCalledTimes(requestsBeforeForeignSync);
  });
});
