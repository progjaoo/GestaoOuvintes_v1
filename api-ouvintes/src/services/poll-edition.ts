import { AppError } from '../lib/errors.js';
import { resolveOnAir, type WeeklySlot, type ProgrammingException } from './programming-resolver.js';
const radioKey = 'radio-88';
const local = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function minute(at:number) {
  const p=Object.fromEntries(local.formatToParts(new Date(at)).map(p=>[p.type,p.value]));
  return Number(p.hour)*60+Number(p.minute)+Number(p.second)/60;
}
// Verify actual source boundaries, not merely that the requested program is on air at one instant.
export function assertConcreteEdition(programId:string,startsAt:string,endsAt:string,slots:WeeklySlot[],exceptions:ProgrammingException[]) {
  const start=Date.parse(startsAt),end=Date.parse(endsAt);
  const invalid=()=>new AppError(422,'INVALID_POLL_EDITION','Edicao nao corresponde a grade atual.');
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>48*3600000)throw invalid();
  try {
    const resolve=(at:number)=>resolveOnAir({at:new Date(at),radioKey,slots,exceptions});
    const match=resolve(start);
    if(!match||match.programId!==programId)throw invalid();
    if(match.source==='exception') {
      const e=exceptions.find(e=>e.id===match.sourceId)!;
      if(Date.parse(e.startsAt)!==start||Date.parse(e.endsAt)!==end)throw invalid();
      if(exceptions.some(other=>other.id!==e.id&&other.active&&other.radioKey===radioKey&&Date.parse(other.startsAt)<end&&Date.parse(other.endsAt)>start))throw invalid();
    } else {
      const slot=slots.find(s=>s.id===match.sourceId)!;
      if(start%60000||end%60000||minute(start)!==slot.startMinute||minute(end)!==slot.endMinute||end-start>25*3600000)throw invalid();
      if(exceptions.some(e=>e.active&&e.radioKey===radioKey&&Date.parse(e.startsAt)<end&&Date.parse(e.endsAt)>start))throw invalid();
    }
    const same=(at:number)=>{const r=resolve(at);return r?.source===match.source&&r.sourceId===match.sourceId&&r.programId===programId;};
    if(!same(end-1)||same(start-1)||same(end))throw invalid();
  } catch { throw invalid(); }
}
