import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  FileSpreadsheet,
  Phone,
  RefreshCw,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { dateInputToIso } from "@/lib/formatters";
import type { RegistrationFilters } from "@/types/api";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { LoadingBlock } from "@/components/ui/LoadingBlock";
import {
  emptyRegistrationFilters,
  RegistrationFiltersPanel,
  type RegistrationFilterForm,
} from "@/components/registrations/RegistrationFiltersPanel";
import { RegistrationList } from "@/components/registrations/RegistrationList";
import { RegistrationDetailDialog } from "@/components/registrations/RegistrationDetailDialog";
import { PaginationControls } from "@/components/registrations/PaginationControls";
import { StatsCard } from "@/components/registrations/StatsCard";
import { usePageTitle } from "@/hooks/usePageTitle";

function toApiFilters(
  filters: RegistrationFilterForm,
  page = 1,
): RegistrationFilters {
  return {
    page,
    pageSize: 20,
    campaignId: filters.campaignId || undefined,
    q: filters.q.trim() || undefined,
    city: filters.city.trim() || undefined,
    neighborhood: filters.neighborhood.trim() || undefined,
    startDate: dateInputToIso(filters.startDate),
    endDate: dateInputToIso(filters.endDate, true),
    hasPhone:
      filters.hasPhone === "" ? undefined : filters.hasPhone === "true",
    sortBy: filters.sortBy,
    sortDirection: filters.sortDirection,
  };
}

export function RegistrationsPage() {
  usePageTitle("Cadastros de ouvintes");
  const { user } = useAuth();
  const [filters, setFilters] = useState(emptyRegistrationFilters);
  const [debouncedFilters, setDebouncedFilters] = useState(emptyRegistrationFilters);
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);

  const apiFilters = useMemo(
    () => toApiFilters(debouncedFilters, page),
    [debouncedFilters, page],
  );
  const summaryBaseFilters = useMemo(
    () => ({
      page: 1,
      pageSize: 1,
      campaignId: debouncedFilters.campaignId || undefined,
    }),
    [debouncedFilters.campaignId],
  );

  const campaignsQuery = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api.listCampaigns(),
  });
  const registrationsQuery = useQuery({
    queryKey: ["registrations", apiFilters],
    queryFn: () => api.listRegistrations(apiFilters),
    placeholderData: (previous) => previous,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const totalQuery = useQuery({
    queryKey: ["registration-total", summaryBaseFilters],
    queryFn: () => api.listRegistrations(summaryBaseFilters),
  });
  const withPhoneQuery = useQuery({
    queryKey: ["registration-with-phone", summaryBaseFilters],
    queryFn: () =>
      api.listRegistrations({
        ...summaryBaseFilters,
        hasPhone: true,
      }),
  });

  const activeFilterCount = [
    filters.campaignId,
    filters.q,
    filters.city,
    filters.neighborhood,
    filters.startDate,
    filters.endDate,
    filters.hasPhone,
  ].filter(Boolean).length;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
        return;
      }
      setDebouncedFilters(filters);
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [filters]);

  const updateFilters = (nextFilters: RegistrationFilterForm) => {
    setFilters(nextFilters);
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(emptyRegistrationFilters);
    setDebouncedFilters(emptyRegistrationFilters);
    setPage(1);
  };

  const handleExport = async (format: "csv" | "xlsx") => {
    setExporting(format);
    try {
      const apiExportFilters = toApiFilters(debouncedFilters);
      const filters = {
        campaignId: apiExportFilters.campaignId,
        q: apiExportFilters.q,
        sortBy: apiExportFilters.sortBy,
        sortDirection: apiExportFilters.sortDirection,
        city: apiExportFilters.city,
        neighborhood: apiExportFilters.neighborhood,
        startDate: apiExportFilters.startDate,
        endDate: apiExportFilters.endDate,
        hasPhone: apiExportFilters.hasPhone,
      };
      await api.exportRegistrations(format, filters);
      toast.success(`Arquivo ${format.toUpperCase()} gerado com sucesso.`);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Não foi possível exportar.",
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1500px] space-y-6">
        <PageHeader
          eyebrow="Relacionamento"
          title="Cadastros de ouvintes"
          description="Consulte, filtre e exporte os cadastros recebidos pelas campanhas da Rádio 88 FM."
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => registrationsQuery.refetch()}
                disabled={registrationsQuery.isFetching}
              >
                <RefreshCw
                  className={`h-4 w-4 ${registrationsQuery.isFetching ? "animate-spin" : ""}`}
                />
                Atualizar
              </Button>
              {user?.role === "admin" && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => handleExport("csv")}
                    disabled={Boolean(exporting)}
                  >
                    <Download className="h-4 w-4" />
                    CSV
                  </Button>
                  <Button
                    onClick={() => handleExport("xlsx")}
                    disabled={Boolean(exporting)}
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Excel
                  </Button>
                </>
              )}
            </>
          }
        />

        <section className="grid gap-3 sm:grid-cols-3">
          <StatsCard
            label="Total"
            value={totalQuery.data?.pagination.total ?? 0}
            hint="Cadastros na campanha selecionada"
            icon={UsersRound}
            loading={totalQuery.isLoading}
          />
          <StatsCard
            label="Com telefone"
            value={withPhoneQuery.data?.pagination.total ?? 0}
            hint="Contatos que informaram telefone"
            icon={Phone}
            tone="yellow"
            loading={withPhoneQuery.isLoading}
          />
          <StatsCard
            label="Resultado filtrado"
            value={registrationsQuery.data?.pagination.total ?? 0}
            hint="Quantidade após os filtros atuais"
            icon={UserRoundCheck}
            tone="red"
            loading={registrationsQuery.isLoading}
          />
        </section>

        <RegistrationFiltersPanel
          value={filters}
          campaigns={campaignsQuery.data?.items ?? []}
          activeCount={activeFilterCount}
          onChange={updateFilters}
          onClear={clearFilters}
        />

        {registrationsQuery.isLoading ? (
          <LoadingBlock />
        ) : registrationsQuery.isError ? (
          <div className="rounded-xl border border-red-100 bg-red-50 p-5">
            <h2 className="font-display font-semibold text-red-800">
              Não foi possível carregar os cadastros
            </h2>
            <p className="mt-2 text-sm text-red-700">
              Verifique se a API está disponível e tente novamente.
            </p>
            <Button
              variant="danger"
              className="mt-4"
              onClick={() => registrationsQuery.refetch()}
            >
              Tentar novamente
            </Button>
          </div>
        ) : (
          <>
            <RegistrationList
              items={registrationsQuery.data?.items ?? []}
              onView={setDetailId}
            />
            {registrationsQuery.data && (
              <PaginationControls
                pagination={registrationsQuery.data.pagination}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </div>

      <RegistrationDetailDialog
        registrationId={detailId}
        onClose={() => setDetailId(null)}
      />
    </AppShell>
  );
}
