import type { ReactNode } from "react";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { PollsPage } from "./PollsPage";
import { PollEditorPage } from "./PollEditorPage";
import { getDefaultAdminPath } from "@/services/permissions";
import type { Poll } from "@/types/polls";
const actor = vi.hoisted(() => ({
  permissions: [
    "poll.read",
    "poll.manage",
    "poll.publish",
    "poll.close",
    "poll.results.read",
  ],
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "actor", permissions: actor.permissions } }),
}));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({
    title,
    actions,
    description,
  }: {
    title: string;
    actions: ReactNode;
    description: string;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
    </header>
  ),
}));
const poll: Poll = {
  mode: "mixed",
  id: "poll-1",
  programId: "program-1",
  programName: "Manhã 88",
  slug: "pergunta",
  question: "Você participa?",
  context: "Contexto",
  identificationPolicy: "optional",
  allowMessage: true,
  options: [
    { id: "yes", text: "Sim" },
    { id: "no", text: "Não" },
  ],
  editionStartsAt: "2026-11-12T09:00:00.000Z",
  editionEndsAt: "2026-11-12T12:00:00.000Z",
  startsAt: "2026-11-12T09:30:00.000Z",
  endsAt: "2026-11-12T11:00:00.000Z",
  state: "draft",
  version: 4,
  totalVotes: 0,
};
const authorizedProgram = {
  id: "program-1",
  name: "Manhã 88",
  slug: "manha",
  description: "",
  active: true,
  version: 1,
};
let catalog: () => Promise<Response>;
let current: Poll;
let list: Poll[];
let fail: string;
let requests: {
  url: URL;
  method: string;
  body: Record<string, unknown> | undefined;
}[];
function Location() {
  return <output data-testid="url">{useLocation().search}</output>;
}
function open(path = "/enquetes") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Location />
        <Routes>
          <Route path="/enquetes" element={<PollsPage />} />
          <Route path="/enquetes/nova" element={<PollEditorPage />} />
          <Route path="/enquetes/:id" element={<PollEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
beforeEach(() => {
  catalog = async () =>
    Response.json({ items: [authorizedProgram], nextCursor: null });
  current = structuredClone(poll);
  list = [current];
  fail = "";
  requests = [];
  actor.permissions = [
    "poll.read",
    "poll.manage",
    "poll.publish",
    "poll.close",
    "poll.results.read",
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, method, body });
      if (fail && method !== "GET")
        return new Response(
          JSON.stringify({ code: "CONFLICT", message: fail }),
          { status: 409 },
        );
      if (method === "GET" && url.pathname === "/api/admin/programs")
        return catalog();
      if (method === "GET" && url.pathname === "/api/admin/programs/program-1")
        return Response.json({
          program: authorizedProgram,
          slots: [],
          hosts: [],
        });
      if (url.pathname.endsWith("/results"))
        return Response.json({
          totalVotes: 3,
          options: [
            { id: "yes", text: "Sim", votes: 3, percentage: 100 },
            { id: "no", text: "Não", votes: 0, percentage: 0 },
          ],
        });
      if (url.pathname === "/api/admin/polls")
        return Response.json({ items: list, nextCursor: null });
      if (method === "POST" && url.pathname.endsWith("/polls")) {
        current = {
          ...current,
          ...body,
          options: body.options.map((text: string, i: number) => ({
            id: String(i),
            text,
          })),
          version: 1,
        };
        return Response.json(current, { status: 201 });
      }
      if (method === "PATCH") {
        current = {
          ...current,
          ...body,
          options: body.options.map((text: string, i: number) => ({
            id: String(i),
            text,
          })),
          version: current.version + 1,
        };
        return Response.json(current);
      }
      if (method === "POST") {
        current = {
          ...current,
          state: "scheduled",
          version: current.version + 1,
        };
        return Response.json(current);
      }
      return Response.json(current);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function fillNew() {
  fill("Programa", "program-1");
  fill("Slug", "nova-enquete");
  fill("Pergunta", "Nova pergunta?");
  fireEvent.click(screen.getByRole("button", { name: "Usar Sim / Não" }));
  fill("Início da edição", "2026-11-12T06:00");
  fill("Fim da edição", "2026-11-12T09:00");
  fill("Abertura da enquete", "2026-11-12T06:30");
  fill("Término da enquete", "2026-11-12T08:00");
}
describe("Enquetes: fluxo HTTP administrativo", () => {
  it("lista, persiste filtros na URL e não usa polling", async () => {
    open("/enquetes?programId=program-1&state=draft");
    expect(
      await screen.findByRole("link", { name: poll.question }),
    ).toBeVisible();
    expect(requests[0].url.searchParams.get("programId")).toBe("program-1");
    expect(requests[0].url.searchParams.get("state")).toBe("draft");
    fill("Estado", "closed");
    await waitFor(() =>
      expect(screen.getByTestId("url")).toHaveTextContent("state=closed"),
    );
    expect(
      requests.some((item) => item.url.searchParams.get("state") === "closed"),
    ).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Atualizar" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() =>
      expect(
        requests.filter(
          (item) => item.url.searchParams.get("state") === "closed",
        ).length,
      ).toBe(2),
    );
  });
  it("cria rascunho com defaults e UTC, sem publicar nem carregar resultados implicitamente", async () => {
    open("/enquetes/nova");
    fillNew();
    expect(screen.getByLabelText("Identificação")).toHaveValue("optional");
    expect(
      screen.getByRole("radio", { name: "Voto e mensagem" }),
    ).toHaveAttribute("data-state", "on");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await screen.findByRole("button", { name: "Salvar alterações" });
    const created = requests.find((item) => item.method === "POST");
    expect(created?.url.pathname).toBe("/api/admin/programs/program-1/polls");
    expect(created?.body).toMatchObject({
      options: ["Sim", "Não"],
      identificationPolicy: "optional",
      allowMessage: true,
      startsAt: new Date("2026-11-12T06:30").toISOString(),
    });
    expect(created?.body).not.toHaveProperty("programId");
    expect(
      requests.some((item) => /publish|results/.test(item.url.pathname)),
    ).toBe(false);
  });
  it("preseleciona a data de edição ao iniciar uma enquete pelo calendário", () => {
    open("/enquetes/nova?editionStartsAt=2026-11-20T09:30");
    expect(screen.getByLabelText("Início da edição")).toHaveValue("2026-11-20T09:30");
    expect(screen.getByText(/A data inicial veio do calendário/)).toBeVisible();
  });
  it("edita com versão e programa imutável; resultados são consultados manualmente", async () => {
    open("/enquetes/poll-1");
    await screen.findByRole("button", { name: "Salvar alterações" });
    expect(screen.getByLabelText("Programa")).toBeDisabled();
    fill("Pergunta", "Pergunta alterada?");
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() =>
      expect(requests.some((item) => item.method === "PATCH")).toBe(true),
    );
    const patched = requests.find((item) => item.method === "PATCH");
    expect(patched?.body).toMatchObject({
      version: 4,
      question: "Pergunta alterada?",
      options: ["Sim", "Não"],
    });
    expect(patched?.body).not.toHaveProperty("programId");
    expect(
      screen.getByRole("link", { name: "Resultados e mensagens" }),
    ).toHaveAttribute("href", "/enquetes/poll-1/resultados");
  });
  it("mantém formulário após erro 409", async () => {
    open("/enquetes/poll-1");
    await screen.findByRole("button", { name: "Salvar alterações" });
    fail = "Versão desatualizada";
    fill("Pergunta", "Minha alteração");
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByText(/Versão desatualizada/)).toBeVisible();
    expect(screen.getByLabelText("Pergunta")).toHaveValue("Minha alteração");
  });
  it("exige AlertDialog antes de publicar e envia somente versão", async () => {
    open();
    const trigger = await screen.findByRole("button", {
      name: `Ações de ${poll.question}`,
    });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Publicar" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/não publica o snapshot/i)).toBeVisible();
    expect(requests.filter((item) => item.method === "POST")).toHaveLength(0);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirmar publicar" }),
    );
    await waitFor(() =>
      expect(requests.find((item) => item.method === "POST")?.body).toEqual({
        version: 4,
      }),
    );
    expect(requests.find((item) => item.method === "POST")?.url.pathname).toBe(
      "/api/admin/polls/poll-1/publish",
    );
  });
  it("perfil somente leitura não recebe controles de gestão nem resultados sem grant", async () => {
    actor.permissions = ["poll.read"];
    open("/enquetes/poll-1");
    await screen.findByText("Consulta somente leitura");
    expect(
      screen.queryByRole("button", { name: "Salvar alterações" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Consultar resultados" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Pergunta")).toBeDisabled();
  });
  it("mostra estado vazio verdadeiro", async () => {
    list = [];
    open();
    expect(await screen.findByText("Nenhuma enquete encontrada")).toBeVisible();
  });
  it("mostra erro de leitura em vez de vazio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "Sem acesso ao recurso" }), {
            status: 404,
          }),
      ),
    );
    open();
    expect(await screen.findByText(/Sem acesso ao recurso/)).toBeVisible();
    expect(
      screen.queryByText("Nenhuma enquete encontrada"),
    ).not.toBeInTheDocument();
  });
  it("filtra edição em todas as páginas, sem enviar parâmetro fora do contrato", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        requests.push({ url, method: "GET", body: undefined });
        expect(url.searchParams.has("edition")).toBe(false);
        return Response.json(
          url.searchParams.get("after")
            ? { items: [poll], nextCursor: null }
            : {
                items: [
                  {
                    ...poll,
                    id: "outro-dia",
                    editionStartsAt: "2026-11-10T12:00:00Z",
                  },
                ],
                nextCursor: "cursor-2",
              },
        );
      }),
    );
    open("/enquetes?edition=2026-11-12");
    expect(
      await screen.findByRole("link", { name: poll.question }),
    ).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Próxima página" }),
    ).not.toBeInTheDocument();
  });
  it("valida janela antes de chamar a API e limita alternativas a dez", async () => {
    open("/enquetes/nova");
    fillNew();
    fill("Término da enquete", "2026-11-12T10:00");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(
      await screen.findByText(/A janela da enquete deve estar dentro/),
    ).toBeVisible();
    expect(requests.some((item) => item.method === "POST")).toBe(false);
    for (let index = 0; index < 8; index++)
      fireEvent.click(
        screen.getByRole("button", { name: "Adicionar alternativa" }),
      );
    expect(
      screen.getByRole("button", { name: "Adicionar alternativa" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Alternativa 10")).toBeVisible();
  });
  it.each([
    ["published", "Retirar do ar", "close"],
    ["closed", "Arquivar", "archive"],
    ["draft", "Cancelar enquete", "cancel"],
  ] as const)(
    "confirma transição %s usando poll.close",
    async (state, label, action) => {
      current.state = state;
      actor.permissions = ["poll.read", "poll.close"];
      open();
      fireEvent.keyDown(
        await screen.findByRole("button", {
          name: `Ações de ${poll.question}`,
        }),
        { key: "Enter" },
      );
      fireEvent.click(await screen.findByRole("menuitem", { name: label }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: `Confirmar ${label.toLowerCase()}`,
        }),
      );
      await waitFor(() =>
        expect(
          requests.find((item) => item.method === "POST")?.url.pathname,
        ).toBe(`/api/admin/polls/poll-1/${action}`),
      );
    },
  );

  it("seleciona programas pelo nome no filtro e persiste somente o ID na URL", async () => {
    actor.permissions.push("program.read");
    open();
    expect(await screen.findByRole("option", { name: "Manhã 88" })).toHaveValue(
      "program-1",
    );
    const select = screen.getByRole("combobox", { name: "Programa" });
    expect(select.tagName).toBe("SELECT");
    expect(
      screen.queryByRole("textbox", { name: "Programa" }),
    ).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "program-1" } });
    await waitFor(() =>
      expect(screen.getByTestId("url")).toHaveTextContent(
        "programId=program-1",
      ),
    );
  });
  it("cria pelo Select autorizado e mantém o nome imutável na edição", async () => {
    actor.permissions.push("program.read");
    open("/enquetes/nova");
    await screen.findByRole("option", { name: "Manhã 88" });
    fillNew();
    expect(screen.getByRole("combobox", { name: "Programa" })).toHaveValue(
      "program-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await screen.findByRole("button", { name: "Salvar alterações" });
    expect(screen.getByRole("combobox", { name: "Programa" })).toBeDisabled();
    expect(
      (screen.getByRole("option", { name: "Manhã 88" }) as HTMLOptionElement)
        .selected,
    ).toBe(true);
    expect(requests.find((item) => item.method === "POST")?.url.pathname).toBe(
      "/api/admin/programs/program-1/polls",
    );
  });
  it.each(["/enquetes", "/enquetes/nova"])(
    "preserva ID sem solicitar catálogo quando não há program.read: %s",
    async (path) => {
      open(path);
      expect(screen.getByRole("textbox", { name: "Programa" })).toBeVisible();
      expect(
        screen.queryByRole("combobox", { name: "Programa" }),
      ).not.toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.queryByText("Carregando enquetes…"),
        ).not.toBeInTheDocument(),
      );
      expect(
        requests.some((item) =>
          item.url.pathname.startsWith("/api/admin/programs"),
        ),
      ).toBe(false);
    },
  );
  it.each(["/enquetes", "/enquetes/nova"])(
    "mostra loading real sem fallback ID: %s",
    async (path) => {
      actor.permissions.push("program.read");
      catalog = () => new Promise(() => {});
      open(path);
      expect(
        await screen.findByText("Carregando programas autorizados…"),
      ).toBeVisible();
      expect(screen.getByRole("combobox", { name: "Programa" })).toBeDisabled();
      expect(
        screen.queryByRole("textbox", { name: "Programa" }),
      ).not.toBeInTheDocument();
    },
  );
  it.each(["/enquetes", "/enquetes/nova"])(
    "mostra erro real e permite tentar catálogo novamente, sem ID: %s",
    async (path) => {
      actor.permissions.push("program.read");
      catalog = async () =>
        new Response(
          JSON.stringify({ message: "Catálogo temporariamente indisponível" }),
          { status: 503 },
        );
      open(path);
      expect(
        await screen.findByText(
          /Não foi possível carregar os programas: Catálogo temporariamente indisponível/,
        ),
      ).toBeVisible();
      expect(screen.getByRole("combobox", { name: "Programa" })).toBeDisabled();
      expect(
        screen.queryByRole("textbox", { name: "Programa" }),
      ).not.toBeInTheDocument();
      catalog = async () =>
        Response.json({ items: [authorizedProgram], nextCursor: null });
      fireEvent.click(
        screen.getByRole("button", {
          name: "Tentar carregar programas novamente",
        }),
      );
      expect(
        await screen.findByRole("option", { name: "Manhã 88" }),
      ).toBeVisible();
      expect(screen.getByRole("combobox", { name: "Programa" })).toBeEnabled();
    },
  );
  it.each(["/enquetes", "/enquetes/nova"])(
    "distingue catálogo autorizado vazio de falha: %s",
    async (path) => {
      actor.permissions.push("program.read");
      catalog = async () => Response.json({ items: [], nextCursor: null });
      open(path);
      expect(
        await screen.findByText("Nenhum programa autorizado disponível."),
      ).toBeVisible();
      expect(
        screen.queryByText(/Não foi possível carregar os programas:/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("textbox", { name: "Programa" }),
      ).not.toBeInTheDocument();
      if (path.endsWith("/nova"))
        expect(
          screen.getByRole("button", { name: "Salvar rascunho" }),
        ).toBeDisabled();
    },
  );
  it.each(["create", "edit"])(
    "sincroniza versão depois de publicação/refetch e salva sem PATCH stale: %s",
    async (mode) => {
      open(mode === "create" ? "/enquetes/nova" : "/enquetes/poll-1");
      if (mode === "create") {
        fillNew();
        fireEvent.click(
          screen.getByRole("button", { name: "Salvar rascunho" }),
        );
      }
      await screen.findByRole("button", { name: "Salvar alterações" });
      fireEvent.keyDown(screen.getByRole("button", { name: /Ações de/ }), {
        key: "Enter",
      });
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Publicar" }),
      );
      fireEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "Confirmar publicar",
        }),
      );
      const nextVersion = mode === "create" ? 2 : 5;
      await screen.findByText(`Versão ${nextVersion}`);
      fill("Pergunta", "Depois da transição?");
      fireEvent.click(
        screen.getByRole("button", { name: "Salvar alterações" }),
      );
      await waitFor(() =>
        expect(
          requests.find((item) => item.method === "PATCH")?.body?.version,
        ).toBe(nextVersion),
      );
      await screen.findByText(`Versão ${nextVersion + 1}`);
    },
  );
  it("bloqueia ações com edição pendente e preserva os campos em refetch concorrente", async () => {
    const { client } = open("/enquetes/poll-1");
    await screen.findByRole("button", { name: "Salvar alterações" });
    fill("Pergunta", "Minha edição pendente");
    expect(
      screen.getByRole("button", { name: "Ações indisponíveis" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Ações de/ }),
    ).not.toBeInTheDocument();
    current = {
      ...current,
      version: 5,
      state: "scheduled",
      question: "Pergunta do servidor",
    };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["polls", "detail"] });
    });
    expect(screen.getByLabelText("Pergunta")).toHaveValue(
      "Minha edição pendente",
    );
    expect(screen.getByText("Versão 4")).toBeVisible();
    expect(await screen.findByText("A enquete foi atualizada")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Salvar alterações" }),
    ).toBeDisabled();
    expect(requests.some((item) => item.method === "POST")).toBe(false);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Descartar alterações e usar dados atuais",
      }),
    );
    expect(screen.getByLabelText("Pergunta")).toHaveValue(
      "Pergunta do servidor",
    );
    expect(screen.getByText("Versão 5")).toBeVisible();
    fill("Pergunta", "Edição após recarregar");
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() =>
      expect(
        requests.find((item) => item.method === "PATCH")?.body?.version,
      ).toBe(5),
    );
  });
  it("adota refetch limpo sem precisar remontar o editor antes de editar e salvar", async () => {
    const { client } = open("/enquetes/poll-1");
    await screen.findByRole("button", { name: "Salvar alterações" });
    current = {
      ...current,
      version: 6,
      question: "Pergunta atualizada pelo servidor",
    };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["polls", "detail"] });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Pergunta")).toHaveValue(
        "Pergunta atualizada pelo servidor",
      ),
    );
    expect(screen.getByText("Versão 6")).toBeVisible();
    fill("Pergunta", "Nova edição limpa");
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() =>
      expect(
        requests.find((item) => item.method === "PATCH")?.body?.version,
      ).toBe(6),
    );
  });
  it("direciona perfil exclusivo de enquetes", () => {
    expect(
      getDefaultAdminPath({ permissions: ["poll.read"] } as Parameters<
        typeof getDefaultAdminPath
      >[0]),
    ).toBe("/enquetes");
  });
});

describe("Novo editor de enquetes", () => {
  it("gera slug da pergunta somente até edição manual", () => {
    open("/enquetes/nova");
    fill("Pergunta", "Qual é a sua opinião?");
    expect(screen.getByLabelText("Slug")).toHaveValue("qual-e-a-sua-opiniao");
    fill("Slug", "slug-manual");
    fill("Pergunta", "Outra pergunta?");
    expect(screen.getByLabelText("Slug")).toHaveValue("slug-manual");
  });
  it("envia message sem alternativas e imagem opcional", async () => {
    open("/enquetes/nova");
    fillNew();
    fireEvent.click(screen.getByRole("radio", { name: "Somente mensagem" }));
    expect(screen.queryByLabelText("Alternativa 1")).not.toBeInTheDocument();
    fill("Imagem da enquete (URL opcional)", "https://example.com/poll.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() =>
      expect(requests.some((item) => item.method === "POST")).toBe(true),
    );
    expect(requests.find((item) => item.method === "POST")?.body).toMatchObject(
      {
        mode: "message",
        options: [],
        allowMessage: true,
        imageUrl: "https://example.com/poll.jpg",
      },
    );
  });
  it("default mixed e alternância preserva Sim/Não", () => {
    open("/enquetes/nova");
    expect(
      screen.getByRole("radio", { name: "Voto e mensagem" }),
    ).toHaveAttribute("data-state", "on");
    fireEvent.click(screen.getByRole("button", { name: "Usar Sim / Não" }));
    fireEvent.click(screen.getByRole("radio", { name: "Somente mensagem" }));
    fireEvent.click(screen.getByRole("radio", { name: "Somente voto" }));
    expect(screen.getByLabelText("Alternativa 1")).toHaveValue("Sim");
    expect(screen.getByLabelText("Alternativa 2")).toHaveValue("Não");
  });
});

it("publica snapshot apenas após ação e confirmação explícitas", async () => {
  open();
  const trigger = await screen.findByRole("button", { name: /Ações de/ });
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Publicar no institucional" }),
  );
  const dialog = await screen.findByRole("alertdialog");
  expect(requests.some((item) => item.method === "POST")).toBe(false);
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Confirmar publicar no institucional",
    }),
  );
  await waitFor(() =>
    expect(requests.find((item) => item.method === "POST")?.url.pathname).toBe(
      "/api/admin/polls/poll-1/publish-public",
    ),
  );
  expect(requests.find((item) => item.method === "POST")?.body).toBeUndefined();
});
it("não oferece publicação pública sem poll.publish", async () => {
  actor.permissions = ["poll.read", "poll.close"];
  open();
  fireEvent.keyDown(await screen.findByRole("button", { name: /Ações de/ }), {
    key: "Enter",
  });
  expect(
    screen.queryByRole("menuitem", { name: "Publicar no institucional" }),
  ).not.toBeInTheDocument();
});
it("omite imagem vazia e envia vote sem mensagem", async () => {
  open("/enquetes/nova");
  fillNew();
  fireEvent.click(screen.getByRole("radio", { name: "Somente voto" }));
  fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
  await waitFor(() =>
    expect(requests.some((item) => item.method === "POST")).toBe(true),
  );
  expect(requests.find((item) => item.method === "POST")?.body).toMatchObject({
    mode: "vote",
    allowMessage: false,
    options: ["Sim", "Não"],
  });
  expect(
    requests.find((item) => item.method === "POST")?.body,
  ).not.toHaveProperty("imageUrl");
});
it("não regenera slug de uma enquete existente", async () => {
  open("/enquetes/poll-1");
  await screen.findByRole("button", { name: "Salvar alterações" });
  fill("Pergunta", "Nova pergunta existente");
  expect(screen.getByLabelText("Slug")).toHaveValue("pergunta");
});

it.each(["participation.read", "poll.results.read"])(
  "abre enquete sem consultar catálogo quando só há %s",
  (permission) => {
    actor.permissions = [permission];
    open();
    expect(screen.getByLabelText("ID da enquete")).toBeVisible();
    expect(requests).toHaveLength(0);
    fill("ID da enquete", "poll-1");
    expect(screen.getByRole("link", { name: "Abrir enquete" })).toHaveAttribute(
      "href",
      "/enquetes/poll-1/resultados",
    );
  },
);
