import { useState, type FormEvent } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { dateTimeLocalToIso, isoToDateTimeLocal } from "@/lib/formatters";
import type { Campaign, CampaignInput, CampaignStatus } from "@/types/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

interface CampaignFormState {
  slug: string;
  name: string;
  title: string;
  description: string;
  status: CampaignStatus;
  startsAt: string;
  endsAt: string;
  privacyNoticeVersion: string;
  privacyNoticeUrl: string;
  termsUrl: string;
  publishInInstitutionalModal: boolean;
}

const emptyForm: CampaignFormState = {
  slug: "",
  name: "",
  title: "",
  description: "",
  status: "draft",
  startsAt: "",
  endsAt: "",
  privacyNoticeVersion: "",
  privacyNoticeUrl: "/privacidade",
  termsUrl: "",
  publishInInstitutionalModal: true,
};

function campaignToForm(campaign: Campaign, publishedInInstitutionalModal: boolean): CampaignFormState {
  return {
    slug: campaign.slug,
    name: campaign.name,
    title: campaign.title,
    description: campaign.description,
    status: campaign.status,
    startsAt: isoToDateTimeLocal(campaign.startsAt),
    endsAt: isoToDateTimeLocal(campaign.endsAt),
    privacyNoticeVersion: campaign.privacyNoticeVersion,
    privacyNoticeUrl: campaign.privacyNoticeUrl,
    termsUrl: campaign.termsUrl ?? "",
    publishInInstitutionalModal: publishedInInstitutionalModal,
  };
}

export function CampaignFormDialog({
  open,
  campaign,
  publishedInInstitutionalModal,
  submitting,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  campaign: Campaign | null;
  publishedInInstitutionalModal: boolean;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CampaignInput, options: { publishInInstitutionalModal: boolean }) => Promise<void>;
}) {
  const [form, setForm] = useState<CampaignFormState>(() =>
    campaign ? campaignToForm(campaign, publishedInInstitutionalModal) : emptyForm,
  );
  const [error, setError] = useState("");

  const update = (field: keyof CampaignFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateBoolean = (field: keyof CampaignFormState, value: boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (
      !form.slug ||
      !form.name ||
      !form.title ||
      !form.description ||
      !form.startsAt ||
      !form.privacyNoticeVersion ||
      !form.privacyNoticeUrl
    ) {
      setError("Preencha todos os campos obrigatórios.");
      return;
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) {
      setError("O slug deve usar letras minúsculas, números e hífens.");
      return;
    }

    if (form.endsAt && form.endsAt <= form.startsAt) {
      setError("A data final deve ser posterior à data inicial.");
      return;
    }

    try {
      await onSubmit(
        {
          slug: form.slug,
          name: form.name,
          title: form.title,
          description: form.description,
          status: form.status,
          startsAt: dateTimeLocalToIso(form.startsAt),
          endsAt: form.endsAt ? dateTimeLocalToIso(form.endsAt) : null,
          privacyNoticeVersion: form.privacyNoticeVersion,
          privacyNoticeUrl: form.privacyNoticeUrl,
          termsUrl: form.termsUrl || null,
        },
        {
          publishInInstitutionalModal:
            form.status === "active" && form.publishInInstitutionalModal,
        },
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Não foi possível salvar a campanha.",
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={campaign ? "Editar campanha" : "Nova campanha"}
      description="Configure período, disponibilidade e textos usados pelo formulário público."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="campaign-form" disabled={submitting}>
            {submitting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {submitting ? "Salvando..." : "Salvar campanha"}
          </Button>
        </>
      }
    >
      <form id="campaign-form" className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
        <Field label="Nome interno *" htmlFor="campaign-name">
          <Input
            id="campaign-name"
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
            placeholder="Lançamento do institucional"
          />
        </Field>
        <Field label="Slug *" htmlFor="campaign-slug" hint="Não altere após integrar ao frontend.">
          <Input
            id="campaign-slug"
            value={form.slug}
            onChange={(event) => update("slug", event.target.value.toLowerCase())}
            placeholder="lancamento-institucional-2026"
            disabled={Boolean(campaign)}
          />
        </Field>
        <Field label="Título público *" htmlFor="campaign-title" className="sm:col-span-2">
          <Input
            id="campaign-title"
            value={form.title}
            onChange={(event) => update("title", event.target.value)}
            placeholder="Faça parte da história da Rádio 88 FM"
          />
        </Field>
        <Field label="Descrição pública *" htmlFor="campaign-description" className="sm:col-span-2">
          <textarea
            id="campaign-description"
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
            rows={3}
            className="w-full rounded-md border border-genesis-border bg-genesis-surface px-3 py-3 text-base text-genesis-text shadow-none placeholder:text-genesis-neutral focus:border-genesis-primary focus:ring-4 focus:ring-genesis-primary/10 sm:text-sm"
          />
        </Field>
        <Field label="Status *" htmlFor="campaign-status">
          <Select
            id="campaign-status"
            value={form.status}
            onChange={(event) => update("status", event.target.value)}
          >
            <option value="draft">Rascunho</option>
            <option value="active">Ativa</option>
            <option value="paused">Pausada</option>
            <option value="closed">Encerrada</option>
          </Select>
        </Field>
        <div className="rounded-xl border border-genesis-border bg-indigo-50 p-4 sm:col-span-2">
          <label className="flex items-start gap-3 text-sm font-semibold text-genesis-text">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-genesis-border text-genesis-primary focus:ring-genesis-primary"
              checked={form.publishInInstitutionalModal}
              onChange={(event) =>
                updateBoolean("publishInInstitutionalModal", event.target.checked)
              }
              disabled={form.status !== "active"}
            />
            <span>
              Publicar no modal do institucional
              <span className="mt-1 block font-normal leading-5 text-genesis-muted">
                Quando a campanha estiver ativa, esta opcao faz o site institucional exibir o modal para visitantes elegiveis.
              </span>
            </span>
          </label>
          {form.status !== "active" && (
            <p className="mt-3 text-xs font-semibold text-genesis-muted">
              Para publicar no site, altere o status para Ativa.
            </p>
          )}
        </div>
        <Field label="Versão do aviso *" htmlFor="campaign-privacy-version">
          <Input
            id="campaign-privacy-version"
            value={form.privacyNoticeVersion}
            onChange={(event) => update("privacyNoticeVersion", event.target.value)}
            placeholder="2026-08-01"
          />
        </Field>
        <Field label="Início *" htmlFor="campaign-start">
          <Input
            id="campaign-start"
            type="datetime-local"
            value={form.startsAt}
            onChange={(event) => update("startsAt", event.target.value)}
          />
        </Field>
        <Field label="Fim" htmlFor="campaign-end">
          <Input
            id="campaign-end"
            type="datetime-local"
            value={form.endsAt}
            onChange={(event) => update("endsAt", event.target.value)}
          />
        </Field>
        <Field label="URL de privacidade *" htmlFor="campaign-privacy-url">
          <Input
            id="campaign-privacy-url"
            value={form.privacyNoticeUrl}
            onChange={(event) => update("privacyNoticeUrl", event.target.value)}
            placeholder="/privacidade"
          />
        </Field>
        <Field label="URL do regulamento" htmlFor="campaign-terms-url">
          <Input
            id="campaign-terms-url"
            value={form.termsUrl}
            onChange={(event) => update("termsUrl", event.target.value)}
            placeholder="/regulamento"
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-semibold text-genesis-error sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
