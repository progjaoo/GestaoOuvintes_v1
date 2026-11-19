import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationContext } from '../../src/services/authorization-service.js';
import { createCalendarPollStaging } from '../../src/services/calendar-poll-staging.js';
import type { CalendarPollPreview } from '../../src/services/calendar-poll-parser.js';
import { pollCalendarQuery } from '../../src/schemas/poll-calendar.js';

const suite = process.env.RUN_CALENDAR_STAGING_TESTS === 'true' ? describe : describe.skip;
suite('calendar staging - disposable PostgreSQL only', () => {
  const db = new Pool({connectionString:process.env.DATABASE_URL});
  const store = createCalendarPollStaging(db);
  let ctx: AuthorizationContext, sourceId: string, programId: string;
  async function actor(grant = true): Promise<AuthorizationContext> {
    const id = randomUUID(), sid = randomUUID();
    await db.query("INSERT INTO admin_user(id,name,username,password_hash,role,active) VALUES($1::uuid,'Fixture',$1::text,'unused','viewer',true)",[id]);
    await db.query("INSERT INTO admin_session(id,admin_user_id,authz_version,expires_at) VALUES($1,$2,1,now()+interval '1 hour')",[sid,id]);
    if (grant) await db.query(`INSERT INTO admin_permission_override(admin_user_id,permission_id,effect,scope_type,reason,created_by_admin_user_id)
      SELECT $1,id,'ALLOW','global','Synthetic test grant',$1 FROM permission WHERE key LIKE 'calendar_integration.%'`,[id]);
    return {adminUserId:id,sessionId:sid,authzVersion:1,permissions:new Set(),scopes:new Map(),departmentIds:new Set()};
  }
  async function staged() { return (await store.list(ctx,sourceId)).items; }
  function preview(question = 'Synthetic question?', eventId = 'event-17'): CalendarPollPreview {
    return {kind:'preview',requiresReview:true,programId,external:{calendarId:'fixture-'+programId,eventId},calendarEvent:{title:question,programId,startDate:'2026-11-17',endDate:'2026-11-18',startsAt:null,endsAt:null,allDay:true},poll:{slug:'synthetic-question',question,context:'Private context',mode:'message',identificationPolicy:'optional',allowMessage:true,options:[],editionStartsAt:'2026-11-17T12:30:00Z',editionEndsAt:'2026-11-17T15:00:00Z',startsAt:'2026-11-17T12:30:00Z',endsAt:'2026-11-17T15:00:00Z'}};
  }
  beforeAll(() => { if(!process.env.DATABASE_URL?.includes('calendar_staging_test')) throw Error('Disposable calendar_staging_test database required'); });
  beforeEach(async () => {
    ctx=await actor(); programId=randomUUID();
    await db.query("INSERT INTO radio_program(id,radio_key,name,slug) VALUES($1::uuid,'radio-88','Fixture program',$1::text)",[programId]);
    const source=await store.createSource(ctx,{calendarId:'fixture-'+programId,programId}); sourceId=source.id;
    expect(source.active).toBe(false);
    await store.setActive(ctx,sourceId,source.version,true);
  });
  afterAll(async()=>db.end());
  it('requires live permission even if the caller context claims access',async()=>{
    const no=await actor(false); no.permissions.add('calendar_integration.sync');
    await expect(store.claim(no,sourceId)).rejects.toMatchObject({code:'CALENDAR_ACCESS_DENIED'});
  });
  it('rejects inactive/revoked/stale sessions immediately',async()=>{
    await db.query('UPDATE admin_session SET revoked_at=now(),revoke_reason=$2 WHERE id=$1',[ctx.sessionId,'test']);
    await expect(store.claim(ctx,sourceId)).rejects.toMatchObject({code:'CALENDAR_ACCESS_DENIED'});
  });
  it('honors DENY and rejects participation-only grants',async()=>{
    await db.query("UPDATE admin_permission_override SET effect='DENY',scope_type=NULL WHERE admin_user_id=$1 AND permission_id=(SELECT id FROM permission WHERE key='calendar_integration.sync')",[ctx.adminUserId]);
    await expect(store.claim(ctx,sourceId)).rejects.toMatchObject({code:'CALENDAR_ACCESS_DENIED'});
    await db.query("UPDATE admin_permission_override SET effect='ALLOW',scope_type='participation' WHERE admin_user_id=$1 AND permission_id=(SELECT id FROM permission WHERE key='calendar_integration.sync')",[ctx.adminUserId]);
    await expect(store.claim(ctx,sourceId)).rejects.toMatchObject({code:'CALENDAR_ACCESS_DENIED'});
  });
  it('serializes concurrent claims and recovers an expired lease',async()=>{
    const claims=await Promise.allSettled([store.claim(ctx,sourceId),store.claim(ctx,sourceId)]);
    expect(claims.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const old=(claims.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof store.claim>>>).value;
    await db.query("UPDATE radio_calendar_source SET lease_until=now()-interval '1 second' WHERE id=$1",[sourceId]);
    const next=await store.claim(ctx,sourceId); expect(next.token).not.toBe(old.token);
    await expect(store.stage(ctx,sourceId,old.token,'event-17',preview())).rejects.toMatchObject({code:'CALENDAR_LEASE_LOST'});
    await expect(store.finish(ctx,sourceId,old.token,'stale')).rejects.toMatchObject({code:'CALENDAR_LEASE_LOST'});
  });
  it('binds the lease to its actor',async()=>{
    const lease=await store.claim(ctx,sourceId), other=await actor();
    await expect(store.stage(other,sourceId,lease.token,'event-17',preview())).rejects.toMatchObject({code:'CALENDAR_LEASE_LOST'});
  });
  it('stages once and never creates or publishes a poll',async()=>{
    const before=await db.query('SELECT count(*) FROM radio_poll'); const lease=await store.claim(ctx,sourceId);
    const first=await store.stage(ctx,sourceId,lease.token,'event-17',preview());
    const again=await store.stage(ctx,sourceId,lease.token,'event-17',preview());
    expect(first.changed).toBe(true); expect(again).toEqual({id:first.id,changed:false});
    const rows=await staged(); expect(rows).toHaveLength(1); expect(rows[0].version).toBe(1); expect(rows[0].state).toBe('review');
    expect((await db.query('SELECT count(*) FROM radio_poll')).rows).toEqual(before.rows);
  });
  it('updates staged content with stable ID and incremented version',async()=>{
    const lease=await store.claim(ctx,sourceId); const first=await store.stage(ctx,sourceId,lease.token,'event-17',preview());
    const next=await store.stage(ctx,sourceId,lease.token,'event-17',preview('Updated question?'));
    expect(next.id).toBe(first.id); expect((await staged())[0].version).toBe(2);
  });
  it('rejects a different calendar, event or program and rolls back',async()=>{
    const lease=await store.claim(ctx,sourceId); const p=preview(); if(p.kind!=='preview')throw Error();
    for(const change of [{...p,external:{...p.external,calendarId:'other'}},{...p,external:{...p.external,eventId:'other'}},{...p,programId:randomUUID()}])await expect(store.stage(ctx,sourceId,lease.token,'event-17',change)).rejects.toMatchObject({statusCode:422});
    expect(await staged()).toHaveLength(0);
  });
  it('keeps invalid events private with bounded reason codes',async()=>{
    const lease=await store.claim(ctx,sourceId);
    await store.stage(ctx,sourceId,lease.token,'invalid',{kind:'pending',issues:['INVALID_CONFIG'],calendarEvent:{title:'Invalid fixture',programId:null,startDate:null,endDate:null,startsAt:null,endsAt:null,allDay:false}});
    const rows=await staged(); expect(rows[0]).toMatchObject({state:'invalid',payload:null,reason:'INVALID_CONFIG'});
  });
  it('projects only safe agenda fields in a bounded date range and pages by an opaque cursor',async()=>{
    const lease=await store.claim(ctx,sourceId);
    await store.stage(ctx,sourceId,lease.token,'event-17',preview('Agenda first?', 'event-17'));
    await store.stage(ctx,sourceId,lease.token,'event-18',preview('Agenda second?', 'event-18'));
    const range=pollCalendarQuery.parse({from:'2026-11-17',to:'2026-11-18',limit:'1'});
    const first=await store.calendar(ctx,'fixture-'+programId,range);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({title:expect.stringMatching(/^Agenda/),programName:'Fixture program',startDate:'2026-11-17',origin:'google_calendar',state:'review'});
    expect(first.items[0].endDate).toBe('2026-11-18');
    expect(first.items[0]).not.toHaveProperty('eventId');
    expect(first.items[0]).not.toHaveProperty('payload');
    expect(first.nextCursor).toEqual(expect.any(String));
    const second=await store.calendar(ctx,'fixture-'+programId,{...range,after:first.nextCursor!});
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    const outside=await store.calendar(ctx,'fixture-'+programId,pollCalendarQuery.parse({from:'2026-11-18',to:'2026-11-19'}));
    expect(outside.items).toHaveLength(0);
  });
  it('denies calendar projection without current global read permission',async()=>{
    const no=await actor(false);
    await expect(store.calendar(no,'fixture-'+programId,pollCalendarQuery.parse({from:'2026-11-17',to:'2026-11-18'})))
      .rejects.toMatchObject({code:'CALENDAR_ACCESS_DENIED'});
  });
  it('marks cancellation only in staging, without deleting operational records',async()=>{
    const lease=await store.claim(ctx,sourceId); await store.stage(ctx,sourceId,lease.token,'event-17',preview());
    await store.stage(ctx,sourceId,lease.token,'event-17',{kind:'canceled',external:{calendarId:lease.calendarId,eventId:'event-17'},calendarEvent:{title:'Synthetic question?',programId:null,startDate:'2026-11-17',endDate:'2026-11-18',startsAt:null,endsAt:null,allDay:true}});
    expect((await staged())[0].state).toBe('canceled');
  });
  it('changes cursor only on explicit successful completion and fences finished jobs',async()=>{
    const lease=await store.claim(ctx,sourceId); expect(lease.syncToken).toBeNull();
    await store.stage(ctx,sourceId,lease.token,'event-17',preview());
    expect((await db.query('SELECT sync_token FROM radio_calendar_source WHERE id=$1',[sourceId])).rows[0].sync_token).toBeNull();
    await store.finish(ctx,sourceId,lease.token,'next-page-complete');
    await expect(store.stage(ctx,sourceId,lease.token,'event-17',preview())).rejects.toMatchObject({code:'CALENDAR_LEASE_LOST'});
    expect((await store.claim(ctx,sourceId)).syncToken).toBe('next-page-complete');
  });
  it('resets an expired cursor without deleting staged events and releases a failed lease',async()=>{
    const lease=await store.claim(ctx,sourceId); await store.stage(ctx,sourceId,lease.token,'event-17',preview());
    await store.finish(ctx,sourceId,lease.token,'expired-cursor');
    const next=await store.claim(ctx,sourceId); await store.restartFullSync(ctx,sourceId,next.token);
    expect((await db.query('SELECT sync_token FROM radio_calendar_source WHERE id=$1',[sourceId])).rows[0].sync_token).toBeNull();
    expect(await staged()).toHaveLength(1);
    const retry=await store.claim(ctx,sourceId); await store.abort(ctx,sourceId,retry.token);
    await expect(store.claim(ctx,sourceId)).resolves.toMatchObject({syncToken:null});
  });
  it('configuration change invalidates a running job and checks optimistic version',async()=>{
    const lease=await store.claim(ctx,sourceId);
    await expect(store.setActive(ctx,sourceId,1,false)).rejects.toMatchObject({code:'CALENDAR_VERSION_CONFLICT'});
    await store.setActive(ctx,sourceId,2,false);
    await expect(store.finish(ctx,sourceId,lease.token,'bad')).rejects.toMatchObject({code:'CALENDAR_LEASE_LOST'});
  });
  it('allows explicit program overrides only from the inactive source allowlist',async()=>{
    const secondProgram=randomUUID();
    await db.query("INSERT INTO radio_program(id,radio_key,name,slug) VALUES($1::uuid,'radio-88','Second Fixture',$2)",[secondProgram,`fixture-${secondProgram}`]);
    await expect(store.configurePrograms(ctx,sourceId,2,programId,[programId,secondProgram])).rejects.toMatchObject({code:'CALENDAR_SOURCE_VERSION_CONFLICT'});
    await store.setActive(ctx,sourceId,2,false);
    const configured=await store.configurePrograms(ctx,sourceId,3,programId,[programId,secondProgram]);
    await store.setActive(ctx,sourceId,configured.version,true);
    const lease=await store.claim(ctx,sourceId);
    expect(lease.allowedProgramIds).toEqual(expect.arrayContaining([programId,secondProgram]));
    const basePreview=preview(); if(basePreview.kind!=='preview')throw Error('Expected preview fixture');
    const alternate={...basePreview,programId:secondProgram,external:{...basePreview.external,eventId:'alternate-event'}};
    await store.stage(ctx,sourceId,lease.token,'alternate-event',alternate);
    await expect(store.stage(ctx,sourceId,lease.token,'outside-event',{...alternate,programId:randomUUID(),external:{...alternate.external,eventId:'outside-event'}})).rejects.toMatchObject({code:'CALENDAR_PROGRAM_MISMATCH'});
    const source=(await store.listSources(ctx))[0];
    expect(source.allowedPrograms).toHaveLength(2);
  });
  it('audit contains no content, cursor or lease bearer token',async()=>{
    const lease=await store.claim(ctx,sourceId);await store.stage(ctx,sourceId,lease.token,'event-17',preview('Sensitive fixture question?'));await store.finish(ctx,sourceId,lease.token,'private-cursor');
    const log=JSON.stringify((await db.query("SELECT metadata FROM admin_audit_log WHERE resource_type='radio_calendar_source'")).rows);
    for(const value of ['Sensitive fixture','Private context',lease.token,'private-cursor'])expect(log).not.toContain(value);
  });
  it('does not grant any existing role the new permissions implicitly',async()=>{
    expect((await db.query("SELECT count(*) FROM role_permission rp JOIN permission p ON p.id=rp.permission_id WHERE p.key LIKE 'calendar_integration.%'")).rows[0].count).toBe('0');
  });
});
