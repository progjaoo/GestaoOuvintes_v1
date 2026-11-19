import { describe, it, expect } from 'vitest';
import { schedulesConflict } from '../../src/services/programming-conflicts.js';
import { programInput, slotInput, hostInput } from '../../src/schemas/programming.js';
const slot = { weekday: 1, startMinute: 300, endMinute: 570, validFrom: '2026-11-01', validUntil: null };
describe('programming writes', () => {
    it('accepts adjacent slots and rejects overlap', () => {
        expect(schedulesConflict(slot, { ...slot, startMinute: 570, endMinute: 600 })).toBe(false);
        expect(schedulesConflict(slot, { ...slot, startMinute: 569, endMinute: 600 })).toBe(true);
    });
    it('respects disjoint seasons', () => expect(schedulesConflict({ ...slot, validUntil: '2026-11-08' }, { ...slot, validFrom: '2026-11-09' })).toBe(false));
    it('handles overnight overlap across validity boundaries', () => expect(schedulesConflict({ ...slot, weekday: 0, startMinute: 1380, endMinute: 120, validFrom: '2026-11-08', validUntil: '2026-11-08' }, { ...slot, startMinute: 60, endMinute: 180, validFrom: '2026-11-09', validUntil: '2026-11-09' })).toBe(true));
    it('does not invent occurrences outside short seasons', () => expect(schedulesConflict({ ...slot, validFrom: '2026-11-10', validUntil: '2026-11-10' }, slot)).toBe(false));
    it('rejects invalid dates, zero duration and client radio scope', () => {
        expect(slotInput.safeParse({ ...slot, validFrom: '2026-02-30' }).success).toBe(false);
        expect(slotInput.safeParse({ ...slot, endMinute: 300 }).success).toBe(false);
        expect(programInput.safeParse({ name: 'Teste', slug: 'teste', radioKey: 'other' }).success).toBe(false);
        expect(hostInput.safeParse({ active: true, validFrom: '2026-11-09T00:00:00Z', validUntil: '2026-11-08T00:00:00Z' }).success).toBe(false);
    });
});
