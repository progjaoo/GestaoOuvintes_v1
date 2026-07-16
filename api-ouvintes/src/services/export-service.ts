import ExcelJS from "exceljs";
import { neutralizeSpreadsheetFormula } from "../lib/normalization.js";

export interface RegistrationExportRow {
  id: string;
  campaignId: string;
  campaignName: string;
  name: string;
  neighborhood: string;
  city: string;
  phone: string | null;
  source: string;
  marketingOptIn: boolean;
  createdAt: Date;
}

const csvHeaders = [
  "ID",
  "Campanha",
  "Nome",
  "Bairro",
  "Cidade",
  "Telefone",
  "Origem",
  "Aceite de marketing",
  "Data do cadastro",
];

function escapeCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Sao_Paulo",
  }).format(value);
}

function toSafeValues(row: RegistrationExportRow): string[] {
  return [
    row.id,
    row.campaignName,
    row.name,
    row.neighborhood,
    row.city,
    row.phone ?? "",
    row.source,
    row.marketingOptIn ? "Sim" : "Nao",
    formatDate(row.createdAt),
  ].map(neutralizeSpreadsheetFormula);
}

export function createCsv(rows: RegistrationExportRow[]): Buffer {
  const lines = [
    csvHeaders.map(escapeCsv).join(";"),
    ...rows.map((row) => toSafeValues(row).map(escapeCsv).join(";")),
  ];

  return Buffer.from(`\uFEFF${lines.join("\r\n")}`, "utf8");
}

export async function createXlsx(rows: RegistrationExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Radio 88 FM";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Cadastros");
  worksheet.columns = csvHeaders.map((header, index) => ({
    header,
    key: String(index),
    width: index === 2 ? 32 : 22,
  }));

  for (const row of rows) {
    worksheet.addRow(toSafeValues(row));
  }

  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1360E8" },
  };
  worksheet.autoFilter = {
    from: "A1",
    to: `I${Math.max(1, rows.length + 1)}`,
  };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
