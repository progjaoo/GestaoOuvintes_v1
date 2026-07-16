import { useState } from "react";
import { ChevronDown, Filter, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { Campaign } from "@/types/api";

export interface RegistrationFilterForm {
  campaignId: string;
  name: string;
  city: string;
  neighborhood: string;
  startDate: string;
  endDate: string;
  hasPhone: "" | "true" | "false";
}

export const emptyRegistrationFilters: RegistrationFilterForm = {
  campaignId: "",
  name: "",
  city: "",
  neighborhood: "",
  startDate: "",
  endDate: "",
  hasPhone: "",
};

export function RegistrationFiltersPanel({
  value,
  campaigns,
  activeCount,
  onChange,
  onApply,
  onClear,
}: {
  value: RegistrationFilterForm;
  campaigns: Campaign[];
  activeCount: number;
  onChange: (value: RegistrationFilterForm) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const update = (field: keyof RegistrationFilterForm, fieldValue: string) => {
    onChange({ ...value, [field]: fieldValue });
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
              Filtros
            </h2>
            <p className="text-xs text-genesis-muted">
              {activeCount > 0
                ? `${activeCount} filtro${activeCount > 1 ? "s" : ""} aplicado${activeCount > 1 ? "s" : ""}`
                : "Refine os cadastros exibidos"}
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Campanha" htmlFor="campaign">
            <Select
              id="campaign"
              value={value.campaignId}
              onChange={(event) => update("campaignId", event.target.value)}
            >
              <option value="">Todas as campanhas</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nome" htmlFor="filter-name">
            <Input
              id="filter-name"
              value={value.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Buscar ouvinte"
            />
          </Field>
          <Field label="Cidade" htmlFor="filter-city">
            <Input
              id="filter-city"
              value={value.city}
              onChange={(event) => update("city", event.target.value)}
              placeholder="Ex.: Volta Redonda"
            />
          </Field>
          <Field label="Bairro" htmlFor="filter-neighborhood">
            <Input
              id="filter-neighborhood"
              value={value.neighborhood}
              onChange={(event) => update("neighborhood", event.target.value)}
              placeholder="Ex.: Retiro"
            />
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
          <div className="flex items-end gap-2">
            <Button className="flex-1" onClick={onApply}>
              <Search className="h-4 w-4" />
              Aplicar
            </Button>
            <Button variant="outline" size="icon" aria-label="Limpar filtros" onClick={onClear}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
