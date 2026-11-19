import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/shadcn/button";
import { Input } from "@/components/ui/shadcn/input";
import { Textarea } from "@/components/ui/shadcn/textarea";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from "@/components/ui/shadcn/field";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@/components/ui/shadcn/alert";
import { Badge } from "@/components/ui/shadcn/badge";
import { Select } from "@/components/ui/Select";
import { PollActions } from "@/components/polls/PollActions";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/shadcn/toggle-group";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
} from "@/components/ui/shadcn/input-group";
import { X, Plus } from "lucide-react";
import {
  PollNotice,
  PollError,
  PollLoading,
} from "@/components/polls/PollFeedback";
import { usePollPrograms } from "@/components/polls/usePollPrograms";
import {
  localInput,
  localTimezone,
  pollStates,
  questionSlug,
} from "@/components/polls/poll-utils";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";
import { api } from "@/services/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { Poll, PollInput } from "@/types/polls";

export function PollEditorPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const initialEditionStartsAt = searchParams.get("editionStartsAt") ?? "";
  usePageTitle(id ? "Editar enquete" : "Nova enquete");
  const query = useQuery({
    queryKey: ["polls", "detail", id],
    queryFn: () => api.getPoll(id!),
    enabled: !!id,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Operação / Enquetes"
          title={id ? "Enquete" : "Nova enquete"}
          description="Salve o rascunho antes de mudar seu estado administrativo."
          actions={
            <Button variant="outline" asChild>
              <Link to="/enquetes">Voltar à lista</Link>
            </Button>
          }
        />
        <PollNotice />
        {id && query.isPending ? (
          <PollLoading />
        ) : id && query.isError ? (
          <>
            <PollError error={query.error} />
            <Button variant="outline" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          </>
        ) : (
          <PollEditorForm
            key={id ?? "new"}
            initial={query.data}
            initialEditionStartsAt={id ? "" : initialEditionStartsAt}
          />
        )}
      </div>
    </AppShell>
  );
}

function pollFormValues(poll?: Poll, initialEditionStartsAt = ""): PollInput {
  return {
    mode: poll?.mode ?? "mixed",
    imageUrl: poll?.imageUrl ?? "",
    slug: poll?.slug ?? "",
    question: poll?.question ?? "",
    context: poll?.context ?? "",
    identificationPolicy: poll?.identificationPolicy ?? "optional",
    allowMessage: poll?.allowMessage ?? true,
    options: poll?.options.map((option) => option.text) ?? ["", ""],
    editionStartsAt: poll ? localInput(poll.editionStartsAt) : initialEditionStartsAt,
    editionEndsAt: poll ? localInput(poll.editionEndsAt) : "",
    startsAt: poll ? localInput(poll.startsAt) : "",
    endsAt: poll ? localInput(poll.endsAt) : "",
  };
}

function PollEditorForm({
  initial,
  initialEditionStartsAt = "",
}: {
  initial?: Poll;
  initialEditionStartsAt?: string;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const programs = usePollPrograms();
  const canReadPrograms = hasPermission(user, "program.read");
  const [programId, setProgramId] = useState(initial?.programId ?? "");
  const [form, setForm] = useState<PollInput>(() => pollFormValues(initial, initialEditionStartsAt));
  const [saved, setSaved] = useState(() => ({
    version: initial?.version,
    programId: initial?.programId ?? "",
    form: pollFormValues(initial, initialEditionStartsAt),
  }));
  const version = saved.version;
  const isDirty =
    programId !== saved.programId ||
    JSON.stringify(form) !== JSON.stringify(saved.form);
  const [slugManual, setSlugManual] = useState(!!initial);
  const [error, setError] = useState("");
  const canEdit =
    hasPermission(user, "poll.manage") &&
    (!initial || initial.state === "draft" || initial.state === "scheduled");
  const programSelectionUnavailable =
    !initial &&
    canReadPrograms &&
    (!programs.isSuccess ||
      !programs.data.some((program) => program.id === programId));
  const structureLocked = (initial?.totalVotes ?? 0) > 0;
  const detail = useQuery({
    queryKey: ["polls", "program-detail", programId],
    queryFn: () => api.getProgram(programId),
    enabled: !!programId && hasPermission(user, "program.read"),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const set = <K extends keyof PollInput>(key: K, value: PollInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  };
  const save = useMutation({
    mutationFn: (input: PollInput) =>
      initial
        ? api.updatePoll(initial.id, { ...input, version: version! })
        : api.createPoll(programId.trim(), input),
    onSuccess: async (poll) => {
      const nextForm = pollFormValues(poll);
      setForm(nextForm);
      setProgramId(poll.programId);
      setSaved({
        version: poll.version,
        programId: poll.programId,
        form: nextForm,
      });
      client.setQueryData(["polls", "detail", poll.id], poll);
      await client.invalidateQueries({ queryKey: ["polls"] });
      toast.success(
        "Enquete salva. Nenhuma publicação foi feita no institucional.",
      );
      if (!initial) navigate(`/enquetes/${poll.id}`, { replace: true });
    },
  });
  // Reconcile only clean snapshots. A dirty form keeps its version and fields until an explicit discard.
  if (
    initial &&
    initial.version !== saved.version &&
    !isDirty &&
    !save.isPending
  ) {
    const nextForm = pollFormValues(initial);
    setForm(nextForm);
    setProgramId(initial.programId);
    setSaved({
      version: initial.version,
      programId: initial.programId,
      form: nextForm,
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !canEdit ||
      programSelectionUnavailable ||
      (initial && initial.version !== saved.version)
    )
      return;
    const dates = [
      form.editionStartsAt,
      form.editionEndsAt,
      form.startsAt,
      form.endsAt,
    ].map((value) => new Date(value).getTime());
    if (
      !programId.trim() ||
      !form.slug.trim() ||
      !form.question.trim() ||
      (form.mode !== "message" &&
        (form.options.length < 2 ||
          form.options.length > 10 ||
          form.options.some((option) => !option.trim())))
    ) {
      setError("Preencha programa, slug, pergunta e de 2 a 10 alternativas.");
      return;
    }
    if (
      form.mode !== "message" &&
      new Set(form.options.map((option) => option.trim().toLocaleLowerCase()))
        .size !== form.options.length
    ) {
      setError("As alternativas devem ser distintas.");
      return;
    }
    if (
      dates.some((date) => !Number.isFinite(date)) ||
      dates[0] >= dates[1] ||
      dates[2] >= dates[3] ||
      dates[2] < dates[0] ||
      dates[3] > dates[1]
    ) {
      setError(
        "A janela da enquete deve estar dentro da edição, com início antes do fim.",
      );
      return;
    }
    save.mutate({
      ...form,
      slug: form.slug.trim(),
      question: form.question.trim(),
      context: form.context.trim(),
      mode: form.mode,
      allowMessage: form.mode !== "vote",
      imageUrl: form.imageUrl?.trim() || undefined,
      options:
        form.mode === "message"
          ? []
          : form.options.map((option) => option.trim()),
      editionStartsAt: new Date(form.editionStartsAt).toISOString(),
      editionEndsAt: new Date(form.editionEndsAt).toISOString(),
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
    });
  }
  return (
    <>
      {initial && (
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{pollStates[initial.state]}</Badge>
          <span>Versão {version}</span>
          {isDirty || save.isPending ? (
            <Button disabled variant="outline">
              Ações indisponíveis
            </Button>
          ) : (
            <PollActions poll={initial} />
          )}
        </div>
      )}
      {initial && isDirty && (
        <div className="flex flex-col gap-2">
          <p role="status">
            Há alterações não salvas. Salve ou descarte antes de mudar o estado
            da enquete.
          </p>
          {initial.version !== saved.version && (
            <Alert variant="destructive">
              <AlertTitle>A enquete foi atualizada</AlertTitle>
              <AlertDescription>
                Suas alterações foram preservadas. Descarte-as para carregar a
                versão atual antes de continuar.
              </AlertDescription>
            </Alert>
          )}
          <Button
            variant="outline"
            className="self-start"
            disabled={save.isPending}
            onClick={() => {
              const nextForm = pollFormValues(initial);
              setForm(nextForm);
              setProgramId(initial.programId);
              setSaved({
                version: initial.version,
                programId: initial.programId,
                form: nextForm,
              });
              setError("");
            }}
          >
            Descartar alterações e usar dados atuais
          </Button>
        </div>
      )}
      {!canEdit && (
        <Alert>
          <AlertTitle>Consulta somente leitura</AlertTitle>
          <AlertDescription>
            Seu perfil ou o estado atual não permite editar esta enquete.
          </AlertDescription>
        </Alert>
      )}
      <form
        onSubmit={submit}
        className="rounded-xl border border-border bg-background p-4 sm:p-6"
      >
        <FieldGroup>
          <FieldSet disabled={!canEdit || save.isPending}>
            <FieldLegend>Programa e edição</FieldLegend>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="poll-program">Programa</FieldLabel>
                {canReadPrograms ? (
                  <Select
                    id="poll-program"
                    required
                    disabled={
                      !!initial ||
                      programs.isPending ||
                      programs.isError ||
                      !programs.data?.length
                    }
                    value={programId}
                    aria-describedby="poll-program-status"
                    onChange={(event) => {
                      setProgramId(event.target.value);
                      setError("");
                    }}
                  >
                    <option value="">
                      {programs.isPending
                        ? "Carregando programas…"
                        : programs.isError
                          ? "Programas indisponíveis"
                          : "Selecione um programa"}
                    </option>
                    {initial &&
                      !programs.data?.some(
                        (program) => program.id === initial.programId,
                      ) && (
                        <option value={initial.programId}>
                          {initial.programName}
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
                    id="poll-program"
                    required
                    disabled={!!initial}
                    value={programId}
                    onChange={(event) => setProgramId(event.target.value)}
                    placeholder="ID do programa"
                  />
                )}
                {canReadPrograms && (
                  <div id="poll-program-status">
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
                      <p role="status">
                        Nenhum programa autorizado disponível.
                      </p>
                    )}
                  </div>
                )}
                <FieldDescription>
                  {initial
                    ? `${initial.programName}. O programa não pode ser alterado.`
                    : canReadPrograms
                      ? "Selecione um programa autorizado pelo nome."
                      : "Sem acesso ao catálogo. Informe o ID de um programa autorizado."}
                </FieldDescription>
              </Field>
              {detail.isSuccess && (
                <FieldDescription>
                  Grade em Brasília (America/Sao_Paulo):{" "}
                  {detail.data.slots
                    .filter((slot) => slot.active)
                    .map(
                      (slot) =>
                        `${["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][slot.weekday]} ${String(Math.floor(slot.startMinute / 60)).padStart(2, "0")}:${String(slot.startMinute % 60).padStart(2, "0")}–${String(Math.floor(slot.endMinute / 60)).padStart(2, "0")}:${String(slot.endMinute % 60).padStart(2, "0")}`,
                    )
                    .join("; ") || "sem horários ativos"}
                  .
                </FieldDescription>
              )}
              {detail.isError && <PollError error={detail.error} />}
              <FieldDescription>
                Todos os campos de data abaixo usam o fuso local do dispositivo:{" "}
                {localTimezone}. A API valida a edição real da grade e a
                unicidade (uma enquete por edição).
              </FieldDescription>
              {!initial && initialEditionStartsAt && (
                <FieldDescription>
                  A data inicial veio do calendário. Confirme o horário e preencha os demais limites da edição antes de salvar.
                </FieldDescription>
              )}
              <FieldGroup className="sm:flex-row">
                {(["editionStartsAt", "editionEndsAt"] as const).map(
                  (key, index) => (
                    <Field key={key} data-invalid={!!error}>
                      <FieldLabel htmlFor={key}>
                        {index === 0 ? "Início da edição" : "Fim da edição"}
                      </FieldLabel>
                      <Input
                        id={key}
                        type="datetime-local"
                        required
                        value={form[key]}
                        aria-invalid={!!error}
                        onChange={(event) => set(key, event.target.value)}
                      />
                    </Field>
                  ),
                )}
              </FieldGroup>
            </FieldGroup>
          </FieldSet>
          <FieldSet disabled={!canEdit || save.isPending}>
            <FieldLegend>Pergunta e participação</FieldLegend>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="poll-slug">Slug</FieldLabel>
                <Input
                  id="poll-slug"
                  required
                  maxLength={120}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={form.slug}
                  disabled={structureLocked}
                  onChange={(event) => {
                    setSlugManual(true);
                    set("slug", event.target.value);
                  }}
                />
                <FieldDescription>
                  Letras minúsculas, números e hífens.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="poll-question">Pergunta</FieldLabel>
                <Input
                  id="poll-question"
                  required
                  disabled={structureLocked}
                  minLength={3}
                  maxLength={500}
                  value={form.question}
                  onChange={(event) => {
                    const question = event.target.value;
                    setForm((current) => ({
                      ...current,
                      question,
                      ...(!initial && !slugManual
                        ? { slug: questionSlug(question) }
                        : {}),
                    }));
                    setError("");
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="poll-context">
                  Contexto da pergunta
                </FieldLabel>
                <Textarea
                  id="poll-context"
                  maxLength={2000}
                  value={form.context}
                  onChange={(event) => set("context", event.target.value)}
                />
                <FieldDescription>
                  Explique a pergunta ao participante. Não é um mural de
                  mensagens.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="poll-image">
                  Imagem da enquete (URL opcional)
                </FieldLabel>
                <Input
                  id="poll-image"
                  type="url"
                  maxLength={2048}
                  value={form.imageUrl ?? ""}
                  onChange={(event) => set("imageUrl", event.target.value)}
                  placeholder="https://…"
                />
                <FieldDescription>
                  Opcional. Use uma URL HTTP ou HTTPS da imagem.
                </FieldDescription>
              </Field>
              <FieldSet disabled={structureLocked}>
                <FieldLegend>Tipo de participação</FieldLegend>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={form.mode}
                  disabled={structureLocked || !canEdit || save.isPending}
                  className="flex-wrap justify-start"
                  aria-label="Tipo de participação"
                  onValueChange={(value) => {
                    if (!value) return;
                    setForm((current) => ({
                      ...current,
                      mode: value as PollInput["mode"],
                      allowMessage: value !== "vote",
                      options:
                        value !== "message" && current.options.length < 2
                          ? ["", ""]
                          : current.options,
                    }));
                    setError("");
                  }}
                >
                  <ToggleGroupItem value="vote">Somente voto</ToggleGroupItem>
                  <ToggleGroupItem value="message">
                    Somente mensagem
                  </ToggleGroupItem>
                  <ToggleGroupItem value="mixed">
                    Voto e mensagem
                  </ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  Mensagens são privadas e não precisam de aprovação.
                </FieldDescription>
              </FieldSet>
              {form.mode !== "message" && (
                <FieldSet disabled={structureLocked}>
                  <FieldLegend>Alternativas</FieldLegend>
                  <FieldGroup>
                    <Button
                      type="button"
                      variant="outline"
                      className="self-start"
                      onClick={() => set("options", ["Sim", "Não"])}
                    >
                      Usar Sim / Não
                    </Button>
                    {form.options.map((option, index) => (
                      <Field key={index}>
                        <FieldLabel htmlFor={`option-${index}`}>
                          Alternativa {index + 1}
                        </FieldLabel>
                        <InputGroup>
                          <InputGroupAddon>
                            <InputGroupText>{index + 1}.</InputGroupText>
                          </InputGroupAddon>
                          <InputGroupInput
                            id={`option-${index}`}
                            required
                            maxLength={300}
                            value={option}
                            placeholder={`Digite a opção ${index + 1}`}
                            onChange={(event) =>
                              set(
                                "options",
                                form.options.map((text, at) =>
                                  at === index ? event.target.value : text,
                                ),
                              )
                            }
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton
                              size="icon-sm"
                              disabled={form.options.length <= 2}
                              aria-label={`Remover alternativa ${index + 1}`}
                              onClick={() =>
                                set(
                                  "options",
                                  form.options.filter((_, at) => at !== index),
                                )
                              }
                            >
                              <X data-icon="inline-start" />
                            </InputGroupButton>
                          </InputGroupAddon>
                        </InputGroup>
                      </Field>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      className="self-start"
                      disabled={form.options.length >= 10}
                      onClick={() => set("options", [...form.options, ""])}
                    >
                      <Plus data-icon="inline-start" /> Adicionar alternativa
                    </Button>
                  </FieldGroup>
                </FieldSet>
              )}
              <Field>
                <FieldLabel htmlFor="poll-identification">
                  Identificação
                </FieldLabel>
                <Select
                  id="poll-identification"
                  disabled={structureLocked}
                  value={form.identificationPolicy}
                  onChange={(event) =>
                    set(
                      "identificationPolicy",
                      event.target.value as PollInput["identificationPolicy"],
                    )
                  }
                >
                  <option value="anonymous">Anônima</option>
                  <option value="optional">Opcional</option>
                  <option value="required">Obrigatória</option>
                </Select>
              </Field>
              {structureLocked && (
                <FieldDescription>
                  A enquete já recebeu votos. Pergunta, identificação, mensagem
                  e alternativas estão bloqueadas.
                </FieldDescription>
              )}
              <FieldGroup className="sm:flex-row">
                {(["startsAt", "endsAt"] as const).map((key, index) => (
                  <Field key={key} data-invalid={!!error}>
                    <FieldLabel htmlFor={key}>
                      {index === 0
                        ? "Abertura da enquete"
                        : "Término da enquete"}
                    </FieldLabel>
                    <Input
                      id={key}
                      type="datetime-local"
                      required
                      value={form[key]}
                      aria-invalid={!!error}
                      onChange={(event) => set(key, event.target.value)}
                    />
                  </Field>
                ))}
              </FieldGroup>
            </FieldGroup>
          </FieldSet>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Revise os campos</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {save.isError && <PollError error={save.error} />}
          {canEdit && (
            <Button
              type="submit"
              disabled={
                save.isPending ||
                programSelectionUnavailable ||
                (!!initial && initial.version !== saved.version)
              }
              className="self-start"
            >
              {save.isPending
                ? "Salvando…"
                : initial
                  ? "Salvar alterações"
                  : "Salvar rascunho"}
            </Button>
          )}
        </FieldGroup>
      </form>
      {initial &&
        (hasPermission(user, "poll.results.read") ||
          hasPermission(user, "participation.read")) && (
          <Button variant="outline" asChild className="self-start">
            <Link to={`/enquetes/${initial.id}/resultados`}>
              Resultados e mensagens
            </Link>
          </Button>
        )}
    </>
  );
}
