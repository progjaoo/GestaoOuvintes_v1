import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PollWorkspacePage } from "./PollWorkspacePage";
import { ApiError, api } from "@/services/api";
const actor = vi.hoisted(() => ({
  user: {
    id: "actor",
    permissions: ["poll.results.read", "participation.read"],
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => actor }));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title, actions }: { title: string; actions: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}));
function open(path = "/enquetes/poll-1/resultados") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const app = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/enquetes/:id/resultados"
            element={<PollWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(app);
  return { ...view, client, refresh: () => view.rerender(<>{app}</>) };
}
beforeEach(() => {
  actor.user.permissions = ["poll.results.read", "participation.read"];
  vi.spyOn(api, "pollResults").mockResolvedValue({
    totalVotes: 4,
    options: [
      { id: "yes", text: "Sim", votes: 3, percentage: 75 },
      { id: "no", text: "Não", votes: 1, percentage: 25 },
    ],
  });
  vi.spyOn(api, "listParticipations").mockResolvedValue({
    items: [
      {
        id: "p1",
        pollId: "poll-1",
        programId: "prog-1",
        programName: "Manhã",
        pollQuestion: "Pergunta",
        editionStartsAt: "2026-11-11T09:00:00Z",
        editionEndsAt: "2026-11-11T12:00:00Z",
        receivedAt: "2026-11-11T10:00:00Z",
        state: "received",
        version: 1,
        displayName: "Maria",
        neighborhood: "Centro",
        message: "<b>Minha mensagem privada</b>",
        moderationNote: "Nota legada privada",
        moderatedAt: null,
      },
    ],
    nextCursor: null,
  });
  vi.spyOn(api, "getPoll");
  vi.spyOn(api, "moderateParticipation");
});
afterEach(() => vi.restoreAllMocks());
describe("Workspace da enquete", () => {
  it("exibe barras com os agregados reais e não carrega mensagens na aba de resultados", async () => {
    const view = open();
    expect(await screen.findByText("Total de votos: 4")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Sim" })).toHaveAttribute(
      "aria-valuenow",
      "75",
    );
    expect(screen.getByRole("progressbar", { name: "Não" })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(api.listParticipations).not.toHaveBeenCalled();
    expect(api.getPoll).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar resultados" }),
    );
    await waitFor(() => expect(api.pollResults).toHaveBeenCalledTimes(2));
    view.unmount();
    expect(view.client.getQueryCache().getAll()).toHaveLength(0);
  });
  it("leitura de mensagens independe de resultados, sem moderação nem telefone", async () => {
    actor.user.permissions = ["participation.read"];
    const view = open(
      "/enquetes/poll-1/resultados?pollId=outro&state=rejected",
    );
    expect(await screen.findByText("Maria — Centro")).toBeVisible();
    expect(screen.getByText("<b>Minha mensagem privada</b>")).toBeVisible();
    expect(document.querySelector("b")).toBeNull();
    expect(
      screen.queryByRole("tab", { name: "Resultados" }),
    ).not.toBeInTheDocument();
    expect(api.pollResults).not.toHaveBeenCalled();
    expect(api.listParticipations).toHaveBeenCalledWith(
      { pollId: "poll-1", after: undefined },
      expect.any(AbortSignal),
    );
    expect(screen.queryByText(/Nota legada/)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(api.moderateParticipation).not.toHaveBeenCalled();
    expect(
      JSON.stringify(
        view.client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toMatch(/Nota legada|moderationNote/);
  });
  it("poll.results.read não concede participation.read", async () => {
    actor.user.permissions = ["poll.results.read"];
    open();
    await screen.findByText("Total de votos: 4");
    expect(
      screen.queryByRole("tab", { name: "Mensagens" }),
    ).not.toBeInTheDocument();
    expect(api.listParticipations).not.toHaveBeenCalled();
  });
  it("troca de aba desmonta e descarta os dados privados", async () => {
    const view = open();
    await screen.findByText("Total de votos: 4");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Mensagens" }), {
      button: 0,
      ctrlKey: false,
    });
    await screen.findByText("Maria — Centro");
    expect(
      view.client
        .getQueryCache()
        .findAll({ queryKey: ["poll-private", "actor", "poll-1", "results"] }),
    ).toHaveLength(0);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Resultados" }), {
      button: 0,
      ctrlKey: false,
    });
    await screen.findByText("Total de votos: 4");
    expect(
      JSON.stringify(
        view.client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain("Minha mensagem privada");
  });
  it("cancela consulta e ignora resposta atrasada ao sair", async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof api.listParticipations>>,
    ) => void;
    let signal: AbortSignal | undefined;
    vi.mocked(api.listParticipations).mockImplementation((_filters, s) => {
      signal = s;
      return new Promise((r) => {
        resolve = r;
      });
    });
    actor.user.permissions = ["participation.read"];
    const view = open();
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve({ items: [], nextCursor: null }));
    expect(view.client.getQueryCache().getAll()).toHaveLength(0);
  });
  it("remove conteúdo e cache após erro de acesso no refresh", async () => {
    actor.user.permissions = ["participation.read"];
    const view = open();
    await screen.findByText("Maria — Centro");
    vi.mocked(api.listParticipations).mockRejectedValue(
      new ApiError(403, "DENIED", "Acesso revogado"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Atualizar mensagens" }),
    );
    await screen.findByText(/Acesso revogado/);
    expect(screen.queryByText("Maria — Centro")).not.toBeInTheDocument();
    expect(
      JSON.stringify(
        view.client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain("Minha mensagem privada");
  });
  it("sem grants não solicita dados privados", () => {
    actor.user.permissions = [];
    open();
    expect(screen.getByText("Acesso não autorizado")).toBeVisible();
    expect(api.pollResults).not.toHaveBeenCalled();
    expect(api.listParticipations).not.toHaveBeenCalled();
  });
});
