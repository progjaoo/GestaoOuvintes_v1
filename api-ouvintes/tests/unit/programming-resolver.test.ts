import { describe, expect, it } from "vitest";
import { resolveOnAir, weeklySlotsOverlap, type WeeklySlot } from "../../src/services/programming-resolver.js";

const slot: WeeklySlot = { id: "morning", radioKey: "radio88", programId: "fato", active: true, programActive: true, weekday: 1, startMinute: 300, endMinute: 570, validFrom: "2026-01-01", validUntil: null };
const resolve = (at: string, slots = [slot]) => resolveOnAir({ at: new Date(at), radioKey: "radio88", slots, exceptions: [] });
describe("programming resolver", () => {
  it.each([["07:59:59", null], ["08:00:00", "fato"], ["12:29:59", "fato"], ["12:30:00", null]])("uses half-open intervals at %s", (time, expected) => {
    expect(resolve(`2026-11-09T${time}Z`)?.programId ?? null).toBe(expected);
  });
  it("resolves overnight Sunday slots on Monday", () => {
    const overnight = { ...slot, weekday: 0, startMinute: 1380, endMinute: 120 };
    expect(resolve("2026-11-09T04:00:00Z", [overnight])?.programId).toBe("fato");
    expect(resolve("2026-11-09T05:00:00Z", [overnight])).toBeNull();
  });
  it("uses the originating date for overnight validity", () => {
    expect(resolve("2026-11-09T04:00:00Z", [{ ...slot, weekday: 0, startMinute: 1380, endMinute: 120, validUntil: "2026-11-08" }])?.programId).toBe("fato");
  });
  it("does not mix radios or inactive programs", () => {
    expect(resolve("2026-11-09T08:00:00Z", [{ ...slot, radioKey: "other" }])).toBeNull();
    expect(resolve("2026-11-09T08:00:00Z", [{ ...slot, programActive: false }])).toBeNull();
  });
  it("fails closed on ambiguous schedules", () => {
    expect(() => resolve("2026-11-09T08:00:00Z", [slot, { ...slot, id: "other" }])).toThrow("AMBIGUOUS_SCHEDULE");
  });
  it("supports explicit interruption and replacement", () => {
    const base = { id: "special", radioKey: "radio88", active: true, startsAt: "2026-11-09T08:00:00Z", endsAt: "2026-11-09T09:00:00Z", programId: null, programActive: true };
    expect(resolveOnAir({ at: new Date(base.startsAt), radioKey: "radio88", slots: [slot], exceptions: [base] })).toBeNull();
    expect(resolveOnAir({ at: new Date(base.startsAt), radioKey: "radio88", slots: [slot], exceptions: [{ ...base, programId: "special-program" }] })?.programId).toBe("special-program");
  });
  it("rejects zero length and malformed slots", () => {
    expect(() => resolve("2026-11-09T08:00:00Z", [{ ...slot, endMinute: 300 }])).toThrow();
    expect(() => resolve("2026-11-09T08:00:00Z", [{ ...slot, weekday: 7 }])).toThrow();
  });
  it("detects week-boundary overlap but permits adjacent slots", () => {
    expect(weeklySlotsOverlap({ weekday: 0, startMinute: 1380, endMinute: 120 }, { weekday: 1, startMinute: 60, endMinute: 180 })).toBe(true);
    expect(weeklySlotsOverlap(slot, { ...slot, startMinute: 570, endMinute: 600 })).toBe(false);
  });
  it("uses IANA timezone rather than a fixed UTC-3", () => {
    expect(resolve("2018-11-05T07:00:00Z", [{ ...slot, validFrom: "2018-01-01" }])?.programId).toBe("fato");
  });
});
