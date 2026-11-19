import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../lib/errors.js';
const publicSchema=z.object({
 id:z.uuid(),slug:z.string(),programId:z.uuid(),programName:z.string(),question:z.string(),context:z.string(),
 mode:z.enum(['vote','message','mixed']),imageUrl:z.string().optional(),
 identificationPolicy:z.enum(['anonymous','optional','required']),allowMessage:z.boolean(),
 options:z.array(z.object({id:z.uuid(),text:z.string()}).strict()),
 editionStartsAt:z.iso.datetime({offset:true}),editionEndsAt:z.iso.datetime({offset:true}),
 startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),
}).strict();
export type PublicPollDto=z.infer<typeof publicSchema>;
export function publicPollDto(p:Record<string,any>):PublicPollDto{
 return publicSchema.parse({id:p.id,slug:p.slug,programId:p.programId,programName:p.programName,
 question:p.question,context:p.context,mode:p.mode??'mixed',...(p.imageUrl?{imageUrl:p.imageUrl}:{}),
 identificationPolicy:p.identificationPolicy,allowMessage:p.allowMessage,options:p.options,
 editionStartsAt:p.editionStartsAt,editionEndsAt:p.editionEndsAt,startsAt:p.startsAt,endsAt:p.endsAt});
}
const fileSchema=z.array(z.object({poll:publicSchema,state:z.enum(['scheduled','published'])}).strict());
// One explicit local publisher; immutable copies, atomic file replacement, no DB read fallback or timer.
export class LocalPollSnapshotStore {
 private entries:z.infer<typeof fileSchema>=[];
 private loaded=false;
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private path?:string){}
 private async load(){
  if(this.loaded)return;
  if(this.path){try{this.entries=fileSchema.parse(JSON.parse(await readFile(this.path,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw new AppError(503,'POLL_SNAPSHOT_UNAVAILABLE','Snapshot local indisponivel.');}}
  this.loaded=true;
 }
 async publish(value:PublicPollDto,state:string){
  const task=this.queue.then(async()=>{
   await this.load();const poll=publicSchema.parse(value);
   const remaining=this.entries.filter(e=>e.poll.id!==poll.id);
   if(remaining.some(e=>e.poll.slug===poll.slug))throw new AppError(409,'POLL_SLUG_AMBIGUOUS','Slug publico ja utilizado.');
   const next=[...remaining,...(state==='published'?[{poll,state:state as 'scheduled'|'published'}]:[])];
   if(this.path){await mkdir(dirname(this.path),{recursive:true});const temp=this.path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,this.path);}
   this.entries=next;
  });
  this.queue=task.catch(()=>{});await task;
 }
 async bySlug(slug:string,now=new Date()){await this.queue;await this.load();const p=this.entries.find(e=>e.state==='published'&&e.poll.slug===slug)?.poll;return p&&now.getTime()<Date.parse(p.endsAt)?structuredClone(p):null;}
 async active(programId:string,now=new Date()){
  await this.queue;await this.load();
  const entries=this.entries.filter(e=>e.state==='published'&&e.poll.programId===programId&&Date.parse(e.poll.startsAt)<=now.getTime()&&now.getTime()<Date.parse(e.poll.endsAt));
  if(entries.length!==1)return null;return structuredClone(entries[0]!.poll);
 }
}
