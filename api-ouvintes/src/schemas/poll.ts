import { z } from 'zod';
export const pollState=z.enum(['draft','scheduled','published','closed','archived','canceled']);
const shape=z.object({
 slug:z.string().max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
 question:z.string().trim().min(3).max(500),context:z.string().max(2000),
 mode:z.enum(['vote','message','mixed']).optional(),
 imageUrl:z.url().max(2048).refine(v=>/^https?:\/\//.test(v)).optional(),
 identificationPolicy:z.enum(['anonymous','optional','required']),allowMessage:z.boolean(),
 options:z.array(z.string().trim().min(1).max(300)).max(10)
  .refine(items=>new Set(items.map(s=>s.toLocaleLowerCase('pt-BR'))).size===items.length,'Alternativas devem ser distintas.'),
 editionStartsAt:z.iso.datetime({offset:true}),editionEndsAt:z.iso.datetime({offset:true}),
 startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),
}).strict().refine(v=>v.mode==='message'?v.options.length===0:v.options.length>=2,
 {message:'Message exige zero alternativas; demais modos exigem 2..10.',path:['options']});
// Missing mode supports legacy allowMessage=false without silently enabling messages.
function deriveMode<T extends {mode?:'vote'|'message'|'mixed';allowMessage:boolean}>(value:T){
 const mode=value.mode??(value.allowMessage?'mixed':'vote');return {...value,mode,allowMessage:mode!=='vote'};
}
export const pollInput=shape.transform(deriveMode);
export const pollUpdate=shape.safeExtend({version:z.number().int().positive()}).transform(deriveMode);
export const pollCommand=z.object({version:z.number().int().positive()}).strict();
export type PollInput=z.infer<typeof pollInput>;
