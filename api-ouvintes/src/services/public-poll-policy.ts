import {AppError} from '../lib/errors.js';
import type {PollSubmissionInput} from '../schemas/public-poll.js';
export function validatePollSubmission(p:{mode:string;allow_message:boolean;identification_policy:string},s:PollSubmissionInput){
 const invalid=()=>new AppError(400,'INVALID_POLL_SUBMISSION','Conteudo incompativel com esta enquete.');
 if(!s.optionId&&!s.message)throw invalid();
 if(p.mode==='vote'&&(!s.optionId||s.message))throw invalid();
 if(p.mode==='message'&&(!s.message||s.optionId))throw invalid();
 if(p.mode==='mixed'&&!s.optionId)throw invalid();
 if(p.identification_policy==='required'&&!s.identified)throw new AppError(400,'POLL_IDENTIFICATION_REQUIRED','Identificacao obrigatoria.');
 if(p.identification_policy==='anonymous'&&s.identified)throw invalid();
 if((s.identified||s.message)&&s.privacyAccepted!==true)throw new AppError(400,'PRIVACY_ACCEPTANCE_REQUIRED','Aceite de privacidade obrigatorio.');
}
