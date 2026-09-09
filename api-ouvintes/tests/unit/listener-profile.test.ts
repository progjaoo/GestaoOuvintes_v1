import { describe, expect, it } from "vitest";
import {
  hashListenerPhone,
  isListenerProfileComplete,
} from "../../src/services/listener-profile-service.js";

describe("listener persistent profile", () => {
  it("normalizes the same phone into a deterministic non-reversible hash", () => {
    const formatted = hashListenerPhone("24999998888");
    const samePhone = hashListenerPhone("24999998888");

    expect(formatted).toHaveLength(64);
    expect(formatted).toMatch(/^[a-f0-9]+$/);
    expect(samePhone).toBe(formatted);
    expect(formatted).not.toContain("24999998888");
  });

  it("only considers the campaign profile complete with the required fields", () => {
    expect(
      isListenerProfileComplete({
        name: "Maria",
        neighborhood: "Retiro",
        city: "Volta Redonda",
        phoneNormalized: "24999998888",
      }),
    ).toBe(true);

    expect(
      isListenerProfileComplete({
        name: "Maria",
        neighborhood: "Retiro",
        city: "",
        phoneNormalized: "24999998888",
      }),
    ).toBe(false);
  });
});
