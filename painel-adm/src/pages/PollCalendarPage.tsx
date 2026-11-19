import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { PollAreaNavigation } from "@/components/polls/PollAreaNavigation";
import { Badge } from "@/components/ui/shadcn/badge";
import { Button } from "@/components/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";
import { Input } from "@/components/ui/shadcn/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/shadcn/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/shadcn/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hasPermission } from "@/services/permissions";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/services/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/shadcn/alert";
import type { PollCalendarItem, PollCalendarState } from "@/types/calendar-integration";

type CalendarView = "month" | "list";
const stateLabels: Record<PollCalendarState, string> = {
  review: "Aguardando conferência",
  scheduled: "Agendada",
  published: "No ar",
  closed: "Encerrada",
  archived: "Arquivada",
  canceled: "Cancelada",
  invalid: "Precisa de ajuste",
  conflict: "Conflito",
};

const reasonLabels: Record<string, string> = {
  INVALID_SOURCE: "A origem precisa ser revisada.", INVALID_EVENT: "O evento está sem título ou horário reconhecível.",
  UNSUPPORTED_EVENT: "O formato ou recorrência ainda não é compatível.", UNSAFE_DESCRIPTION: "A descrição não pode ser importada com segurança.",
  INVALID_CONFIG: "A configuração editorial precisa ser revisada.", PROGRAM_UNAVAILABLE: "O programa não está identificado ou permitido.",
  EDITION_UNAVAILABLE: "Não foi possível relacionar o evento a uma edição da grade.", INVALID_WINDOW: "O período não corresponde a uma janela válida.",
  INVALID_POLL: "A pergunta ou configuração precisa de revisão.",
};

function stateVariant(state: PollCalendarState): "default" | "secondary" | "destructive" | "outline" {
  if (state === "published") return "default";
  if (state === "scheduled" || state === "review") return "secondary";
  if (state === "invalid" || state === "conflict") return "destructive";
  return "outline";
}

function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function parseSelectedDate(value: string | null) {
  if (!value) return new Date();
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function calendarDate(item: PollCalendarItem) {
  if (item.startDate) return parseISO(item.startDate);
  return item.startsAt ? new Date(item.startsAt) : null;
}

function eventTime(item: PollCalendarItem) {
  if (item.allDay) return "Dia inteiro";
  if (!item.startsAt) return "Horário não definido";
  const start = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(item.startsAt));
  if (!item.endsAt) return start;
  const end = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(item.endsAt));
  return `${start}–${end}`;
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-36 flex-col gap-1 text-xs font-medium text-muted-foreground" htmlFor={id}>
      {label}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </select>
    </label>
  );
}

export function PollCalendarPage() {
  usePageTitle("Calendário · Enquetes");
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const selectedDate = parseSelectedDate(params.get("date"));
  const viewParam = params.get("view");
  const view: CalendarView = viewParam === "month" || viewParam === "list"
    ? viewParam
    : isMobile ? "list" : "month";
  const program = params.get("program") ?? "";
  const stateParam = params.get("state") ?? "";
  const allowedStates: PollCalendarState[] = ["review", "scheduled", "published", "closed", "archived", "canceled", "invalid", "conflict"];
  const state = allowedStates.includes(stateParam as PollCalendarState) ? stateParam : "";
  const query = params.get("q") ?? "";
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const rangeFrom = dayKey(gridStart);
  const rangeTo = dayKey(addDays(gridEnd, 1));
  const canReadCalendar = hasPermission(user, "calendar_integration.read");
  const calendarQuery = useQuery({
    queryKey: ["poll-calendar", rangeFrom, rangeTo, program, state, query],
    queryFn: ({ signal }) => api.listPollCalendar({
      from: rangeFrom,
      to: rangeTo,
      ...(program ? { programId: program } : {}),
      ...(state ? { state } : {}),
      ...(query ? { q: query } : {}),
    }, signal),
    enabled: canReadCalendar,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    const updateTime = () => setCurrentTime(Date.now());
    updateTime();
    const timer = window.setInterval(updateTime, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const events = useMemo(() => calendarQuery.data?.items ?? [], [calendarQuery.data?.items]);
  const lastSyncedAt = calendarQuery.data?.lastSyncedAt;
  const syncIsStale = Boolean(lastSyncedAt && currentTime && currentTime - new Date(lastSyncedAt).getTime() > 10 * 60_000);
  const datedEvents = events.filter((item) => calendarDate(item) !== null);
  const undatedEvents = events.filter((item) => calendarDate(item) === null);
  const eventsForMonth = [...datedEvents].sort((a, b) => {
    const byDate = (calendarDate(a)?.getTime() ?? 0) - (calendarDate(b)?.getTime() ?? 0);
    return byDate || (a.startsAt ?? "").localeCompare(b.startsAt ?? "");
  });
  const activeDayEvents = selectedDay
    ? events.filter((item) => {
      if (item.allDay && item.startDate && item.endDate) return item.startDate <= selectedDay && item.endDate > selectedDay;
      return calendarDate(item) !== null && dayKey(calendarDate(item)!) === selectedDay;
    })
    : [];
  const selectedEvent = activeDayEvents.find((item) => item.id === selectedEventId) ?? null;
  const canCreatePolls = hasPermission(user, "poll.manage") && hasPermission(user, "poll.read");
  const canOpenGoogleIntegration = ["calendar_integration.read", "calendar_integration.manage", "calendar_integration.sync"]
    .some((permission) => hasPermission(user, permission));
  const programs = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of events) if (item.programId && item.programName) byId.set(item.programId, item.programName);
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [events]);

  function updateParams(updates: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  }

  function moveMonth(amount: number) {
    updateParams({ date: dayKey(addMonths(selectedDate, amount)) });
  }

  function showSheet(day: Date, eventId: string | null = null) {
    setSelectedDay(dayKey(day));
    setSelectedEventId(eventId);
  }

  const today = new Date();
  const monthHeading = format(selectedDate, "MMMM 'de' yyyy", { locale: ptBR });
  const weekdayNames = Array.from({ length: 7 }, (_, index) =>
    format(addDays(startOfWeek(today, { weekStartsOn: 0 }), index), "EEE", { locale: ptBR }).replace(".", "").toLocaleUpperCase("pt-BR"),
  );

  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageHeader
          eyebrow="Operação"
          title="Enquetes"
          description="Acompanhe a pauta e gerencie as enquetes em uma área única."
          actions={(
            <div className="flex flex-wrap gap-2">
              {canCreatePolls && (
                <Button asChild>
                  <Link to={`/enquetes/nova?editionStartsAt=${encodeURIComponent(`${dayKey(selectedDate)}T09:30`)}`}>
                    <Plus aria-hidden="true" data-icon="inline-start" /> Nova enquete
                  </Link>
                </Button>
              )}
              {canOpenGoogleIntegration && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" aria-label="Mais ações">
                      <MoreHorizontal aria-hidden="true" data-icon="inline-start" /> Mais ações
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link to="/enquetes/integracao">
                        <CalendarDays aria-hidden="true" data-icon="inline-start" /> Integração Google
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        />
        <PollAreaNavigation />

        {!canReadCalendar && (
          <Alert>
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Sem permissão para consultar a agenda</AlertTitle>
            <AlertDescription>Solicite o acesso <code>calendar_integration.read</code> para visualizar os eventos sincronizados.</AlertDescription>
          </Alert>
        )}
        {canReadCalendar && calendarQuery.isError && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Não foi possível carregar a agenda</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{calendarQuery.error instanceof Error ? calendarQuery.error.message : "Tente atualizar a consulta."}</span>
              <Button variant="outline" size="sm" onClick={() => void calendarQuery.refetch()}>Tentar novamente</Button>
            </AlertDescription>
          </Alert>
        )}
        {canReadCalendar && calendarQuery.data && !calendarQuery.data.connected && (
          <Alert>
            <CircleAlert aria-hidden="true" />
            <AlertTitle>Conta Google desconectada</AlertTitle>
            <AlertDescription>A agenda conectada ainda não está disponível. Confira a integração Google.</AlertDescription>
          </Alert>
        )}
        {canReadCalendar && calendarQuery.data?.connected && !calendarQuery.data.configured && (
          <Alert>
            <CircleAlert aria-hidden="true" />
            <AlertTitle>A agenda 88 - ENQUETE ainda não está configurada</AlertTitle>
            <AlertDescription>Configure a fonte permitida na integração Google para exibir os eventos aqui.</AlertDescription>
          </Alert>
        )}

        <section aria-label="Calendário de enquetes" className="min-w-0 overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex flex-col gap-4 border-b border-border p-4 sm:p-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <Button variant="outline" size="icon" aria-label="Mês anterior" onClick={() => moveMonth(-1)}>
                  <ChevronLeft aria-hidden="true" data-icon="only" />
                </Button>
                <Button variant="outline" size="icon" aria-label="Próximo mês" onClick={() => moveMonth(1)}>
                  <ChevronRight aria-hidden="true" data-icon="only" />
                </Button>
                <h2 className="min-w-0 px-2 font-display text-lg font-semibold text-foreground sm:text-xl">
                  {monthHeading.charAt(0).toLocaleUpperCase("pt-BR") + monthHeading.slice(1)}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => updateParams({ date: dayKey(new Date()) })}>
                  Hoje
                </Button>
              </div>
              <ToggleGroup
                type="single"
                value={view}
                onValueChange={(next) => next && updateParams({ view: next })}
                aria-label="Visualização do calendário"
                className="w-fit rounded-lg bg-muted p-1"
              >
                <ToggleGroupItem value="month" aria-label="Visualização mensal" className="gap-2 px-3">
                  <CalendarDays aria-hidden="true" data-icon="inline-start" className="size-4" /> Mês
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="Visualização em lista" className="gap-2 px-3">
                  <ListFilter aria-hidden="true" data-icon="inline-start" className="size-4" /> Lista
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4 lg:flex-row lg:items-end">
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground" htmlFor="calendar-search">
                Buscar pauta
                <Input id="calendar-search" value={query} onChange={(event) => updateParams({ q: event.target.value })} placeholder="Pergunta ou programa" />
              </label>
              <FilterSelect id="calendar-program" label="Programa" value={program} onChange={(value) => updateParams({ program: value })}>
                <option value="">Todos os programas</option>
                {programs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </FilterSelect>
              <FilterSelect id="calendar-state" label="Estado" value={state} onChange={(value) => updateParams({ state: value })}>
                <option value="">Todos os estados</option>
                {allowedStates.map((item) => <option key={item} value={item}>{stateLabels[item]}</option>)}
              </FilterSelect>
            </div>
          </div>

          {canReadCalendar && calendarQuery.isLoading && (
            <div className="flex items-center justify-center gap-2 border-b border-border py-8 text-sm text-muted-foreground" role="status">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Carregando eventos da agenda 88 - ENQUETE…
            </div>
          )}
          {canReadCalendar && syncIsStale && (
            <p role="status" className="border-b border-border px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
              A última sincronização foi há mais de 10 minutos. O conteúdo salvo continua visível; verifique a integração Google se necessário.
            </p>
          )}

          {view === "month" ? (
            <div className="overflow-x-auto">
              <div className="min-w-[840px]">
                <div className="grid grid-cols-7 border-b border-border bg-muted/40" aria-hidden="true">
                  {weekdayNames.map((name) => (
                    <div key={name} className="px-3 py-2 text-center text-[11px] font-semibold tracking-wide text-muted-foreground">{name}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {days.map((day) => {
                    const key = dayKey(day);
                    const dayEvents = datedEvents.filter((item) => {
                      if (item.allDay && item.startDate && item.endDate) return item.startDate <= key && item.endDate > key;
                      return calendarDate(item) !== null && dayKey(calendarDate(item)!) === key;
                    }).sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
                    const outsideMonth = !isSameMonth(day, selectedDate);
                    return (
                      <div key={dayKey(day)} role="group" aria-label={format(day, "EEEE, d 'de' MMMM", { locale: ptBR })} className={`min-h-32 border-b border-r border-border p-2 ${outsideMonth ? "bg-muted/20 text-muted-foreground/60" : "bg-background"}`}>
                        <button
                          type="button"
                          aria-label={`Ver pauta de ${format(day, "d 'de' MMMM", { locale: ptBR })}`}
                          onClick={() => showSheet(day)}
                          className={`mb-2 grid size-7 place-items-center rounded-full text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${isToday(day) ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                        >
                          {format(day, "d")}
                        </button>
                        <div className="flex flex-col gap-1">
                          {dayEvents.slice(0, 3).map((item) => (
                            <button
                              type="button"
                              key={item.id}
                              aria-label={`Abrir pauta da agenda: ${item.title}`}
                              onClick={() => showSheet(day, item.id)}
                              className="w-full truncate rounded bg-sky-500/10 px-2 py-1 text-left text-[11px] font-medium text-sky-800 outline-none hover:bg-sky-500/20 focus-visible:ring-2 focus-visible:ring-ring dark:text-sky-200"
                            >
                              <span className="mr-1 opacity-75">{eventTime(item)}</span>{item.title}
                            </button>
                          ))}
                          {dayEvents.length > 3 && (
                            <button type="button" className="self-start px-2 text-xs font-semibold text-primary hover:underline" onClick={() => showSheet(day)}>
                              +{dayEvents.length - 3} mais
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {eventsForMonth.length || undatedEvents.length ? eventsForMonth.map((item) => {
                const itemDate = calendarDate(item)!;
                return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => showSheet(itemDate, item.id)}
                  className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-3 px-4 py-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-5"
                >
                  <span className="text-sm font-semibold capitalize text-muted-foreground">{format(itemDate, "EEE, d", { locale: ptBR })}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{item.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{eventTime(item)} · {item.programName ?? "Programa não identificado"} · Agenda 88 - ENQUETE</span>
                  </span>
                  <Badge variant={stateVariant(item.state)} className="col-start-2 w-fit sm:col-start-auto">{stateLabels[item.state]}</Badge>
                </button>
              ); }) : null}
              {undatedEvents.length > 0 && (
                <section aria-labelledby="undated-events-title" className="px-4 py-3 sm:px-5">
                  <h3 id="undated-events-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sem data reconhecida</h3>
                  {undatedEvents.map((item) => (
                    <div key={item.id} className="border-b border-border py-3 last:border-b-0">
                      <p className="font-medium text-foreground">{item.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.programName ?? "Programa não identificado"} · Agenda 88 - ENQUETE</p>
                      <Badge className="mt-2" variant={stateVariant(item.state)}>{stateLabels[item.state]}</Badge>
                    </div>
                  ))}
                </section>
              )}
              {!eventsForMonth.length && !undatedEvents.length && !calendarQuery.isLoading && !calendarQuery.isError && calendarQuery.data?.connected && calendarQuery.data.configured && (
                <div className="px-5 py-12 text-center">
                  <p className="font-medium text-foreground">Nenhum evento da agenda neste período.</p>
                  <p className="mt-1 text-sm text-muted-foreground">A agenda está conectada. Ajuste os filtros ou navegue para outro mês.</p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
            <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-sky-500" /> Agenda Google · 88 - ENQUETE · somente leitura</span>
            <span className="ml-auto">{events.length} evento(s) no período</span>
            {calendarQuery.data?.lastSyncedAt && <span>Sincronizada {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(calendarQuery.data.lastSyncedAt))}</span>}
            <Button variant="ghost" size="sm" onClick={() => void calendarQuery.refetch()} disabled={!canReadCalendar || calendarQuery.isFetching}>
              <RefreshCw aria-hidden="true" data-icon="inline-start" className={calendarQuery.isFetching ? "animate-spin" : undefined} /> Atualizar dados
            </Button>
          </div>
        </section>
      </div>

      <Sheet open={Boolean(selectedDay)} onOpenChange={(open) => { if (!open) { setSelectedDay(null); setSelectedEventId(null); } }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader className="pr-8 text-left">
            <SheetTitle>{selectedEvent?.title ?? (selectedDay ? format(parseISO(selectedDay), "EEEE, d 'de' MMMM", { locale: ptBR }) : "Pauta do dia")}</SheetTitle>
            <SheetDescription>
              {selectedEvent ? `${selectedEvent.programName ?? "Programa não identificado"} · ${eventTime(selectedEvent)}` : "Eventos da agenda 88 - ENQUETE nesta data."}
            </SheetDescription>
          </SheetHeader>
          {selectedEvent ? (
            <div className="mt-6 space-y-5">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Google Agenda · 88 - ENQUETE</Badge>
                <Badge variant={stateVariant(selectedEvent.state)}>{stateLabels[selectedEvent.state]}</Badge>
                {selectedEvent.pollState && <Badge variant="outline">Enquete local: {stateLabels[selectedEvent.pollState]}</Badge>}
              </div>
              {selectedEvent.reason && <p className="border-l-2 border-amber-500 pl-3 text-sm text-muted-foreground">{reasonLabels[selectedEvent.reason] ?? "Este evento precisa de conferência."}</p>}
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-xs font-medium text-muted-foreground">Data</dt><dd className="mt-1 font-medium">{selectedEvent.startDate ? format(parseISO(selectedEvent.startDate), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR }) : "Não reconhecida"}</dd></div>
                <div><dt className="text-xs font-medium text-muted-foreground">Programa</dt><dd className="mt-1 font-medium">{selectedEvent.programName ?? "Não identificado"}</dd></div>
                <div><dt className="text-xs font-medium text-muted-foreground">Período</dt><dd className="mt-1 font-medium">{eventTime(selectedEvent)}</dd></div>
                <div><dt className="text-xs font-medium text-muted-foreground">Origem</dt><dd className="mt-1 font-medium">Google Agenda · 88 - ENQUETE</dd></div>
              </dl>
              <p className="text-xs text-muted-foreground">A agenda é consultada em modo somente leitura. Revisar ou visualizar aqui não publica, altera nem exclui eventos.</p>
            </div>
          ) : (
            <div className="mt-6 divide-y divide-border">
              {activeDayEvents.length ? activeDayEvents.map((item) => (
                <button type="button" key={item.id} onClick={() => setSelectedEventId(item.id)} className="block w-full py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block text-xs text-muted-foreground">{eventTime(item)} · {item.programName ?? "Programa não identificado"}</span>
                  <span className="mt-1 block font-medium text-foreground">{item.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">Google Agenda · 88 - ENQUETE · {stateLabels[item.state]}</span>
                </button>
              )) : <p className="py-6 text-sm text-muted-foreground">Nenhum evento da agenda nesta data.</p>}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
