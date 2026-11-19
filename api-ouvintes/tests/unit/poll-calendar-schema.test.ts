import { describe, expect, it } from 'vitest';
import { decodePollCalendarCursor, encodePollCalendarCursor, pollCalendarQuery } from '../../src/schemas/poll-calendar.js';

describe('poll calendar query', () => {
  it('accepts a visible range up to 42 days and applies the bounded page size', () => {
    expect(pollCalendarQuery.parse({ from:'2026-11-01',to:'2026-12-13' })).toMatchObject({ limit:200 });
    expect(pollCalendarQuery.safeParse({ from:'2026-11-01',to:'2026-12-14' }).success).toBe(false);
  });

  it('rejects empty or reversed windows and unknown parameters', () => {
    expect(pollCalendarQuery.safeParse({ from:'2026-11-17',to:'2026-11-17' }).success).toBe(false);
    expect(pollCalendarQuery.safeParse({ from:'2026-11-18',to:'2026-11-17' }).success).toBe(false);
    expect(pollCalendarQuery.safeParse({ from:'2026-11-01',to:'2026-11-03',debug:'true' }).success).toBe(false);
  });

  it('round-trips a keyset cursor and rejects malformed input', () => {
    const cursor={startDate:'2026-11-17',id:'11111111-1111-4111-8111-111111111111'};
    expect(decodePollCalendarCursor(encodePollCalendarCursor(cursor))).toEqual(cursor);
    expect(()=>decodePollCalendarCursor('not-a-cursor')).toThrow('Cursor invalido.');
  });
});
