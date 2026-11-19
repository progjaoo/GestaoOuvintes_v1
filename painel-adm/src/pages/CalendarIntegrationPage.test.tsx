import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarIntegrationPage } from "./CalendarIntegrationPage";

const actor = vi.hoisted(() => ({ permissions: ["calendar_integration.read", "calendar_integration.manage", "calendar_integration.sync"] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin-1", permissions: actor.permissions } }) }));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{actions}</header>,
}));

const programs = [
  { id: "program-bom-dia", name: "Bom Dia 88" },
  { id: "program-fato", name: "Fato Popular" },
];
const source = {
  id: "source-1",
  calendarId: "private-calendar-id",
  programId: "program-bom-dia",
  programName: "Bom Dia 88",
  active: true,
  version: 2,
  incrementalReady: true,
  allowedPrograms: [{ id: "program-bom-dia", name: "Bom Dia 88" }],
  lastSyncAt: "2026-11-16T12:00:00.000Z",
};
let currentSource: typeof source | null;
let requests: { path: string; method: string; body?: Record<string, unknown> }[];
let stagedItems: unknown[];

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><CalendarIntegrationPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  actor.permissions = ["calendar_integration.read", "calendar_integration.manage", "calendar_integration.sync"];
  currentSource = structuredClone(source);
  requests = [];
  stagedItems = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ path: url.pathname, method, body });
    if (url.pathname.endsWith("/status")) return Response.json({ connected: true, readOnly: true, scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"], connectedAt: "2026-11-16T12:00:00.000Z" });
    if (url.pathname.endsWith("/programs")) return Response.json(programs);
    if (url.pathname.endsWith("/sources") && method === "GET") return Response.json(currentSource ? [currentSource] : []);
    if (url.pathname.endsWith("/sources") && method === "POST") {
      currentSource = { ...source, id: "source-created", programId: String(body?.programId), active: false, version: 1 };
      return Response.json({ id: currentSource.id, version: 1, active: false }, { status: 201 });
    }
    if (url.pathname.endsWith("/events")) return Response.json({ items: stagedItems, nextCursor: null });
    if (url.pathname.endsWith("/sync") && method === "POST") return Response.json({ scanned: 1, changed: 1, pending: 0, canceled: 0, skippedPast: 0, reviewRequired: true, readOnly: true });
    return Response.json({});
  }));
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Integração da Agenda Google", () => {
  it("abre a autorização em aba normal e informa quando o navegador bloqueia", async () => {
    const openTab = vi.spyOn(window, "open").mockReturnValue(null);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Reconectar conta" }));
    expect(openTab).toHaveBeenCalledWith("about:blank", "_blank");
    expect(requests.some((request) => request.path.endsWith("/oauth/start"))).toBe(false);
  });

  it("usa Bom Dia 88 como padrão ao configurar a agenda, sem enviar alterações ao Google", async () => {
    currentSource = null;
    open();

    const selector = await screen.findByLabelText("Programa padrão da agenda");
    await waitFor(() => expect(selector).toHaveValue("program-bom-dia"));
    fireEvent.click(screen.getByRole("button", { name: "Configurar agenda" }));

    await waitFor(() => expect(requests.some((request) => request.method === "POST" && request.path.endsWith("/sources"))).toBe(true));
    expect(requests.find((request) => request.method === "POST" && request.path.endsWith("/sources"))?.body).toEqual({ programId: "program-bom-dia" });
    expect(requests.some((request) => /www\.googleapis\.com|calendar\.google\.com/.test(request.path))).toBe(false);
    expect(requests.some((request) => ["PUT", "PATCH", "DELETE"].includes(request.method))).toBe(false);
    expect((await screen.findAllByText("Bom Dia 88")).length).toBeGreaterThan(0);
  });

  it("executa leitura manual e mostra eventos privados sem publicar automaticamente", async () => {
    stagedItems = [{
      id: "stage-1",
      eventId: "google-event-123",
      state: "review",
      payload: {
        programId: "program-bom-dia",
        poll: {
          mode: "mixed",
          imageUrl: "",
          slug: "enquete-do-dia",
          question: "A pergunta de amanhã?",
          context: "Contexto importado da agenda.",
          identificationPolicy: "optional",
          allowMessage: true,
          options: ["Sim", "Não"],
          editionStartsAt: "2026-11-17T08:00:00.000Z",
          editionEndsAt: "2026-11-17T15:00:00.000Z",
          startsAt: "2026-11-17T08:00:00.000Z",
          endsAt: "2026-11-17T12:30:00.000Z",
        },
      },
      reason: null,
      version: 1,
      updatedAt: "2026-11-16T12:30:00.000Z",
    }];
    open();

    expect(await screen.findByText("A pergunta de amanhã?")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar agora" }));
    await waitFor(() => expect(requests.some((request) => request.method === "POST" && request.path.endsWith("/sync"))).toBe(true));
    expect(await screen.findByText("Aguardando conferência")).toBeVisible();
    expect(requests.some((request) => request.path.includes("publish-public"))).toBe(false);
    expect(requests.some((request) => ["PUT", "PATCH", "DELETE"].includes(request.method))).toBe(false);
  });
});
