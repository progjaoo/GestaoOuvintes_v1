import { describe, expect, it } from "vitest";
import { createCsv, createXlsx } from "../../src/services/export-service.js";

const row = {
  id: "c8d97f13-5c61-4f30-9ec5-f3afab301cee",
  campaignId: "fe6360d4-efbf-4280-97c7-edb770cfa198",
  campaignName: "Lancamento",
  name: "=FORMULA",
  neighborhood: "Retiro",
  city: "Volta Redonda",
  phone: null,
  source: "institutional_web",
  marketingOptIn: false,
  createdAt: new Date("2026-07-16T12:00:00-03:00"),
};

describe("export service", () => {
  it("gera CSV UTF-8 com BOM e neutraliza formulas", () => {
    const csv = createCsv([row]).toString("utf8");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("'=FORMULA");
    expect(csv).toContain("Volta Redonda");
  });

  it("gera planilha XLSX valida", async () => {
    const xlsx = await createXlsx([row]);
    expect(xlsx.length).toBeGreaterThan(1_000);
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
  });
});
