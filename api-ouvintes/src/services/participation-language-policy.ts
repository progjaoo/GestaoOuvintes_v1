/** First-pass lexical protection, not a classifier of intent or a substitute for human review. */
const blockedTokens = new Set(['porra', 'merda', 'foder', 'foda', 'fudido', 'fodido', 'caralho', 'puta', 'puto', 'buceta', 'cacete', 'cuzao']);
const substitutions: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };
export type LanguageInspection = { allowed: true } | { allowed: false; code: 'INAPPROPRIATE_LANGUAGE'; message: string };
export function inspectParticipationLanguage(message: string): LanguageInspection {
  const normalized = message.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').toLocaleLowerCase('pt-BR');
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const blocked = tokens.some(token => blockedTokens.has(token.replace(/[013457]/g, digit => substitutions[digit]!)));
  if (!blocked) return { allowed: true };
  return { allowed: false, code: 'INAPPROPRIATE_LANGUAGE', message: 'Sua opinião é bem-vinda. Reformule a mensagem sem palavrões ou ofensas e tente novamente.' };
}
