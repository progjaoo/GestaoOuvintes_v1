import { createHmac } from "node:crypto";

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizePhone(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export function summarizeUserAgent(value?: string): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/[\r\n]/g, " ").slice(0, 255);
}

export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

export function neutralizeSpreadsheetFormula(value: string | null): string {
  if (!value) {
    return "";
  }

  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}
