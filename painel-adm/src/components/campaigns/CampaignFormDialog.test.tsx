import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CampaignFormDialog } from "./CampaignFormDialog";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Nome interno *"), {
    target: { value: "Campanha teste" },
  });
  fireEvent.change(screen.getByLabelText("Slug *"), {
    target: { value: "campanha-teste" },
  });
  fireEvent.change(screen.getByLabelText("Título público *"), {
    target: { value: "Participe do sorteio" },
  });
  fireEvent.change(screen.getByLabelText("Descrição pública *"), {
    target: { value: "Cadastro para ouvintes." },
  });
  fireEvent.change(screen.getByLabelText("Versão do aviso *"), {
    target: { value: "2026-08-01" },
  });
  fireEvent.change(screen.getByLabelText("Início *"), {
    target: { value: "2026-08-01T10:00" },
  });
}

describe("CampaignFormDialog", () => {
  it("envia a opcao de publicar no modal quando a campanha e criada ativa", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <CampaignFormDialog
        open
        campaign={null}
        publishedInInstitutionalModal={false}
        submitting={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Status *"), {
      target: { value: "active" },
    });
    fireEvent.click(screen.getByRole("button", { name: /salvar campanha/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({
      publishInInstitutionalModal: true,
    });
  });

  it("nao publica automaticamente quando a campanha permanece em rascunho", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <CampaignFormDialog
        open
        campaign={null}
        publishedInInstitutionalModal={false}
        submitting={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /salvar campanha/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({
      publishInInstitutionalModal: false,
    });
  });
});
