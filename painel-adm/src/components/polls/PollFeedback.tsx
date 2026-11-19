import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/shadcn/alert";
import { Skeleton } from "@/components/ui/shadcn/skeleton";
export function PollNotice() {
  return (
    <Alert>
      <AlertTitle>Operação administrativa local</AlertTitle>
      <AlertDescription>
        Salvar e mudar o estado não publicam o snapshot. Use a ação explícita
        Publicar no institucional para atualizar a versão pública. Mensagens
        permanecem privadas, sem edição ou aprovação.
      </AlertDescription>
    </Alert>
  );
}
export function PollError({ error }: { error: Error }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Não foi possível concluir</AlertTitle>
      <AlertDescription>
        {error.message} Atualize os dados e tente novamente. Em caso de conflito
        de versão, reabra a enquete antes de salvar.
      </AlertDescription>
    </Alert>
  );
}
export function PollLoading() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span>Carregando enquetes…</span>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
