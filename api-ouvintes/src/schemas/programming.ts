import { z } from 'zod';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const d = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, 'Data invalida');
export const programInput = z.object({
    name: z.string().trim().min(2).max(160), slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    presenters: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    imageAssetId: z.uuid().nullable().default(null),
    description: z.string().trim().max(1000).default(''), active: z.boolean().default(true),
}).strict();
export const programUpdate = programInput.extend({ version: z.number().int().positive() });
export const slotInput = z.object({
    weekday: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(0).max(1439),
    validFrom: date, validUntil: date.nullable().default(null), active: z.boolean().default(true),
}).strict().refine(v => v.startMinute !== v.endMinute, 'Inicio e fim precisam ser diferentes')
    .refine(v => v.validUntil === null || v.validUntil >= v.validFrom, 'Vigencia invalida');
export const slotUpdate = slotInput.safeExtend({ version: z.number().int().positive() });
export const hostInput = z.object({ active: z.boolean(), validFrom: z.iso.datetime({ offset: true }), validUntil: z.iso.datetime({ offset: true }).nullable() }).strict()
    .refine(v => v.validUntil === null || Date.parse(v.validUntil) > Date.parse(v.validFrom), 'Vigencia invalida');

export const overrideInput=z.object({programId:z.uuid().nullable(),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),reason:z.string().trim().min(5).max(500),active:z.boolean().default(true)}).strict().refine(v=>Date.parse(v.endsAt)>Date.parse(v.startsAt),'Periodo invalido');
export const overrideUpdate=overrideInput.safeExtend({version:z.number().int().positive()});
export const slotBatchInput=z.object({weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(a=>new Set(a).size===a.length),slot:slotInput}).strict();
