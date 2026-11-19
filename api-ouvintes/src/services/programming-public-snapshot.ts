// Public read adapter: this module must never import database/client or an admin service.
import {GetObjectCommand,PutObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {programmingSnapshotSchema,type ProgrammingSnapshot} from './programming-contract.js';
export {programmingSnapshotSchema,type ProgrammingSnapshot} from './programming-contract.js';
import {env} from '../config/env.js';
import {AppError} from '../lib/errors.js';
let client:S3Client|undefined;
let cache:{value:ProgrammingSnapshot;expires:number}|undefined;
export function programmingNamespace(){
 const namespace=env.PROGRAMMING_NAMESPACE;
 if(!namespace)throw new AppError(503,'PROGRAMMING_NAMESPACE_MISSING','Namespace de programacao nao configurado.');
 if(namespace.startsWith('preview/')&&env.R2_BUCKET_NAME!=='radio88-feed-preview-public')throw new AppError(503,'PROGRAMMING_BUCKET_INVALID','Bucket de Preview incorreto.');
 if(namespace.startsWith('production/')&&env.VERCEL_ENV!=='production')throw new AppError(503,'PROGRAMMING_ENV_INVALID','Publicacao de producao nao permitida neste ambiente.');
 return namespace;
}
function storage(){
 if(!env.PROGRAMMING_PUBLICATION_ENABLED||!env.R2_ACCOUNT_ID||!env.R2_ACCESS_KEY_ID||!env.R2_SECRET_ACCESS_KEY||!env.R2_PUBLIC_BASE_URL)throw new AppError(503,'PROGRAMMING_STORAGE_DISABLED','Armazenamento de programacao indisponivel.');
 programmingNamespace();
 return client??=new S3Client({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}});
}
export function programmingPrefix(){return `programming/v1/${programmingNamespace()}`;}
export async function putProgrammingSnapshot(snapshot:ProgrammingSnapshot){
 const payload=programmingSnapshotSchema.parse(snapshot),body=JSON.stringify(payload),s3=storage(),signal=AbortSignal.timeout(6000);
 if(payload.namespace!==programmingNamespace())throw new Error('Snapshot namespace mismatch');
 // Immutable object first; current is updated only after the complete object exists.
 await s3.send(new PutObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:`${programmingPrefix()}/releases/${payload.revision}.json`,Body:body,ContentType:'application/json',CacheControl:'public,max-age=31536000,immutable'}),{abortSignal:signal});
 await s3.send(new PutObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:`${programmingPrefix()}/current.json`,Body:body,ContentType:'application/json',CacheControl:'public,max-age=60'}),{abortSignal:signal});
 cache={value:payload,expires:Date.now()+15_000};
}
export async function readProgrammingSnapshot():Promise<ProgrammingSnapshot>{
 if(cache&&cache.expires>Date.now()&&Date.parse(cache.value.validUntil)>Date.now())return cache.value;
 try{
  const signal=AbortSignal.timeout(6000);
  const result=await storage().send(new GetObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:`${programmingPrefix()}/current.json`}),{abortSignal:signal});
  if(!result.Body||(result.ContentLength??0)>2_000_000)throw new Error('Invalid snapshot size');
  const body=await result.Body.transformToString();if(body.length>2_000_000)throw new Error('Invalid snapshot size');
  const value=programmingSnapshotSchema.parse(JSON.parse(body));
  if(value.namespace!==programmingNamespace()||Date.parse(value.validUntil)<=Date.now())throw new Error('Expired snapshot');
  cache={value,expires:Date.now()+15_000};return value;
 }catch{throw new AppError(503,'PROGRAMMING_PUBLIC_UNAVAILABLE','Programacao temporariamente indisponivel.');}
}
