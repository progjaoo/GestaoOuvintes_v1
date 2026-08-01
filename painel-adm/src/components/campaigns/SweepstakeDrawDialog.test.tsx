import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import type { Campaign, SweepstakeDrawResponse, SweepstakeStatusResponse } from "@/types/api";
import { SweepstakeDrawDialog } from "./SweepstakeDrawDialog";

vi.mock("@/services/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      getSweepstakeStatus: vi.fn(),
      drawSweepstake: vi.fn(),
      redrawSweepstake: vi.fn(),
    },
  };
});

const campaign: Campaign = {
  id: "9ac05339-5471-4ef4-b51f-fcda829df895",
  slug: "sorteio-32-anos",
  name: "Sorteio 32 anos",
  title: "Concorra",
  description: "Campanha de teste",
  status: "closed",
  type: "sweepstake",
  startsAt: "2026-08-01T10:00:00.000Z",
  endsAt: "2026-08-02T10:00:00.000Z",
  privacyNoticeVersion: "2026-08-01",
  privacyNoticeUrl: "/privacidade",
  termsUrl: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
};

const draw: SweepstakeDrawResponse = {
  drawId: "4b665282-031f-4ced-ab34-aa7c317f4e58",
  campaignId: campaign.id,
  sequence: 1,
  eligibleCount: 3,
  drawnAt: "2026-08-02T11:00:00.000Z",
  animationNames: ["Ana", "Bruno", "Maria da Silva"],
  winner: {
    participationId: "03549dc4-a4e0-4d53-9298-ff580e745f62",
    name: "Maria da Silva",
    city: "Volta Redonda",
    neighborhood: "Retiro",
    phone: "24999990000",
  },
};

const status: SweepstakeStatusResponse = {
  campaignId: campaign.id,
  campaignName: campaign.name,
  campaignStatus: "closed",
  campaignType: "sweepstake",
  eligibleCount: 3,
  legacyUnlinkedCount: 0,
  canDraw: true,
  currentDraw: null,
};

const mockedApi = vi.mocked(api);

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  mockedApi.getSweepstakeStatus.mockResolvedValue(status);
  mockedApi.drawSweepstake.mockResolvedValue(draw);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("SweepstakeDrawDialog", () => {
  it("realiza o sorteio na API e exibe todos os dados do vencedor", async () => {
    render(<SweepstakeDrawDialog open campaign={campaign} onOpenChange={vi.fn()} />);

    expect(screen.getByText("Conferindo participantes...")).toBeInTheDocument();
    expect(await screen.findByText("Maria da Silva")).toBeInTheDocument();
    expect(screen.getByText("Volta Redonda")).toBeInTheDocument();
    expect(screen.getByText("Retiro")).toBeInTheDocument();
    expect(screen.getByText("(24) 99999-0000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sortear novamente" })).toBeInTheDocument();
    expect(screen.getByText("Fechar")).toBeInTheDocument();
    expect(mockedApi.drawSweepstake).toHaveBeenCalledTimes(1);
  });

  it("mantem a animacao com nomes por pelo menos 8 segundos antes do vencedor", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));

    render(<SweepstakeDrawDialog open campaign={campaign} onOpenChange={vi.fn()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Sorteando entre os participantes")).toBeInTheDocument();
    expect(screen.queryByText("Pessoa sorteada")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_999);
    });
    expect(screen.queryByText("Pessoa sorteada")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText("Pessoa sorteada")).toBeInTheDocument();
  });

  it("recupera um resultado existente sem criar outro sorteio", async () => {
    mockedApi.getSweepstakeStatus.mockResolvedValue({ ...status, canDraw: false, currentDraw: draw });

    render(<SweepstakeDrawDialog open campaign={campaign} onOpenChange={vi.fn()} />);

    expect(await screen.findByText("Maria da Silva")).toBeInTheDocument();
    expect(mockedApi.drawSweepstake).not.toHaveBeenCalled();
  });

  it("preserva o resultado anterior e exibe o novo vencedor no ressorteio", async () => {
    const nextDraw: SweepstakeDrawResponse = {
      ...draw,
      drawId: "4bd82e8f-f8eb-4404-8508-c99d5c35feaa",
      sequence: 2,
      animationNames: ["João Pereira"],
      winner: { ...draw.winner, participationId: "20d1ca60-96dd-431a-92a2-1c4992889d44", name: "João Pereira" },
    };
    mockedApi.redrawSweepstake.mockResolvedValue(nextDraw);

    render(<SweepstakeDrawDialog open campaign={campaign} onOpenChange={vi.fn()} />);
    await screen.findByText("Maria da Silva");
    fireEvent.click(screen.getByRole("button", { name: "Sortear novamente" }));

    expect(await screen.findByText("João Pereira")).toBeInTheDocument();
    expect(mockedApi.redrawSweepstake).toHaveBeenCalledWith(
      campaign.id,
      draw.drawId,
      expect.any(String),
    );
  });

  it("impede fechar o modal enquanto a requisicao esta pendente", async () => {
    mockedApi.getSweepstakeStatus.mockReturnValue(new Promise(() => undefined));
    const onOpenChange = vi.fn();

    render(<SweepstakeDrawDialog open campaign={campaign} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    await waitFor(() => expect(onOpenChange).not.toHaveBeenCalled());
  });
});
