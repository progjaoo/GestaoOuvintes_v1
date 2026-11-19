import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import type { AuthorizationContext } from './authorization-service.js';

const RADIO = 'radio-88';
export const GOOGLE_CALENDAR_READ_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const denied = () => new AppError(403, 'CALENDAR_ACCESS_DENIED', 'Acesso a integracao indisponivel.');
const stateSchema = z.string().min(32).max(256);
const tokenResponse = z.object({
  access_token: z.string().min(1).max(8192), token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive().max(86400), refresh_token: z.string().min(1).max(8192).optional(),
  scope: z.string().min(1).max(2048),
});

export function calendarEncryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('Calendar token encryption key must be 32-byte base64.');
  return key;
}
export function encryptCalendarSecret(value: string, key: Buffer): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(part => part.toString('base64url')).join('.');
}
export function decryptCalendarSecret(value: string, key: Buffer): string {
  const [ivText, tagText, bodyText, ...extra] = value.split('.');
  if (!ivText || !tagText || !bodyText || extra.length) throw new Error('Invalid encrypted calendar token.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(bodyText, 'base64url')), decipher.final()]).toString('utf8');
}

export interface CalendarOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
}

export function createGoogleCalendarOAuth(db: Pool, config: CalendarOAuthConfig, fetcher: typeof fetch = fetch) {
  const key = calendarEncryptionKey(config.encryptionKey);
  const clientId = z.string().min(1).max(512).parse(config.clientId);
  const clientSecret = z.string().min(1).max(2048).parse(config.clientSecret);
  const redirectUri = z.string().url().parse(config.redirectUri);

  async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await db.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async function assertLiveGrant(client: PoolClient, ctx: AuthorizationContext) {
    const live = await client.query(`SELECT 1 FROM admin_user u JOIN admin_session s ON s.admin_user_id=u.id
      WHERE u.id=$1 AND s.id=$2 AND u.active AND u.authz_version=$3 AND s.authz_version=u.authz_version
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() FOR SHARE OF u,s`, [ctx.adminUserId, ctx.sessionId, ctx.authzVersion]);
    const grant = await client.query(`SELECT 1 WHERE NOT EXISTS (
      SELECT 1 FROM admin_permission_override o JOIN permission p ON p.id=o.permission_id
      WHERE o.admin_user_id=$1 AND p.key='calendar_integration.manage' AND o.effect='DENY') AND EXISTS (
      SELECT 1 FROM admin_user_role ur JOIN role_permission rp ON rp.role_id=ur.role_id
      JOIN role_permission_scope rs ON (rs.role_id,rs.permission_id)=(rp.role_id,rp.permission_id)
      JOIN permission p ON p.id=rp.permission_id WHERE ur.admin_user_id=$1 AND p.key='calendar_integration.manage' AND rs.scope_type='global'
      UNION ALL SELECT 1 FROM admin_permission_override o JOIN permission p ON p.id=o.permission_id
      WHERE o.admin_user_id=$1 AND p.key='calendar_integration.manage' AND o.effect='ALLOW' AND o.scope_type='global')`, [ctx.adminUserId]);
    if (!live.rowCount || !grant.rowCount) throw denied();
  }
  async function audit(client: PoolClient, actor: string, action: string) {
    await client.query(`INSERT INTO admin_audit_log(admin_user_id,action,resource_type,resource_id,metadata)
      VALUES($1,$2,'radio_calendar_oauth_connection',$1,$3::jsonb)`, [actor, action, JSON.stringify({radioKey:RADIO, readOnly:true})]);
  }
  return {
    async start(ctx: AuthorizationContext) {
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const hash = createHash('sha256').update(state).digest('hex');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      await transaction(async client => {
        await assertLiveGrant(client, ctx);
        await client.query(`INSERT INTO radio_calendar_oauth_state(state_hash,radio_key,admin_user_id,session_id,authz_version,pkce_verifier_ciphertext,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '10 minutes')`,
        [hash, RADIO, ctx.adminUserId, ctx.sessionId, ctx.authzVersion, encryptCalendarSecret(verifier, key)]);
      });
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:GOOGLE_CALENDAR_READ_SCOPE,
        access_type:'offline',prompt:'consent',include_granted_scopes:'false',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
      return {authorizationUrl:url.toString(),expiresInSeconds:600};
    },
    async callback(input: {state: string; code: string}) {
      const state = stateSchema.parse(input.state), code = z.string().min(1).max(4096).parse(input.code);
      const hash = createHash('sha256').update(state).digest('hex');
      const pending = await transaction(async client => {
        const result = await client.query(`SELECT * FROM radio_calendar_oauth_state WHERE state_hash=$1 AND radio_key=$2
          AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`, [hash,RADIO]);
        if (!result.rowCount) throw new AppError(400,'CALENDAR_OAUTH_STATE_INVALID','Autorizacao expirada ou ja utilizada. Inicie novamente.');
        const row = result.rows[0]!;
        const ctx: AuthorizationContext = {adminUserId:row.admin_user_id,sessionId:row.session_id,authzVersion:Number(row.authz_version),permissions:new Set(),scopes:new Map(),departmentIds:new Set()};
        await assertLiveGrant(client,ctx);
        await client.query('UPDATE radio_calendar_oauth_state SET consumed_at=clock_timestamp() WHERE state_hash=$1',[hash]);
        return {actor:row.admin_user_id as string,sessionId:row.session_id as string,authzVersion:Number(row.authz_version),verifier:decryptCalendarSecret(row.pkce_verifier_ciphertext,key)};
      });
      const body = new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,
        grant_type:'authorization_code',code_verifier:pending.verifier});
      let response: Response;
      try {
        response = await fetcher('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        throw new AppError(502, 'CALENDAR_OAUTH_EXCHANGE_FAILED', 'O Google nao concluiu a autorizacao. Inicie uma nova conexao.');
      }
      if (!response.ok) throw new AppError(502,'CALENDAR_OAUTH_EXCHANGE_FAILED','O Google nao concluiu a autorizacao. Inicie uma nova conexao.');
      let rawToken: unknown;
      try { rawToken = await response.json(); } catch {
        throw new AppError(502, 'CALENDAR_OAUTH_RESPONSE_INVALID', 'Resposta de autorizacao invalida. Inicie uma nova conexao.');
      }
      const parsedToken = tokenResponse.safeParse(rawToken);
      if (!parsedToken.success) throw new AppError(502, 'CALENDAR_OAUTH_RESPONSE_INVALID', 'Resposta de autorizacao invalida. Inicie uma nova conexao.');
      const token = parsedToken.data;
      const scopes = [...new Set(token.scope.split(/\s+/).filter(Boolean))].sort();
      if (scopes.length !== 1 || scopes[0] !== GOOGLE_CALENDAR_READ_SCOPE) throw new AppError(403,'CALENDAR_OAUTH_SCOPE_REJECTED','O Google retornou permissoes diferentes do acesso somente leitura solicitado.');
      await transaction(async client => {
        await assertLiveGrant(client,{adminUserId:pending.actor,sessionId:pending.sessionId,authzVersion:pending.authzVersion,permissions:new Set(),scopes:new Map(),departmentIds:new Set()});
        let refresh = token.refresh_token;
        if (!refresh) {
          const existing = await client.query('SELECT refresh_token_ciphertext FROM radio_calendar_oauth_connection WHERE radio_key=$1 FOR UPDATE',[RADIO]);
          if (!existing.rowCount) throw new AppError(502,'CALENDAR_REFRESH_TOKEN_MISSING','O Google nao forneceu token de renovacao. Refaça a conexao com consentimento.');
          refresh = decryptCalendarSecret(existing.rows[0].refresh_token_ciphertext,key);
        }
        await client.query(`INSERT INTO radio_calendar_oauth_connection(radio_key,refresh_token_ciphertext,granted_scopes,connected_by)
          VALUES($1,$2,$3,$4) ON CONFLICT(radio_key) DO UPDATE SET refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,
          granted_scopes=EXCLUDED.granted_scopes,connected_by=EXCLUDED.connected_by,connected_at=clock_timestamp(),updated_at=clock_timestamp()`,
        [RADIO,encryptCalendarSecret(refresh,key),scopes,pending.actor]);
        await audit(client,pending.actor,'calendar.oauth.connect');
      });
      return {connected:true,readOnly:true,scopes};
    },
    async status(ctx: AuthorizationContext) {
      return transaction(async client => {
        await assertLiveGrant(client,ctx);
        const result = await client.query('SELECT granted_scopes,connected_at,updated_at FROM radio_calendar_oauth_connection WHERE radio_key=$1',[RADIO]);
        return result.rowCount ? {connected:true,readOnly:true,scopes:result.rows[0].granted_scopes as string[],connectedAt:result.rows[0].connected_at as Date}
          : {connected:false,readOnly:true,scopes:[],connectedAt:null};
      });
    },
  };
}
