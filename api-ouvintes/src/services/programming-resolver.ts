/** Pure schedule resolution. No database, network or timers. */
export interface WeeklySlot {
  id: string; radioKey: string; programId: string; active: boolean; programActive: boolean;
  weekday: number; startMinute: number; endMinute: number; validFrom: string; validUntil: string | null;
}
export interface ProgrammingException {
  id: string; radioKey: string; active: boolean; startsAt: string; endsAt: string;
  programId: string | null; programActive: boolean;
}
export interface OnAirMatch { programId: string; source: "weekly" | "exception"; sourceId: string }
type WeeklyInterval = Pick<WeeklySlot, "weekday" | "startMinute" | "endMinute">;
const DAY = 1440, WEEK = DAY * 7;
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function interval(slot: WeeklyInterval): [number, number] {
  if (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6 ||
      !Number.isInteger(slot.startMinute) || slot.startMinute < 0 || slot.startMinute >= DAY ||
      !Number.isInteger(slot.endMinute) || slot.endMinute < 0 || slot.endMinute >= DAY ||
      slot.startMinute === slot.endMinute) throw new Error("INVALID_WEEKLY_SLOT");
  return [slot.weekday * DAY + slot.startMinute,
    slot.weekday * DAY + slot.endMinute + (slot.endMinute < slot.startMinute ? DAY : 0)];
}
export function weeklySlotsOverlap(a: WeeklyInterval, b: WeeklyInterval): boolean {
  const [startA, endA] = interval(a), [startB, endB] = interval(b);
  return [-WEEK, 0, WEEK].some(offset => startA < endB + offset && startB + offset < endA);
}
function validDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value) throw new Error("INVALID_VALIDITY_DATE");
}
export function resolveOnAir(input: {
  at: Date; radioKey: string; slots: readonly WeeklySlot[]; exceptions: readonly ProgrammingException[];
}): OnAirMatch | null {
  const now = input.at.getTime();
  if (!Number.isFinite(now) || !input.radioKey) throw new Error("INVALID_RESOLUTION_INPUT");
  const exceptions = input.exceptions.filter(item => item.radioKey === input.radioKey && item.active).filter(item => {
    const start = Date.parse(item.startsAt), end = Date.parse(item.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("INVALID_EXCEPTION");
    return now >= start && now < end;
  });
  if (exceptions.length > 1) throw new Error("AMBIGUOUS_EXCEPTION");
  const exception = exceptions[0];
  if (exception) return exception.programId && exception.programActive
    ? { programId: exception.programId, source: "exception", sourceId: exception.id } : null;
  const parts = Object.fromEntries(formatter.formatToParts(input.at).map(part => [part.type, part.value]));
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  const weekday = date.getUTCDay();
  const minute = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
  const matches = input.slots.filter(item => item.radioKey === input.radioKey && item.active && item.programActive).filter(item => {
    interval(item); validDate(item.validFrom);
    if (item.validUntil !== null) {
      validDate(item.validUntil);
      if (item.validUntil < item.validFrom) throw new Error("INVALID_VALIDITY_RANGE");
    }
    const overnight = item.endMinute < item.startMinute;
    const startsToday = weekday === item.weekday && minute >= item.startMinute && (overnight || minute < item.endMinute);
    const continuesToday = overnight && weekday === (item.weekday + 1) % 7 && minute < item.endMinute;
    if (!startsToday && !continuesToday) return false;
    const anchor = new Date(date);
    if (continuesToday) anchor.setUTCDate(anchor.getUTCDate() - 1);
    const anchorDate = anchor.toISOString().slice(0, 10);
    return anchorDate >= item.validFrom && (item.validUntil === null || anchorDate <= item.validUntil);
  });
  if (matches.length > 1) throw new Error("AMBIGUOUS_SCHEDULE");
  const match = matches[0];
  return match ? { programId: match.programId, source: "weekly", sourceId: match.id } : null;
}
