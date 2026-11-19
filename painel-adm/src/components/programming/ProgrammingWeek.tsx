import { CalendarDays, Clock3 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export function ProgrammingWeek({ enabled, onSelect }: { enabled: boolean; onSelect: (id: string) => void }) {
  const query = useQuery({ queryKey: ['programming-week'], queryFn: api.programmingWeek, enabled, refetchOnWindowFocus: false });
  if (!enabled) return null;

  return (
    <section aria-labelledby="weekly-overview-title" className="rounded-xl border border-genesis-border bg-genesis-surface p-4 shadow-sm sm:p-5">
      <div className="mb-5 flex items-start gap-3 border-b border-genesis-border pb-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent text-genesis-primary"><CalendarDays aria-hidden="true" className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 id="weekly-overview-title" className="font-display text-lg font-bold sm:text-xl">Visão semanal da grade</h2>
          <p className="mt-1 text-sm leading-5 text-genesis-muted">Horários de Brasília. Selecione um programa para abrir sua configuração.</p>
        </div>
      </div>

      {query.isPending && <p role="status" className="py-4 text-sm text-genesis-muted">Carregando a grade…</p>}
      {query.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{query.error.message}</p>}
      {!query.isPending && !query.isError && (query.data?.items.length ?? 0) === 0 && (
        <div className="rounded-lg border border-dashed border-genesis-border px-4 py-7 text-center">
          <Clock3 aria-hidden="true" className="mx-auto h-6 w-6 text-genesis-muted" />
          <p className="mt-2 font-semibold">A semana ainda não tem horários.</p>
          <p className="mt-1 text-sm text-genesis-muted">Selecione um programa e adicione os dias e períodos de exibição.</p>
        </div>
      )}

      {(query.data?.items.length ?? 0) > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
          {days.map((day, index) => {
            const slots = (query.data?.items ?? [])
              .filter((slot) => slot.weekday === index)
              .sort((a, b) => a.startMinute - b.startMinute || a.programName.localeCompare(b.programName));
            return (
              <section key={day} aria-label={day} className="min-w-0 overflow-hidden rounded-lg border border-genesis-border bg-genesis-bg/60">
                <h3 className="flex min-h-10 items-center justify-between gap-2 border-b border-genesis-border bg-genesis-surface px-3 py-2 text-sm font-bold">
                  <span>{day}</span><span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-genesis-muted">{slots.length}</span>
                </h3>
                <div className="max-h-[28rem] space-y-2 overflow-y-auto p-2">
                  {slots.length === 0 && <p className="px-2 py-3 text-xs text-genesis-muted">Sem horários</p>}
                  {slots.map((slot) => (
                    <button
                      key={slot.id}
                      type="button"
                      aria-label={`Abrir ${slot.programName}, ${day}, ${time(slot.startMinute)} às ${time(slot.endMinute)}`}
                      onClick={() => onSelect(slot.programId)}
                      className={`block min-h-24 w-full min-w-0 rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-genesis-primary focus-visible:ring-offset-1 ${slot.active ? 'border-indigo-100 bg-accent/80 hover:border-genesis-primary/40 hover:bg-accent' : 'border-genesis-border bg-muted text-genesis-muted hover:border-neutral-300'}`}
                    >
                      <span className="block truncate text-xs font-bold tabular-nums text-genesis-primary">{time(slot.startMinute)}–{time(slot.endMinute)}</span>
                      <span className="mt-1 block break-words text-sm font-semibold leading-5 text-genesis-text [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{slot.programName}</span>
                      <span className="mt-2 block break-words text-[11px] leading-4 text-genesis-muted">{slot.validFrom}{slot.validUntil ? ` até ${slot.validUntil}` : ' · sem término'}{!slot.active ? ' · inativo' : ''}</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
