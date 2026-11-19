import {randomUUID} from 'node:crypto';
import {env} from '../config/env.js';
import {pool} from '../database/client.js';
import {AppError} from '../lib/errors.js';
import {processBannerImage} from './media-storage/media-image-processor.js';
import {R2MediaStorage} from './media-storage/r2-media-storage.js';
import {programmingNamespace} from './programming-public-snapshot.js';
export async function uploadProgramImage(buffer:Buffer,filename:string,actorId:string){
 if(!env.PROGRAMMING_PUBLICATION_ENABLED)throw new AppError(503,'PROGRAMMING_STORAGE_DISABLED','Armazenamento de programas desativado.');
 if(buffer.length>10*1024*1024)throw new AppError(413,'IMAGE_TOO_LARGE','Envie uma imagem de ate 10 MiB.');
 const namespace=programmingNamespace(),processed=await processBannerImage(buffer,filename),storage=new R2MediaStorage();
 const key=`programs/${namespace}/${randomUUID()}.webp`;
 const uploaded=await storage.put({key,body:processed.buffer,contentType:'image/webp',cacheControl:'public,max-age=31536000,immutable'});
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const result=await c.query(`INSERT INTO media_asset(object_key,original_name,mime_type,byte_size,width,height,etag,status,created_by_admin_user_id) VALUES($1,$2,'image/webp',$3,$4,$5,$6,'ready',$7) RETURNING id`,[key,processed.originalName,processed.buffer.length,processed.width,processed.height,uploaded.etag,actorId]);
  await c.query("INSERT INTO admin_audit_log(admin_user_id,action,resource_type,resource_id,metadata) VALUES($1,'program.image.uploaded','media_asset',$2,$3::jsonb)",[actorId,result.rows[0].id,JSON.stringify({width:processed.width,height:processed.height})]);
  await c.query('COMMIT');
  return {id:result.rows[0].id,imageUrl:storage.publicUrl(key),width:processed.width,height:processed.height};
 }catch(error){await c.query('ROLLBACK');await storage.delete(key).catch(()=>{});throw error;}finally{c.release();}
}
