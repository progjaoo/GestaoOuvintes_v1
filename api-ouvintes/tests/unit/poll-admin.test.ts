import {describe,it,expect} from 'vitest';
import {pollInput} from '../../src/schemas/poll.js';
import {assertConcreteEdition} from '../../src/services/poll-edition.js';
const start='2026-11-09T08:00:00Z',end='2026-11-09T12:30:00Z';
const slot={id:'slot',radioKey:'radio-88',programId:'program',active:true,programActive:true,weekday:1,startMinute:300,endMinute:570,validFrom:'2026-01-01',validUntil:null};
describe('poll administrative validation',()=>{
 it('requires offset and distinct 2..10 options',()=>{
 const input={slug:'test',question:'Question',context:'',identificationPolicy:'optional',allowMessage:false,options:['A','B'],editionStartsAt:start,editionEndsAt:end,startsAt:start,endsAt:end};
 expect(pollInput.safeParse(input).success).toBe(true);
 for(const options of [['A'],['A',' A '],Array(11).fill('A')])expect(pollInput.safeParse({...input,options}).success).toBe(false);
 expect(pollInput.safeParse({...input,startsAt:'2026-11-09T08:00:00'}).success).toBe(false);
 });
 it('accepts exact edition but rejects clipped boundaries',()=>{
 expect(()=>assertConcreteEdition('program',start,end,[slot],[])).not.toThrow();
 expect(()=>assertConcreteEdition('program','2026-11-09T08:01:00Z',end,[slot],[])).toThrow();
 });
 it('rejects interruption inside weekly edition',()=>{
 expect(()=>assertConcreteEdition('program',start,end,[slot],[{id:'break',radioKey:'radio-88',programId:null,programActive:false,active:true,startsAt:'2026-11-09T09:00:00Z',endsAt:'2026-11-09T09:10:00Z'}])).toThrow();
 });
});

it('rejects conflicting interior override of an exception edition',()=>{
 const main={id:'main',radioKey:'radio-88',programId:'program',programActive:true,active:true,startsAt:start,endsAt:end};
 const interruption={...main,id:'inner',programId:null,startsAt:'2026-11-09T09:00:00Z',endsAt:'2026-11-09T10:00:00Z'};
 expect(()=>assertConcreteEdition('program',start,end,[],[main,interruption])).toThrow();
});
