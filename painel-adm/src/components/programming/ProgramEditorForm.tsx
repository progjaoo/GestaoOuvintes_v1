import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import type { RadioProgram } from '@/types/programming';

export type ProgramEditorInput = Omit<RadioProgram, 'id' | 'version' | 'imageUrl'> & { version?: number };

export function ProgramEditorForm({ initial, busy, save }: { initial: RadioProgram | null; busy: boolean; save: (input: ProgramEditorInput) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [presenters, setPresenters] = useState((initial?.presenters ?? []).join(', '));
  const [imageAssetId, setImageAssetId] = useState(initial?.imageAssetId ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const previewRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function selectImage(selected?: File) {
    if (!selected || busy || uploading) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(selected.type)) {
      toast.error('Escolha uma imagem JPEG, PNG, WebP ou AVIF.');
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      toast.error('A imagem deve ter até 10 MiB.');
      return;
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(selected);
    setPreview(previewRef.current);
    setFile(selected);
  }

  function openImagePicker() {
    const input = fileInputRef.current;
    if (!input) return;
    // Keep the native picker synchronous with the user's gesture (Safari/Chromium).
    try {
      if (typeof input.showPicker === 'function') input.showPicker();
      else input.click();
    } catch {
      toast.error('O navegador bloqueou o seletor. Arraste a imagem do Finder para a área de envio.');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setUploading(true);
    try {
      let asset = imageAssetId;
      if (file) {
        const uploaded = await api.uploadProgramImage(file);
        asset = uploaded.id;
        setImageAssetId(asset);
        setFile(null);
        setPreview(uploaded.imageUrl);
      }
      await save({
        name,
        slug,
        description,
        active,
        presenters: presenters.split(',').map((value) => value.trim()).filter(Boolean),
        imageAssetId: asset,
        ...(initial ? { version: initial.version } : {}),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao enviar imagem.');
    } finally {
      setUploading(false);
    }
  }

  const image = preview ?? (imageAssetId === initial?.imageAssetId ? initial?.imageUrl : null);

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
        <Field label="Nome do programa" htmlFor="program-name"><Input id="program-name" required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Slug" htmlFor="program-slug" hint="Endereço curto e único do programa."><Input id="program-slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={120} value={slug} onChange={(event) => setSlug(event.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Descrição curta" htmlFor="program-description"><Input id="program-description" maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></Field></div>
        <div className="sm:col-span-2"><Field label="Locutores/apresentadores (nomes públicos)" htmlFor="program-presenters" hint="Separe os nomes por vírgula. Eles aparecem no site, mas não concedem acesso ao painel."><Input id="program-presenters" placeholder="Ex.: Apresentador 1, Apresentadora 2" value={presenters} onChange={(event) => setPresenters(event.target.value)} /></Field></div>
      </div>

      <section className="grid min-w-0 gap-4 rounded-lg border border-genesis-border bg-genesis-bg/60 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,0.85fr)] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold"><ImagePlus aria-hidden="true" className="h-4 w-4 text-genesis-primary" />Imagem do programa</div>
          <p className="mt-1 text-xs leading-5 text-genesis-muted">Recomendado 1920 × 1080 px (16:9). JPEG, PNG, WebP ou AVIF; até 10 MiB. A imagem é pública e enviada ao R2 do ambiente atual.</p>
          <div className="mt-3 rounded-md border border-dashed border-genesis-border p-3" role="group" aria-label="Selecionar ou arrastar imagem do programa"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); selectImage(event.dataTransfer.files[0]); }}>
            <Button type="button" variant="outline" disabled={busy || uploading} onClick={openImagePicker}>
              <ImagePlus aria-hidden="true" className="h-4 w-4" />Escolher imagem
            </Button>
            <p className="mt-2 break-all text-xs text-genesis-muted" role="status">{file ? file.name : 'Ou arraste uma imagem do Finder para esta área.'}</p>
            <Input ref={fileInputRef} className="sr-only" tabIndex={-1} id="program-image" aria-label="Imagem do programa" type="file" accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={(event) => { selectImage(event.target.files?.[0]); event.target.value = ''; }} />
          </div>
          {(image || imageAssetId || file) && <Button className="mt-3 w-full sm:w-auto" type="button" variant="outline" onClick={() => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); setFile(null); setImageAssetId(null); setPreview(null); previewRef.current = null; }}><Trash2 aria-hidden="true" className="h-4 w-4" />Remover imagem do programa</Button>}
        </div>
        <div className="min-w-0 overflow-hidden rounded-md border border-genesis-border bg-genesis-surface">
          {image
            ? <img src={image} alt="Prévia da imagem do programa" className="aspect-video w-full object-contain" />
            : <div className="grid aspect-video place-items-center text-center text-sm text-genesis-muted"><span><ImagePlus aria-hidden="true" className="mx-auto mb-2 h-6 w-6" />Prévia da imagem</span></div>}
        </div>
      </section>

      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-genesis-border px-3 py-2 text-sm font-medium">
        <input className="h-4 w-4 accent-genesis-primary" type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        Programa ativo
      </label>
      <div className="flex flex-col gap-3 border-t border-genesis-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-genesis-muted">Salvar cria uma revisão pendente. Use “Publicar grade” para atualizar o institucional.</p>
        <Button className="w-full shrink-0 sm:w-auto" type="submit" disabled={busy || uploading}>{uploading ? 'Enviando e salvando…' : 'Salvar programa'}</Button>
      </div>
    </form>
  );
}
