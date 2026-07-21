import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarRange,
  Edit3,
  Plus,
  Send,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/services/api";
import { formatDateTime } from "@/lib/formatters";
import type { Campaign, CampaignInput, CampaignStatus } from "@/types/api";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingBlock } from "@/components/ui/LoadingBlock";
import { CampaignFormDialog } from "@/components/campaigns/CampaignFormDialog";
import { usePageTitle } from "@/hooks/usePageTitle";

const statusPresentation: Record<
  CampaignStatus,
  { label: string; tone: "blue" | "green" | "yellow" | "gray" }
> = {
  draft: { label: "Rascunho", tone: "gray" },
  active: { label: "Ativa", tone: "green" },
  paused: { label: "Pausada", tone: "yellow" },
  closed: { label: "Encerrada", tone: "gray" },
};

const INSTITUTIONAL_MODAL_PLACEMENT = "institutional_modal";

export function CampaignsPage() {
  usePageTitle("Campanhas");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: api.listCampaigns,
  });

  const placementsQuery = useQuery({
    queryKey: ["campaign-placements"],
    queryFn: api.listCampaignPlacements,
  });

  const institutionalPlacement = placementsQuery.data?.items.find(
    (placement) => placement.placementKey === INSTITUTIONAL_MODAL_PLACEMENT,
  );

  const saveMutation = useMutation({
    mutationFn: async ({
      input,
      publishInInstitutionalModal,
    }: {
      input: CampaignInput;
      publishInInstitutionalModal: boolean;
    }) => {
      const campaign = selectedCampaign
        ? await api.updateCampaign(selectedCampaign.id, input)
        : await api.createCampaign(input);

      if (publishInInstitutionalModal && campaign.status === "active") {
        await api.publishCampaign(campaign.id, INSTITUTIONAL_MODAL_PLACEMENT);
      }

      return { campaign, published: publishInInstitutionalModal && campaign.status === "active" };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
        queryClient.invalidateQueries({ queryKey: ["campaign-placements"] }),
      ]);
      if (result.published) {
        toast.success("Campanha salva e publicada no modal do institucional.");
      } else {
        toast.success(selectedCampaign ? "Campanha atualizada." : "Campanha criada.");
      }
      setDialogOpen(false);
      setSelectedCampaign(null);
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Não foi possível salvar a campanha.",
      );
    },
  });

  const publishMutation = useMutation({
    mutationFn: (campaignId: string) => api.publishCampaign(campaignId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
        queryClient.invalidateQueries({ queryKey: ["campaign-placements"] }),
      ]);
      toast.success("Campanha publicada no modal do institucional.");
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Não foi possível publicar a campanha.",
      );
    },
  });

  const openCreate = () => {
    setSelectedCampaign(null);
    setDialogOpen(true);
  };

  const openEdit = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setDialogOpen(true);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1500px] space-y-6">
        <PageHeader
          eyebrow="Configuração"
          title="Campanhas"
          description="Controle quando o formulário público pode receber cadastros e qual aviso de privacidade deve ser exibido."
          actions={
            user?.role === "admin" ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Nova campanha
              </Button>
            ) : undefined
          }
        />

        <div className="rounded-xl border border-genesis-border bg-indigo-50 p-4 sm:flex sm:items-center sm:gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-genesis-surface text-genesis-primary shadow-sm">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="mt-3 sm:mt-0">
            <p className="font-semibold text-genesis-text">A API é a fonte de autoridade</p>
            <p className="mt-1 text-sm text-genesis-muted">
              Alterar o status para pausada ou encerrada impede novos cadastros sem exigir novo deploy do site.
            </p>
          </div>
        </div>

        {campaignsQuery.isLoading ? (
          <LoadingBlock />
        ) : campaignsQuery.isError ? (
          <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-genesis-error">
            Não foi possível carregar as campanhas.
          </div>
        ) : campaignsQuery.data?.items.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="Nenhuma campanha cadastrada"
            description="Crie a primeira campanha para liberar o formulário público."
          />
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {campaignsQuery.data?.items.map((campaign) => {
              const presentation = statusPresentation[campaign.status];
              const isPublishedInInstitutionalModal =
                institutionalPlacement?.campaignId === campaign.id;
              return (
                <article
                  key={campaign.id}
                  className="animate-fade-up rounded-xl border border-genesis-border bg-genesis-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-genesis-primary/30 hover:shadow-panel"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="grid h-11 w-11 place-items-center rounded-lg bg-genesis-text text-white">
                      <CalendarRange className="h-5 w-5" />
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge tone={presentation.tone}>{presentation.label}</Badge>
                      {isPublishedInInstitutionalModal && (
                        <Badge tone="blue">Publicada no institucional</Badge>
                      )}
                    </div>
                  </div>
                  <h2 className="mt-5 font-display text-xl font-semibold text-genesis-text">
                    {campaign.name}
                  </h2>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-genesis-muted">
                    {campaign.description}
                  </p>
                  <div className="mt-5 space-y-3 border-t border-genesis-border pt-4 text-sm">
                    <div className="flex gap-2 text-genesis-muted">
                      <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-genesis-neutral" />
                      <div>
                        <p>{formatDateTime(campaign.startsAt)}</p>
                        <p className="mt-1 text-xs text-genesis-neutral">
                          até{" "}
                          {campaign.endsAt
                            ? formatDateTime(campaign.endsAt)
                            : "sem data final"}
                        </p>
                      </div>
                    </div>
                    <p className="truncate rounded-md bg-genesis-bg px-3 py-2 font-mono text-xs text-genesis-muted">
                      {campaign.slug}
                    </p>
                  </div>
                  {user?.role === "admin" && (
                    <div className="mt-5 grid gap-2 sm:grid-cols-2">
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => openEdit(campaign)}
                      >
                        <Edit3 className="h-4 w-4" />
                        Editar
                      </Button>
                      <Button
                        className="w-full"
                        onClick={() => publishMutation.mutate(campaign.id)}
                        disabled={
                          campaign.status !== "active" ||
                          publishMutation.isPending || isPublishedInInstitutionalModal
                        }
                      >
                        <Send className="h-4 w-4" />
                        {isPublishedInInstitutionalModal ? "Publicada" : "Publicar"}
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}
      </div>

      {dialogOpen && (
        <CampaignFormDialog
          open={dialogOpen}
          campaign={selectedCampaign}
          publishedInInstitutionalModal={
            selectedCampaign
              ? institutionalPlacement?.campaignId === selectedCampaign.id
              : true
          }
          submitting={saveMutation.isPending}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setSelectedCampaign(null);
          }}
          onSubmit={async (input, options) => {
            await saveMutation.mutateAsync({ input, ...options });
          }}
        />
      )}
    </AppShell>
  );
}
