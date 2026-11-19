import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { api } from '@/services/api';

export function ProgrammingPublicationPanel({ enabled }: { enabled: boolean }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: ['programming-publication'], queryFn: api.programmingPublication, enabled, refetchOnWindowFocus: false });
  if (!enabled) return null;

  const publication = status.data?.publication;
  const stateLabel = publication
    ? publication.status === 'published' ? 'Publicada' : publication.status === 'failed' ? 'Falha na publicação' : 'Alterações pendentes'
    : 'Ainda não há configuração publicada.';

  async function publish(retry = false) {
    setBusy(true);
    try {
      const result = await api.publishProgramming(retry);
      await client.invalidateQueries({ queryKey: ['programming-publication'] });
      if (result.status === 'published') toast.success('Grade publicada. O institucional atualiza em até 120 segundos.');
      else if (result.status === 'failed') toast.error('Falha no R2. A última versão publicada foi preservada. Tente novamente.');
      else toast.info('Publicação pendente. Atualize o estado e tente novamente.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível publicar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="program-publication-title" className="rounded-xl border border-genesis-primary/20 bg-accent/80 p-4 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-genesis-surface text-genesis-primary shadow-sm"><Globe2 aria-hidden="true" className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 id="program-publication-title" className="font-display text-lg font-bold">Publicação no institucional</h2>
            <p className="mt-1 text-sm font-medium text-genesis-text">{publication ? `Revisão ${publication.revision} · ${stateLabel}` : stateLabel}</p>
            <p className="mt-1 text-xs leading-5 text-genesis-muted">Somente nomes públicos, imagens e grade. Dados de usuários e ouvintes não são publicados.</p>
            {status.isError && <p role="alert" className="mt-2 text-sm text-red-800">{status.error.message}</p>}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:shrink-0">
          <Button className="w-full" variant="outline" disabled={busy} onClick={() => void status.refetch()}><RefreshCw aria-hidden="true" className="h-4 w-4" />Atualizar estado</Button>
          {publication && publication.status !== 'published' && <Button className="w-full" variant="outline" disabled={busy} onClick={() => void publish(true)}>Tentar novamente</Button>}
          <Button className="w-full sm:col-span-2 xl:col-span-1" disabled={busy || status.data?.enabled === false} onClick={() => void publish()}>{busy ? 'Publicando…' : 'Publicar grade'}</Button>
        </div>
      </div>
    </section>
  );
}
