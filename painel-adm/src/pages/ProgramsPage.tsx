import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Clock3, Image as ImageIcon, Radio, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { ProgramEditorForm as ProgramForm } from '@/components/programming/ProgramEditorForm';
import { ProgrammingPublicationPanel } from '@/components/programming/ProgrammingPublicationPanel';
import { ProgrammingOverridesPanel } from '@/components/programming/ProgrammingOverridesPanel';
import { ProgrammingWeek } from '@/components/programming/ProgrammingWeek';
import { AppShell, PageHeader } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { api } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/services/permissions';
import { usePageTitle } from '@/hooks/usePageTitle';
import type { RadioProgram, ProgramSlot } from '@/types/programming';

const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const minutes = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
};
const panel = 'min-w-0 rounded-xl border border-genesis-border bg-genesis-surface p-4 shadow-sm sm:p-5';

export function ProgramsPage() {
  usePageTitle('Programas e grade');
  const { user } = useAuth();
  const qc = useQueryClient();
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [editingSlot, setEditingSlot] = useState<ProgramSlot | null>(null);
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<RadioProgram | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState('05:00');
  const [end, setEnd] = useState('09:30');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [host, setHost] = useState('');
  const [hostFrom, setHostFrom] = useState('');
  const [hostUntil, setHostUntil] = useState('');
  const [at, setAt] = useState('');
  const [simulation, setSimulation] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();

  const programs = useQuery({ queryKey: ['programs', cursor], queryFn: () => api.listPrograms(cursor), refetchOnWindowFocus: false });
  const detail = useQuery({ queryKey: ['program-detail', selected], queryFn: () => api.getProgram(selected), enabled: !!selected, refetchOnWindowFocus: false });
  const canManage = hasPermission(user, 'program.manage');
  const canSchedule = hasPermission(user, 'schedule.manage');
  const canHosts = hasPermission(user, 'program.host.manage');
  const canPublish = hasPermission(user, 'programming.publish');
  const candidates = useQuery({ queryKey: ['program-host-candidates', selected], queryFn: () => api.eligibleProgramHosts(selected), enabled: !!selected && canHosts, refetchOnWindowFocus: false });

  async function perform(task: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await task();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['programs'] }),
        qc.invalidateQueries({ queryKey: ['program-detail'] }),
        qc.invalidateQueries({ queryKey: ['programming-week'] }),
        qc.invalidateQueries({ queryKey: ['programming-publication'] }),
      ]);
      toast.success(message);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addSlot(event: FormEvent) {
    event.preventDefault();
    const saved = await perform(
      () => editingSlot
        ? api.saveProgramSlot(selected, { weekday, startMinute: minutes(start), endMinute: minutes(end), validFrom: from, validUntil: until || null, active: editingSlot.active, version: editingSlot.version }, editingSlot.id)
        : api.saveProgramSlotsBatch(selected, weekdays, { weekday, startMinute: minutes(start), endMinute: minutes(end), validFrom: from, validUntil: until || null, active: true }),
      'Horário salvo. Publique a grade para atualizar o institucional.',
    );
    if (saved) setEditingSlot(null);
  }

  async function addHost(event: FormEvent) {
    event.preventDefault();
    const saved = await perform(
      () => api.saveProgramHost(selected, host, { active: true, validFrom: new Date(hostFrom).toISOString(), validUntil: hostUntil ? new Date(hostUntil).toISOString() : null }),
      'Vínculo salvo.',
    );
    if (saved) setHost('');
  }

  const programItems = programs.data?.items ?? [];
  const currentProgram = detail.data?.program;

  return (
    <AppShell>
      <div className="space-y-6 pb-10 sm:space-y-8">
        <PageHeader
          eyebrow="Programação · Fase 2 local"
          title="Programas e grade"
          description="Organize os programas, os horários e os locutores. Salve as alterações e publique a grade para atualizar o institucional."
          actions={(
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <Button variant="outline" onClick={() => { void programs.refetch(); if (selected) void detail.refetch(); }}>Atualizar</Button>
              {canManage && <Button onClick={() => setEditing(null)}>Novo programa</Button>}
            </div>
          )}
        />

        <ProgrammingPublicationPanel enabled={canPublish} />

        <ProgrammingWeek
          enabled={canSchedule}
          onSelect={(id) => {
            setSelected(id);
            setEditingSlot(null);
          }}
        />

        <section aria-labelledby="programs-catalog-title" className={panel}>
          <div className="mb-4 flex flex-col gap-1 border-b border-genesis-border pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-genesis-primary">
                <Radio aria-hidden="true" className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-[0.16em]">Catálogo</p>
              </div>
              <h2 id="programs-catalog-title" className="mt-1 font-display text-xl font-bold text-genesis-text">Programas cadastrados</h2>
              <p className="mt-1 text-sm text-genesis-muted">Selecione um programa para ver e editar sua operação.</p>
            </div>
            {programs.data?.nextCursor && (
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => setCursor(programs.data!.nextCursor!)}>Mais programas</Button>
            )}
          </div>

          {programs.isPending && <p role="status" className="py-5 text-sm text-genesis-muted">Carregando programas…</p>}
          {programs.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{programs.error.message}</p>}
          {!programs.isPending && !programs.isError && programItems.length === 0 && (
            <div className="rounded-lg border border-dashed border-genesis-border px-4 py-8 text-center">
              <Radio aria-hidden="true" className="mx-auto h-7 w-7 text-genesis-muted" />
              <p className="mt-3 font-semibold">Nenhum programa disponível para seu acesso.</p>
              {canManage && <p className="mt-1 text-sm text-genesis-muted">Use “Novo programa” para cadastrar o primeiro.</p>}
            </div>
          )}
          {programItems.length > 0 && (
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {programItems.map((program) => {
                const isSelected = selected === program.id;
                return (
                  <button
                    key={program.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => { setSelected(program.id); setEditingSlot(null); }}
                    className={`group flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-genesis-primary focus-visible:ring-offset-2 sm:p-4 ${isSelected ? 'border-genesis-primary bg-accent/70 shadow-sm' : 'border-genesis-border bg-genesis-surface hover:border-genesis-primary/50 hover:bg-genesis-bg'}`}
                  >
                    {program.imageUrl
                      ? <img src={program.imageUrl} alt="" className="h-16 w-24 shrink-0 rounded-md bg-muted object-cover sm:h-[4.5rem] sm:w-28" />
                      : <span className="grid h-16 w-24 shrink-0 place-items-center rounded-md bg-muted text-genesis-muted sm:h-[4.5rem] sm:w-28"><ImageIcon aria-hidden="true" className="h-5 w-5" /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display font-bold text-genesis-text">{program.name}</span>
                      <span className="mt-1 block truncate text-xs text-genesis-muted">/{program.slug}</span>
                      <span className={`mt-2 inline-flex items-center gap-1.5 text-xs font-semibold ${program.active ? 'text-emerald-700' : 'text-genesis-muted'}`}>
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${program.active ? 'bg-emerald-600' : 'bg-neutral-400'}`} />
                        {program.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </span>
                    {isSelected && <span className="sr-only">Selecionado</span>}
                  </button>
                );
              })}
            </div>
          )}
          {cursor && <Button variant="outline" className="mt-4 w-full sm:w-auto" onClick={() => setCursor(undefined)}>Voltar ao início</Button>}
        </section>

        {!selected && !programs.isPending && programItems.length > 0 && (
          <div className="rounded-xl border border-dashed border-genesis-border bg-genesis-surface/70 px-4 py-8 text-center sm:py-10">
            <CalendarDays aria-hidden="true" className="mx-auto h-7 w-7 text-genesis-muted" />
            <h2 className="mt-3 font-display text-lg font-bold">Escolha um programa</h2>
            <p className="mt-1 text-sm text-genesis-muted">Os detalhes da grade e dos locutores aparecerão aqui.</p>
          </div>
        )}

        {selected && detail.isPending && <p role="status" className="py-4 text-sm text-genesis-muted">Carregando detalhes do programa…</p>}
        {selected && detail.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{detail.error.message}</p>}

        {currentProgram && detail.data && (
          <section aria-labelledby="program-detail-title" className="space-y-4 sm:space-y-5">
            <article className={`${panel} overflow-hidden`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                {currentProgram.imageUrl
                  ? <img src={currentProgram.imageUrl} alt={`Imagem do programa ${currentProgram.name}`} className="aspect-video w-full rounded-lg bg-muted object-cover sm:aspect-video sm:w-56 sm:shrink-0" />
                  : <div className="grid aspect-video w-full place-items-center rounded-lg bg-muted text-genesis-muted sm:w-56 sm:shrink-0"><ImageIcon aria-hidden="true" className="h-8 w-8" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${currentProgram.active ? 'bg-emerald-50 text-emerald-800' : 'bg-muted text-genesis-text'}`}>{currentProgram.active ? 'Ativo' : 'Inativo'}</span>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-genesis-muted">/{currentProgram.slug}</span>
                  </div>
                  <h2 id="program-detail-title" className="mt-3 break-words font-display text-2xl font-bold tracking-tight text-genesis-text sm:text-3xl">{currentProgram.name}</h2>
                  <p className="mt-2 text-sm leading-6 text-genesis-muted">{currentProgram.description || 'Este programa ainda não tem uma descrição.'}</p>
                  {(currentProgram.presenters ?? []).length > 0 && (
                    <p className="mt-3 flex items-start gap-2 text-sm font-medium text-genesis-text">
                      <UsersRound aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-genesis-primary" />
                      <span>{(currentProgram.presenters ?? []).join(' · ')}</span>
                    </p>
                  )}
                  {canManage && <Button variant="outline" className="mt-4 w-full sm:w-auto" onClick={() => setEditing(currentProgram)}>Editar programa</Button>}
                </div>
              </div>
            </article>

            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <section className={`${panel} space-y-4`} aria-labelledby="program-week-title">
                <div className="flex items-start gap-3 border-b border-genesis-border pb-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent text-genesis-primary"><Clock3 aria-hidden="true" className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <h3 id="program-week-title" className="font-display text-lg font-bold">Grade semanal</h3>
                    <p className="mt-1 text-sm leading-5 text-genesis-muted">Horário de Brasília. Fim antes do início indica programação que atravessa a madrugada.</p>
                  </div>
                </div>

                {detail.data.slots.length === 0 && <p className="rounded-lg bg-genesis-bg p-4 text-sm text-genesis-muted">Nenhum horário cadastrado para este programa.</p>}
                <div className="space-y-2">
                  {detail.data.slots.map((slot) => (
                    <article key={slot.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-genesis-border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                      <div className="min-w-0">
                        <p className="font-semibold text-genesis-text">{days[slot.weekday]} <span className="mx-1 text-genesis-muted">·</span> {hhmm(slot.startMinute)}–{hhmm(slot.endMinute)}</p>
                        <p className="mt-1 break-words text-xs leading-5 text-genesis-muted">Vigência: {slot.validFrom} até {slot.validUntil || 'sem término'}</p>
                        <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${slot.active ? 'bg-emerald-50 text-emerald-800' : 'bg-muted text-genesis-muted'}`}>{slot.active ? 'Ativo' : 'Inativo'}</span>
                      </div>
                      {canSchedule && (
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                          <Button variant="outline" className="min-h-10" disabled={busy} onClick={() => { setEditingSlot(slot); setWeekday(slot.weekday); setStart(hhmm(slot.startMinute)); setEnd(hhmm(slot.endMinute)); setFrom(slot.validFrom); setUntil(slot.validUntil ?? ''); }}>Editar</Button>
                          <Button variant="outline" className="min-h-10" disabled={busy} onClick={() => void perform(() => api.saveProgramSlot(selected, { weekday: slot.weekday, startMinute: slot.startMinute, endMinute: slot.endMinute, validFrom: slot.validFrom, validUntil: slot.validUntil, active: !slot.active, version: slot.version }, slot.id), 'Horário atualizado.')}>{slot.active ? 'Desativar' : 'Ativar'}</Button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>

                {canSchedule && (
                  <div className="rounded-lg bg-genesis-bg p-3 sm:p-4">
                    <h4 className="font-semibold">{editingSlot ? 'Editar horário' : 'Adicionar horários'}</h4>
                    <p className="mt-1 text-xs leading-5 text-genesis-muted">{editingSlot ? 'Ajuste este dia e período.' : 'Selecione um ou mais dias para repetir o mesmo período.'}</p>
                    {!editingSlot && (
                      <fieldset className="mt-4">
                        <legend className="mb-2 text-sm font-medium">Dias da recorrência</legend>
                        <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-4">
                          {days.map((label, index) => (
                            <label key={label} className="flex min-h-10 items-center gap-2 rounded-md border border-genesis-border bg-genesis-surface px-3 text-sm">
                              <input className="accent-genesis-primary" type="checkbox" checked={weekdays.includes(index)} onChange={(event) => setWeekdays((current) => event.target.checked ? [...current, index].sort((a, b) => a - b) : current.filter((day) => day !== index))} />
                              {label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                    <form onSubmit={addSlot} className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                      {editingSlot && <Field label="Dia" htmlFor="slot-day"><Select id="slot-day" value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{days.map((day, index) => <option key={day} value={index}>{day}</option>)}</Select></Field>}
                      <Field label="Início" htmlFor="slot-start"><Input id="slot-start" type="time" required value={start} onChange={(event) => setStart(event.target.value)} /></Field>
                      <Field label="Fim" htmlFor="slot-end"><Input id="slot-end" type="time" required value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
                      <Field label="Vigência inicial" htmlFor="slot-from"><Input id="slot-from" type="date" required value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
                      <Field label="Vigência final (opcional)" htmlFor="slot-until"><Input id="slot-until" type="date" min={from} value={until} onChange={(event) => setUntil(event.target.value)} /></Field>
                      <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
                        <Button className="w-full sm:w-auto" disabled={busy || (!editingSlot && weekdays.length === 0)} type="submit">{editingSlot ? 'Salvar horário' : 'Adicionar horários'}</Button>
                        {editingSlot && <Button className="w-full sm:w-auto" variant="outline" type="button" onClick={() => setEditingSlot(null)}>Cancelar edição</Button>}
                      </div>
                    </form>
                  </div>
                )}

                {canSchedule && (
                  <div className="border-t border-genesis-border pt-4">
                    <h4 className="font-semibold">Pré-visualizar o “No Ar”</h4>
                    <p className="mt-1 text-sm text-genesis-muted">Teste a grade sem alterar o que está publicado.</p>
                    <form className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={async (event) => {
                      event.preventDefault();
                      try {
                        const result = await api.simulateProgramming(new Date(at).toISOString());
                        setSimulation(result.current ? `Programa: ${result.current.name} · ${result.timezone}` : 'Nenhum programa no ar nesse instante.');
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : 'Falha na simulação.');
                      }
                    }}>
                      <Input aria-label="Instante da simulação (horário local do dispositivo)" type="datetime-local" required value={at} onChange={(event) => setAt(event.target.value)} />
                      <Button type="submit" className="w-full sm:w-auto">Simular</Button>
                    </form>
                    {simulation && <p role="status" className="mt-3 rounded-md bg-genesis-surface p-3 text-sm font-medium">{simulation}</p>}
                  </div>
                )}
              </section>

              <section className={`${panel} space-y-4`} aria-labelledby="program-hosts-title">
                <div className="flex items-start gap-3 border-b border-genesis-border pb-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent text-genesis-primary"><UsersRound aria-hidden="true" className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <h3 id="program-hosts-title" className="font-display text-lg font-bold">Locutores vinculados</h3>
                    <p className="mt-1 text-sm leading-5 text-genesis-muted">Vínculos dão acesso operacional conforme as permissões; não alteram o papel da conta.</p>
                  </div>
                </div>
                {detail.data.hosts.length === 0
                  ? <p className="rounded-lg bg-genesis-bg p-4 text-sm text-genesis-muted">Nenhum locutor vinculado a este programa.</p>
                  : <ul className="space-y-2">{detail.data.hosts.map((hostItem) => (
                    <li key={hostItem.adminUserId} className="flex min-w-0 flex-col gap-3 rounded-lg border border-genesis-border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-genesis-primary">{hostItem.name.slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0"><span className="block truncate font-semibold">{hostItem.name}</span><span className="mt-1 block text-xs text-genesis-muted">{hostItem.active ? 'Vínculo ativo' : 'Vínculo inativo'}</span></span>
                      </div>
                      {canHosts && hostItem.active && <Button variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={() => void perform(() => api.saveProgramHost(selected, hostItem.adminUserId, { active: false, validFrom: hostItem.validFrom, validUntil: hostItem.validUntil }), 'Vínculo desativado.')}>Desvincular</Button>}
                    </li>
                  ))}</ul>}

                {canHosts && (
                  <div className="rounded-lg bg-genesis-bg p-3 sm:p-4">
                    <h4 className="font-semibold">Vincular locutor</h4>
                    <p className="mt-1 text-xs leading-5 text-genesis-muted">Escolha uma conta interna e defina o período em que ela poderá operar este programa.</p>
                    <form onSubmit={addHost} className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2"><Field label="Usuário ativo" htmlFor="program-host"><Select id="program-host" required value={host} onChange={(event) => setHost(event.target.value)}><option value="">Selecione um usuário</option>{candidates.data?.items.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</Select></Field></div>
                      <Field label="Início do vínculo" htmlFor="host-from"><Input id="host-from" type="datetime-local" required value={hostFrom} onChange={(event) => setHostFrom(event.target.value)} /></Field>
                      <Field label="Fim do vínculo (opcional)" htmlFor="host-until"><Input id="host-until" type="datetime-local" value={hostUntil} onChange={(event) => setHostUntil(event.target.value)} /></Field>
                      <p className="text-xs leading-5 text-genesis-muted sm:col-span-2">Horário local deste dispositivo, convertido para UTC.</p>
                      <div className="sm:col-span-2"><Button className="w-full sm:w-auto" disabled={busy || !host} type="submit">Salvar vínculo</Button></div>
                      {candidates.isError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{candidates.error.message}</p>}
                    </form>
                  </div>
                )}
              </section>
            </div>
          </section>
        )}

        <ProgrammingOverridesPanel enabled={canSchedule} programs={programItems} />

        <Dialog
          open={editing !== undefined}
          onOpenChange={(open) => { if (!open) setEditing(undefined); }}
          title={editing ? 'Editar programa' : 'Novo programa'}
          description="Cadastre a apresentação pública do programa. Salvar não publica automaticamente no institucional."
          className="sm:max-w-3xl"
        >
          {editing !== undefined && <ProgramForm key={editing?.id ?? 'new'} initial={editing} busy={busy} save={async (input) => {
            if (await perform(() => api.saveProgram(input, editing?.id), 'Programa salvo.')) setEditing(undefined);
          }} />}
        </Dialog>
      </div>
    </AppShell>
  );
}
