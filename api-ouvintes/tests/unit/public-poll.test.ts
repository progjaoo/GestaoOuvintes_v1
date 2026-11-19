import {describe, it, expect, vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {pollInput} from '../../src/schemas/poll.js';
import {pollIdentityInput, pollSubmissionInput} from '../../src/schemas/public-poll.js';
import {validatePollSubmission} from '../../src/services/public-poll-policy.js';
import {publicPollDto, LocalPollSnapshotStore} from '../../src/services/public-poll-snapshot.js';
const base={slug:'test',question:'Question?',context:'',identificationPolicy:'optional',allowMessage:true,options:['A','B'],editionStartsAt:'2026-11-11T08:00:00Z',editionEndsAt:'2026-11-11T12:00:00Z',startsAt:'2026-11-11T08:00:00Z',endsAt:'2026-11-11T12:00:00Z'};
describe('public poll contract',()=>{
 it('defaults legacy mode and accepts message-only with zero options',()=>{
  expect(pollInput.parse(base).mode).toBe('mixed');
  expect(pollInput.parse({...base,allowMessage:false}).mode).toBe('vote');
  expect(pollInput.parse({...base,mode:'message',options:[]}).options).toEqual([]);
  for(const mode of ['vote','mixed'])expect(pollInput.safeParse({...base,mode,options:[]}).success).toBe(false);
  expect(pollInput.safeParse({...base,mode:'message'}).success).toBe(false);
 });
 it('validates optional image and strict identity/consent',()=>{
  expect(pollInput.safeParse({...base,imageUrl:'https://example.com/poll.jpg'}).success).toBe(true);
  expect(pollInput.safeParse({...base,imageUrl:'javascript:alert(1)'}).success).toBe(false);
  expect(pollIdentityInput.parse({})).toEqual({});
  expect(pollIdentityInput.safeParse({phone:'11999999999'}).success).toBe(false);
  expect(pollIdentityInput.safeParse({name:'Teste',neighborhood:'Centro',city:'Cidade',phone:'11999999999',privacyAccepted:true}).success).toBe(true);
 });
 it('accepts plain text up to 4000 including profanity without a lexical filter',()=>{
  const input={submissionId:randomUUID(),identified:false,message:'palavrao porra <b>texto literal</b>'};
  expect(pollSubmissionInput.parse(input).message).toBe(input.message);
  expect(pollSubmissionInput.safeParse({...input,message:'x'.repeat(4000)}).success).toBe(true);
  expect(pollSubmissionInput.safeParse({...input,message:'x'.repeat(4001)}).success).toBe(false);
  expect(pollSubmissionInput.safeParse({...input,message:'\u0000'}).success).toBe(false);
 });
 it('enforces modes, identity policy, consent and nonempty content',()=>{
  const sub={submissionId:randomUUID(),identified:false};
  const policy={mode:'mixed',allow_message:true,identification_policy:'optional'};
  expect(()=>validatePollSubmission(policy,sub)).toThrow();
  expect(()=>validatePollSubmission(policy,{...sub,optionId:randomUUID(),message:'Oi',privacyAccepted:true})).not.toThrow();
  expect(()=>validatePollSubmission({...policy,mode:'vote'},{...sub,message:'Oi'})).toThrow();
  expect(()=>validatePollSubmission({...policy,mode:'message'},{...sub,optionId:randomUUID(),message:'Oi'})).toThrow();
  expect(()=>validatePollSubmission({...policy,identification_policy:'required'},{...sub,message:'Oi'})).toThrow();
  expect(()=>validatePollSubmission(policy,{...sub,message:'Oi',identified:true})).toThrow();
  expect(()=>validatePollSubmission(policy,{...sub,optionId:randomUUID(),message:'Oi',identified:true,privacyAccepted:true})).not.toThrow();
 });
 it('projects only allowlisted public fields and serves memory without DB',async()=>{
  const row={...base,options:[{id:randomUUID(),text:'A'},{id:randomUUID(),text:'B'}],id:randomUUID(),programId:randomUUID(),programName:'Programa',mode:'mixed',phone:'secret',message:'private',neighborhood:'private',state:'published'};
  const value=publicPollDto(row);
  expect(value).not.toHaveProperty('phone');expect(value).not.toHaveProperty('state');expect(value).not.toHaveProperty('neighborhood');
  const store=new LocalPollSnapshotStore();await store.publish(value,'published');
  expect(await store.bySlug('test',new Date('2026-11-11T09:00:00Z'))).toEqual(value);
  expect(await store.active(row.programId,new Date('2026-11-11T09:00:00Z'))).toEqual(value);
  expect(await store.active(row.programId,new Date(base.endsAt))).toBeNull();
  expect(await store.bySlug('test',new Date(base.endsAt))).toBeNull();
  await store.publish(value,'scheduled');expect(await store.active(row.programId,new Date('2026-11-11T09:00:00Z'))).toBeNull();
  await store.publish(value,'closed');expect(await store.bySlug('test')).toBeNull();
 });
});
