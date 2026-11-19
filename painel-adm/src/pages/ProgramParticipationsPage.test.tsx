import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PollParticipations,
  ProgramParticipationsPage,
} from "./ProgramParticipationsPage";
import { getDefaultAdminPath } from "@/services/permissions";
const actor = vi.hoisted(() => ({
  user: { id: "actor", permissions: ["participation.read"] },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => actor }));
const item = {
  id: "p1",
  pollId: "poll-1",
  programId: "program-1",
  displayName: "Maria",
  neighborhood: "Centro",
  message: "Texto privado",
  receivedAt: "2026-11-11T10:00:00Z",
  state: "received",
  moderationNote: "histórico legado",
};
let status: number;
let items: (typeof item)[];
let cursor: string | null;
let requests: { url: URL; init?: RequestInit }[];
function open(pollId = "poll-1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = (id = pollId) => (
    <QueryClientProvider client={client}>
      <PollParticipations pollId={id} />
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    ...view,
    client,
    refresh: () => view.rerender(tree()),
    changePoll: (id: string) => view.rerender(tree(id)),
  };
}
beforeEach(() => {
  actor.user = { id: "actor", permissions: ["participation.read"] };
  status = 200;
  items = [item];
  cursor = null;
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      requests.push({ url: new URL(input), init });
      return status === 200
        ? Response.json({ items, nextCursor: cursor })
        : Response.json({ message: "Consulta indisponível" }, { status });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});
describe("Mensagens scoped da enquete", () => {
  it("fixa pollId e mantém consulta no-store sem telefone, edição ou moderação", async () => {
    open();
    await screen.findByText("Maria — Centro");
    expect(requests).toHaveLength(1);
    expect(requests[0].url.search).toBe("?pollId=poll-1");
    expect(requests[0].init?.cache).toBe("no-store");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("histórico legado")).not.toBeInTheDocument();
  });
  it("não concede leitura a quem só possui moderate", () => {
    actor.user.permissions = ["participation.moderate"];
    open();
    expect(requests).toHaveLength(0);
    expect(screen.queryByText("Mensagens privadas")).not.toBeInTheDocument();
  });
  it("paginação mantém escopo da enquete", async () => {
    cursor = "p1";
    open();
    await screen.findByText("Maria — Centro");
    items = [{ ...item, id: "p2", displayName: "José" }];
    cursor = null;
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    await screen.findByText("José — Centro");
    expect(requests[1].url.searchParams.get("pollId")).toBe("poll-1");
    expect(requests[1].url.searchParams.get("after")).toBe("p1");
    fireEvent.click(screen.getByRole("button", { name: "Primeira página" }));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].url.searchParams.has("after")).toBe(false);
  });
  it("distingue vazio de falha e atualiza somente por comando", async () => {
    items = [];
    open();
    await screen.findByText("Nenhuma mensagem recebida");
    status = 503;
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar mensagens" }),
    );
    await screen.findByText(/Consulta indisponível/);
    expect(
      screen.queryByText("Nenhuma mensagem recebida"),
    ).not.toBeInTheDocument();
  });
  it("não solicita dados por foco, reconexão ou timers", async () => {
    open();
    await screen.findByText("Maria — Centro");
    vi.useFakeTimers();
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      vi.advanceTimersByTime(900000);
    });
    expect(requests).toHaveLength(1);
  });
  it("revogação de leitura remove mensagens e cache", async () => {
    const view = open();
    await screen.findByText("Maria — Centro");
    actor.user.permissions = [];
    view.refresh();
    expect(screen.queryByText("Maria — Centro")).not.toBeInTheDocument();
    expect(view.client.getQueryCache().getAll()).toHaveLength(0);
  });
  it("trocar a enquete ou a sessão descarta o escopo anterior", async () => {
    const view = open();
    await screen.findByText("Maria — Centro");
    items = [];
    view.changePoll("poll-2");
    await screen.findByText("Nenhuma mensagem recebida");
    expect(
      view.client
        .getQueryCache()
        .findAll({ queryKey: ["poll-private", "actor", "poll-1"] }),
    ).toHaveLength(0);
    actor.user.id = "actor-2";
    view.changePoll("poll-2");
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(
      view.client
        .getQueryCache()
        .findAll({ queryKey: ["poll-private", "actor"] }),
    ).toHaveLength(0);
  });
  it("rota legada redireciona para enquetes", async () => {
    render(
      <MemoryRouter initialEntries={["/participacoes"]}>
        <Routes>
          <Route
            path="/participacoes"
            element={<ProgramParticipationsPage />}
          />
          <Route path="/enquetes" element={<h1>Enquetes</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { name: "Enquetes" }),
    ).toBeVisible();
    expect(requests).toHaveLength(0);
  });
  it("rota inicial participation-only usa área consolidada", () =>
    expect(
      getDefaultAdminPath(
        actor.user as Parameters<typeof getDefaultAdminPath>[0],
      ),
    ).toBe("/enquetes"));
});
