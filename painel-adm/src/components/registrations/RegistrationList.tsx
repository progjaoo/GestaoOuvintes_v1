import { Eye, Inbox, MapPin, Phone, UserRound } from "lucide-react";
import { formatDateTime, formatPhone, sourceLabel } from "@/lib/formatters";
import type { RegistrationListItem } from "@/types/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export function RegistrationList({
  items,
  onView,
}: {
  items: RegistrationListItem[];
  onView: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nenhum cadastro encontrado"
        description="Ajuste os filtros ou aguarde novos cadastros da campanha."
      />
    );
  }

  return (
    <>
      <div className="space-y-3 lg:hidden">
        {items.map((item) => (
          <article
            key={item.id}
            className="rounded-xl border border-genesis-border bg-genesis-surface p-4 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-50 text-genesis-primary">
                <UserRound className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold text-genesis-text">{item.name}</h3>
                <p className="mt-1 text-xs text-genesis-muted">
                  {formatDateTime(item.createdAt)}
                </p>
              </div>
              <Badge tone={item.phone ? "green" : "gray"}>
                {item.phone ? "Telefone" : "Sem telefone"}
              </Badge>
            </div>
            <div className="mt-4 grid gap-2 text-sm text-genesis-muted">
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-genesis-neutral" />
                {item.neighborhood}, {item.city}
              </span>
              <span className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-genesis-neutral" />
                {formatPhone(item.phone)}
              </span>
            </div>
            <Button
              variant="outline"
              className="mt-4 w-full"
              onClick={() => onView(item.id)}
            >
              <Eye className="h-4 w-4" />
              Ver detalhes
            </Button>
          </article>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-genesis-border bg-genesis-surface shadow-sm lg:block">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-genesis-border bg-genesis-bg text-xs font-semibold uppercase tracking-[0.1em] text-genesis-muted">
                <th className="px-5 py-4">Ouvinte</th>
                <th className="px-5 py-4">Localidade</th>
                <th className="px-5 py-4">Telefone</th>
                <th className="px-5 py-4">Origem</th>
                <th className="px-5 py-4">Data</th>
                <th className="px-5 py-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-genesis-border text-sm last:border-0 hover:bg-indigo-50/45"
                >
                  <td className="px-5 py-4">
                    <p className="font-semibold text-genesis-text">{item.name}</p>
                    <p className="mt-1 max-w-[220px] truncate text-xs text-genesis-muted">
                      {item.campaignName}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-genesis-muted">
                    <p>{item.city}</p>
                    <p className="mt-1 text-xs text-genesis-neutral">{item.neighborhood}</p>
                  </td>
                  <td className="px-5 py-4">
                    <Badge tone={item.phone ? "green" : "gray"}>
                      {formatPhone(item.phone)}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-genesis-muted">
                    {sourceLabel(item.source)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-genesis-muted">
                    {formatDateTime(item.createdAt)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onView(item.id)}
                    >
                      <Eye className="h-4 w-4" />
                      Detalhes
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
