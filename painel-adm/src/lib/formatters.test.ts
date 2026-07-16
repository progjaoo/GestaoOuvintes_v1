import { describe, expect, it } from "vitest";
import { dateInputToIso, formatPhone, sourceLabel } from "@/lib/formatters";

describe("formatters", () => {
  it("formata telefones brasileiros", () => {
    expect(formatPhone("24999990000")).toBe("(24) 99999-0000");
    expect(formatPhone(null)).toBe("Não informado");
  });

  it("converte datas de filtro com fuso de São Paulo", () => {
    expect(dateInputToIso("2026-08-01")).toBe("2026-08-01T03:00:00.000Z");
    expect(dateInputToIso("2026-08-01", true)).toBe(
      "2026-08-02T02:59:59.999Z",
    );
  });

  it("traduz origens conhecidas", () => {
    expect(sourceLabel("institutional_web")).toBe("Site institucional");
  });
});
