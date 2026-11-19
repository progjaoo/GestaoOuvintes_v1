import type { PollState } from "@/types/polls";
export const pollStates: Record<PollState, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  published: "Publicada (local)",
  closed: "Encerrada",
  archived: "Arquivada",
  canceled: "Cancelada",
};
export const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export function localInput(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function formatInstant(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function questionSlug(question: string) {
  return question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}
