import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";
import { api } from "@/services/api";
import { formatInstant } from "@/components/polls/poll-utils";
import { usePrivatePollQuery } from "@/components/polls/usePrivatePollQuery";
import { PollError, PollLoading } from "@/components/polls/PollFeedback";
import { Button } from "@/components/ui/shadcn/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/shadcn/empty";

export function ProgramParticipationsPage() {
  return <Navigate to="/enquetes" replace />;
}

export function PollParticipations({ pollId }: { pollId: string }) {
  const { user } = useAuth();
  if (!user || !hasPermission(user, "participation.read")) return null;
  return (
    <PollMessages
      key={`${user.id}:${pollId}`}
      actorId={user.id}
      pollId={pollId}
    />
  );
}

function PollMessages({
  actorId,
  pollId,
}: {
  actorId: string;
  pollId: string;
}) {
  const [after, setAfter] = useState("");
  const { query, accessError } = usePrivatePollQuery({
    actorId,
    pollId,
    kind: "messages",
    after,
    queryFn: async (signal) => {
      const page = await api.listParticipations(
        { pollId, after: after || undefined },
        signal,
      );
      // Keep only the immutable message and declared presentation fields, never legacy notes or contacts.
      return {
        items: page.items
          .filter((item) => item.pollId === pollId)
          .map((item) => ({
            id: item.id,
            displayName: item.displayName,
            neighborhood: item.neighborhood,
            message: item.message,
            receivedAt: item.receivedAt,
          })),
        nextCursor: page.nextCursor,
      };
    },
  });
  return (
    <section
      aria-label="Mensagens privadas"
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-background p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">
          Mensagens privadas
        </h2>
        <Button
          variant="outline"
          disabled={query.isFetching || !!accessError}
          onClick={() => void query.refetch()}
        >
          Atualizar mensagens
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Somente leitura, sem edição ou aprovação. Nome e bairro são declarados
        pelo participante. Atualização manual.
      </p>
      {accessError ? (
        <PollError error={accessError} />
      ) : query.isPending ? (
        <PollLoading />
      ) : query.isError ? (
        <PollError error={query.error} />
      ) : query.data.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nenhuma mensagem recebida</EmptyTitle>
            <EmptyDescription>
              As mensagens desta enquete aparecerão aqui.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {query.data.items.map((item) => (
            <li
              key={item.id}
              className="flex min-w-0 flex-col gap-2 py-5 first:pt-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="min-w-0 break-words font-semibold">
                  {item.displayName || "Nome não informado"} —{" "}
                  {item.neighborhood || "Bairro não informado"}
                </h3>
                <time
                  dateTime={item.receivedAt}
                  className="text-xs text-muted-foreground"
                >
                  {formatInstant(item.receivedAt)}
                </time>
              </div>
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {item.message}
              </p>
            </li>
          ))}
        </ol>
      )}
      {!accessError && (
        <div className="flex flex-wrap gap-2">
          {after && (
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => setAfter("")}
            >
              Primeira página
            </Button>
          )}
          {!query.isError && query.data?.nextCursor && (
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => setAfter(query.data.nextCursor!)}
            >
              Próxima página
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
