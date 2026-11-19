import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CloudDownload,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/shadcn/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/shadcn/alert";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/shadcn/field";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";
import { api } from "@/services/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { CalendarProgram, CalendarSource, CalendarStageReason, StagedCalendarEvent } from "@/types/calendar-integration";

const DEFAULT_PROGRAM_NAME = "Bom Dia 88";
const calendarPermissionKeys = [
  "calendar_integration.read",
  "calendar_integration.manage",
  "calendar_integration.sync",
] as const;
const noPrograms: CalendarProgram[] = [];
const noSources: CalendarSource[] = [];

const reasonLabels: Record<CalendarStageReason, string> = {
  INVALID_SOURCE: "A fonte da agenda precisa ser revisada.",
  INVALID_EVENT: "O evento não tem título, data ou horário reconhecido.",
  UNSUPPORTED_EVENT: "O formato ou recorrência deste evento ainda não é compatível.",
  UNSAFE_DESCRIPTION: "A descrição contém conteúdo que não pode ser importado com segurança.",
  INVALID_CONFIG: "A descrição precisa seguir o formato de enquete combinado.",
  PROGRAM_UNAVAILABLE: "O programa indicado não está permitido para esta agenda.",
  EDITION_UNAVAILABLE: "Não foi possível relacionar o horário a uma edição da grade.",
  INVALID_WINDOW: "O período do evento não corresponde a uma janela válida do programa.",
  INVALID_POLL: "Pergunta, alternativas ou horários precisam de revisão.",
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Ainda não sincronizada";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}

function eventStatusLabel(event: StagedCalendarEvent) {
  if (event.externalState === "canceled") return "Cancelada na agenda · removida do ar";
  if (event.linkedPollState === "scheduled") return "Enquete agendada automaticamente";
  if (event.linkedPollState === "published") return "Disponível no institucional";
  if (event.externalState === "review") return "Alteração aguardando revisão";
  if (event.state === "review") return "Aguardando conferência";
  if (event.state === "canceled") return "Cancelado na agenda";
  if (event.state === "conflict") return "Conflito";
  return "Pendente de ajuste";
}

function eventBadgeVariant(event: StagedCalendarEvent): "default" | "secondary" | "destructive" | "outline" {
  if (event.state === "review") return "secondary";
  if (event.state === "invalid" || event.state === "conflict") return "destructive";
  return "outline";
}

export function CalendarIntegrationPage() {
  usePageTitle("Agenda Google · Enquetes");
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canRead = hasPermission(user, "calendar_integration.read");
  const canManage = hasPermission(user, "calendar_integration.manage");
  const canSync = hasPermission(user, "calendar_integration.sync");
  const hasAnyPermission = calendarPermissionKeys.some((key) => hasPermission(user, key));
  const [connecting, setConnecting] = useState(false);
  const [newProgramId, setNewProgramId] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [programConfigDraft, setProgramConfigDraft] = useState<{
    sourceId: string;
    version: number;
    defaultProgramId: string;
    allowedProgramIds: string[];
  } | null>(null);
  const popupRef = useRef<Window | null>(null);
  const oauthFlowActive = useRef(false);

  const statusQuery = useQuery({
    queryKey: ["calendar-integration", "oauth-status"],
    queryFn: ({ signal }) => api.getCalendarOAuthStatus(signal),
    enabled: canManage,
    refetchOnWindowFocus: true,
  });
  const programsQuery = useQuery({
    queryKey: ["calendar-integration", "programs"],
    queryFn: ({ signal }) => api.listCalendarPrograms(signal),
    enabled: canManage,
  });
  const sourcesQuery = useQuery({
    queryKey: ["calendar-integration", "sources"],
    queryFn: ({ signal }) => api.listCalendarSources(signal),
    enabled: canRead,
  });
  const sources = sourcesQuery.data ?? noSources;
  const activeSourceId = selectedSourceId || sources[0]?.id || "";
  const selectedSource = sources.find((source) => source.id === activeSourceId);
  const availablePrograms = programsQuery.data ?? noPrograms;
  const preferredProgram = availablePrograms.find((program) => normalize(program.name) === normalize(DEFAULT_PROGRAM_NAME));
  const resolvedNewProgramId = newProgramId || preferredProgram?.id || "";
  const draftMatchesSource = Boolean(selectedSource && programConfigDraft?.sourceId === selectedSource.id && programConfigDraft.version === selectedSource.version);
  const defaultProgramId = draftMatchesSource ? programConfigDraft!.defaultProgramId : selectedSource?.programId ?? "";
  const allowedProgramIds = draftMatchesSource ? programConfigDraft!.allowedProgramIds : selectedSource?.allowedPrograms.map((program) => program.id) ?? [];
  const eventsQuery = useInfiniteQuery({
    queryKey: ["calendar-integration", "events", selectedSource?.id],
    queryFn: ({ pageParam, signal }) => api.listStagedCalendarEvents(selectedSource!.id, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: canRead && Boolean(selectedSource?.id),
  });

  useEffect(() => {
    return () => { oauthFlowActive.current = false; };
  }, []);

  const refreshSources = async () => {
    await queryClient.invalidateQueries({ queryKey: ["calendar-integration", "sources"] });
    await queryClient.invalidateQueries({ queryKey: ["calendar-integration", "events"] });
  };

  const connectMutation = useMutation({
    mutationFn: api.startCalendarOAuth,
    onSuccess: async ({ authorizationUrl }) => {
      if (!popupRef.current || popupRef.current.closed) {
        oauthFlowActive.current = false;
        setConnecting(false);
        toast.error("A janela de autorização foi fechada. Tente conectar novamente.");
        return;
      }
      popupRef.current.location.href = authorizationUrl;
      for (let attempt = 0; attempt < 120 && oauthFlowActive.current; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
        if (!oauthFlowActive.current) return;
        if (popupRef.current?.closed) {
          oauthFlowActive.current = false;
          setConnecting(false);
          toast.info("A autorização foi fechada antes da confirmação.");
          return;
        }
        try {
          const status = await api.getCalendarOAuthStatus();
          queryClient.setQueryData(["calendar-integration", "oauth-status"], status);
          if (status.connected) {
            oauthFlowActive.current = false;
            setConnecting(false);
            toast.success("Conta Google conectada. A agenda permanece somente para leitura.");
            if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
            popupRef.current = null;
            return;
          }
        } catch {
          // Keep the consent flow alive through transient status/network errors.
        }
      }
      if (oauthFlowActive.current) {
        oauthFlowActive.current = false;
        setConnecting(false);
        toast.error("A autorização não foi confirmada em até cinco minutos. Confira a janela do Google e tente novamente.");
      }
    },
    onError: (error) => {
      oauthFlowActive.current = false;
      setConnecting(false);
      popupRef.current?.close();
      popupRef.current = null;
      toast.error(error instanceof Error ? error.message : "Não foi possível iniciar a autorização.");
    },
  });

  const createSourceMutation = useMutation({
    mutationFn: (programId: string) => api.createCalendarSource(programId),
    onSuccess: async (source) => {
      setSelectedSourceId(source.id);
      setProgramConfigDraft(null);
      await refreshSources();
      toast.success(`Agenda configurada com ${DEFAULT_PROGRAM_NAME} como padrão. A fonte foi criada inativa.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível configurar a agenda."),
  });

  const configureMutation = useMutation({
    mutationFn: () => {
      if (!selectedSource) throw new Error("Selecione uma fonte de agenda.");
      return api.configureCalendarSourcePrograms(selectedSource.id, {
        version: selectedSource.version,
        defaultProgramId,
        allowedProgramIds,
      });
    },
    onSuccess: async () => {
      setProgramConfigDraft(null);
      await refreshSources();
      toast.success("Programas permitidos atualizados.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível salvar os programas."),
  });

  const activeMutation = useMutation({
    mutationFn: (active: boolean) => {
      if (!selectedSource) throw new Error("Selecione uma fonte de agenda.");
      return api.setCalendarSourceActive(selectedSource.id, selectedSource.version, active);
    },
    onSuccess: async ({ active }) => {
      await refreshSources();
      toast.success(active ? "Sincronização habilitada para leitura." : "Fonte desativada.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível atualizar a fonte."),
  });

  const syncMutation = useMutation({
    mutationFn: () => {
      if (!selectedSource) throw new Error("Selecione uma fonte de agenda.");
      return api.syncCalendarSource(selectedSource.id);
    },
    onSuccess: async (result) => {
      await refreshSources();
      if (result.fullSyncRequired) {
        toast.warning("O cursor do Google expirou. A fonte foi preparada para uma leitura completa; execute sincronizar novamente.");
      } else {
        const promoted = result.publication?.scheduled ?? 0;
        const review = result.publication?.needsReview ?? 0;
        toast.success(`Leitura concluída: ${result.scanned} eventos. ${promoted} enquetes programadas; ${review} itens precisam de revisão.`);
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível sincronizar a agenda."),
  });

  const programsById = useMemo(() => new Map(availablePrograms.map((program) => [program.id, program.name])), [availablePrograms]);
  const configChanged = Boolean(selectedSource && (
    selectedSource.programId !== defaultProgramId ||
    [...selectedSource.allowedPrograms.map((program) => program.id)].sort().join(",") !== [...allowedProgramIds].sort().join(",")
  ));

  function beginOAuth() {
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      toast.error("Permita a abertura da janela de autorização do Google e tente novamente.");
      return;
    }
    popupRef.current = popup;
    oauthFlowActive.current = true;
    setConnecting(true);
    connectMutation.mutate();
  }

  function toggleAllowedProgram(programId: string) {
    if (!selectedSource) return;
    const next = allowedProgramIds.includes(programId)
      ? allowedProgramIds.filter((id) => id !== programId)
      : [...allowedProgramIds, programId];
    setProgramConfigDraft({ sourceId: selectedSource.id, version: selectedSource.version, defaultProgramId, allowedProgramIds: next });
  }

  function changeDefaultProgram(programId: string) {
    if (!selectedSource) return;
    const next = allowedProgramIds.includes(programId) ? allowedProgramIds : [...allowedProgramIds, programId];
    setProgramConfigDraft({ sourceId: selectedSource.id, version: selectedSource.version, defaultProgramId: programId, allowedProgramIds: next });
  }

  if (!hasAnyPermission) {
    return <AppShell><PageHeader eyebrow="Operação" title="Agenda Google" description="Acesso não autorizado." /></AppShell>;
  }

  return (
    <AppShell>
      <div className="flex min-w-0 flex-col gap-6">
        <PageHeader
          eyebrow="Enquetes · Origem de conteúdo"
          title="Agenda Google"
          description="Consulte os eventos da agenda 88 - ENQUETE e confira o conteúdo antes de criar ou publicar qualquer enquete."
          actions={<Button variant="outline" onClick={() => navigate("/enquetes")}>Voltar às enquetes</Button>}
        />

        <Alert>
          <ShieldCheck aria-hidden="true" />
          <AlertTitle>Somente leitura, sem alterações na agenda</AlertTitle>
          <AlertDescription>
            O Gestão consulta a agenda privada. Não cria, edita nem exclui eventos no Google. A sincronização apenas salva uma prévia privada; ela não cria votos, participação ou publicação automaticamente.
          </AlertDescription>
        </Alert>

        {!canRead && (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Permissão de consulta necessária</AlertTitle>
            <AlertDescription>Seu perfil pode configurar ou sincronizar a integração, mas precisa de <code>calendar_integration.read</code> para visualizar fontes e eventos importados.</AlertDescription>
          </Alert>
        )}

        <section aria-labelledby="calendar-connection-title" className="rounded-xl border border-border bg-background p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays aria-hidden="true" /></span>
              <div>
                <h2 id="calendar-connection-title" className="font-display text-lg font-semibold">Conexão Google</h2>
                <p className="mt-1 text-sm text-muted-foreground">A conta autorizada concede acesso de leitura ao calendário selecionado.</p>
                {canManage && statusQuery.data && (
                  <p className="mt-2 flex items-center gap-2 text-sm" role="status">
                    {statusQuery.data.connected ? <><CheckCircle2 className="size-4 text-emerald-600" /> Conectada · somente leitura</> : <><LockKeyhole className="size-4 text-muted-foreground" /> Ainda não conectada</>}
                  </p>
                )}
                {canManage && statusQuery.isError && <p className="mt-2 text-sm text-destructive" role="alert">{statusQuery.error.message} Verifique se a integração está habilitada neste ambiente.</p>}
              </div>
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                {connecting ? (
                  <Button variant="outline" onClick={() => { oauthFlowActive.current = false; setConnecting(false); popupRef.current?.close(); popupRef.current = null; }}>Interromper verificação</Button>
                ) : (
                  <Button onClick={beginOAuth} disabled={connectMutation.isPending || statusQuery.isPending}>
                    {connectMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                    {statusQuery.data?.connected ? "Reconectar conta" : "Conectar conta Google"}
                  </Button>
                )}
              </div>
            )}
          </div>
          {canManage && statusQuery.isPending && <p className="mt-4 text-sm text-muted-foreground" role="status">Consultando status da conexão…</p>}
          {canManage && statusQuery.data?.connected && (
            <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">Conectada em {formatDate(statusQuery.data.connectedAt)} · Escopo concedido: leitura dos eventos.</p>
          )}
        </section>

        {canManage && (
          <section aria-labelledby="calendar-source-title" className="rounded-xl border border-border bg-background p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="calendar-source-title" className="font-display text-lg font-semibold">Fonte 88 - ENQUETE</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">O programa padrão é <strong>{DEFAULT_PROGRAM_NAME}</strong>. Outros programas só serão aceitos se forem explicitamente selecionados.</p>
              </div>
              {selectedSource && <Badge variant={selectedSource.active ? "default" : "outline"}>{selectedSource.active ? "Sincronização habilitada" : "Fonte inativa"}</Badge>}
            </div>

            {programsQuery.isError && <Alert variant="destructive" className="mt-4"><AlertTriangle aria-hidden="true" /><AlertTitle>Não foi possível carregar os programas</AlertTitle><AlertDescription>{programsQuery.error.message} Confirme se a grade está publicada no banco local e se a integração está habilitada.</AlertDescription></Alert>}

            {canRead && sourcesQuery.isSuccess && !selectedSource && (
              <div className="mt-5 grid gap-4 rounded-lg bg-muted/40 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Field>
                  <FieldLabel htmlFor="calendar-default-program">Programa padrão da agenda</FieldLabel>
                  <select id="calendar-default-program" className="flex min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={resolvedNewProgramId} onChange={(event) => setNewProgramId(event.target.value)} disabled={programsQuery.isPending || programsQuery.isError}>
                    <option value="">Selecione Bom Dia 88</option>
                    {availablePrograms.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
                  </select>
                  <FieldDescription>Bom Dia 88 é aplicado automaticamente como programa padrão; o evento só poderá indicar outro programa após configurar uma permissão explícita.</FieldDescription>
                </Field>
                <Button onClick={() => createSourceMutation.mutate(resolvedNewProgramId)} disabled={!resolvedNewProgramId || createSourceMutation.isPending || statusQuery.data?.connected !== true}>
                  {createSourceMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <CalendarDays className="size-4" />}
                  Configurar agenda
                </Button>
                {!statusQuery.data?.connected && <p className="text-xs text-muted-foreground sm:col-span-2">Conecte primeiro a conta Google para configurar a fonte.</p>}
              </div>
            )}

            {sourcesQuery.isPending && canRead && <p className="mt-4 text-sm text-muted-foreground" role="status">Carregando fontes de agenda…</p>}
            {sourcesQuery.isError && canRead && <Alert variant="destructive" className="mt-4"><AlertTriangle aria-hidden="true" /><AlertTitle>Não foi possível carregar a fonte</AlertTitle><AlertDescription>{sourcesQuery.error.message}</AlertDescription></Alert>}

            {selectedSource && (
              <div className="mt-5 space-y-5">
                {selectedSource.active && <p className="rounded-md border-l-2 border-primary pl-3 text-sm text-muted-foreground">A agenda ativa é consultada automaticamente no intervalo configurado no servidor. Perguntas válidas são preparadas e entram no ar somente dentro da janela do programa; conteúdo incompleto ou ambíguo fica para revisão.</p>}
                <div className="grid gap-3 rounded-lg bg-muted/40 p-4 sm:grid-cols-3">
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agenda monitorada</p><p className="mt-1 break-all text-sm font-medium">88 - ENQUETE</p></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Programa padrão</p><p className="mt-1 text-sm font-medium">{selectedSource.programName}</p></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Última sincronização</p><p className="mt-1 text-sm font-medium">{formatDate(selectedSource.lastSyncAt)}</p></div>
                </div>

                <FieldGroup className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="calendar-source-default">Programa padrão</FieldLabel>
                    <select id="calendar-source-default" className="flex min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={defaultProgramId} onChange={(event) => changeDefaultProgram(event.target.value)} disabled={selectedSource.active || !canRead || programsQuery.isPending}>
                      {availablePrograms.map((program) => <option key={program.id} value={program.id}>{program.name}{normalize(program.name) === normalize(DEFAULT_PROGRAM_NAME) ? " · padrão recomendado" : ""}</option>)}
                    </select>
                    <FieldDescription>O padrão inicial foi definido como Bom Dia 88.</FieldDescription>
                  </Field>
                  <fieldset className="min-w-0 rounded-lg border border-border p-3">
                    <legend className="px-1 text-sm font-medium">Programas permitidos nos eventos</legend>
                    <div className="mt-1 grid gap-2 sm:grid-cols-2">
                      {availablePrograms.map((program) => (
                        <label key={program.id} className="flex min-h-10 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/60">
                          <input type="checkbox" checked={allowedProgramIds.includes(program.id)} onChange={() => toggleAllowedProgram(program.id)} disabled={selectedSource.active || !canRead || program.id === defaultProgramId} className="size-4 accent-primary" />
                          <span>{program.name}</span>
                        </label>
                      ))}
                    </div>
                    <FieldDescription className="mt-2">O programa padrão permanece sempre permitido.</FieldDescription>
                  </fieldset>
                </FieldGroup>

                <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">Somente eventos da agenda fixa 88 - ENQUETE são consultados. A automação do serviço sincroniza em segundo plano quando habilitada; também é possível iniciar uma sincronização manual.</p>
                  <div className="flex flex-wrap gap-2">
                    {canRead && configChanged && !selectedSource.active && (
                      <Button variant="outline" onClick={() => configureMutation.mutate()} disabled={configureMutation.isPending || !defaultProgramId || allowedProgramIds.length === 0}>
                        {configureMutation.isPending && <LoaderCircle className="size-4 animate-spin" />} Salvar programas
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => activeMutation.mutate(!selectedSource.active)} disabled={activeMutation.isPending || (selectedSource.active && configChanged) || (!selectedSource.active && statusQuery.data?.connected !== true)}>
                      {activeMutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
                      {selectedSource.active ? "Desativar fonte" : "Habilitar leitura"}
                    </Button>
                    {canSync && (
                    <Button onClick={() => syncMutation.mutate()} disabled={!selectedSource.active || (canManage && statusQuery.data?.connected !== true) || syncMutation.isPending}>
                        {syncMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                        Sincronizar agora
                      </Button>
                    )}
                  </div>
                </div>
                {canManage && selectedSource.active && statusQuery.data?.connected !== true && <p role="alert" className="text-sm text-destructive">A fonte está habilitada, mas a conexão Google não está disponível. Reconecte antes de sincronizar.</p>}
                {canSync && !selectedSource.active && <p className="text-xs text-muted-foreground">Habilite a fonte para consultar eventos. Isso não altera a agenda do Google.</p>}
              </div>
            )}
          </section>
        )}

        {canRead && (
          <section aria-labelledby="calendar-review-title" className="rounded-xl border border-border bg-background p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="calendar-review-title" className="font-display text-lg font-semibold">Eventos importados para conferência</h2>
                <p className="mt-1 text-sm text-muted-foreground">Esta lista contém apenas eventos importados da agenda 88 - ENQUETE. Perguntas válidas são programadas; itens sem formato de enquete permanecem em revisão.</p>
              </div>
              {selectedSource && <Button variant="outline" size="sm" onClick={() => void eventsQuery.refetch()} disabled={eventsQuery.isFetching}><RefreshCw className={`size-4 ${eventsQuery.isFetching ? "animate-spin" : ""}`} /> Atualizar lista</Button>}
            </div>
            {!selectedSource && <p className="mt-5 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">Configure a fonte da agenda para visualizar as prévias.</p>}
            {eventsQuery.isPending && selectedSource && <p className="mt-5 text-sm text-muted-foreground" role="status">Carregando eventos importados…</p>}
            {eventsQuery.isError && selectedSource && <Alert variant="destructive" className="mt-4"><AlertTriangle aria-hidden="true" /><AlertTitle>Falha ao consultar eventos importados</AlertTitle><AlertDescription>{eventsQuery.error.message}</AlertDescription></Alert>}
            {eventsQuery.isSuccess && eventsQuery.data.pages.flatMap((page) => page.items).length === 0 && <p className="mt-5 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">Nenhum evento importado ainda. Habilite a fonte e execute uma sincronização manual.</p>}
            {eventsQuery.isSuccess && eventsQuery.data.pages.flatMap((page) => page.items).length > 0 && (
              <div className="mt-5 space-y-3">
                {eventsQuery.data.pages.flatMap((page) => page.items).map((event) => {
                  const poll = event.payload?.poll;
                  const eventProgram = event.payload ? programsById.get(event.payload.programId) ?? selectedSource?.allowedPrograms.find((program) => program.id === event.payload?.programId)?.name : undefined;
                  return (
                    <article key={event.id} className="rounded-lg border border-border p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h3 className="break-words font-semibold">{poll?.question ?? "Evento sem enquete pronta para conferência"}</h3>
                          {eventProgram && <p className="mt-1 text-sm text-muted-foreground">{eventProgram}</p>}
                          <p className="mt-1 text-xs text-muted-foreground">Atualizado em {formatDate(event.updatedAt)} · referência privada: {event.eventId.slice(0, 12)}{event.eventId.length > 12 ? "…" : ""}</p>
                        </div>
                        <Badge variant={eventBadgeVariant(event)}>{eventStatusLabel(event)}</Badge>
                      </div>
                      {event.reason && <p className="mt-3 flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{reasonLabels[event.reason]}</p>}
                      {poll && (
                        <details className="mt-4 rounded-md bg-muted/40 p-3">
                          <summary className="cursor-pointer text-sm font-medium">Conferir pergunta e conteúdo</summary>
                          <div className="mt-3 space-y-3 text-sm">
                            {poll.context && <p className="whitespace-pre-wrap text-muted-foreground">{poll.context}</p>}
                            {poll.options.length > 0 && <div><p className="font-medium">Alternativas</p><ul className="mt-1 list-inside list-disc text-muted-foreground">{poll.options.map((option, index) => <li key={`${index}-${option}`}>{option}</li>)}</ul></div>}
                            <dl className="grid gap-2 text-xs sm:grid-cols-2"><div><dt className="font-semibold">Janela da edição</dt><dd className="text-muted-foreground">{formatDate(poll.editionStartsAt)} – {formatDate(poll.editionEndsAt)}</dd></div><div><dt className="font-semibold">Período da enquete</dt><dd className="text-muted-foreground">{formatDate(poll.startsAt)} – {formatDate(poll.endsAt)}</dd></div></dl>
                          </div>
                        </details>
                      )}
                    </article>
                  );
                })}
                <div className="flex justify-end">
                  {eventsQuery.hasNextPage && <Button variant="outline" onClick={() => void eventsQuery.fetchNextPage()} disabled={eventsQuery.isFetchingNextPage}><CloudDownload className="size-4" /> {eventsQuery.isFetchingNextPage ? "Carregando…" : "Carregar mais eventos"}</Button>}
                </div>
              </div>
            )}
          </section>
        )}

        <p className="flex items-start gap-2 text-xs text-muted-foreground"><LockKeyhole className="mt-0.5 size-4 shrink-0" />Credenciais e cursores ficam no backend. A interface nunca recebe refresh token nem oferece ações de edição/exclusão da agenda.</p>
      </div>
    </AppShell>
  );
}
