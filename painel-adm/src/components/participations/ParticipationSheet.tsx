import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "@/services/api";
import { Button } from "@/components/ui/shadcn/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/shadcn/sheet";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@/components/ui/shadcn/alert";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/shadcn/field";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/shadcn/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/shadcn/alert-dialog";
import type {
  ModerationState,
  ProgramParticipation,
} from "@/types/participations";
import { formatInstant } from "@/components/polls/poll-utils";
import {
  clearParticipationCache,
  isParticipationAccessError,
  participationStates,
} from "./participation-utils";
interface Props {
  id: string;
  actorId: string;
  canModerate: boolean;
  onClose: () => void;
  restoreFocus: () => void;
  onAccessError: () => void;
}
export function ParticipationSheet({
  id,
  actorId,
  canModerate,
  onClose,
  restoreFocus,
  onAccessError,
}: Props) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["participations", actorId, "detail", id],
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        return await api.getParticipation(id, signal);
      } catch (error) {
        if (!signal.aborted && isParticipationAccessError(error))
          onAccessError();
        throw error;
      }
    },
  });
  useEffect(
    () => () =>
      clearParticipationCache(client, [
        "participations",
        actorId,
        "detail",
        id,
      ]),
    [client, actorId, id],
  );
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="flex w-full flex-col gap-5 overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <SheetHeader>
          <SheetTitle>Participação</SheetTitle>
          <SheetDescription>
            Opinião privada, somente leitura. Moderação administrativa não
            publica nem altera o texto recebido.
          </SheetDescription>
        </SheetHeader>
        {query.isPending ? (
          <div role="status">
            Carregando opinião…
            <Skeleton className="h-24 w-full" />
          </div>
        ) : query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível ler a participação</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Tentar novamente
            </Button>
          </Alert>
        ) : (
          <>
            <dl className="flex flex-col gap-2">
              <div>
                <dt>Nome declarado</dt>
                <dd>{query.data.displayName || "Não informado"}</dd>
              </div>
              <div>
                <dt>Programa</dt>
                <dd>{query.data.programName}</dd>
              </div>
              <div>
                <dt>Pergunta</dt>
                <dd>{query.data.pollQuestion}</dd>
              </div>
              <div>
                <dt>Recebida em</dt>
                <dd>{formatInstant(query.data.receivedAt)}</dd>
              </div>
              <div>
                <dt>Edição</dt>
                <dd>
                  {formatInstant(query.data.editionStartsAt)} até{" "}
                  {formatInstant(query.data.editionEndsAt)}
                </dd>
              </div>
              <div>
                <dt>Estado atual</dt>
                <dd>{participationStates[query.data.state]}</dd>
              </div>
            </dl>
            <section
              aria-label="Opinião somente leitura"
              className="flex flex-col gap-2"
            >
              <h2 className="font-semibold">Opinião (somente leitura)</h2>
              <p className="whitespace-pre-wrap break-words">
                {query.data.message}
              </p>
            </section>
            {query.data.moderationNote && (
              <section aria-label="Nota de moderação anterior">
                <h2 className="font-semibold">Nota interna atual</h2>
                <p className="whitespace-pre-wrap break-words">
                  {query.data.moderationNote}
                </p>
              </section>
            )}
            {query.data.moderatedAt && (
              <p>Moderada em {formatInstant(query.data.moderatedAt)}</p>
            )}
            <p>Versão {query.data.version}</p>
            {canModerate ? (
              <ModerationForm
                participation={query.data}
                actorId={actorId}
                onAccessError={onAccessError}
                reload={async () => {
                  const result = await query.refetch();
                  return result.isSuccess ? result.data : undefined;
                }}
              />
            ) : (
              <p>
                Consulta somente leitura. Moderação requer
                participation.moderate.
              </p>
            )}
          </>
        )}
        <SheetClose asChild>
          <Button variant="outline">Fechar participação</Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
function moderationValues(participation: ProgramParticipation) {
  return {
    version: participation.version,
    note: participation.moderationNote ?? "",
    state: (participation.state === "received"
      ? "reviewed"
      : participation.state) as ModerationState,
  };
}
function ModerationForm({
  participation,
  actorId,
  onAccessError,
  reload,
}: {
  participation: ProgramParticipation;
  actorId: string;
  onAccessError: () => void;
  reload: () => Promise<ProgramParticipation | undefined>;
}) {
  const client = useQueryClient();
  const [baseline, setBaseline] = useState(() =>
    moderationValues(participation),
  );
  const [draft, setDraft] = useState(() => moderationValues(participation));
  const { state, note } = draft;
  const dirty = note !== baseline.note || state !== baseline.state;
  const versionChanged = participation.version !== baseline.version;
  const [confirm, setConfirm] = useState(false);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationKey: ["participations", actorId, "moderation", participation.id],
    gcTime: 0,
    mutationFn: () => {
      controller.current = new AbortController();
      return api.moderateParticipation(
        participation.id,
        {
          version: baseline.version,
          state,
          note: note.trim(),
        },
        controller.current.signal,
      );
    },
    onSuccess: async (updated) => {
      if (!active.current) return;
      setConfirm(false);
      const values = moderationValues(updated);
      setBaseline(values);
      setDraft(values);
      toast.success("Moderação salva. O texto da opinião não foi alterado.");
      // Refetch only after this explicit action; no timer or focus-driven updates.
      await Promise.all([
        client.invalidateQueries({
          queryKey: ["participations", actorId, "list"],
        }),
        reload(),
      ]);
    },
    onError: (error) => {
      if (!active.current) return;
      setConfirm(false);
      if (isParticipationAccessError(error)) onAccessError();
      else toast.error(error.message);
    },
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
      for (const item of client.getMutationCache().findAll({
        mutationKey: [
          "participations",
          actorId,
          "moderation",
          participation.id,
        ],
      }))
        client.getMutationCache().remove(item);
    };
  }, [client, actorId, participation.id]);
  // Incoming data may change while a moderator is drafting. Only clean drafts adopt it automatically.
  if (versionChanged && !dirty && !mutation.isPending) {
    const values = moderationValues(participation);
    setBaseline(values);
    setDraft(values);
  }
  const conflict =
    versionChanged ||
    (mutation.error instanceof ApiError && mutation.error.status === 409);
  async function reloadExplicitly() {
    const updated = await reload();
    if (!active.current || !updated) return;
    const values = moderationValues(updated);
    setBaseline(values);
    setDraft(values);
    setConfirm(false);
    mutation.reset();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (note.length > 500 || mutation.isPending || conflict) return;
    if (state === "reviewed") mutation.mutate();
    else setConfirm(true);
  }
  return (
    <>
      <form onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="participation-state">Novo estado</FieldLabel>
            <Select
              id="participation-state"
              value={state}
              disabled={mutation.isPending || conflict}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  state: event.target.value as ModerationState,
                }))
              }
            >
              <option value="reviewed">Revisada</option>
              <option value="selected">Selecionada</option>
              <option value="rejected">Rejeitada</option>
            </Select>
          </Field>
          <Field data-invalid={note.length > 500}>
            <FieldLabel htmlFor="participation-note">
              Nota interna (opcional)
            </FieldLabel>
            <Textarea
              id="participation-note"
              value={note}
              disabled={mutation.isPending}
              maxLength={500}
              aria-invalid={note.length > 500}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
            />
            <FieldDescription>
              Até 500 caracteres. Privada e sem alterar a opinião.
            </FieldDescription>
          </Field>
          {mutation.isError && (
            <Alert variant="destructive">
              <AlertTitle>Moderação não salva</AlertTitle>
              <AlertDescription>
                {mutation.error.message}
                {conflict &&
                  " Recarregue antes de tentar novamente; a nota não salva será descartada ao atualizar a versão."}
              </AlertDescription>
            </Alert>
          )}
          {versionChanged && (
            <Alert variant="destructive">
              <AlertTitle>Participação atualizada</AlertTitle>
              <AlertDescription>
                Sua nota foi preservada. Recarregar descarta a edição pendente e
                usa a versão atual.
              </AlertDescription>
            </Alert>
          )}
          {conflict && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void reloadExplicitly()}
            >
              Recarregar participação
            </Button>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending || conflict || note.length > 500}
          >
            {mutation.isPending ? "Salvando…" : "Salvar moderação"}
          </Button>
        </FieldGroup>
      </form>
      <AlertDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!mutation.isPending) setConfirm(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar moderação</AlertDialogTitle>
            <AlertDialogDescription>
              Marcar como {participationStates[state].toLocaleLowerCase()}? Isso
              não publica a opinião nem altera o texto recebido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                mutation.mutate();
              }}
            >
              Confirmar moderação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
