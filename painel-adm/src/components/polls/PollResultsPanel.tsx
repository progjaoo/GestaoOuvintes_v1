import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";
import { api } from "@/services/api";
import { Button } from "@/components/ui/shadcn/button";
import { Progress } from "@/components/ui/shadcn/progress";
import { PollError, PollLoading } from "./PollFeedback";
import { usePrivatePollQuery } from "./usePrivatePollQuery";

export function PollResultsPanel({ id }: { id: string }) {
  const { user } = useAuth();
  if (!user || !hasPermission(user, "poll.results.read")) return null;
  return <Results key={`${user.id}:${id}`} id={id} actorId={user.id} />;
}
function Results({ id, actorId }: { id: string; actorId: string }) {
  const { query: results, accessError } = usePrivatePollQuery({
    actorId,
    pollId: id,
    kind: "results",
    queryFn: (signal) => api.pollResults(id, signal),
  });
  return (
    <section
      aria-label="Resultados"
      className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-background p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Resultados</h2>
        <Button
          variant="outline"
          disabled={results.isFetching || !!accessError}
          onClick={() => void results.refetch()}
        >
          Atualizar resultados
        </Button>
      </div>
      {accessError ? (
        <PollError error={accessError} />
      ) : results.isPending ? (
        <PollLoading />
      ) : results.isError ? (
        <PollError error={results.error} />
      ) : (
        <>
          <p className="tabular-nums">
            Total de votos: {results.data.totalVotes}
          </p>
          {results.data.options.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Esta enquete não possui alternativas de voto.
            </p>
          )}
          <ol className="flex flex-col gap-5">
            {results.data.options.map((option) => (
              <li key={option.id} className="flex min-w-0 flex-col gap-2">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 break-words font-medium">
                    {option.text}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums">
                    {option.votes.toLocaleString("pt-BR")} votos ·{" "}
                    {option.percentage.toLocaleString("pt-BR")}%
                  </span>
                </div>
                <Progress aria-label={option.text} value={option.percentage} />
              </li>
            ))}
          </ol>
          {results.data.totalVotes === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum voto registrado.
            </p>
          )}
        </>
      )}
    </section>
  );
}
