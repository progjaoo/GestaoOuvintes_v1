import {z} from 'zod';
const label=(max:number)=>z.string().trim().min(2).max(max).regex(/^[^\u0000-\u001f\u007f]*$/);
export const pollIdentityInput=z.union([
 z.object({}).strict(),
 z.object({name:label(160),neighborhood:label(120),city:label(120),
  phone:z.string().trim().max(30).regex(/^[+()\d .-]+$/).refine(v=>{const n=v.replace(/\D/g,'');return n.length>=10&&n.length<=15;}),
  privacyAccepted:z.literal(true)}).strict(),
]);
export const pollSubmissionInput=z.object({
 submissionId:z.uuid(),optionId:z.uuid().optional(),
 message:z.string().trim().min(1).max(4000).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/).optional(),
 identified:z.boolean(),privacyAccepted:z.boolean().optional(),
}).strict();
export type PollIdentityInput=z.infer<typeof pollIdentityInput>;
export type PollSubmissionInput=z.infer<typeof pollSubmissionInput>;
