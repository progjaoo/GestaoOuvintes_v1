import { describe, it, expect } from 'vitest';
import { previewCalendarPoll, type CalendarPollSource, type CalendarPollSchedule } from '../../src/services/calendar-poll-parser.js';
const programId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const source: CalendarPollSource = { calendarId: 'fixture-88-enquete', allowedProgramIds: [programId], defaultProgramId: programId, defaultMode: 'mixed', identificationPolicy: 'optional' };
const slot = { id: 'slot', radioKey: 'radio-88', programId, active: true, programActive: true, weekday: 1, startMinute: 570, endMinute: 720, validFrom: '2026-01-01', validUntil: null };
const schedule: CalendarPollSchedule = { programs: [{ id: programId, name: 'Bom Dia 88', active: true }],
  editions: [{ programId, startsAt: '2026-11-16T12:30:00Z', endsAt: '2026-11-16T15:00:00Z' }], slots: [slot], exceptions: [] };
const event = { id: 'fixture-event', summary: 'Ter o "dedo podre" no amor pode ser influencia demoniaca?', description: 'Qual e a sua opiniao?', start: { date: '2026-11-16' }, end: { date: '2026-11-17' } };
const block = '[CONFIG ENQUETE 88]\nPROGRAMA: Bom Dia 88\nTIPO: Voto e mensagem\nALTERNATIVAS:\n- Sim\n- Nao\n[/CONFIG ENQUETE 88]';
const preview = (patch: Record<string, unknown> = {}, sc = schedule, so = source) => previewCalendarPoll({ ...event, ...patch }, so, sc);
const pending = (result: ReturnType<typeof preview>, code: string) => expect(result).toMatchObject({ kind: 'pending', issues: [code] });

describe('Calendar poll preview without persistence', () => {
  it('uses the default binary vote with optional opinion; all-day follows the edition', () => {
    const r = preview({ summary: 'Qual é a sua opinião sobre o tema?' }); expect(r.kind).toBe('preview');
    if (r.kind !== 'preview') throw new Error('expected preview');
    expect(r.requiresReview).toBe(true); expect(r.poll.mode).toBe('mixed'); expect(r.poll.allowMessage).toBe(true); expect(r.poll.options).toEqual(['Sim', 'Não']);
    expect(r.poll.startsAt).toBe('2026-11-16T12:30:00Z'); expect(r.poll.endsAt).toBe('2026-11-16T15:00:00Z');
    expect(r.poll.identificationPolicy).toBe('optional'); expect(r.programId).toBe(programId);
  });
  it('accepts formatting HTML, strips markup and configuration from context', () => {
    const r = preview({ description: '<p>Uma <b>pergunta</b> &amp; contexto.</p><div>' + block.replaceAll('\n', '<br>') + '</div>' });
    expect(r.kind).toBe('preview');
    if (r.kind !== 'preview') throw new Error('expected preview');
    expect(r.poll.mode).toBe('mixed'); expect(r.poll.options).toEqual(['Sim', 'Nao']); expect(r.poll.context).toBe('Uma pergunta & contexto.');
  });
  it('accepts an unambiguous trailing legacy block', () => {
    const r = preview({ description: 'Contexto.\nPROGRAMA: Bom Dia 88\nTIPO: Voto\nALTERNATIVAS:\n- A\n- B' });
    expect(r.kind === 'preview' && r.poll.mode).toBe('vote');
  });
  it.each([
    block.replace('TIPO: Voto e mensagem', 'TIPO: Voto\nTIPO: Mensagem'),
    block.replace('TIPO: Voto e mensagem', 'HORA: 10h'),
    block.replace('[/CONFIG ENQUETE 88]', ''),
    block + '\nTexto depois do bloco',
    block.replace('- Nao\n', ''),
    block.replace('Voto e mensagem', 'Automatico'),
  ])('flags invalid or ambiguous configuration %#', description => pending(preview({ description }), 'INVALID_CONFIG'));
  it('defaults to Sim/Não + optional opinion instead of extracting options from prose', () => {
    const r = preview({ summary: 'O mundo pode acabar hoje? Devemos levar a sério as teorias sobre o apocalipse?' });
    expect(r.kind === 'preview' && r.poll).toMatchObject({ mode: 'mixed', allowMessage: true, options: ['Sim', 'Não'] });
  });
  it.each(['MANHÃ: VIDA DE CRENTE É CHATA?', 'Crente de hoje aceita correção?', 'Qual é a sua opinião?'])('defaults valid questions to Sim/Não + opinion: %s', summary => {
    const r = preview({ summary });
    expect(r.kind === 'preview' && r.poll).toMatchObject({ mode: 'mixed', options: ['Sim', 'Não'] });
  });
  it('keeps headlines without a terminal question mark out of automatic publication', () => {
    const r = preview({ summary: '“Aceitar Jesus”? Apóstolo critica a expressão usada nos cultos' });
    pending(r, 'INVALID_POLL');
  });
  it('uses binary defaults for editorial contrasts until an editor sets custom alternatives', () => {
    const r = preview({
      summary: 'Ter o dedo podre no amor pode ser influência demoníaca?',
      description: 'Ou será que isso só demonstra falta de sabedoria nas escolhas?',
    });
    expect(r.kind === 'preview' && r.poll).toMatchObject({ mode: 'mixed', options: ['Sim', 'Não'] });
  });
  it('keeps explicit custom alternatives and mode from the calendar description', () => {
    const r = preview({ summary: 'A ou B?', description: block });
    expect(r.kind === 'preview' && r.poll).toMatchObject({ mode: 'mixed', options: ['Sim', 'Nao'] });
  });
  it('defaults open-ended prompts to binary voting; the editor can change them later', () => {
    const r = preview({ summary: 'Qual é a sua opinião sobre o assunto?' });
    expect(r.kind === 'preview' && r.poll).toMatchObject({ mode: 'mixed', allowMessage: true, options: ['Sim', 'Não'] });
  });
  it('does not mistake an open question beginning with "o que pode" for yes/no', () => {
    const r = preview({ summary: 'O que pode ajudar uma família neste momento?' });
    expect(r.kind === 'preview' && r.poll).toMatchObject({ mode: 'mixed', options: ['Sim', 'Não'] });
  });
  it('applies the binary default when a mode is set without custom alternatives', () => {
    const vote = preview({ description: 'TIPO: Voto' });
    expect(vote.kind === 'preview' && vote.poll).toMatchObject({ mode: 'vote', allowMessage: false, options: ['Sim', 'Não'] });
    const mixed = preview({ description: 'TIPO: Voto e mensagem' });
    expect(mixed.kind === 'preview' && mixed.poll).toMatchObject({ mode: 'mixed', allowMessage: true, options: ['Sim', 'Não'] });
  });
  it.each(['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '&lt;script&gt;alert(1)&lt;/script&gt;', '<!-- secret -->', '<iframe src=x></iframe>', '<b'])('fails closed on unsupported HTML %#', description => pending(preview({ description }), 'UNSAFE_DESCRIPTION'));
  it('treats anchors as text and never downloads audio or attachments', () => {
    const r = preview({ description: '<a href="https://example.com/audio">(AUDIO)</a>', attachments: [{ fileUrl: 'https://example.com/file' }] });
    expect(r.kind === 'preview' && r.poll.context).toBe('(AUDIO)');
    expect(r.kind === 'preview' && r.poll.imageUrl).toBeUndefined();
  });
  it('never chooses unauthorized or inactive programs from event text', () => {
    pending(preview({}, schedule, { ...source, allowedProgramIds: [otherId] }), 'INVALID_SOURCE');
    pending(preview({ description: block.replace('Bom Dia 88', 'Outro Programa') }), 'PROGRAM_UNAVAILABLE');
    pending(preview({}, { ...schedule, programs: [{ id: programId, name: 'Bom Dia 88', active: false }] }), 'PROGRAM_UNAVAILABLE');
  });
  it('does not guess between equal names', () => pending(preview({ description: block }, { ...schedule, programs: [...schedule.programs, { id: otherId, name: 'Bom Dia 88', active: true }] }, { ...source, allowedProgramIds: [programId, otherId] }), 'PROGRAM_UNAVAILABLE'));
  it('rejects duplicate alternatives after accent/case normalization', () => pending(preview({ description: block.replace('- Sim\n- Nao', '- Nao\n- NÃO') }), 'INVALID_POLL'));
  it.each([1, 11])('requires 2..10 voting options (%i)', count => {
    const description = 'TIPO: Voto\nALTERNATIVAS:\n' + Array.from({ length: count }, (_, i) => '- Opcao ' + i).join('\n');
    expect(preview({ description }).kind).toBe('pending');
  });
  it('rejects question/context/option length overflow without truncating', () => {
    pending(preview({ summary: 'x'.repeat(501) }), 'INVALID_POLL');
    pending(preview({ description: 'x'.repeat(2001) }), 'INVALID_POLL');
    pending(preview({ description: block.replace('- Sim', '- ' + 'x'.repeat(301)) }), 'INVALID_POLL');
  });
  it('rejects multi-day, invalid dates and mixed temporal representations', () => {
    pending(preview({ end: { date: '2026-11-18' } }), 'INVALID_WINDOW');
    pending(preview({ start: { date: '2026-02-30' } }), 'INVALID_EVENT');
    pending(preview({ start: { date: '2026-11-16', dateTime: '2026-11-16T13:00:00Z' } }), 'INVALID_WINDOW');
  });
  it('accepts an explicit offset time window strictly inside the edition', () => {
    const r = preview({ start: { dateTime: '2026-11-16T10:00:00-03:00' }, end: { dateTime: '2026-11-16T11:00:00-03:00' } });
    expect(r.kind === 'preview' && r.poll.startsAt).toBe('2026-11-16T10:00:00-03:00');
  });
  it('rejects outside/negative windows and timestamps without offset', () => {
    pending(preview({ start: { dateTime: '2026-11-16T09:00:00-03:00' }, end: { dateTime: '2026-11-16T11:00:00-03:00' } }), 'EDITION_UNAVAILABLE');
    pending(preview({ start: { dateTime: '2026-11-16T13:00:00Z' }, end: { dateTime: '2026-11-16T12:59:00Z' } }), 'INVALID_WINDOW');
    pending(preview({ start: { dateTime: '2026-11-16T10:00:00' } }), 'INVALID_EVENT');
  });
  it('requires exactly one concrete edition and honors interruptions', () => {
    pending(preview({}, { ...schedule, editions: [] }), 'EDITION_UNAVAILABLE');
    pending(preview({}, { ...schedule, editions: [...schedule.editions, ...schedule.editions] }), 'EDITION_UNAVAILABLE');
    pending(preview({}, { ...schedule, exceptions: [{ id: 'break', radioKey: 'radio-88', programId: null, active: true, programActive: false, startsAt: '2026-11-16T13:00:00Z', endsAt: '2026-11-16T13:10:00Z' }] }), 'EDITION_UNAVAILABLE');
  });
  it.each([{ recurrence: ['RRULE:FREQ=DAILY'] }, { recurringEventId: 'series' }, { status: 'tentative' }, { eventType: 'birthday' }])('keeps unsupported event types pending %#', patch => pending(preview(patch), 'UNSUPPORTED_EVENT'));
  it('keeps a minimal safe date/title projection for the admin calendar', () => {
    const r=preview({ summary:'  Enquete  do dia?  ' });
    expect(r.calendarEvent).toMatchObject({ title:'Enquete do dia?',startDate:'2026-11-16',endDate:'2026-11-17',allDay:true,programId });
    expect(JSON.stringify(r)).not.toContain('AUDIO');
  });
  it('projects timed events in their source offset without exposing their description', () => {
    const r=preview({summary:'Enquete ao vivo?',description:'private text',start:{dateTime:'2026-11-16T10:00:00-03:00'},end:{dateTime:'2026-11-16T11:00:00-03:00'}});
    expect(r.calendarEvent).toMatchObject({title:'Enquete ao vivo?',startDate:'2026-11-16',startsAt:'2026-11-16T13:00:00.000Z',endsAt:'2026-11-16T14:00:00.000Z',allDay:false});
    expect(JSON.stringify(r.calendarEvent)).not.toContain('private text');
  });
  it('recognizes a minimal cancellation but does not execute one', () => expect(previewCalendarPoll({ id: 'deleted', status: 'cancelled' }, source, schedule)).toMatchObject({ kind: 'canceled', external: { calendarId: source.calendarId, eventId: 'deleted' } }));
  it('is deterministic, does not mutate inputs and keeps provenance out of poll payload', () => {
    const before = JSON.stringify({ event, source, schedule });
    expect(preview()).toEqual(preview()); expect(JSON.stringify({ event, source, schedule })).toBe(before);
    const r = preview(); expect(r.kind === 'preview' && 'calendarId' in r.poll).toBe(false);
  });
  it('emits plain title text and rejects active title markup', () => {
    const r = preview({ summary: '<b>Qual sua opiniao?</b>' });
    expect(r.kind === 'preview' && r.poll.question).toBe('Qual sua opiniao?');
    pending(preview({ summary: '<script>alert(1)</script>' }), 'UNSAFE_DESCRIPTION');
  });
  it('rejects message mode with voting alternatives', () => pending(preview({ description: block.replace('Voto e mensagem', 'Mensagem') }), 'INVALID_POLL'));
  it('supports an edition crossing midnight without opening for the entire day', () => {
    const night = { ...schedule, slots: [{ ...slot, startMinute: 1380, endMinute: 0 }], editions: [{ programId, startsAt: '2026-11-17T02:00:00Z', endsAt: '2026-11-17T03:00:00Z' }] };
    const r = preview({}, night);
    expect(r.kind === 'preview' && r.poll.endsAt).toBe('2026-11-17T03:00:00Z');
  });
});
