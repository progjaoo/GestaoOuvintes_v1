import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationContext } from '../../src/services/authorization-service.js';
import { createGoogleCalendarOAuth, GOOGLE_CALENDAR_READ_SCOPE } from '../../src/services/google-calendar-oauth.js';

const suite = process.env.RUN_CALENDAR_STAGING_TESTS === 'true' ? describe : describe.skip;
suite('Google Calendar OAuth - disposable PostgreSQL only',()=>{
  const db=new Pool({connectionString:process.env.DATABASE_URL});
  const config={clientId:'fixture-client-id',clientSecret:'fixture-client-secret',redirectUri:'http://localhost:3012/api/admin/calendar-integrations/oauth/callback',encryptionKey:Buffer.alloc(32,7).toString('base64')};
  async function actor(grant=true):Promise<AuthorizationContext>{
    const id=randomUUID(),sid=randomUUID();
    await db.query("INSERT INTO admin_user(id,name,username,password_hash,role,active) VALUES($1::uuid,'OAuth Fixture',$1::text,'unused','viewer',true)",[id]);
    await db.query("INSERT INTO admin_session(id,admin_user_id,authz_version,expires_at) VALUES($1,$2,1,now()+interval '1 hour')",[sid,id]);
    if(grant) await db.query(`INSERT INTO admin_permission_override(admin_user_id,permission_id,effect,scope_type,reason,created_by_admin_user_id)
      SELECT $1,id,'ALLOW','global','Synthetic OAuth grant',$1 FROM permission WHERE key='calendar_integration.manage'`,[id]);
    return {adminUserId:id,sessionId:sid,authzVersion:1,permissions:new Set(),scopes:new Map(),departmentIds:new Set()};
  }
  beforeAll(()=>{if(!process.env.DATABASE_URL?.includes('calendar_staging_test'))throw Error('Disposable database required');});
  beforeEach(async()=>{await db.query('DELETE FROM radio_calendar_oauth_state');await db.query('DELETE FROM radio_calendar_oauth_connection');});
  afterAll(async()=>db.end());
  it('starts PKCE auth with only the exact read-only Calendar scope',async()=>{
    const ctx=await actor(),oauth=createGoogleCalendarOAuth(db,config),result=await oauth.start(ctx),url=new URL(result.authorizationUrl);
    expect(url.origin).toBe('https://accounts.google.com'); expect(url.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_READ_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline'); expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(result.authorizationUrl).not.toContain(config.clientSecret);
    const state=url.searchParams.get('state')!;
    const row=(await db.query('SELECT state_hash,pkce_verifier_ciphertext FROM radio_calendar_oauth_state WHERE admin_user_id=$1',[ctx.adminUserId])).rows[0];
    expect(row.state_hash).not.toBe(state); expect(row.pkce_verifier_ciphertext).not.toContain(url.searchParams.get('code_challenge'));
  });
  it('exchanges mocked authorization, stores only encrypted refresh token and consumes state once',async()=>{
    const ctx=await actor(),fetcher=vi.fn(async(_input:string|Request|URL,init?:RequestInit)=>{
      const body=new URLSearchParams(init?.body as string);
      expect(body.get('client_secret')).toBe(config.clientSecret); expect(body.get('code_verifier')).toBeTruthy();
      return new Response(JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',expires_in:3600,scope:GOOGLE_CALENDAR_READ_SCOPE}),{status:200});
    });
    const oauth=createGoogleCalendarOAuth(db,config,fetcher),url=new URL((await oauth.start(ctx)).authorizationUrl),state=url.searchParams.get('state')!;
    expect(await oauth.callback({state,code:'synthetic-code'})).toMatchObject({connected:true,readOnly:true,scopes:[GOOGLE_CALENDAR_READ_SCOPE]});
    const status=await oauth.status(ctx);expect(status.connected).toBe(true);expect(status.readOnly).toBe(true);
    const row=(await db.query('SELECT refresh_token_ciphertext FROM radio_calendar_oauth_connection WHERE radio_key=$1',['radio-88'])).rows[0];
    expect(row.refresh_token_ciphertext).not.toContain('synthetic-refresh');
    await expect(oauth.callback({state,code:'synthetic-code'})).rejects.toMatchObject({code:'CALENDAR_OAUTH_STATE_INVALID'});
  });
  it('rejects revoked admin sessions before exchanging or storing tokens',async()=>{
    const ctx=await actor(),fetcher=vi.fn(),oauth=createGoogleCalendarOAuth(db,config,fetcher),url=new URL((await oauth.start(ctx)).authorizationUrl);
    await db.query('UPDATE admin_session SET revoked_at=now(),revoke_reason=$2 WHERE id=$1',[ctx.sessionId,'test']);
    await expect(oauth.callback({state:url.searchParams.get('state')!,code:'synthetic-code'})).rejects.toMatchObject({code:'CALENDAR_ACCESS_DENIED'});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects broader scopes and does not save the refresh token',async()=>{
    const ctx=await actor(),fetcher=vi.fn(async()=>new Response(JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',expires_in:3600,scope:'https://www.googleapis.com/auth/calendar'}),{status:200}));
    const oauth=createGoogleCalendarOAuth(db,config,fetcher as typeof fetch),url=new URL((await oauth.start(ctx)).authorizationUrl);
    await expect(oauth.callback({state:url.searchParams.get('state')!,code:'synthetic-code'})).rejects.toMatchObject({code:'CALENDAR_OAUTH_SCOPE_REJECTED'});
    expect((await db.query('SELECT count(*) FROM radio_calendar_oauth_connection')).rows[0].count).toBe('0');
  });
  it('denies connection setup without live global management permission',async()=>{
    const ctx=await actor(false),oauth=createGoogleCalendarOAuth(db,config);
    await expect(oauth.start(ctx)).rejects.toMatchObject({code:'CALENDAR_ACCESS_DENIED'});
  });
});
