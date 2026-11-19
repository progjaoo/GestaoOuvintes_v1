import { z } from 'zod';
import { AppError } from '../lib/errors.js';

const READ_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const tokenResult = z.object({
  access_token:z.string().min(1).max(8192), token_type:z.literal('Bearer'), expires_in:z.number().int().positive().max(86400),
  scope:z.string().min(1).max(2048).optional(),
});
const eventPage = z.object({items:z.array(z.unknown()).max(2500).default([]),nextPageToken:z.string().min(1).max(8192).optional(),nextSyncToken:z.string().min(1).max(16000).optional()}).passthrough();
export class GoogleCalendarSyncTokenExpired extends Error { readonly code='CALENDAR_SYNC_TOKEN_EXPIRED'; }

export function createGoogleCalendarApi(input:{clientId:string;clientSecret:string;allowedCalendarId:string;loadRefreshToken:()=>Promise<string>},fetcher:typeof fetch=fetch) {
  const calendarId=z.string().min(1).max(1024).parse(input.allowedCalendarId);
  let cached:{token:string;expiresAt:number}|undefined;
  let pending:Promise<string>|undefined;
  async function accessToken() {
    if(cached && cached.expiresAt>Date.now()+30_000) return cached.token;
    if(pending) return pending;
    pending=(async()=>{
      const refreshToken=await input.loadRefreshToken();
      let response:Response;
      try { response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:input.clientId,client_secret:input.clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(8_000)}); }
      catch { throw new AppError(503,'CALENDAR_TOKEN_REFRESH_FAILED','Conexao Google indisponivel. Tente novamente.'); }
      if(!response.ok) {
        if(response.status===400||response.status===401) throw new AppError(409,'CALENDAR_RECONNECT_REQUIRED','A conexao Google precisa ser refeita.');
        throw new AppError(503,'CALENDAR_TOKEN_REFRESH_FAILED','Conexao Google indisponivel. Tente novamente.');
      }
      let raw:unknown; try{raw=await response.json();}catch{throw new AppError(502,'CALENDAR_TOKEN_RESPONSE_INVALID','Resposta do Google invalida.');}
      const parsed=tokenResult.safeParse(raw);if(!parsed.success)throw new AppError(502,'CALENDAR_TOKEN_RESPONSE_INVALID','Resposta do Google invalida.');
      if(parsed.data.scope){const scopes=[...new Set(parsed.data.scope.split(/\s+/).filter(Boolean))];if(scopes.length!==1||scopes[0]!==READ_SCOPE)throw new AppError(403,'CALENDAR_OAUTH_SCOPE_REJECTED','A conexao Google nao esta limitada a leitura solicitada.');}
      cached={token:parsed.data.access_token,expiresAt:Date.now()+parsed.data.expires_in*1000};return cached.token;
    })().finally(()=>{pending=undefined;});
    return pending;
  }
  return {
    async listEvents(request:{calendarId:string;syncToken:string|null;pageToken?:string}) {
      if(request.calendarId!==calendarId)throw new AppError(403,'CALENDAR_ID_NOT_ALLOWED','Agenda fora da allowlist configurada.');
      const url=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('maxResults','2500');url.searchParams.set('showDeleted','true');url.searchParams.set('singleEvents','true');url.searchParams.set('timeZone','America/Sao_Paulo');
      if(request.syncToken)url.searchParams.set('syncToken',request.syncToken);
      if(request.pageToken)url.searchParams.set('pageToken',request.pageToken);
      let response:Response;
      try{response=await fetcher(url,{method:'GET',headers:{authorization:`Bearer ${await accessToken()}`},signal:AbortSignal.timeout(10_000)});}
      catch(error){if(error instanceof AppError)throw error;throw new AppError(503,'CALENDAR_READ_FAILED','Nao foi possivel consultar a agenda. Tente novamente.');}
      if(response.status===410)throw new GoogleCalendarSyncTokenExpired();
      if(response.status===401)throw new AppError(409,'CALENDAR_RECONNECT_REQUIRED','A conexao Google precisa ser refeita.');
      if(response.status===403||response.status===404)throw new AppError(502,'CALENDAR_READ_DENIED','O Google nao permitiu ler a agenda configurada.');
      if(response.status===429||response.status>=500)throw new AppError(503,'CALENDAR_READ_THROTTLED','O Google esta temporariamente indisponivel. Tente novamente.');
      if(!response.ok)throw new AppError(502,'CALENDAR_READ_FAILED','Resposta invalida ao consultar a agenda.');
      let raw:unknown;try{raw=await response.json();}catch{throw new AppError(502,'CALENDAR_RESPONSE_INVALID','Resposta invalida ao consultar a agenda.');}
      const parsed=eventPage.safeParse(raw);if(!parsed.success)throw new AppError(502,'CALENDAR_RESPONSE_INVALID','Resposta invalida ao consultar a agenda.');
      return parsed.data;
    },
  };
}
