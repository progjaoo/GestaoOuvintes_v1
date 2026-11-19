import { describe, expect, it } from 'vitest';
import { inspectParticipationLanguage } from '../../src/services/participation-language-policy.js';
describe('private participation language policy', () => {
  it.each(['Discordo, mas respeito sua opinião.', 'Minha opinião sobre os doramas é diferente.', 'A cidade de Campinas fica distante.'])('accepts civil disagreement without substring false positives: %s', message => {
    expect(inspectParticipationLanguage(message).allowed).toBe(true);
  });
  it.each(['Isso é uma porra!', 'P0RR4!', 'Que merda.', 'Vá se foder!', 'P\u200borra', 'Você é um filho da puta'])('rejects known explicit profanity without returning the message: %s', message => {
    const result = inspectParticipationLanguage(message);
    expect(result.allowed).toBe(false);
    expect(JSON.stringify(result)).not.toContain(message);
  });
  it('does not promise universal detection', () => {
    expect(inspectParticipationLanguage('Você não entende o assunto.')).toEqual({ allowed: true });
  });
});
