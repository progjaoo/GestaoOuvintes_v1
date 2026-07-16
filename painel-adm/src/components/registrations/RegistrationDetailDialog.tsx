import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, MapPin, Megaphone, Phone, UserRound } from "lucide-react";
import { api } from "@/services/api";
import { formatDateTime, formatPhone, sourceLabel } from "@/lib/formatters";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingBlock } from "@/components/ui/LoadingBlock";

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="rounded-lg border border-genesis-border bg-genesis-bg p-3.5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-genesis-muted">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-genesis-text">
        {value || "Não informado"}
      </p>
    </div>
  );
}

export function RegistrationDetailDialog({
  registrationId,
  onClose,
}: {
  registrationId: string | null;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["registration", registrationId],
    queryFn: () => api.getRegistration(registrationId!),
    enabled: Boolean(registrationId),
  });

  return (
    <Dialog
      open={Boolean(registrationId)}
      onOpenChange={(open) => !open && onClose()}
      title="Detalhes do cadastro"
      description="Dados informados pelo ouvinte e contexto da submissão."
    >
      {query.isLoading && <LoadingBlock />}
      {query.isError && (
        <p className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm font-semibold text-genesis-error">
          Não foi possível carregar este cadastro.
        </p>
      )}
      {query.data && (
        <div className="space-y-5">
          <div className="flex flex-col gap-4 rounded-xl border border-genesis-border bg-genesis-text p-5 text-white sm:flex-row sm:items-center">
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-genesis-primary">
              <UserRound className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-xl font-semibold">
                {query.data.name}
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="blue">{query.data.campaignName}</Badge>
                <Badge tone={query.data.phone ? "green" : "gray"}>
                  {query.data.phone ? "Com telefone" : "Sem telefone"}
                </Badge>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DetailItem label="Telefone" value={formatPhone(query.data.phone)} />
            <DetailItem label="Origem" value={sourceLabel(query.data.source)} />
            <DetailItem label="Bairro" value={query.data.neighborhood} />
            <DetailItem label="Cidade" value={query.data.city} />
            <DetailItem
              label="Cadastrado em"
              value={formatDateTime(query.data.createdAt)}
            />
            <DetailItem
              label="Aviso de privacidade"
              value={query.data.privacyNoticeVersion}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex gap-3 rounded-lg border border-genesis-border p-4">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-genesis-success" />
              <div>
                <p className="text-sm font-semibold text-genesis-text">Privacidade reconhecida</p>
                <p className="mt-1 text-xs text-genesis-muted">
                  {formatDateTime(query.data.privacyAcknowledgedAt)}
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-genesis-border p-4">
              <Megaphone className="h-5 w-5 shrink-0 text-genesis-primary" />
              <div>
                <p className="text-sm font-semibold text-genesis-text">
                  Comunicação: {query.data.marketingOptIn ? "aceita" : "não aceita"}
                </p>
                <p className="mt-1 text-xs text-genesis-muted">
                  {query.data.marketingOptInAt
                    ? formatDateTime(query.data.marketingOptInAt)
                    : "Sem aceite adicional"}
                </p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-genesis-text">Rastreamento</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailItem label="UTM source" value={query.data.utmSource} />
              <DetailItem label="UTM medium" value={query.data.utmMedium} />
              <DetailItem label="UTM campaign" value={query.data.utmCampaign} />
              <DetailItem label="UTM content" value={query.data.utmContent} />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-genesis-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {query.data.city}
            </span>
            {query.data.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" />
                Telefone informado
              </span>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
