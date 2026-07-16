import { describe, expect, it } from "vitest";
import {
  hashIp,
  neutralizeSpreadsheetFormula,
  normalizePhone,
  normalizeText,
  summarizeUserAgent,
} from "../../src/lib/normalization.js";

describe("normalization", () => {
  it("normaliza espacos de textos", () => {
    expect(normalizeText("  Maria   da Silva  ")).toBe("Maria da Silva");
  });

  it("normaliza telefone e preserva telefone opcional", () => {
    expect(normalizePhone("(24) 99999-0000")).toBe("24999990000");
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("resume user-agent sem permitir quebra de linha", () => {
    expect(summarizeUserAgent("Browser\r\nInjected")).toBe("Browser  Injected");
  });

  it("gera hash deterministico sem guardar o IP bruto", () => {
    const hash = hashIp("127.0.0.1", "secret");
    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashIp("127.0.0.1", "secret"));
    expect(hash).not.toContain("127.0.0.1");
  });

  it("neutraliza formulas em planilhas", () => {
    expect(neutralizeSpreadsheetFormula("=HYPERLINK(\"x\")")).toBe(
      "'=HYPERLINK(\"x\")",
    );
    expect(neutralizeSpreadsheetFormula("Nome normal")).toBe("Nome normal");
  });
});
