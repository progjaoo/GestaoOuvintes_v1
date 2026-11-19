import {z} from 'zod';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const programmingSnapshotSchema=z.object({
 schemaVersion:z.literal(1),radioKey:z.literal('radio-88'),namespace:z.string().regex(/^(preview|production|development|test)\/radio-88$/),
 revision:z.number().int().positive().safe(),generatedAt:z.iso.datetime(),validUntil:z.iso.datetime(),timezone:z.literal('America/Sao_Paulo'),
 programs:z.array(z.object({id:z.uuid(),name:z.string().max(160),slug:z.string(),description:z.string().max(1000),presenters:z.array(z.string().max(120)).max(20),imageUrl:z.url().nullable(),imageEdgeColor:z.string().regex(/^#[0-9a-f]{6}$/i).optional()}).strict()).max(500),
 slots:z.array(z.object({id:z.uuid(),programId:z.uuid(),weekday:z.number().int().min(0).max(6),startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(0).max(1439),validFrom:date,validUntil:date.nullable()}).strict().refine(s=>s.startMinute!==s.endMinute)).max(5000),
 exceptions:z.array(z.object({id:z.uuid(),programId:z.uuid().nullable(),startsAt:z.iso.datetime(),endsAt:z.iso.datetime()}).strict().refine(v=>Date.parse(v.endsAt)>Date.parse(v.startsAt))).max(500),
}).strict().superRefine((value,ctx)=>{
 if(Date.parse(value.validUntil)<=Date.parse(value.generatedAt))ctx.addIssue({code:'custom',message:'Invalid snapshot lifetime'});
 const ids=new Set(value.programs.map(p=>p.id));
 if(ids.size!==value.programs.length||value.slots.some(s=>!ids.has(s.programId))||value.exceptions.some(e=>e.programId&&!ids.has(e.programId)))ctx.addIssue({code:'custom',message:'Invalid program references'});
});
export type ProgrammingSnapshot=z.infer<typeof programmingSnapshotSchema>;
