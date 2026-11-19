import {createHmac,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {pool} from '../database/client.js';
import {env} from '../config/env.js';
import {AppError} from '../lib/errors.js';
import {normalizePhone,normalizeText} from '../lib/normalization.js';
import {hashDeviceToken} from './public-session-service.js';
import {assertConcreteEdition} from './poll-edition.js';
import {pollWindow} from './poll-policy.js';
import {validatePollSubmission} from './public-poll-policy.js';
import {publicPollDto} from './public-poll-snapshot.js';
import type {PollIdentityInput,PollSubmissionInput} from '../schemas/public-poll.js';
import type {WeeklySlot,ProgrammingException} from './programming-resolver.js';
const RADIO='radio-88';
export const POLL_PRIVACY_VERSION='poll-privacy-v1';
const fail=(code:string,message:string)=>new AppError(409,code,message);
const publicPollSelect=`SELECT p.id,p.slug,p.program_id AS "programId",pr.name AS "programName",p.question,p.context,p.mode,
 p.image_url AS "imageUrl",p.identification_policy AS "identificationPolicy",p.allow_message AS "allowMessage",
 e.starts_at AS "editionStartsAt",e.ends_at AS "editionEndsAt",p.starts_at AS "startsAt",p.ends_at AS "endsAt",
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.id,'text',o.text) ORDER BY o.position)
  FROM radio_poll_option o WHERE (o.radio_key,o.program_id,o.poll_id)=(p.radio_key,p.program_id,p.id) AND o.active),'[]'::jsonb) AS options,
 p.program_id AS _program_id
 FROM radio_poll p JOIN radio_program pr ON (pr.radio_key,pr.id)=(p.radio_key,p.program_id)
 JOIN radio_program_edition e ON (e.radio_key,e.program_id,e.id)=(p.radio_key,p.program_id,p.edition_id)`;

async function publicEditionIsCurrent(row:Record<string,any>) {
 const [slotRows,exceptionRows]=await Promise.all([
  pool.query(`SELECT s.id,s.radio_key AS "radioKey",s.program_id AS "programId",s.weekday,s.start_minute AS "startMinute",s.end_minute AS "endMinute",
   s.valid_from::text AS "validFrom",s.valid_until::text AS "validUntil",s.active,p.active AS "programActive"
   FROM radio_program_slot s JOIN radio_program p ON (p.radio_key,p.id)=(s.radio_key,s.program_id) WHERE s.radio_key=$1 AND s.program_id=$2`,[RADIO,row._program_id]),
  pool.query(`SELECT o.id,o.radio_key AS "radioKey",o.program_id AS "programId",o.active,o.starts_at AS "startsAt",o.ends_at AS "endsAt",p.active AS "programActive"
   FROM radio_program_override o LEFT JOIN radio_program p ON (p.radio_key,p.id)=(o.radio_key,o.program_id) WHERE o.radio_key=$1 AND o.program_id=$2`,[RADIO,row._program_id]),
 ]);
 const exceptions:ProgrammingException[]=exceptionRows.rows.map(e=>({...e,startsAt:e.startsAt.toISOString(),endsAt:e.endsAt.toISOString()}));
 try { assertConcreteEdition(row._program_id,row.editionStartsAt.toISOString(),row.editionEndsAt.toISOString(),slotRows.rows,exceptions); return true; }
 catch { return false; }
}

async function findPublicPoll(where:string,value:string) {
 const rows=await pool.query(`${publicPollSelect} WHERE p.radio_key=$1 AND ${where}
  AND pr.active AND p.state IN ('scheduled','published')
  AND p.starts_at<=clock_timestamp() AND p.ends_at>clock_timestamp() LIMIT 2`,[RADIO,value]);
 if(rows.rows.length!==1) return null;
 const row=rows.rows[0];
 if(!await publicEditionIsCurrent(row)) return null;
 const { _program_id:_programId, ...dto }=row;
 return publicPollDto({...dto,editionStartsAt:dto.editionStartsAt.toISOString(),editionEndsAt:dto.editionEndsAt.toISOString(),
  startsAt:dto.startsAt.toISOString(),endsAt:dto.endsAt.toISOString()});
}

export function activePublicPoll(programId:string) { return findPublicPoll('p.program_id=$2',programId); }
export function publicPollBySlug(slug:string) { return findPublicPoll('p.slug=$2',slug); }
async function transaction<T>(pollId:string,token:string,action:(c:PoolClient,p:Record<string,any>,hash:string)=>Promise<T>){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock_shared(881188,12)');
  await c.query('SELECT key FROM radio_programming_scope WHERE key=$1 FOR SHARE',[RADIO]);
  const locked=await c.query('SELECT id FROM radio_poll WHERE radio_key=$1 AND id=$2 FOR UPDATE',[RADIO,pollId]);
  if(!locked.rowCount)throw new AppError(404,'POLL_NOT_FOUND','Enquete indisponivel.');
  const p=(await c.query(`SELECT p.*,pr.active AS program_active,e.starts_at AS edition_starts_at,e.ends_at AS edition_ends_at
   FROM radio_poll p JOIN radio_program pr ON (pr.radio_key,pr.id)=(p.radio_key,p.program_id)
   JOIN radio_program_edition e ON (e.radio_key,e.program_id,e.id)=(p.radio_key,p.program_id,p.edition_id)
   WHERE p.radio_key=$1 AND p.id=$2`,[RADIO,pollId])).rows[0];
  const hash=hashDeviceToken(token);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['public-poll-device:'+hash]);
  const device=await c.query('SELECT id,revoked_at FROM listener_device WHERE token_hash=$1 FOR UPDATE',[hash]);
  if(device.rows[0]?.revoked_at)throw new AppError(403,'DEVICE_REVOKED','Dispositivo indisponivel.');
  const result=await action(c,p,hash);await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function assertOpen(c:PoolClient,p:Record<string,any>){
 const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
 if(!p.program_active||!['published','scheduled'].includes(p.state)||now<p.starts_at||now>=p.ends_at)throw fail('POLL_NOT_OPEN','Enquete fora da janela atual.');
 pollWindow({startsAt:p.edition_starts_at.toISOString(),endsAt:p.edition_ends_at.toISOString()},{startsAt:p.starts_at.toISOString(),endsAt:p.ends_at.toISOString()});
 const slots=await c.query<WeeklySlot>(`SELECT s.id,s.radio_key AS "radioKey",s.program_id AS "programId",s.active,p.active AS "programActive",
  s.weekday,s.start_minute AS "startMinute",s.end_minute AS "endMinute",s.valid_from::text AS "validFrom",s.valid_until::text AS "validUntil"
  FROM radio_program_slot s JOIN radio_program p ON (p.radio_key,p.id)=(s.radio_key,s.program_id) WHERE s.radio_key=$1 AND s.active`,[RADIO]);
 const ex=await c.query(`SELECT o.id,o.radio_key AS "radioKey",o.program_id AS "programId",o.active,p.active AS "programActive",o.starts_at,o.ends_at
  FROM radio_program_override o LEFT JOIN radio_program p ON (p.radio_key,p.id)=(o.radio_key,o.program_id) WHERE o.radio_key=$1 AND o.active`,[RADIO]);
 const exceptions:ProgrammingException[]=ex.rows.map(e=>({...e,startsAt:e.starts_at.toISOString(),endsAt:e.ends_at.toISOString()}));
 assertConcreteEdition(p.program_id,p.edition_starts_at.toISOString(),p.edition_ends_at.toISOString(),slots.rows,exceptions);
}
async function knownProfile(c:PoolClient,hash:string){
 const r=await c.query(`SELECT d.id AS device_id,p.id AS profile_id,p.name,p.neighborhood FROM listener_device d
 JOIN listener_profile p ON p.id=d.listener_profile_id
 WHERE d.token_hash=$1 AND d.revoked_at IS NULL AND p.status='active' AND p.deleted_at IS NULL FOR SHARE OF p`,[hash]);
 return r.rows[0];
}
export function pollIdentity(pollId:string,token:string,input:PollIdentityInput){
 return transaction(pollId,token,async(c,p,hash)=>{
  await assertOpen(c,p);
  let profile=await knownProfile(c,hash);
  if(!profile&&'name' in input){
   // A blocked/deleted linked profile must not be replaced using the same bearer token.
   const linked=await c.query('SELECT listener_profile_id FROM listener_device WHERE token_hash=$1',[hash]);
   if(linked.rows[0]?.listener_profile_id)throw new AppError(403,'LISTENER_PROFILE_UNAVAILABLE','Perfil indisponivel.');
   const created=await c.query(`INSERT INTO listener_profile(name,neighborhood,city,phone,phone_normalized,marketing_opt_in)
    VALUES($1,$2,$3,$4,$4,false) RETURNING id`,[normalizeText(input.name),normalizeText(input.neighborhood),normalizeText(input.city),normalizePhone(input.phone)]);
   await c.query(`INSERT INTO listener_device(token_hash,platform,listener_profile_id,linked_at)
    VALUES($1,'web_desktop',$2,clock_timestamp()) ON CONFLICT(token_hash) DO UPDATE
    SET listener_profile_id=EXCLUDED.listener_profile_id,linked_at=clock_timestamp(),last_seen_at=clock_timestamp()
    WHERE listener_device.revoked_at IS NULL AND listener_device.listener_profile_id IS NULL`,[hash,created.rows[0].id]);
   profile=await knownProfile(c,hash);
   if(!profile)throw fail('LISTENER_PROFILE_CONFLICT','Dispositivo alterado. Tente novamente.');
  }
  if(profile&&'name' in input)await c.query(`INSERT INTO radio_poll_identity_consent(radio_key,poll_id,listener_profile_id,listener_device_id,privacy_notice_version)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[RADIO,p.id,profile.profile_id,profile.device_id,POLL_PRIVACY_VERSION]);
  return profile?{known:true,displayName:profile.name,neighborhood:profile.neighborhood}:{known:false};
 });
}
function receipt(row:Record<string,any>){return {status:'accepted' as const,submissionId:row.submission_id,pollId:row.poll_id,
 voteId:row.vote_id??null,messageId:row.participation_id??null,receivedAt:row.created_at.toISOString()};}
export function submitPoll(pollId:string,token:string,input:PollSubmissionInput){
 return transaction(pollId,token,async(c,p,hash)=>{
  const payloadHash=createHmac('sha256',env.DEVICE_TOKEN_SECRET).update(JSON.stringify({
   optionId:input.optionId??null,message:input.message??null,identified:input.identified,privacyAccepted:input.privacyAccepted??false,
  })).digest('hex');
  const previous=await c.query('SELECT * FROM radio_poll_submission WHERE radio_key=$1 AND poll_id=$2 AND submission_id=$3',[RADIO,p.id,input.submissionId]);
  if(previous.rows[0]){
   if(previous.rows[0].device_token_hash!==hash||previous.rows[0].payload_hash!==payloadHash)throw fail('SUBMISSION_CONFLICT','Identificador de envio ja utilizado com outros dados.');
   return receipt(previous.rows[0]);
  }
  await assertOpen(c,p);validatePollSubmission({mode:p.mode,allow_message:p.allow_message,identification_policy:p.identification_policy},input);
  if((await c.query('SELECT id FROM radio_poll_submission WHERE radio_key=$1 AND poll_id=$2 AND device_token_hash=$3',[RADIO,p.id,hash])).rowCount)throw fail('POLL_ALREADY_SUBMITTED','Dispositivo ja participou desta enquete.');
  let profile;
  if(input.identified){profile=await knownProfile(c,hash);if(!profile)throw fail('LISTENER_PROFILE_REQUIRED','Cadastre a identidade neste dispositivo.');}
  if(input.optionId&&!(await c.query(`SELECT id FROM radio_poll_option WHERE radio_key=$1 AND program_id=$2 AND poll_id=$3 AND id=$4 AND active`,[RADIO,p.program_id,p.id,input.optionId])).rowCount)throw new AppError(400,'INVALID_POLL_OPTION','Alternativa indisponivel.');
  await assertOpen(c,p);
  let voteId=null,messageId=null;
  if(input.optionId){voteId=randomUUID();await c.query(`INSERT INTO radio_poll_vote(id,radio_key,program_id,poll_id,option_id,voter_key) VALUES($1,$2,$3,$4,$5,$6)`,[voteId,RADIO,p.program_id,p.id,input.optionId,randomUUID()]);}
  if(input.message){messageId=randomUUID();await c.query(`INSERT INTO radio_program_participation(id,radio_key,program_id,edition_id,poll_id,display_name,neighborhood,message)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[messageId,RADIO,p.program_id,p.edition_id,p.id,profile?.name??null,profile?.neighborhood??null,input.message]);}
  const saved=await c.query(`INSERT INTO radio_poll_submission(radio_key,program_id,edition_id,poll_id,submission_id,device_token_hash,payload_hash,
   listener_profile_id,listener_device_id,identified,privacy_accepted_at,privacy_notice_version,display_name,neighborhood,vote_id,participation_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $16 THEN clock_timestamp() END,$11,$12,$13,$14,$15) RETURNING *`,
   [RADIO,p.program_id,p.edition_id,p.id,input.submissionId,hash,payloadHash,profile?.profile_id??null,profile?.device_id??null,input.identified,
    input.privacyAccepted?POLL_PRIVACY_VERSION:null,profile?.name??null,profile?.neighborhood??null,voteId,messageId,input.privacyAccepted??false]);
  return receipt(saved.rows[0]);
 });
}
