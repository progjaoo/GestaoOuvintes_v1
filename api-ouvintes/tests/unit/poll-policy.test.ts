import { describe, expect, it } from 'vitest';
import { pollWindow, assertPollTransition, assertPollStructureUnchanged, acceptsPollEntry } from '../../src/services/poll-policy.js';

const edition = { startsAt: '2026-11-14T23:00:00-03:00', endsAt: '2026-11-15T00:00:00-03:00' };
const window = { startsAt: '2026-11-14T23:10:00-03:00', endsAt: '2026-11-14T23:50:00-03:00' };
const structure = { question: 'Qual a sua escolha?', mode: 'anonymous' as const, options: [{ id: 'a', text: 'Primeira' }, { id: 'b', text: 'Segunda' }] };
describe('poll policy', () => {
  it('normalizes a contained overnight window to UTC', () => {
    expect(pollWindow(edition, window)).toEqual({ startsAt: '2026-11-15T02:10:00.000Z', endsAt: '2026-11-15T02:50:00.000Z' });
  });
  it.each([
    { ...window, startsAt: '2026-11-14T22:59:00-03:00' },
    { ...window, endsAt: '2026-11-15T00:01:00-03:00' },
    { ...window, endsAt: window.startsAt },
    { ...window, startsAt: 'invalid' },
    { ...window, startsAt: '2026-11-14T23:10:00' },
  ])('rejects invalid or out-of-edition windows: %j', input => {
    expect(() => pollWindow(edition, input)).toThrow();
  });
  it.each([
    ['2026-11-15T02:09:59Z', false], ['2026-11-15T02:10:00Z', true],
    ['2026-11-15T02:49:59Z', true], ['2026-11-15T02:50:00Z', false],
  ])('uses server-time half-open boundaries at %s', (now, expected) => {
    expect(acceptsPollEntry({ state: 'published', window, now: new Date(now), programEligible: true })).toBe(expected);
  });
  it('fails closed on interruption, closed state or invalid server clock', () => {
    const input = { state: 'published' as const, window, now: new Date('2026-11-15T02:20:00Z'), programEligible: true };
    expect(acceptsPollEntry({ ...input, programEligible: false })).toBe(false);
    expect(acceptsPollEntry({ ...input, state: 'closed' })).toBe(false);
    expect(acceptsPollEntry({ ...input, now: new Date(NaN) })).toBe(false);
  });
  it('permits preparation, publication, closing and archival', () => {
    expect(() => assertPollTransition('draft', 'scheduled')).not.toThrow();
    expect(() => assertPollTransition('scheduled', 'published')).not.toThrow();
    expect(() => assertPollTransition('published', 'closed')).not.toThrow();
    expect(() => assertPollTransition('closed', 'archived')).not.toThrow();
    expect(() => assertPollTransition('draft', 'canceled')).not.toThrow();
  });
  it.each([['closed', 'published'], ['archived', 'draft'], ['published', 'draft'], ['draft', 'archived']] as const)('forbids reopening/regression %s -> %s', (from, to) => {
    expect(() => assertPollTransition(from, to)).toThrow();
  });
  it('allows structural changes before votes only', () => {
    expect(() => assertPollStructureUnchanged(structure, { ...structure, question: 'Outra pergunta?' }, 0)).not.toThrow();
    expect(() => assertPollStructureUnchanged(structure, { ...structure, question: 'Outra pergunta?' }, 1)).toThrow();
    expect(() => assertPollStructureUnchanged(structure, { ...structure, mode: 'required' }, 1)).toThrow();
    expect(() => assertPollStructureUnchanged(structure, { ...structure, options: [...structure.options].reverse() }, 1)).toThrow();
    expect(() => assertPollStructureUnchanged(structure, structure, 1)).not.toThrow();
  });
});
