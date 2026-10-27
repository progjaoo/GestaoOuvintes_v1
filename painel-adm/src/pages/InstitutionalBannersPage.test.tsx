import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstitutionalBannersPage } from "./InstitutionalBannersPage";
import { api } from "@/services/api";
import type { InstitutionalBanner } from "@/types/api";

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: ({ title, actions }: { title: string; actions: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/api", () => ({
  ApiError: class extends Error {},
  api: {
    listInstitutionalBanners: vi.fn(), updateInstitutionalBanner: vi.fn(),
    createInstitutionalBanner: vi.fn(), uploadInstitutionalBannerAsset: vi.fn(),
    reorderInstitutionalBanners: vi.fn(), setInstitutionalBannerActive: vi.fn(), deleteInstitutionalBanner: vi.fn(),
  },
}));

const banner: InstitutionalBanner = {
  id: "festa", title: "Festa da Radio", altText: "Arte da festa", placementKey: "home_hero",
  mediaAssetId: "asset", actionType: "none", destinationUrl: null, openInNewTab: false,
  displayOrder: 1, active: true, isPrimary: false, imageUrl: "https://media.example/festa.webp",
  objectKey: "festa.webp", width: 1920, height: 1080, byteSize: 1000,
  createdAt: "2026-10-27T12:00:00Z", updatedAt: "2026-10-27T12:00:00Z",
};

async function openEditor(item = banner, enabled = true) {
  vi.mocked(api.listInstitutionalBanners).mockResolvedValue({ items: [item], capabilities: { primaryBanner: enabled } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><InstitutionalBannersPage /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
}

describe("selecao editorial do banner principal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.updateInstitutionalBanner).mockResolvedValue(banner);
  });
  afterEach(cleanup);

  it("salva a escolha explicita sem reenviar a imagem", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("checkbox", { name: "Usar como banner principal" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar banner" }));
    await waitFor(() => expect(api.updateInstitutionalBanner).toHaveBeenCalledWith("festa", expect.objectContaining({ isPrimary: true, active: true })));
    expect(api.uploadInstitutionalBannerAsset).not.toHaveBeenCalled();
  });

  it("edicao comum nao envia uma escolha antiga de principal", async () => {
    await openEditor({ ...banner, isPrimary: true });
    fireEvent.click(screen.getByRole("button", { name: "Salvar banner" }));
    await waitFor(() => expect(api.updateInstitutionalBanner).toHaveBeenCalled());
    expect(vi.mocked(api.updateInstitutionalBanner).mock.calls[0][1]).not.toHaveProperty("isPrimary");
  });

  it("desmarcar permite restaurar o branco", async () => {
    await openEditor({ ...banner, isPrimary: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Usar como banner principal" }));
    expect(screen.getByText(/banner branco será restaurado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar banner" }));
    await waitFor(() => expect(api.updateInstitutionalBanner).toHaveBeenCalledWith("festa", expect.objectContaining({ isPrimary: false })));
  });

  it("aguarda a capacidade da API e a publicacao do banner", async () => {
    await openEditor(banner, false);
    expect(screen.getByRole("checkbox", { name: "Usar como banner principal" })).toBeDisabled();
    cleanup();
    await openEditor({ ...banner, active: false });
    const choice = screen.getByRole("checkbox", { name: "Usar como banner principal" });
    expect(choice).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Publicar banner" }));
    expect(choice).not.toBeDisabled();
  });
});
