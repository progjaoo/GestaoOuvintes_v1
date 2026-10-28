import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedEditorPage } from "./FeedEditorPage";
import { FeedMediaLibraryPage } from "./FeedMediaLibraryPage";
import { FeedMediaPickerDialog } from "@/components/feed/FeedMediaPickerDialog";
import { api } from "@/services/api";
import type { EditorialMediaAsset } from "@/types/feed";

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageHeader: ({ title, actions }: { title: string; actions: ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/api", () => ({
  ApiError: class extends Error {},
  api: {
    listFeedCategories: vi.fn(), listFeedAssets: vi.fn(),
    getFeedAssetPreview: vi.fn(), uploadFeedAsset: vi.fn(),
  },
}));

const legacyAsset: EditorialMediaAsset = {
  id: "legacy-image", mediaType: "image", mimeType: "image/jpeg", byteSize: 1000,
  status: "ready", width: 640, height: 480, originalName: "Imagem antiga.jpg",
};

function renderFeed(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

function expectStandards(container: HTMLElement) {
  const view = within(container);
  expect(view.getByText(/Capa do card.*1260 × 900 px \(7:5\)/)).toBeInTheDocument();
  expect(view.getByText(/Imagem de abertura.*1920 × 1080 px \(16:9\)/)).toBeInTheDocument();
  expect(view.getByText(/corpo ou galeria.*1920 px de largura.*imagem inteira, sem cortes ou distorções/)).toBeInTheDocument();
  expect(view.getByText(/Poster estático de GIF ou vídeo.*1920 × 1080 px \(16:9\)/)).toBeInTheDocument();
  expect(view.getByText(/recomendações, não requisitos de upload.*Arquivos antigos/)).toBeInTheDocument();
}

function addBlock(name: string) {
  const menu = screen.getByText("Inserir bloco").closest("details")!;
  menu.open = true;
  fireEvent.click(within(menu).getByRole("button", { name }));
}

describe("orientações editoriais de mídia do Feed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listFeedCategories).mockResolvedValue({ items: [{ id: "news", name: "Notícias", slug: "noticias", active: true }] });
    vi.mocked(api.listFeedAssets).mockResolvedValue({ items: [legacyAsset], page: 1, pageSize: 50 });
    vi.mocked(api.getFeedAssetPreview).mockResolvedValue({ url: "/legacy.jpg", expiresInSeconds: 60 });
    vi.mocked(api.uploadFeedAsset).mockResolvedValue(legacyAsset);
  });
  afterEach(cleanup);

  it("orienta capa, abertura e o uso público da data do acontecimento", () => {
    renderFeed(<FeedEditorPage />);
    expect(screen.getByText(/Capa do card.*1260 × 900 px \(7:5\)/)).toBeInTheDocument();
    expect(screen.getByText(/Imagem de abertura.*1920 × 1080 px \(16:9\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Data do acontecimento/)).toHaveAttribute("type", "date");
    expect(screen.getByText(/filtro por ano.*ordenação por data do acontecimento.*Sem data/)).toBeInTheDocument();
    expect(screen.queryByText(/não altera a ordem de publicação/)).not.toBeInTheDocument();
  });

  it("orienta imagens do corpo e galerias ainda vazias, preservando a imagem inteira", () => {
    renderFeed(<FeedEditorPage />);
    addBlock("Imagem");
    addBlock("Galeria");
    expect(screen.getAllByText(/corpo ou galeria.*1920 px de largura.*imagem inteira, sem cortes ou distorções/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Adicionar imagem" })).toBeEnabled();
  });

  it("orienta GIF, vídeo MP4 e os dois campos de poster", () => {
    renderFeed(<FeedEditorPage />);
    addBlock("GIF");
    addBlock("Vídeo");
    fireEvent.change(screen.getByLabelText("Fonte do vídeo"), { target: { value: "asset" } });
    expect(screen.getByText(/GIF: preserve a proporção original e a animação inteira/)).toHaveTextContent("1920 × 1080 px (16:9)");
    expect(screen.getByText(/Vídeo: preserve a proporção original/)).toHaveTextContent("1920 × 1080 px (16:9)");
    expect(screen.getAllByText(/Poster estático de GIF ou vídeo.*1920 × 1080 px \(16:9\)/)).toHaveLength(2);
  });

  it("exibe os padrões na biblioteca e no diálogo de envio", async () => {
    renderFeed(<FeedMediaLibraryPage />);
    expectStandards(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Enviar mídia" }));
    expectStandards(await screen.findByRole("dialog"));
  });

  it("exibe os padrões no seletor sem bloquear uma imagem antiga menor", async () => {
    const onSelect = vi.fn();
    renderFeed(<FeedMediaPickerDialog open onOpenChange={vi.fn()} allowedTypes={["image"]} onSelect={onSelect} />);
    expectStandards(screen.getByRole("dialog"));
    const choice = await screen.findByRole("button", { name: /Imagem antiga.jpg/ });
    expect(choice).toBeEnabled();
    fireEvent.click(choice);
    expect(onSelect).toHaveBeenCalledWith(legacyAsset);
  });

  it("mantém o envio do arquivo original sem impor dimensões recomendadas", async () => {
    const { baseElement } = renderFeed(<FeedMediaPickerDialog open onOpenChange={vi.fn()} allowedTypes={["image"]} onSelect={vi.fn()} />);
    const file = new File(["original"], "imagem-menor.jpg", { type: "image/jpeg" });
    const input = baseElement.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(api.uploadFeedAsset).toHaveBeenCalledWith(file, "image", expect.any(Function), expect.any(AbortSignal)));
  });
});
