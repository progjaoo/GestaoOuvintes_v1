import { weeklySlotsOverlap } from './programming-resolver.js';
export interface SlotPeriod {
    weekday: number;
    startMinute: number;
    endMinute: number;
    validFrom: string;
    validUntil: string | null;
}
/** Compare recurrence in wall-clock days, including the start date of overnight slots. */
export function schedulesConflict(a: SlotPeriod, b: SlotPeriod) {
    if (!weeklySlotsOverlap(a, b))
        return false;
    const from = Math.max(Date.parse(a.validFrom + 'T00:00:00Z'), Date.parse(b.validFrom + 'T00:00:00Z')) - 86400000;
    const occurrences = (s: SlotPeriod) => Array.from({ length: 16 }, (_, i) => {
        const anchor = new Date(from + i * 86400000), day = anchor.toISOString().slice(0, 10);
        if (anchor.getUTCDay() !== s.weekday || day < s.validFrom || (s.validUntil !== null && day > s.validUntil))
            return null;
        const start = anchor.getTime() + s.startMinute * 60000;
        return [start, anchor.getTime() + (s.endMinute + (s.endMinute < s.startMinute ? 1440 : 0)) * 60000] as const;
    }).filter((v): v is readonly [
        number,
        number
    ] => v !== null);
    return occurrences(a).some(x => occurrences(b).some(y => x[0] < y[1] && y[0] < x[1]));
}
