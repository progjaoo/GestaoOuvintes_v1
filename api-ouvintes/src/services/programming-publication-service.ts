import {hasGlobalPermission,type AuthorizationContext} from './authorization-service.js';
import {AppError} from '../lib/errors.js';
import type {PoolClient} from 'pg';
import {pool} from '../database/client.js';
import {env} from '../config/env.js';
import {programmingNamespace,programmingSnapshotSchema,putProgrammingSnapshot} from './programming-public-snapshot.js';
export async function enqueueProgramming(c:PoolClient){
 const revision=Number((await c.query("INSERT INTO radio_programming_publication(radio_key,payload) VALUES('radio-88','{}') RETURNING revision")).rows[0].revision);
 const programs=(await c.query(`SELECT p.id,p.name,p.slug,p.description,p.presenters,m.object_key,m.program_edge_color FROM radio_program p LEFT JOIN media_asset m ON m.id=p.image_asset_id AND m.status='ready' WHERE p.radio_key='radio-88' AND p.active ORDER BY p.id`)).rows.map(p=>({id:p.id,name:p.name,slug:p.slug,description:p.description,presenters:p.presenters,...(p.program_edge_color?{imageEdgeColor:p.program_edge_color}:{}),imageUrl:p.object_key&&env.R2_PUBLIC_BASE_URL?`${env.R2_PUBLIC_BASE_URL.replace(/\/$/,'')}/${p.object_key}`:null}));
 const slots=(await c.query(`SELECT s.id,s.program_id AS "programId",s.weekday,s.start_minute AS "startMinute",s.end_minute AS "endMinute",s.valid_from::text AS "validFrom",s.valid_until::text AS "validUntil" FROM radio_program_slot s JOIN radio_program p ON (p.radio_key,p.id)=(s.radio_key,s.program_id) WHERE s.radio_key='radio-88' AND s.active AND p.active ORDER BY s.id`)).rows;
 const exceptions=(await c.query(`SELECT o.id,CASE WHEN p.active THEN o.program_id ELSE NULL END AS "programId",o.starts_at AS "startsAt",o.ends_at AS "endsAt" FROM radio_program_override o LEFT JOIN radio_program p ON (p.radio_key,p.id)=(o.radio_key,o.program_id) WHERE o.radio_key='radio-88' AND o.active AND o.ends_at>now() ORDER BY o.starts_at`)).rows.map(e=>({...e,startsAt:e.startsAt.toISOString(),endsAt:e.endsAt.toISOString()}));
 const now=new Date();
 // Publication can be disabled locally without blocking admin writes or requiring R2.
 const namespace=env.PROGRAMMING_NAMESPACE??'test/radio-88';
 const payload=programmingSnapshotSchema.parse({schemaVersion:1,radioKey:'radio-88',namespace,revision,generatedAt:now.toISOString(),validUntil:new Date(now.getTime()+30*86400000).toISOString(),timezone:'America/Sao_Paulo',programs,slots,exceptions});
 await c.query('UPDATE radio_programming_publication SET payload=$2 WHERE revision=$1',[revision,payload]);
 return revision;
}
export async function programmingPublicationStatus(){
 const result=await pool.query("SELECT revision,status,attempts,last_error AS \"lastError\",published_at AS \"publishedAt\",payload->>'validUntil' AS \"validUntil\" FROM radio_programming_publication WHERE radio_key='radio-88' ORDER BY revision DESC LIMIT 1");
 return {publication:result.rows[0]??null,enabled:env.PROGRAMMING_PUBLICATION_ENABLED};
}
export async function publishProgramming(context:AuthorizationContext,rebuild=true){
 if(!hasGlobalPermission(context,'programming.publish'))throw new AppError(403,'INSUFFICIENT_PERMISSION','Permissao insuficiente.');
 programmingNamespace();
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(881188,12)');
  const session=await c.query(`SELECT u.id FROM admin_user u JOIN admin_session s ON s.admin_user_id=u.id WHERE u.id=$1 AND u.active AND u.authz_version=$2 AND s.id=$3 AND s.authz_version=u.authz_version AND s.revoked_at IS NULL AND s.expires_at>now() FOR SHARE OF u,s`,[context.adminUserId,context.authzVersion,context.sessionId]);
  if(!session.rowCount)throw new AppError(401,'ADMIN_SESSION_INVALID','Sessao revogada.');
  // Held across bounded R2 requests; other publishers never overwrite a newer pointer.
  const lock=await c.query('SELECT pg_try_advisory_xact_lock(881188,71) AS acquired');
  if(!lock.rows[0].acquired){await c.query('ROLLBACK');return {status:'pending'};}
  if(rebuild){await c.query("SELECT key FROM radio_programming_scope WHERE key='radio-88' FOR UPDATE");await enqueueProgramming(c);}
  const latest=(await c.query("SELECT revision,payload,status FROM radio_programming_publication WHERE radio_key='radio-88' ORDER BY revision DESC LIMIT 1 FOR UPDATE")).rows[0];
  if(!latest){await c.query('COMMIT');return {status:'empty'};}
  if(latest.status==='published'){await c.query('COMMIT');return {status:'published',revision:latest.revision};}
  try{
   await putProgrammingSnapshot(programmingSnapshotSchema.parse(latest.payload));
   await c.query("UPDATE radio_programming_publication SET status='published',attempts=attempts+1,last_error=NULL,published_at=now() WHERE revision=$1",[latest.revision]);
   await c.query("UPDATE radio_programming_publication SET status='superseded' WHERE radio_key='radio-88' AND revision<$1 AND status IN('pending','failed')",[latest.revision]);
   await c.query("INSERT INTO admin_audit_log(admin_user_id,action,resource_type,metadata) VALUES($1,'programming.published','programming_publication',$2::jsonb)",[context.adminUserId,JSON.stringify({revision:latest.revision})]);
   await c.query('COMMIT');return {status:'published',revision:latest.revision};
  }catch{
   await c.query("UPDATE radio_programming_publication SET status='failed',attempts=attempts+1,last_error='R2_PUBLICATION_FAILED' WHERE revision=$1",[latest.revision]);
   await c.query('COMMIT');return {status:'failed',revision:latest.revision};
  }
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
