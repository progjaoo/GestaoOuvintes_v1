import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Badge } from "@/components/ui/shadcn/badge";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/shadcn/field";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/shadcn/table";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/shadcn/empty";
import { Select } from "@/components/ui/Select";
import { PollActions } from "@/components/polls/PollActions";
import { PollAreaNavigation } from "@/components/polls/PollAreaNavigation";
import {
  PollNotice,
  PollError,
  PollLoading,
} from "@/components/polls/PollFeedback";
import { usePollPrograms } from "@/components/polls/usePollPrograms";
import {
  pollStates,
  formatInstant,
  localInput,
  localTimezone,
} from "@/components/polls/poll-utils";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";
import { api } from "@/services/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { Poll } from "@/types/polls";

export function PollsPage() {
  const { user } = useAuth();
  return hasPermission(user, "poll.read") ? (
    <PollCatalog />
  ) : (
    <PollDirectAccess />
  );
}

function PollDirectAccess() {
  usePageTitle("Enquetes");
  const { user } = useAuth();
  const [id, setId] = useState("");
  const canOpenCalendarIntegration = [
    "calendar_integration.read",
    "calendar_integration.manage",
    "calendar_integration.sync",
  ].some((permission) => hasPermission(user, permission));
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Operação"
          title="Enquetes"
          description="Abra os resultados ou mensagens de uma enquete autorizada."
          actions={canOpenCalendarIntegration ? (
            <Button asChild variant="outline">
              <Link to="/enquetes/integracao"><CalendarDays aria-hidden="true" /> Agenda Google</Link>
            </Button>
          ) : undefined}
        />
        <PollAreaNavigation />
        <FieldGroup className="max-w-lg">
          <Field>
            <FieldLabel htmlFor="direct-poll-id">ID da enquete</FieldLabel>
            <Input
              id="direct-poll-id"
              value={id}
              onChange={(event) => setId(event.target.value)}
            />
            <FieldDescription>
              O catálogo exige poll.read. Seu acesso a resultados e mensagens é
              independente; informe o ID recebido da equipe.
            </FieldDescription>
          </Field>
          {id.trim() ? (
            <Button asChild className="self-start">
              <Link
                to={`/enquetes/${encodeURIComponent(id.trim())}/resultados`}
              >
                Abrir enquete
              </Link>
            </Button>
          ) : (
            <Button disabled className="self-start">
              Abrir enquete
            </Button>
          )}
        </FieldGroup>
      </div>
    </AppShell>
  );
}

function PollCatalog() {
  usePageTitle("Enquetes");
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const programId = params.get("programId") ?? "";
  const state = params.get("state") ?? "";
  const edition = params.get("edition") ?? "";
  const after = params.get("after") ?? "";
  const programs = usePollPrograms();
  const canReadPrograms = hasPermission(user, "program.read");
  const query = useQuery({
    queryKey: ["polls", "list", programId, state, edition, after],
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      let page = await api.listPolls({
        programId,
        state,
        after: edition ? undefined : after,
      });
      if (!edition) return page;
      // The fixed API has no edition filter: traverse all matching pages before filtering locally.
      const items: Poll[] = [...page.items];
      const seen = new Set<string>();
      while (page.nextCursor) {
        if (seen.has(page.nextCursor))
          throw new Error("Cursor de enquetes repetido.");
        seen.add(page.nextCursor);
        page = await api.listPolls({
          programId,
          state,
          after: page.nextCursor,
        });
        items.push(...page.items);
      }
      return {
        items: items.filter(
          (poll) => localInput(poll.editionStartsAt).slice(0, 10) === edition,
        ),
        nextCursor: null,
      };
    },
  });
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "after") next.delete("after");
    setParams(next);
  }
  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageHeader
          eyebrow="Operação"
          title="Enquetes"
          description="Gerencie perguntas e resultados por edição do programa."
          actions={
            <div className="flex flex-wrap gap-2">
              {[
                "calendar_integration.read",
                "calendar_integration.manage",
                "calendar_integration.sync",
              ].some((permission) => hasPermission(user, permission)) && (
                <Button asChild variant="outline">
                  <Link to="/enquetes/integracao">
                    <CalendarDays aria-hidden="true" /> Agenda Google
                  </Link>
                </Button>
              )}
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                Atualizar
              </Button>
              {hasPermission(user, "poll.manage") && (
                <Button asChild>
                  <Link to="/enquetes/nova">Nova enquete</Link>
                </Button>
              )}
            </div>
          }
        />
        <PollAreaNavigation />
        <PollNotice />
        <section
          aria-label="Filtros de enquetes"
          className="rounded-xl border border-border bg-background p-4"
        >
          <FieldGroup className="sm:flex-row sm:items-start">
            <Field>
              <FieldLabel htmlFor="poll-program-filter">Programa</FieldLabel>
              {canReadPrograms ? (
                <Select
                  id="poll-program-filter"
                  value={programId}
                  disabled={programs.isPending || programs.isError}
                  aria-describedby="poll-program-filter-status"
                  onChange={(event) => filter("programId", event.target.value)}
                >
                  <option value="">
                    {programs.isPending
                      ? "Carregando programas…"
                      : programs.isError
                        ? "Programas indisponíveis"
                        : "Todos os programas"}
                  </option>
                  {programId &&
                    !programs.data?.some(
                      (program) => program.id === programId,
                    ) && (
                      <option value={programId} disabled>
                        Programa fora do catálogo disponível
                      </option>
                    )}
                  {programs.data?.map((program) => (
                    <option key={program.id} value={program.id}>
                      {program.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id="poll-program-filter"
                  placeholder="Todos (ou ID do programa)"
                  value={programId}
                  onChange={(event) => filter("programId", event.target.value)}
                />
              )}
              {canReadPrograms && (
                <div id="poll-program-filter-status">
                  {programs.isPending && (
                    <p role="status">Carregando programas autorizados…</p>
                  )}
                  {programs.isError && (
                    <>
                      <p role="alert">
                        Não foi possível carregar os programas:{" "}
                        {programs.error.message}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={programs.isFetching}
                        onClick={() => void programs.refetch()}
                      >
                        Tentar carregar programas novamente
                      </Button>
                    </>
                  )}
                  {programs.isSuccess && programs.data.length === 0 && (
                    <p role="status">Nenhum programa autorizado disponível.</p>
                  )}
                </div>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="poll-edition-filter">
                Edição (data)
              </FieldLabel>
              <Input
                id="poll-edition-filter"
                type="date"
                value={edition}
                onChange={(event) => filter("edition", event.target.value)}
              />
              <FieldDescription>
                Data de início em {localTimezone}.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="poll-state-filter">Estado</FieldLabel>
              <Select
                id="poll-state-filter"
                value={state}
                onChange={(event) => filter("state", event.target.value)}
              >
                <option value="">Todos</option>
                {Object.entries(pollStates).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldGroup>
        </section>
        {query.isPending ? (
          <PollLoading />
        ) : query.isError ? (
          <PollError error={query.error} />
        ) : query.data.items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Nenhuma enquete encontrada</EmptyTitle>
              <EmptyDescription>
                Revise os filtros ou crie um rascunho se seu perfil permitir.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-background">
            <Table className="table-fixed [&_th]:px-4 [&_td]:px-4 [&_td]:py-4">
              <TableCaption>
                Enquetes administrativas. Horários em {localTimezone}.
              </TableCaption>
              <TableHeader className="bg-muted/60">
                <TableRow>
                  <TableHead className="w-auto">Pergunta / programa</TableHead>
                  <TableHead className="hidden w-[28%] md:table-cell">
                    Edição
                  </TableHead>
                  <TableHead className="w-28 sm:w-36">Estado</TableHead>
                  {hasPermission(user, "poll.results.read") && (
                    <TableHead className="hidden w-20 text-right sm:table-cell">
                      Votos
                    </TableHead>
                  )}
                  <TableHead className="w-16">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((poll) => (
                  <TableRow key={poll.id} className="align-top">
                    <TableCell>
                      <Link
                        className="break-words font-medium underline underline-offset-4 [overflow-wrap:anywhere]"
                        to={
                          hasPermission(user, "poll.results.read") ||
                          hasPermission(user, "participation.read")
                            ? `/enquetes/${poll.id}/resultados`
                            : `/enquetes/${poll.id}`
                        }
                      >
                        {poll.question}
                      </Link>
                      <p className="mt-1 break-words text-muted-foreground">
                        {poll.programName}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground md:hidden">
                        {formatInstant(poll.editionStartsAt)} até{" "}
                        {formatInstant(poll.editionEndsAt)}
                      </p>
                      {hasPermission(user, "poll.results.read") && (
                        <p className="mt-1 text-xs tabular-nums text-muted-foreground sm:hidden">
                          {poll.totalVotes} votos
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {formatInstant(poll.editionStartsAt)}
                      <br />
                      até {formatInstant(poll.editionEndsAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {pollStates[poll.state]}
                      </Badge>
                    </TableCell>
                    {hasPermission(user, "poll.results.read") && (
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {poll.totalVotes}
                      </TableCell>
                    )}
                    <TableCell>
                      <PollActions poll={poll} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex gap-2">
          {after && (
            <Button variant="outline" onClick={() => filter("after", "")}>
              Primeira página
            </Button>
          )}
          {!query.isError && query.data?.nextCursor && (
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => filter("after", query.data.nextCursor!)}
            >
              Próxima página
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
