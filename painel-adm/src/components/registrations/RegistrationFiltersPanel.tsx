import { useState } from "react";
import { ChevronDown, Filter, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { Campaign, RegistrationSortBy, SortDirection } from "@/types/api";

export interface RegistrationFilterForm {
  campaignId: string;
  q: string;
  city: string;
  neighborhood: string;
  startDate: string;
  endDate: string;
  hasPhone: "" | "true" | "false";
  sortBy: RegistrationSortBy;
  sortDirection: SortDirection;
}

export const emptyRegistrationFilters: RegistrationFilterForm = {
  campaignId: "",
  q: "",
  city: "",
  neighborhood: "",
  startDate: "",
  endDate: "",
  hasPhone: "",
  sortBy: "createdAt",
  sortDirection: "desc",
};

function getActiveFilterLabels(value: RegistrationFilterForm, campaigns: Campaign[]) {
  const labels: Array<{ key: keyof RegistrationFilterForm; label: string }> = [];
  const campaign = campaigns.find((item) => item.id === value.campaignId);

  if (campaign) labels.push({ key: "campaignId", label: `Campanha: ${campaign.name}` });
  if (value.q.trim()) labels.push({ key: "q", label: `Busca: ${value.q.trim()}` });
  if (value.city.trim()) labels.push({ key: "city", label: `Cidade: ${value.city.trim()}` });
  if (value.neighborhood.trim()) labels.push({ key: "neighborhood", label: `Bairro: ${value.neighborhood.trim()}` });
  if (value.startDate) labels.push({ key: "startDate", label: `Desde: ${value.startDate}` });
  if (value.endDate) labels.push({ key: "endDate", label: `Até: ${value.endDate}` });
  if (value.hasPhone) {
    labels.push({ key: "hasPhone", label: value.hasPhone === "true" ? "Com telefone" : "Sem telefone" });
  }

  return labels;
}

export function RegistrationFiltersPanel({
  value,
  campaigns,
  activeCount,
  onChange,
  onClear,
}: {
  value: RegistrationFilterForm;
  campaigns: Campaign[];
  activeCount: number;
  onChange: (value: RegistrationFilterForm) => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const activeLabels = getActiveFilterLabels(value, campaigns);

  const update = (field: keyof RegistrationFilterForm, fieldValue: string) => {
    onChange({ ...value, [field]: fieldValue });
  };

  const removeFilter = (field: keyof RegistrationFilterForm) => {
    onChange({
      ...value,
      [field]: emptyRegistrationFilters[field],
    });
  };

  return (
    <section className="rounded-xl border border-genesis-border bg-genesis-surface shadow-sm">
      <button
        type="button"
        className="flex min-h-16 w-full items-center justify-between gap-4 px-4 text-left sm:px-5 lg:pointer-events-none"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-50 text-genesis-primary">
            <Filter className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-genesis-text">
              Filtros inteligentes
            </h2>
            <p className="text-xs text-genesis-muted">
              {activeCount > 0
                ? `${activeCount} filtro${activeCount > 1 ? "s" : ""} ativo${activeCount > 1 ? "s" : ""} · atualização automática`
                : "Digite ou selecione: a lista atualiza sozinha"}
            </p>
          </div>
        </div>
        <ChevronDown
          className={`h-5 w-5 text-genesis-muted transition-transform lg:hidden ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <div className={`${expanded ? "block" : "hidden"} border-t border-genesis-border p-4 sm:p-5 lg:block`}>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr_1fr_1fr] xl:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]">
          <Field label="Busca geral" htmlFor="filter-q">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-genesis-neutral" />
              <Input
                id="filter-q"
                value={value.q}
                onChange={(event) => update("q", event.target.value)}
                placeholder="Nome, bairro, cidade, telefone ou campanha"
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Campanha" htmlFor="campaign">
            <Select
              id="campaign"
              value={value.campaignId}
              onChange={(event) => update("campaignId", event.target.value)}
            >
              <option value="">Todas</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cidade" htmlFor="filter-city">
            <Input
              id="filter-city"
              value={value.city}
              onChange={(event) => update("city", event.target.value)}
              placeholder="Volta Redonda"
            />
          </Field>
          <Field label="Bairro" htmlFor="filter-neighborhood">
            <Input
              id="filter-neighborhood"
              value={value.neighborhood}
              onChange={(event) => update("neighborhood", event.target.value)}
              placeholder="Retiro"
            />
          </Field>
          <Field label="Telefone" htmlFor="filter-phone">
            <Select
              id="filter-phone"
              value={value.hasPhone}
              onChange={(event) => update("hasPhone", event.target.value)}
            >
              <option value="">Todos</option>
              <option value="true">Com telefone</option>
              <option value="false">Sem telefone</option>
            </Select>
          </Field>
          <Field label="Data inicial" htmlFor="filter-start">
            <Input
              id="filter-start"
              type="date"
              value={value.startDate}
              onChange={(event) => update("startDate", event.target.value)}
            />
          </Field>
          <Field label="Data final" htmlFor="filter-end">
            <Input
              id="filter-end"
              type="date"
              value={value.endDate}
              onChange={(event) => update("endDate", event.target.value)}
            />
          </Field>
          <Field label="Ordenar por" htmlFor="filter-sort-by">
            <Select
              id="filter-sort-by"
              value={value.sortBy}
              onChange={(event) => update("sortBy", event.target.value)}
            >
              <option value="createdAt">Data do cadastro</option>
              <option value="name">Nome</option>
              <option value="city">Cidade</option>
            </Select>
          </Field>
          <Field label="Direção" htmlFor="filter-sort-direction">
            <Select
              id="filter-sort-direction"
              value={value.sortDirection}
              onChange={(event) => update("sortDirection", event.target.value)}
            >
              <option value="desc">Mais recente / Z-A</option>
              <option value="asc">Mais antigo / A-Z</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full"
              aria-label="Limpar filtros"
              onClick={onClear}
              disabled={activeCount === 0}
            >
              <RotateCcw className="h-4 w-4" />
              Limpar
            </Button>
          </div>
        </div>

        {activeLabels.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {activeLabels.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-genesis-border bg-genesis-bg px-3 py-1.5 text-xs font-semibold text-genesis-muted transition hover:border-genesis-primary/40 hover:text-genesis-text"
                onClick={() => removeFilter(filter.key)}
              >
                {filter.label}
                <X className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
