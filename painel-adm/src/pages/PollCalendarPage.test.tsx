import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PollCalendarPage } from "./PollCalendarPage";

const auth = vi.hoisted(() => ({ user: { permissions: ["calendar_integration.read", "poll.read", "poll.manage"] } }));
const calendarApi = vi.hoisted(() => ({ listPollCalendar: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/services/api", () => ({ api: calendarApi }));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}));

const response = {
  items: [{
    id: "stage-1", title: "Pergunta real da agenda?", programId: "program-1", programName: "Bom Dia 88",
    startDate: "2026-11-17", endDate: "2026-11-18", startsAt: "2026-11-17T12:30:00.000Z", endsAt: "2026-11-17T15:00:00.000Z",
    allDay: false, origin: "google_calendar" as const, importState: "review" as const, state: "review" as const,
    reason: "INVALID_CONFIG" as const, linkedPollId: null, pollState: null, updatedAt: "2026-11-17T12:00:00.000Z",
  }],
  nextCursor: null, from: "2026-11-01", to: "2026-12-06", timezone: "America/Sao_Paulo" as const,
  readOnly: true as const, configured: true, connected: true, lastSyncedAt: "2026-11-17T12:00:00.000Z",
};

function renderCalendar(path = "/enquetes/calendario?date=2026-11-17") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}><PollCalendarPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PollCalendarPage", () => {
  beforeEach(() => {
    auth.user.permissions = ["calendar_integration.read", "poll.read", "poll.manage"];
    calendarApi.listPollCalendar.mockReset().mockResolvedValue(response);
  });

  it("renders server-provided Google Calendar items and no synthetic fixtures", async () => {
    renderCalendar();
    expect(await screen.findByText("Pergunta real da agenda?")).toBeVisible();
    expect(screen.getByText(/Agenda Google · 88 - ENQUETE · somente leitura/)).toBeVisible();
    expect(screen.queryByText("Qual tema merece um espaço no programa?")).not.toBeInTheDocument();
    expect(calendarApi.listPollCalendar).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-11-01", to: "2026-12-06" }), expect.any(AbortSignal));
  });

  it("opens event details with only safe projection fields", async () => {
    renderCalendar();
    fireEvent.click(await screen.findByRole("button", { name: /Abrir pauta da agenda: Pergunta real da agenda/ }));
    expect(within(await screen.findByRole("dialog")).getAllByText("Google Agenda · 88 - ENQUETE")).toHaveLength(2);
    expect(screen.getByText("A configuração editorial precisa ser revisada.")).toBeVisible();
    expect(screen.queryByText("Private context from Google")).not.toBeInTheDocument();
  });

  it("shows an empty agenda without inserting sample items", async () => {
    calendarApi.listPollCalendar.mockResolvedValue({ ...response, items: [] });
    renderCalendar("/enquetes/calendario?date=2026-11-17&view=list");
    expect(await screen.findByText("Nenhum evento da agenda neste período.")).toBeVisible();
    expect(screen.queryByText(/demonstrativ/i)).not.toBeInTheDocument();
  });

  it("defaults to list view on narrow screens", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query.includes("max-width"), media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    renderCalendar();
    expect(screen.getByLabelText("Visualização em lista")).toHaveAttribute("data-state", "on");
    expect(await screen.findByText("Pergunta real da agenda?")).toBeVisible();
  });

  it("does not query events without the calendar-read permission", async () => {
    auth.user.permissions = ["calendar_integration.manage"];
    renderCalendar();
    expect(screen.getByText("Sem permissão para consultar a agenda")).toBeVisible();
    await waitFor(() => expect(calendarApi.listPollCalendar).not.toHaveBeenCalled());
  });
});
