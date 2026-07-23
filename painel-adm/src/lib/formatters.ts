export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export function formatPhone(value: string | null): string {
  if (!value) return "Não informado";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return value;
}

export function dateInputToIso(value: string, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  return new Date(`${value}T${time}-03:00`).toISOString();
}

export function isoToDateTimeLocal(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function dateTimeLocalToIso(value: string): string {
  return new Date(value).toISOString();
}

export function sourceLabel(value: string): string {
  const labels: Record<string, string> = {
    institutional_web: "Site institucional",
    institutional_mobile: "Site mobile",
    web: "Site institucional",
    expo: "Aplicativo",
    receptionist: "Recepção",
    import: "Importação",
    admin_import: "Importação administrativa",
  };
  return labels[value] ?? value;
}

export function whatsappUrl(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return `https://wa.me/55${digits}`;
}
