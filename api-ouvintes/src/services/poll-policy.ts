import { AppError } from '../lib/errors.js';

export type PollState = 'draft' | 'scheduled' | 'published' | 'closed' | 'archived' | 'canceled';
export type PollMode = 'anonymous' | 'optional' | 'required';
export interface PollWindow { startsAt: string; endsAt: string }
export interface PollStructure {
  question: string;
  mode: PollMode;
  options: readonly { id: string; text: string }[];
}

function instant(value: string): number {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new AppError(422, 'INVALID_POLL_WINDOW', 'Informe datas com fuso horário válido.');
  }
  return Date.parse(value);
}

export function pollWindow(edition: PollWindow, requested: PollWindow): PollWindow {
  const editionStart = instant(edition.startsAt);
  const editionEnd = instant(edition.endsAt);
  const start = instant(requested.startsAt);
  const end = instant(requested.endsAt);
  if (editionEnd <= editionStart || end <= start || start < editionStart || end > editionEnd) {
    throw new AppError(422, 'POLL_OUTSIDE_EDITION', 'A enquete deve começar e terminar dentro desta edição do programa.');
  }
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
}

const transitions: Record<PollState, readonly PollState[]> = {
  draft: ['scheduled', 'published', 'canceled'],
  scheduled: ['published', 'closed', 'canceled'],
  published: ['closed', 'canceled'],
  closed: ['archived'],
  canceled: ['archived'],
  archived: [],
};

export function assertPollTransition(from: PollState, to: PollState): void {
  if (!transitions[from]?.includes(to)) {
    throw new AppError(409, 'INVALID_POLL_TRANSITION', 'Esta mudança de estado não é permitida. Atualize a enquete.');
  }
}

export function assertPollStructureUnchanged(before: PollStructure, after: PollStructure, voteCount: number): void {
  if (!Number.isSafeInteger(voteCount) || voteCount < 0) {
    throw new AppError(409, 'INVALID_VOTE_COUNT', 'Não foi possível validar os votos desta enquete.');
  }
  const sameOptions = before.options.length === after.options.length
    && before.options.every((option, index) => option.id === after.options[index]?.id && option.text === after.options[index]?.text);
  if (voteCount > 0 && (before.question !== after.question || before.mode !== after.mode || !sameOptions)) {
    throw new AppError(409, 'POLL_STRUCTURE_LOCKED', 'A enquete já recebeu votos. Crie uma nova para alterar pergunta, identificação ou alternativas.');
  }
}

// Pure policy only: callers must obtain eligibility and authoritative time inside the write transaction.
export function acceptsPollEntry(input: { state: PollState; window: PollWindow; now: Date; programEligible: boolean }): boolean {
  if (!input.programEligible || input.state !== 'published' || !Number.isFinite(input.now.getTime())) return false;
  try {
    const start = instant(input.window.startsAt);
    const end = instant(input.window.endsAt);
    return start < end && input.now.getTime() >= start && input.now.getTime() < end;
  } catch {
    return false;
  }
}
