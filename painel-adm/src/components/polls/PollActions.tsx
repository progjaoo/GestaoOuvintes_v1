import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";
import { api } from "@/services/api";
import type { Poll, PollAction, PollState } from "@/types/polls";
import { Button } from "@/components/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/components/ui/shadcn/dropdown-menu";
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
import { PollError } from "./PollFeedback";
type ActionKey = PollAction | "publish-public";
type Action = { key: ActionKey; label: string; states: PollState[] };
const actions: { key: PollAction; label: string; states: PollState[] }[] = [
  { key: "publish", label: "Publicar", states: ["draft", "scheduled"] },
  { key: "close", label: "Retirar do ar", states: ["scheduled", "published"] },
  { key: "archive", label: "Arquivar", states: ["closed", "canceled"] },
  {
    key: "cancel",
    label: "Cancelar enquete",
    states: ["draft", "scheduled", "published"],
  },
];
export function PollActions({ poll }: { poll: Poll }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const mutation = useMutation({
    mutationFn: (key: ActionKey) =>
      key === "publish-public"
        ? api.publishPollPublic(poll.id)
        : api.transitionPoll(poll.id, key, poll.version),
    onSuccess: async (_result, key) => {
      setAction(null);
      await client.invalidateQueries({ queryKey: ["polls"] });
      toast.success(
        key === "publish-public"
          ? "Publicação do snapshot solicitada."
          : key === "close" || key === "cancel"
            ? "Enquete retirada do ar. Respostas preservadas; a sincronização não irá reabri-la."
            : "Estado administrativo atualizado.",
      );
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Ações de ${poll.question}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link to={`/enquetes/${poll.id}`}>Abrir enquete</Link>
            </DropdownMenuItem>
            {(hasPermission(user, "poll.results.read") ||
              hasPermission(user, "participation.read")) && (
              <DropdownMenuItem asChild>
                <Link to={`/enquetes/${poll.id}/resultados`}>
                  Resultados e mensagens
                </Link>
              </DropdownMenuItem>
            )}
            {hasPermission(user, "poll.publish") && (
              <DropdownMenuItem
                onSelect={() => {
                  mutation.reset();
                  setAction({
                    key: "publish-public",
                    label: "Publicar no institucional",
                    states: [],
                  });
                }}
              >
                Publicar no institucional
              </DropdownMenuItem>
            )}
            {actions
              .filter(
                (item) =>
                  item.states.includes(poll.state) &&
                  hasPermission(
                    user,
                    item.key === "publish" ? "poll.publish" : "poll.close",
                  ),
              )
              .map((item) => (
                <DropdownMenuItem
                  key={item.key}
                  onSelect={() => {
                    mutation.reset();
                    setAction(item);
                  }}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {action?.label}: {poll.question}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {action?.key === "publish-public"
                ? "Gera e publica o snapshot público desta enquete no ambiente configurado. Mensagens privadas não são incluídas. Confirme a publicação explícita."
                : action?.key === "publish"
                  ? "Esta ação altera o estado administrativo e não publica o snapshot. Use Publicar no institucional para atualizar a versão pública."
                  : action?.key === "close" || action?.key === "cancel"
                    ? "A enquete deixará de aceitar votos e participações no site, inclusive por link direto. Votos, mensagens e cadastros existentes serão preservados. A sincronização do Google Agenda continuará para as próximas enquetes, mas não reabrirá esta enquete. A agenda da Produção não será alterada."
                    : "Confirme a mudança de estado desta enquete. A API validará a versão e a transição."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {mutation.isError && <PollError error={mutation.error} />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (action) mutation.mutate(action.key);
              }}
            >
              {mutation.isPending
                ? "Salvando…"
                : `Confirmar ${action?.label.toLowerCase()}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
