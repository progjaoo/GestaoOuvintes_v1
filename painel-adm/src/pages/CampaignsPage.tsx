import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarRange,
  Edit3,
  Filter,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/services/api";
import { dateInputToIso, formatDateTime } from "@/lib/formatters";
import type { Campaign, CampaignFilters, CampaignInput, CampaignSortBy, CampaignStatus, SortDirection } from "@/types/api";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingBlock } from "@/components/ui/LoadingBlock";
import { Select } from "@/components/ui/Select";
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

interface CampaignFilterForm {
  q: string;
  status: "" | CampaignStatus;
  startDate: string;
  endDate: string;
  activeToday: boolean;
  sortBy: CampaignSortBy;
  sortDirection: SortDirection;
}

const emptyCampaignFilters: CampaignFilterForm = {
  q: "",
  status: "",
  startDate: "",
  endDate: "",
  activeToday: false,
  sortBy: "createdAt",
  sortDirection: "desc",
};

function toCampaignApiFilters(filters: CampaignFilterForm): CampaignFilters {
  return {
    q: filters.q.trim() || undefined,
    status: filters.status || undefined,
    startDate: dateInputToIso(filters.startDate),
    endDate: dateInputToIso(filters.endDate, true),
    activeToday: filters.activeToday || undefined,
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection,
  };
}

export function CampaignsPage() {
  usePageTitle("Campanhas");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [filters, setFilters] = useState(emptyCampaignFilters);

  const apiFilters = useMemo(() => toCampaignApiFilters(filters), [filters]);
  const activeFilterCount = [
    filters.q,
    filters.status,
    filters.startDate,
    filters.endDate,
    filters.activeToday ? "activeToday" : "",
  ].filter(Boolean).length;

  const campaignsQuery = useQuery({
    queryKey: ["campaigns", apiFilters],
    queryFn: () => api.listCampaigns(apiFilters),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const placementsQuery = useQuery({
    queryKey: ["campaign-placements"],
    queryFn: api.listCampaignPlacements,
    refetchOnWindowFocus: true,
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
        queryClient.invalidateQueries({ queryKey: ["registrations"] }),
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
        queryClient.invalidateQueries({ queryKey: ["registrations"] }),
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

  const updateFilter = (field: keyof CampaignFilterForm, value: string | boolean) => {
    setFilters((current) => ({ ...current, [field]: value }));
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

        <section className="rounded-xl border border-genesis-border bg-genesis-surface p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-50 text-genesis-primary">
                <Filter className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-base font-semibold text-genesis-text">Filtros de campanhas</h2>
                <p className="text-xs text-genesis-muted">
                  {activeFilterCount > 0 ? `${activeFilterCount} filtro${activeFilterCount > 1 ? "s" : ""} ativo${activeFilterCount > 1 ? "s" : ""}` : "Filtre por status, período e vigência"}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setFilters(emptyCampaignFilters)}
              disabled={activeFilterCount === 0}
            >
              <RotateCcw className="h-4 w-4" />
              Limpar
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr]">
            <Field label="Busca" htmlFor="campaign-q">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-genesis-neutral" />
                <Input
                  id="campaign-q"
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                  placeholder="Nome, título ou slug"
                  className="pl-9"
                />
              </div>
            </Field>
            <Field label="Status" htmlFor="campaign-status">
              <Select id="campaign-status" value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
                <option value="">Todos</option>
                <option value="draft">Rascunho</option>
                <option value="active">Ativa</option>
                <option value="paused">Pausada</option>
                <option value="closed">Encerrada</option>
              </Select>
            </Field>
            <Field label="Início de" htmlFor="campaign-start">
              <Input id="campaign-start" type="date" value={filters.startDate} onChange={(event) => updateFilter("startDate", event.target.value)} />
            </Field>
            <Field label="Início até" htmlFor="campaign-end">
              <Input id="campaign-end" type="date" value={filters.endDate} onChange={(event) => updateFilter("endDate", event.target.value)} />
            </Field>
            <Field label="Ordenar" htmlFor="campaign-sort">
              <Select id="campaign-sort" value={filters.sortBy} onChange={(event) => updateFilter("sortBy", event.target.value)}>
                <option value="createdAt">Criação</option>
                <option value="startsAt">Início</option>
                <option value="endsAt">Encerramento</option>
                <option value="name">Nome</option>
              </Select>
            </Field>
            <Field label="Direção" htmlFor="campaign-direction">
              <Select id="campaign-direction" value={filters.sortDirection} onChange={(event) => updateFilter("sortDirection", event.target.value)}>
                <option value="desc">Decrescente</option>
                <option value="asc">Crescente</option>
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant={filters.activeToday ? "primary" : "outline"}
              onClick={() => updateFilter("activeToday", !filters.activeToday)}
            >
              Vigentes hoje
            </Button>
          </div>
        </section>

        {campaignsQuery.isLoading ? (
          <LoadingBlock />
        ) : campaignsQuery.isError ? (
          <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-genesis-error">
            Não foi possível carregar as campanhas.
          </div>
        ) : campaignsQuery.data?.items.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="Nenhuma campanha encontrada"
            description="Crie a primeira campanha ou ajuste os filtros atuais."
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
                          até {campaign.endsAt ? formatDateTime(campaign.endsAt) : "sem data final"}
                        </p>
                      </div>
                    </div>
                    <p className="truncate rounded-md bg-genesis-bg px-3 py-2 font-mono text-xs text-genesis-muted">
                      {campaign.slug}
                    </p>
                  </div>
                  {user?.role === "admin" && (
                    <div className="mt-5 grid gap-2 sm:grid-cols-2">
                      <Button variant="outline" className="w-full" onClick={() => openEdit(campaign)}>
                        <Edit3 className="h-4 w-4" />
                        Editar
                      </Button>
                      <Button
                        className="w-full"
                        onClick={() => publishMutation.mutate(campaign.id)}
                        disabled={campaign.status !== "active" || publishMutation.isPending || isPublishedInInstitutionalModal}
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
            selectedCampaign ? institutionalPlacement?.campaignId === selectedCampaign.id : true
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
