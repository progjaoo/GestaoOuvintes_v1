import type { PoolClient } from 'pg';
import {env} from '../config/env.js';
import {LocalPollSnapshotStore,publicPollDto} from './public-poll-snapshot.js';
import { pool } from '../database/client.js';
import { AppError } from '../lib/errors.js';
import type { AuthorizationContext } from './authorization-service.js';
import { pollWindow, assertPollTransition, assertPollStructureUnchanged, type PollState } from './poll-policy.js';
import { assertConcreteEdition } from './poll-edition.js';
import type { PollInput } from '../schemas/poll.js';
import type { WeeklySlot, ProgrammingException } from './programming-resolver.js';
export const localPollSnapshot=new LocalPollSnapshotStore(env.POLLS_PUBLIC_LOCAL_SNAPSHOT_FILE);
const RADIO='radio-88';
const missing=()=>new AppError(404,'POLL_NOT_FOUND','Enquete ou programa indisponivel.');
const conflict=()=>new AppError(409,'VERSION_CONFLICT','Enquete alterada. Atualize a tela.');
const args=(ctx:AuthorizationContext,key:string)=>[RADIO,ctx.adminUserId,ctx.sessionId,ctx.authzVersion,key];
// p is always the scoped program/poll alias. Neither a cached capability nor a host link grants access alone.
const authorized=`EXISTS(SELECT 1 FROM admin_user u JOIN admin_session s ON s.admin_user_id=u.id
 WHERE u.id=$2 AND u.active AND u.authz_version=$4 AND s.id=$3 AND s.authz_version=u.authz_version
 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM admin_permission_override d JOIN permission dp ON dp.id=d.permission_id
 WHERE d.admin_user_id=$2 AND dp.key=$5 AND d.effect='DENY')
 AND EXISTS(SELECT 1 FROM (
 SELECT rs.scope_type FROM admin_user_role ur JOIN role_permission rp ON rp.role_id=ur.role_id
 JOIN permission perm ON perm.id=rp.permission_id JOIN role_permission_scope rs ON rs.role_id=rp.role_id AND rs.permission_id=rp.permission_id
 WHERE ur.admin_user_id=$2 AND perm.key=$5
 UNION ALL SELECT o.scope_type FROM admin_permission_override o JOIN permission perm ON perm.id=o.permission_id
 WHERE o.admin_user_id=$2 AND perm.key=$5 AND o.effect='ALLOW'
 ) grants WHERE grants.scope_type='global' OR (grants.scope_type='participation' AND EXISTS(
 SELECT 1 FROM radio_program_host h WHERE h.radio_key=p.radio_key AND h.program_id=p.program_id
 AND h.admin_user_id=$2 AND h.active AND h.valid_from<=clock_timestamp() AND (h.valid_until IS NULL OR h.valid_until>clock_timestamp()))))`;
const selectPoll=`SELECT p.*,pr.name AS program_name,e.starts_at AS edition_starts_at,e.ends_at AS edition_ends_at,
 (SELECT count(*)::int FROM radio_poll_vote v WHERE (v.radio_key,v.program_id,v.poll_id)=(p.radio_key,p.program_id,p.id)) AS total_votes,
 (SELECT count(*)::int FROM radio_program_participation m WHERE (m.radio_key,m.poll_id)=(p.radio_key,p.id)) AS total_messages,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'text',o.text) ORDER BY o.position) FROM radio_poll_option o
 WHERE (o.radio_key,o.program_id,o.poll_id)=(p.radio_key,p.program_id,p.id) AND o.active),'[]'::jsonb) AS options
 FROM radio_poll p JOIN radio_program pr ON (pr.radio_key,pr.id)=(p.radio_key,p.program_id)
 JOIN radio_program_edition e ON (e.radio_key,e.program_id,e.id)=(p.radio_key,p.program_id,p.edition_id)`;
type Row=Record<string,any>;
function dto(p:Row){return {id:p.id,programId:p.program_id,programName:p.program_name,slug:p.slug,question:p.question,context:p.context,
 mode:p.mode??'mixed',...(p.image_url?{imageUrl:p.image_url}:{}),identificationPolicy:p.identification_policy,allowMessage:(p.mode??'mixed')!=='vote',options:p.options,
 editionStartsAt:p.edition_starts_at.toISOString(),editionEndsAt:p.edition_ends_at.toISOString(),startsAt:p.starts_at.toISOString(),endsAt:p.ends_at.toISOString(),
 state:p.state,version:p.version,totalVotes:p.total_votes};}
export async function listPolls(ctx:AuthorizationContext,filter:{programId?:string;state?:string;after?:string}){
 const r=await pool.query(selectPoll+` WHERE p.radio_key=$1 AND ${authorized}
 AND ($6::uuid IS NULL OR p.program_id=$6) AND ($7::text IS NULL OR p.state=$7) AND ($8::uuid IS NULL OR p.id>$8) ORDER BY p.id LIMIT 101`,
 [...args(ctx,'poll.read'),filter.programId??null,filter.state??null,filter.after??null]);
 return {items:r.rows.slice(0,100).map(dto),nextCursor:r.rows.length>100?r.rows[99].id:null};
}
async function read(c:Pick<PoolClient,'query'>,ctx:AuthorizationContext,id:string,key:string,lock=false){
 if(lock)await c.query(`SELECT p.id FROM radio_poll p WHERE p.radio_key=$1 AND p.id=$6 AND ${authorized} FOR UPDATE OF p`,[...args(ctx,key),id]);
 const r=await c.query(selectPoll+` WHERE p.radio_key=$1 AND p.id=$6 AND ${authorized}`,[...args(ctx,key),id]);
 if(!r.rows[0])throw missing();return r.rows[0];
}
export async function getPoll(ctx:AuthorizationContext,id:string){return dto(await read(pool,ctx,id,'poll.read'));}
export async function pollResults(ctx:AuthorizationContext,id:string){
 const c=await pool.connect();
 try{
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const p=await read(c,ctx,id,'poll.results.read');
 const r=await c.query(`SELECT o.id,o.text,count(v.id)::int AS votes FROM radio_poll_option o LEFT JOIN radio_poll_vote v
 ON (v.radio_key,v.program_id,v.poll_id,v.option_id)=(o.radio_key,o.program_id,o.poll_id,o.id)
 WHERE o.radio_key=$1 AND o.program_id=$2 AND o.poll_id=$3 AND o.active GROUP BY o.id ORDER BY o.position`,[RADIO,p.program_id,id]);
 const totalVotes=Number(p.total_votes);
 const result={totalVotes,options:r.rows.map(o=>({...o,percentage:totalVotes?Number((o.votes*100/totalVotes).toFixed(2)):0}))};
 await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function transaction(ctx:AuthorizationContext,key:string,id:string|null,operation:(c:PoolClient)=>Promise<Row>){
 const c=await pool.connect();
 try{
 await c.query('BEGIN');
 await c.query('SELECT pg_advisory_xact_lock_shared(881188,12)');
 await c.query('SELECT key FROM radio_programming_scope WHERE key=$1 FOR SHARE',[RADIO]);
 const s=await c.query(`SELECT u.id FROM admin_user u JOIN admin_session s ON s.admin_user_id=u.id
 WHERE u.id=$1 AND s.id=$2 AND u.active AND u.authz_version=$3 AND s.authz_version=u.authz_version
 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() FOR SHARE OF u,s`,[ctx.adminUserId,ctx.sessionId,ctx.authzVersion]);
 if(!s.rowCount)throw new AppError(401,'ADMIN_SESSION_INVALID','Sessao revogada.');
 const p=await operation(c);
 await c.query(`INSERT INTO admin_audit_log(admin_user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'radio_poll',$3,$4::jsonb)`,
 [ctx.adminUserId,key,id??p.id,JSON.stringify({radioKey:RADIO,programId:p.program_id,state:p.state,version:p.version})]);
 await c.query('COMMIT');return dto(p);
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function edition(c:PoolClient,programId:string,input:Pick<PollInput,'editionStartsAt'|'editionEndsAt'|'startsAt'|'endsAt'>){
 pollWindow({startsAt:input.editionStartsAt,endsAt:input.editionEndsAt},input);
 const slots=await c.query<WeeklySlot>(`SELECT s.id,s.radio_key AS "radioKey",s.program_id AS "programId",s.active,p.active AS "programActive",
 s.weekday,s.start_minute AS "startMinute",s.end_minute AS "endMinute",s.valid_from::text AS "validFrom",s.valid_until::text AS "validUntil"
 FROM radio_program_slot s JOIN radio_program p ON (p.radio_key,p.id)=(s.radio_key,s.program_id) WHERE s.radio_key=$1 AND s.active`,[RADIO]);
 const ex=await c.query(`SELECT o.id,o.radio_key AS "radioKey",o.program_id AS "programId",o.active,p.active AS "programActive",o.starts_at,o.ends_at
 FROM radio_program_override o LEFT JOIN radio_program p ON (p.radio_key,p.id)=(o.radio_key,o.program_id) WHERE o.radio_key=$1 AND o.active`,[RADIO]);
 const exceptions:ProgrammingException[]=ex.rows.map(e=>({...e,startsAt:e.starts_at.toISOString(),endsAt:e.ends_at.toISOString()}));
 assertConcreteEdition(programId,input.editionStartsAt,input.editionEndsAt,slots.rows,exceptions);
 const r=await c.query(`INSERT INTO radio_program_edition(radio_key,program_id,starts_at,ends_at) VALUES($1,$2,$3,$4)
 ON CONFLICT(radio_key,program_id,starts_at,ends_at) DO UPDATE SET starts_at=EXCLUDED.starts_at RETURNING id`,[RADIO,programId,input.editionStartsAt,input.editionEndsAt]);
 return r.rows[0].id;
}
async function options(c:PoolClient,programId:string,id:string,texts:string[],before:{id:string;text:string}[]=[]){
 await c.query('UPDATE radio_poll_option SET active=false WHERE radio_key=$1 AND poll_id=$2',[RADIO,id]);
 for(const [position,text] of texts.entries()){
 if(before[position])await c.query('UPDATE radio_poll_option SET text=$1,position=$2,active=true WHERE id=$3 AND radio_key=$4 AND poll_id=$5',[text,position,before[position].id,RADIO,id]);
 else await c.query('INSERT INTO radio_poll_option(radio_key,program_id,poll_id,text,position) VALUES($1,$2,$3,$4,$5)',[RADIO,programId,id,text,position]);
 }
}
export function savePoll(ctx:AuthorizationContext,programId:string|null,input:PollInput & {version?:number},id?:string){
 input={...input,allowMessage:input.mode!=='vote'};
 return transaction(ctx,'poll.manage',id??null,async c=>{
 let before:Row = {};
 if(id){before=await read(c,ctx,id,'poll.manage',true);programId=before.program_id;
 if(before.version!==input.version)throw conflict();
 if(!['draft','scheduled'].includes(before.state))throw new AppError(409,'POLL_NOT_EDITABLE','Estado nao permite edicao.');
 if((before.total_votes+before.total_messages)>0 && (before.edition_starts_at.getTime()!==Date.parse(input.editionStartsAt)||before.edition_ends_at.getTime()!==Date.parse(input.editionEndsAt)||before.starts_at.getTime()!==Date.parse(input.startsAt)||before.ends_at.getTime()!==Date.parse(input.endsAt))) throw new AppError(409,'POLL_STRUCTURE_LOCKED','Historico de votos impede mudar edicao ou janela.');
 const oldMode=before.identification_policy;
 assertPollStructureUnchanged({question:before.question,mode:oldMode,options:before.options},
 {question:input.question,mode:input.identificationPolicy,options:input.options.map((text,i)=>({id:before!.options[i]?.id??'',text}))},before.total_votes+before.total_messages);
 if((before.total_votes+before.total_messages)>0&&(before.allow_message!==input.allowMessage||before.mode!==input.mode||before.image_url!==(input.imageUrl??null)||before.context!==input.context||before.slug!==input.slug))throw new AppError(409,'POLL_STRUCTURE_LOCKED','Estrutura bloqueada apos voto.');
 }else{
 const r=await c.query(`SELECT p.id FROM (SELECT *,id AS program_id FROM radio_program) p WHERE p.radio_key=$1 AND p.id=$6 AND ${authorized}`,[...args(ctx,'poll.manage'),programId]);
 if(!r.rowCount)throw missing();
 }
 const editionId=await edition(c,programId!,input);
 const values=[RADIO,programId,editionId,input.slug,input.question,input.context,input.identificationPolicy,input.allowMessage,input.startsAt,input.endsAt,input.mode,input.imageUrl??null];
 const r=id?await c.query(`UPDATE radio_poll SET edition_id=$3,slug=$4,question=$5,context=$6,identification_policy=$7,allow_message=$8,starts_at=$9,ends_at=$10,mode=$11,image_url=$12,
 version=version+1,updated_at=clock_timestamp() WHERE radio_key=$1 AND program_id=$2 AND id=$13 RETURNING id`,[...values,id]):
 await c.query(`INSERT INTO radio_poll(radio_key,program_id,edition_id,slug,question,context,identification_policy,allow_message,starts_at,ends_at,mode,image_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,values);
 const pollId=r.rows[0].id;
 await options(c,programId!,pollId,input.options,before.options);
 // Return by the action already authorized, not poll.read (independent capabilities).
 return read(c,ctx,pollId,'poll.manage');
 });
}
export async function commandPoll(ctx:AuthorizationContext,id:string,command:'publish'|'close'|'archive'|'cancel',version:number){
 const key=command==='publish'?'poll.publish':'poll.close';
 const result=await transaction(ctx,key,id,async c=>{
 const p=await read(c,ctx,id,key,true);if(p.version!==version)throw conflict();
 let state:PollState=command==='close'?'closed':command==='archive'?'archived':command==='cancel'?'canceled':'published';
 if(command==='publish'){
 await edition(c,p.program_id,{editionStartsAt:p.edition_starts_at.toISOString(),editionEndsAt:p.edition_ends_at.toISOString(),startsAt:p.starts_at.toISOString(),endsAt:p.ends_at.toISOString()});
 const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
 if(now>=p.ends_at.getTime())throw new AppError(409,'POLL_WINDOW_ENDED','Janela encerrada.');
 if(now<p.starts_at.getTime())state='scheduled';
 }
 assertPollTransition(p.state,state);
 await c.query('UPDATE radio_poll SET state=$3,version=version+1,updated_at=clock_timestamp() WHERE radio_key=$1 AND id=$2',[RADIO,id,state]);
 return read(c,ctx,id,key);
 });
 if(env.POLLS_PUBLIC_LOCAL_ENABLED&&command!=='publish')await localPollSnapshot.publish(publicPollDto(result),result.state);
 return result;
}

export async function publishPublicPoll(ctx:AuthorizationContext,id:string){
 const result=await transaction(ctx,'poll.publish',id,async c=>{
  const p=await read(c,ctx,id,'poll.publish',true);
  if(['scheduled','published'].includes(p.state))await edition(c,p.program_id,{editionStartsAt:p.edition_starts_at.toISOString(),editionEndsAt:p.edition_ends_at.toISOString(),startsAt:p.starts_at.toISOString(),endsAt:p.ends_at.toISOString()});
  await localPollSnapshot.publish(publicPollDto(dto(p)),p.state);return p;
 });
 return publicPollDto(result);
}
