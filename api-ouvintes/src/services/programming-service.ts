import { env } from '../config/env.js';
import { enqueueProgramming } from './programming-publication-service.js';
import { programmingNamespace } from './programming-public-snapshot.js';
import type { PoolClient } from 'pg';
import { pool } from '../database/client.js';
import { AppError } from '../lib/errors.js';
import { hasGlobalPermission, type AuthorizationContext } from './authorization-service.js';
import { schedulesConflict } from './programming-conflicts.js';
import { resolveOnAir, type WeeklySlot } from './programming-resolver.js';
import type { z } from 'zod';
import type { programInput, programUpdate, slotInput, slotUpdate, hostInput, overrideInput, overrideUpdate, slotBatchInput } from '../schemas/programming.js';
// Compatibility bridge: deployment scope, never supplied by a request body or query.
export const PROGRAMMING_RADIO = 'radio-88';
const missing = () => new AppError(404, 'PROGRAM_NOT_FOUND', 'Programa nao encontrado.');
export async function listPrograms(context: AuthorizationContext, after?: string) {
    const global = hasGlobalPermission(context, 'program.read');
    const linked = context.scopes.get('program.read')?.some(s => s.type === 'participation') ?? false;
    if (!global && !linked)
        throw new AppError(403, 'INSUFFICIENT_PERMISSION', 'Permissao insuficiente.');
    const result = await pool.query(`SELECT p.*,m.object_key AS "imageKey" FROM radio_program p LEFT JOIN media_asset m ON m.id=p.image_asset_id WHERE p.radio_key=$1
    AND ($2::boolean OR EXISTS(SELECT 1 FROM radio_program_host h WHERE h.radio_key=p.radio_key AND h.program_id=p.id
      AND h.admin_user_id=$3 AND h.active AND h.valid_from<=now() AND (h.valid_until IS NULL OR h.valid_until>now())))
    AND ($4::uuid IS NULL OR p.id>$4::uuid) ORDER BY p.id LIMIT 101`, [PROGRAMMING_RADIO, global, context.adminUserId, after ?? null]);
    return { items: result.rows.slice(0, 100).map(programDto), nextCursor: result.rows.length > 100 ? result.rows[99]?.id : null };
}
async function readable(context: AuthorizationContext, id: string) {
    const global = hasGlobalPermission(context, 'program.read');
    const linked = context.scopes.get('program.read')?.some(s => s.type === 'participation') ?? false;
    if (!global && !linked)
        throw missing();
    const result = await pool.query(`SELECT p.*,m.object_key AS "imageKey" FROM radio_program p LEFT JOIN media_asset m ON m.id=p.image_asset_id WHERE p.radio_key=$1 AND p.id=$2
    AND ($3::boolean OR EXISTS(SELECT 1 FROM radio_program_host h WHERE h.radio_key=p.radio_key AND h.program_id=p.id
      AND h.admin_user_id=$4 AND h.active AND h.valid_from<=now() AND (h.valid_until IS NULL OR h.valid_until>now())))`, [PROGRAMMING_RADIO, id, global, context.adminUserId]);
    if (!result.rows[0])
        throw missing();
    return programDto(result.rows[0]);
}
const slotsSql = `SELECT id,program_id AS "programId",radio_key AS "radioKey",weekday,start_minute AS "startMinute",end_minute AS "endMinute",
 valid_from::text AS "validFrom",valid_until::text AS "validUntil",active,version FROM radio_program_slot`;
export async function getProgram(context: AuthorizationContext, id: string) {
    const program = await readable(context, id);
    const slots = await pool.query(slotsSql + ' WHERE radio_key=$1 AND program_id=$2 ORDER BY weekday,start_minute,id', [PROGRAMMING_RADIO, id]);
    const hosts = await pool.query(`SELECT h.admin_user_id AS "adminUserId",u.name,h.active,h.valid_from AS "validFrom",h.valid_until AS "validUntil"
    FROM radio_program_host h JOIN admin_user u ON u.id=h.admin_user_id WHERE h.radio_key=$1 AND h.program_id=$2 ORDER BY u.name`, [PROGRAMMING_RADIO, id]);
    return { program, slots: slots.rows, hosts: hosts.rows };
}
async function write<T>(context: AuthorizationContext, key: string, resourceId: string | null, action: string, operation: (c: PoolClient) => Promise<T>): Promise<T> {
    if (!hasGlobalPermission(context, key))
        throw new AppError(403, 'INSUFFICIENT_PERMISSION', 'Permissao global necessaria.');
    const c = await pool.connect();
    try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(881188,12)');
        const session = await c.query(`SELECT u.id FROM admin_user u JOIN admin_session s ON s.admin_user_id=u.id
      WHERE u.id=$1 AND u.active AND u.authz_version=$2 AND s.id=$3 AND s.authz_version=u.authz_version
      AND s.revoked_at IS NULL AND s.expires_at>now() FOR SHARE OF u,s`, [context.adminUserId, context.authzVersion, context.sessionId]);
        if (!session.rowCount)
            throw new AppError(401, 'ADMIN_SESSION_INVALID', 'Sessao revogada.');
        await c.query('SELECT key FROM radio_programming_scope WHERE key=$1 FOR UPDATE', [PROGRAMMING_RADIO]);
        const result = await operation(c);
        await c.query(`INSERT INTO admin_audit_log(admin_user_id,action,resource_type,resource_id,metadata)
      VALUES($1,$2,'radio_program',$3,$4::jsonb)`, [context.adminUserId, action, resourceId ?? (result as {
                id?: string;
            })?.id ?? null, JSON.stringify({ radioKey: PROGRAMMING_RADIO, change: result })]);
        await enqueueProgramming(c);
        await c.query('COMMIT');
        return result;
    }
    catch (error) {
        await c.query('ROLLBACK');
        throw error;
    }
    finally {
        c.release();
    }
}
function programDto(row:Record<string,any>){return {...row,imageAssetId:row.image_asset_id??null,imageUrl:row.imageKey&&env.R2_PUBLIC_BASE_URL?env.R2_PUBLIC_BASE_URL.replace(/\/$/,'')+'/'+row.imageKey:null};}
export function saveProgram(context: AuthorizationContext,input:z.infer<typeof programInput>|z.infer<typeof programUpdate>,id?:string){
 return write(context,'program.manage',id??null,id?'program.updated':'program.created',async c=>{
  let imageKey:string|null=null;
  if(input.imageAssetId){
   const asset=await c.query(`SELECT m.object_key FROM media_asset m WHERE m.id=$1 AND m.status='ready' AND (m.created_by_admin_user_id=$2 OR EXISTS(SELECT 1 FROM radio_program p WHERE p.id=$3 AND p.radio_key=$4 AND p.image_asset_id=m.id))`,[input.imageAssetId,context.adminUserId,id??null,PROGRAMMING_RADIO]);
   imageKey=asset.rows[0]?.object_key??null;
   if(!imageKey?.startsWith('programs/'+programmingNamespace()+'/'))throw new AppError(422,'INVALID_PROGRAM_IMAGE','Imagem indisponivel para este programa.');
  }
  const values=[PROGRAMMING_RADIO,input.name,input.slug,input.description,input.active,JSON.stringify(input.presenters),input.imageAssetId];
  const result=id?await c.query(`UPDATE radio_program SET name=$2,slug=$3,description=$4,active=$5,presenters=$6,image_asset_id=$7,version=version+1,updated_at=now() WHERE radio_key=$1 AND id=$8 AND version=$9 RETURNING *`,[...values,id,'version' in input?input.version:0]):await c.query(`INSERT INTO radio_program(radio_key,name,slug,description,active,presenters,image_asset_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,values);
  if(!result.rows[0])throw new AppError(409,'VERSION_CONFLICT','Programa alterado ou indisponivel. Atualize a tela.');
  return programDto({...result.rows[0],imageKey});
 });
}
async function putSlot(c:PoolClient,programId:string,input:z.infer<typeof slotInput>|z.infer<typeof slotUpdate>,slotId?:string){
        if (!(await c.query('SELECT id FROM radio_program WHERE radio_key=$1 AND id=$2', [PROGRAMMING_RADIO, programId])).rowCount)
            throw missing();
        if (input.active) {
            const others = await c.query<WeeklySlot>(slotsSql + ' WHERE radio_key=$1 AND active AND ($2::uuid IS NULL OR id<>$2::uuid)', [PROGRAMMING_RADIO, slotId ?? null]);
            if (others.rows.some(other => schedulesConflict(input, other)))
                throw new AppError(409, 'SCHEDULE_CONFLICT', 'Horario em conflito com a grade existente.');
        }
        const args = [PROGRAMMING_RADIO, programId, input.weekday, input.startMinute, input.endMinute, input.validFrom, input.validUntil, input.active];
        const result = slotId ? await c.query(`UPDATE radio_program_slot SET weekday=$3,start_minute=$4,end_minute=$5,valid_from=$6,valid_until=$7,active=$8,version=version+1,updated_at=now()
      WHERE radio_key=$1 AND program_id=$2 AND id=$9 AND version=$10 RETURNING id`, [...args, slotId, 'version' in input ? input.version : 0])
            : await c.query(`INSERT INTO radio_program_slot(radio_key,program_id,weekday,start_minute,end_minute,valid_from,valid_until,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, args);
        if (!result.rows[0])
            throw new AppError(409, 'VERSION_CONFLICT', 'Horario alterado ou indisponivel. Atualize a tela.');
        return { ...result.rows[0], ...input };

}
export function saveSlot(context:AuthorizationContext,programId:string,input:z.infer<typeof slotInput>|z.infer<typeof slotUpdate>,slotId?:string){return write(context,'schedule.manage',programId,'program.slot.saved',c=>putSlot(c,programId,input,slotId));}
export function saveSlotBatch(context:AuthorizationContext,programId:string,input:z.infer<typeof slotBatchInput>){return write(context,'schedule.manage',programId,'program.slots.saved',async c=>{const items=[];for(const weekday of input.weekdays)items.push(await putSlot(c,programId,{...input.slot,weekday}));return {items};});}
export function saveHost(context: AuthorizationContext, programId: string, userId: string, input: z.infer<typeof hostInput>) {
    return write(context, 'program.host.manage', programId, 'program.host.saved', async (c) => {
        if (!(await c.query('SELECT id FROM radio_program WHERE radio_key=$1 AND id=$2', [PROGRAMMING_RADIO, programId])).rowCount)
            throw missing();
        if (!(await c.query('SELECT id FROM admin_user WHERE id=$1 AND ($2::boolean=false OR active)', [userId, input.active])).rowCount)
            throw new AppError(422, 'HOST_INACTIVE', 'Usuario inexistente ou inativo.');
        await c.query(`INSERT INTO radio_program_host(radio_key,program_id,admin_user_id,active,valid_from,valid_until) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(radio_key,program_id,admin_user_id) DO UPDATE SET active=excluded.active,valid_from=excluded.valid_from,valid_until=excluded.valid_until,updated_at=now()`, [PROGRAMMING_RADIO, programId, userId, input.active, input.validFrom, input.validUntil]);
        return { saved: true, adminUserId: userId, ...input };
    });
}
export async function simulateProgramming(context: AuthorizationContext, at: Date) {
    if (!hasGlobalPermission(context, 'schedule.manage'))
        throw new AppError(403, 'INSUFFICIENT_PERMISSION', 'Permissao insuficiente.');
    const slots = await pool.query<WeeklySlot & { programName: string }>(`SELECT p.name AS "programName",s.id,s.radio_key AS "radioKey",s.program_id AS "programId",s.weekday,s.start_minute AS "startMinute",s.end_minute AS "endMinute",s.valid_from::text AS "validFrom",s.valid_until::text AS "validUntil",s.active,p.active AS "programActive" FROM radio_program_slot s JOIN radio_program p ON (p.radio_key,p.id)=(s.radio_key,s.program_id) WHERE s.radio_key=$1`, [PROGRAMMING_RADIO]);
    const current = resolveOnAir({ at, radioKey: PROGRAMMING_RADIO, slots: slots.rows, exceptions: await programmingExceptions() });
    return { at: at.toISOString(), timezone: 'America/Sao_Paulo', current: current ? { ...current, name: (await pool.query('SELECT name FROM radio_program WHERE radio_key=$1 AND id=$2',[PROGRAMMING_RADIO,current.programId])).rows[0]?.name } : null };
}
export async function eligibleProgramHosts(context: AuthorizationContext, programId: string) {
    if (!hasGlobalPermission(context, 'program.host.manage'))
        throw new AppError(403, 'INSUFFICIENT_PERMISSION', 'Permissao insuficiente.');
    if (!(await pool.query('SELECT id FROM radio_program WHERE radio_key=$1 AND id=$2', [PROGRAMMING_RADIO, programId])).rowCount)
        throw missing();
    return { items: (await pool.query('SELECT id,name FROM admin_user WHERE active ORDER BY name,id LIMIT 100')).rows };
}

export async function programmingExceptions(){return (await pool.query(`SELECT o.id,o.radio_key AS "radioKey",o.program_id AS "programId",o.active,o.starts_at AS "startsAt",o.ends_at AS "endsAt",p.active AS "programActive",p.name AS "programName",o.reason,o.version FROM radio_program_override o LEFT JOIN radio_program p ON (p.radio_key,p.id)=(o.radio_key,o.program_id) WHERE o.radio_key=$1 ORDER BY o.starts_at`,[PROGRAMMING_RADIO])).rows.map(row=>({...row,startsAt:row.startsAt.toISOString(),endsAt:row.endsAt.toISOString()}));}
export function saveProgrammingOverride(context:AuthorizationContext,input:z.infer<typeof overrideInput>|z.infer<typeof overrideUpdate>,id?:string){return write(context,'schedule.manage',id??null,'programming.override.saved',async c=>{
 if(input.programId&&!(await c.query('SELECT id FROM radio_program WHERE radio_key=$1 AND id=$2',[PROGRAMMING_RADIO,input.programId])).rowCount)throw missing();
 if(input.active&&(await c.query(`SELECT id FROM radio_program_override WHERE radio_key=$1 AND active AND ($2::uuid IS NULL OR id<>$2::uuid) AND starts_at<$4 AND ends_at>$3`,[PROGRAMMING_RADIO,id??null,input.startsAt,input.endsAt])).rowCount)throw new AppError(409,'OVERRIDE_CONFLICT','Existe outra excecao neste periodo.');
 const args=[PROGRAMMING_RADIO,input.programId,input.startsAt,input.endsAt,input.reason,input.active];
 const result=id?await c.query(`UPDATE radio_program_override SET program_id=$2,starts_at=$3,ends_at=$4,reason=$5,active=$6,version=version+1,updated_at=now() WHERE radio_key=$1 AND id=$7 AND version=$8 RETURNING id`,[...args,id,'version' in input?input.version:0]):await c.query(`INSERT INTO radio_program_override(radio_key,program_id,starts_at,ends_at,reason,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,args);
 if(!result.rows[0])throw new AppError(409,'VERSION_CONFLICT','Excecao alterada. Atualize a tela.');return {...result.rows[0],...input};
});}
export async function programmingWeek(context:AuthorizationContext){
 if(!hasGlobalPermission(context,'schedule.manage'))throw new AppError(403,'INSUFFICIENT_PERMISSION','Permissao insuficiente.');
 const result=await pool.query(`SELECT s.id,s.program_id AS "programId",p.name AS "programName",s.weekday,s.start_minute AS "startMinute",s.end_minute AS "endMinute",s.valid_from::text AS "validFrom",s.valid_until::text AS "validUntil",s.active,s.version FROM radio_program_slot s JOIN radio_program p ON (p.radio_key,p.id)=(s.radio_key,s.program_id) WHERE s.radio_key=$1 ORDER BY s.weekday,s.start_minute,s.id LIMIT 5000`,[PROGRAMMING_RADIO]);
 return {items:result.rows};
}
