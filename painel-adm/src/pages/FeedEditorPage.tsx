import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, Copy, Eye, ImagePlus, LoaderCircle, Plus, RefreshCw, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { FeedMediaPickerDialog, type FeedMediaType } from "@/components/feed/FeedMediaPickerDialog";
import { FeedMediaGuidance, type FeedMediaUsage } from "@/components/feed/FeedMediaGuidance";
import { RichTextBlockEditor } from "@/components/feed/RichTextBlockEditor";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { usePageTitle } from "@/hooks/usePageTitle";
import { api, ApiError } from "@/services/api";
import type { EditorialBlock, EditorialMediaAsset, EditorialPost, EditorialRevisionInput, EditorialTextBlock } from "@/types/feed";

const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };
const blankRevision = (): EditorialRevisionInput => ({
  title: "", excerpt: "", slug: "", categoryId: "", coverAssetId: "", coverAlt: "", coverFocusX: 50, coverFocusY: 50,
  openingAssetId: "", openingAlt: "", openingFocusX: 50, openingFocusY: 50,
  seoTitle: "", seoDescription: "", eventDate: null, publicCredits: "", blocks: [],
});

export function FeedEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editing = Boolean(id);
  usePageTitle(editing ? "Editar matéria do Feed" : "Nova matéria do Feed");
  const categories = useQuery({ queryKey: ["feed-categories"], queryFn: api.listFeedCategories, refetchOnWindowFocus: false });
  const postQuery = useQuery({ queryKey: ["feed-post", id], queryFn: () => api.getFeedPost(id!), enabled: editing, refetchOnWindowFocus: false });
  const [revision, setRevision] = useState<EditorialRevisionInput>(blankRevision);
  const [expectedVersion, setExpectedVersion] = useState(0);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(editing);
  const [dirty, setDirty] = useState(!editing);
  const [mediaPicker, setMediaPicker] = useState<{ open: boolean; target: string; types: FeedMediaType[] }>({ open: false, target: "", types: ["image"] });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [saved, setSaved] = useState<{ postId: string; revisionId: string; revisionNumber: number } | null>(null);
  const [releaseId, setReleaseId] = useState("");
  const [releaseStatus, setReleaseStatus] = useState("");

  useEffect(() => {
    if (!editing || !id || !postQuery.data || loadedId === id) return;
    const post = postQuery.data;
    const source = post.draftRevision ?? post.publishedRevision;
    if (source) {
      // Hydrate editor state after its asynchronous post query resolves.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRevision({
        title: source.title,
        excerpt: source.excerpt,
        slug: post.slug,
        categoryId: post.category?.id ?? "",
        coverAssetId: source.coverAssetId,
        coverAlt: source.coverAlt,
        coverFocusX: source.coverFocusX ?? 50,
        coverFocusY: source.coverFocusY ?? 50,
        openingAssetId: source.openingAssetId ?? source.coverAssetId,
        openingAlt: source.openingAlt ?? source.coverAlt,
        openingFocusX: source.openingFocusX ?? source.coverFocusX ?? 50,
        openingFocusY: source.openingFocusY ?? source.coverFocusY ?? 50,
        seoTitle: source.seoTitle ?? `${source.title} | Rádio 88 FM`.slice(0, 70),
        seoDescription: source.seoDescription ?? source.excerpt.slice(0, 180),
        eventDate: source.eventDate ?? null,
        publicCredits: source.publicCredits ?? "",
        blocks: source.blocks ?? [],
      });
      setExpectedVersion(source.revisionNumber);
      setSaved({ postId: post.id, revisionId: source.id, revisionNumber: source.revisionNumber });
    }
    setLoadedId(id);
    setDirty(false);
  }, [editing, id, loadedId, postQuery.data]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async () => {
      const checked = validateRevision(effectiveRevision);
      const result = editing && id
        ? await api.updateFeedDraft(id, expectedVersion, checked)
        : await api.createFeedDraft(checked);
      return result;
    },
    onSuccess: async (result) => {
      setSaved({ postId: result.id, revisionId: result.revisionId, revisionNumber: result.revisionNumber });
      setExpectedVersion(result.revisionNumber);
      setDirty(false);
      toast.success("Rascunho salvo no banco editorial.");
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["feed-posts"] }), queryClient.invalidateQueries({ queryKey: ["feed-post", result.id] })]);
      if (!editing) navigate(`/conteudo/feed/${result.id}/editar`, { replace: true });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : error.message || "Não foi possível salvar o rascunho."),
  });
  const publish = useMutation({
    mutationFn: () => {
      if (!saved) throw new Error("Salve o rascunho antes de solicitar a publicação.");
      return api.publishFeedPost(saved.postId, saved.revisionId);
    },
    onSuccess: (result) => {
      setReleaseId(result.releaseId);
      setReleaseStatus(result.status);
      toast.success("Release criada. O conteúdo ainda não está publicado até o site confirmar o deploy.");
      void queryClient.invalidateQueries({ queryKey: ["feed-posts"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : error.message || "Não foi possível iniciar a publicação."),
  });
  const checkRelease = useMutation({
    mutationFn: () => api.checkFeedRelease(releaseId),
    onSuccess: (result) => { setReleaseStatus(result.status); toast[result.live ? "success" : "info"](result.live ? "O site confirmou esta release." : `O site ainda não confirmou. Situação: ${result.status}.`); void queryClient.invalidateQueries({ queryKey: ["feed-posts"] }); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Não foi possível consultar a publicação."),
  });
  const retryRelease = useMutation({
    mutationFn: () => api.retryFeedRelease(releaseId),
    onSuccess: (result) => { setReleaseId(result.releaseId); setReleaseStatus(result.status); toast.success("Tentativa de publicação retomada."); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Não foi possível retomar a publicação."),
  });

  const currentPost = postQuery.data;
  const firstActiveCategory = categories.data?.items.find((category) => category.active);
  const effectiveRevision = revision.categoryId || editing
    ? revision
    : { ...revision, categoryId: firstActiveCategory?.id ?? "" };
  const isArchived = currentPost?.status === "archived";
  const canSubmit = !isArchived && !save.isPending && !postQuery.isLoading;
  const onBack = () => {
    if (!dirty || window.confirm("Há alterações ainda não salvas. Sair mesmo assim?")) navigate("/conteudo/feed");
  };
  const update = <K extends keyof EditorialRevisionInput>(key: K, value: EditorialRevisionInput[K]) => {
    setRevision((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };
  const updateBlock = (index: number, block: EditorialBlock) => update("blocks", revision.blocks.map((item, at) => at === index ? block : item));
  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= revision.blocks.length) return;
    const blocks = [...revision.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    update("blocks", blocks);
  };
  const reorderBlocks = (blocks: EditorialBlock[]) => update("blocks", blocks);
  const openPicker = (target: string, types: FeedMediaType[]) => setMediaPicker({ open: true, target, types });
  const selectMedia = (asset: EditorialMediaAsset) => {
    if (mediaPicker.target === "cover") update("coverAssetId", asset.id);
    else if (mediaPicker.target === "opening") update("openingAssetId", asset.id);
    else {
      const match = mediaPicker.target.match(/^block:(\d+):(image|gif|video|poster|gallery)$/);
      if (match) {
        const index = Number(match[1]);
        const block = revision.blocks[index];
        if (!block) return;
        const field = match[2];
        if (field === "gallery" && block.type === "gallery") {
          updateBlock(index, { ...block, items: [...block.items as Array<Record<string, unknown>>, { assetId: asset.id, alt: asset.originalName ?? "Imagem do acervo", caption: "" }] });
        } else if (field === "image" && block.type === "image") updateBlock(index, { ...block, assetId: asset.id });
        else if (field === "gif" && block.type === "gif") updateBlock(index, { ...block, assetId: asset.id });
        else if (field === "video" && block.type === "video") updateBlock(index, { ...block, source: { kind: "asset", assetId: asset.id } });
        else if (field === "poster" && (block.type === "video" || block.type === "gif")) updateBlock(index, { ...block, posterAssetId: asset.id });
      }
    }
    setDirty(true);
  };
  const addBlock = (type: EditorialBlock["type"]) => {
    const id = crypto.randomUUID();
    const defaults: Record<EditorialBlock["type"], EditorialBlock> = {
      text: { id, type: "text", width: "reading", content: emptyDoc },
      image: { id, type: "image", assetId: "", alt: "", caption: "", credit: "", width: "wide" },
      gallery: { id, type: "gallery", items: [], layout: "mosaic" },
      video: { id, type: "video", source: { kind: "youtube", videoId: "" }, title: "", caption: "" },
      gif: { id, type: "gif", assetId: "", alt: "", caption: "" },
      quote: { id, type: "quote", text: "", attribution: "" },
      divider: { id, type: "divider" },
    };
    update("blocks", [...revision.blocks, defaults[type]]);
  };

  if (editing && postQuery.isLoading) return <AppShell><div role="status" className="py-24 text-center text-sm text-genesis-muted">Carregando matéria e revisões…</div></AppShell>;
  if (editing && (postQuery.isError || !currentPost)) return <AppShell><div role="alert" className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">Não foi possível carregar esta matéria. Verifique o acesso ou volte à listagem.<Link to="/conteudo/feed" className="ml-2 font-bold underline">Voltar ao Feed</Link></div></AppShell>;

  return <AppShell>
    <div className="space-y-6">
      <PageHeader eyebrow="Conteúdo editorial · Feed" title={editing ? "Editar matéria" : "Nova matéria"} description={currentPost?.status === "published" ? "Edite uma nova revisão sem alterar o conteúdo que está no ar até concluir outra publicação." : "Monte uma narrativa visual com imagem de abertura, texto, galerias, vídeos e GIFs."} actions={<Button variant="outline" onClick={onBack}><ArrowLeft size={16} /> Voltar à lista</Button>} />
      {isArchived && <div role="alert" className="rounded-lg border border-neutral-300 bg-neutral-100 p-4 text-sm text-neutral-700">Esta matéria está arquivada e não pode ser editada. O histórico permanece preservado.</div>}

      <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }} className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-5">
          <section className="rounded-xl border border-genesis-border bg-white p-4 shadow-sm sm:p-6">
            <SectionHeading eyebrow="01 · Apresentação" title="A história" description="Defina a chamada da grade e a abertura editorial da matéria." />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Título da matéria"><input required minLength={3} maxLength={180} value={revision.title} onChange={(event) => { update("title", event.target.value); if (!slugTouched) update("slug", slugify(event.target.value)); if (!revision.seoTitle) update("seoTitle", `${event.target.value} | Rádio 88 FM`.slice(0, 70)); }} className={inputClass} /></Field>
              <Field label="Categoria"><select required value={effectiveRevision.categoryId} onChange={(event) => update("categoryId", event.target.value)} className={inputClass}><option value="">Selecione uma categoria</option>{categories.data?.items.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
              <Field label="Slug público" hint={currentPost?.firstPublishedAt ? "O slug fica fixo depois da primeira publicação." : "URL legível e sem acentos."}><input required disabled={Boolean(currentPost?.firstPublishedAt)} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={180} value={revision.slug} onChange={(event) => { setSlugTouched(true); update("slug", slugify(event.target.value)); }} className={`${inputClass} font-mono text-sm`} /></Field>
              <Field label="Data do acontecimento" hint="Opcional; usada no filtro por ano e na ordenação por data do acontecimento no Feed público. Sem preenchimento, a matéria aparece em Sem data."><input type="date" value={revision.eventDate ?? ""} onChange={(event) => update("eventDate", event.target.value || null)} className={inputClass} /></Field>
              <Field label="Resumo para a grade e compartilhamento" className="md:col-span-2"><textarea required minLength={10} maxLength={320} rows={3} value={revision.excerpt} onChange={(event) => { update("excerpt", event.target.value); if (!revision.seoDescription) update("seoDescription", event.target.value.slice(0, 180)); }} className={textareaClass} /></Field>
            </div>
          </section>

          <section className="rounded-xl border border-genesis-border bg-white p-4 shadow-sm sm:p-6">
            <SectionHeading eyebrow="02 · Imagens" title="Capa e abertura" description="Escolha imagens distintas ou reutilize o mesmo arquivo com enquadramentos diferentes." />
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <AssetField usage="card" title="Capa da grade" assetId={revision.coverAssetId} onPick={() => openPicker("cover", ["image"])} />
              <AssetField usage="opening" title="Imagem de abertura" assetId={revision.openingAssetId} onPick={() => openPicker("opening", ["image"])} />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button variant="outline" size="sm" type="button" onClick={() => { update("openingAssetId", revision.coverAssetId); update("openingAlt", revision.coverAlt); update("openingFocusX", revision.coverFocusX); update("openingFocusY", revision.coverFocusY); }}>Usar capa também na abertura</Button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Descrição acessível da capa"><input required minLength={2} maxLength={220} value={revision.coverAlt} onChange={(event) => update("coverAlt", event.target.value)} className={inputClass} /></Field>
              <Field label="Descrição acessível da abertura"><input required minLength={2} maxLength={220} value={revision.openingAlt} onChange={(event) => update("openingAlt", event.target.value)} className={inputClass} /></Field>
              <FocusControls label="Foco da capa" x={revision.coverFocusX} y={revision.coverFocusY} onChange={(x, y) => { update("coverFocusX", x); update("coverFocusY", y); }} />
              <FocusControls label="Foco da abertura" x={revision.openingFocusX} y={revision.openingFocusY} onChange={(x, y) => { update("openingFocusX", x); update("openingFocusY", y); }} />
            </div>
          </section>

          <section className="rounded-xl border border-genesis-border bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><SectionHeading eyebrow="03 · Sequência editorial" title="Conteúdo da matéria" description="Reordene blocos com arraste ou com os botões acessíveis de posição." /><BlockMenu onAdd={addBlock} /></div>
            {revision.blocks.length === 0 ? <div className="mt-5 rounded-lg border border-dashed border-genesis-border bg-neutral-50 px-5 py-10 text-center"><p className="font-semibold text-genesis-text">Comece a narrativa</p><p className="mt-1 text-sm text-genesis-muted">Adicione texto, imagem, galeria, vídeo, GIF, citação ou separador.</p></div> : <div className="mt-5 space-y-3"><BlockList blocks={revision.blocks} onChange={updateBlock} onMove={moveBlock} onReorder={reorderBlocks} onRemove={(index) => update("blocks", revision.blocks.filter((_, at) => at !== index))} onDuplicate={(index) => { const copy = structuredClone(revision.blocks[index]); copy.id = crypto.randomUUID(); update("blocks", [...revision.blocks.slice(0, index + 1), copy, ...revision.blocks.slice(index + 1)]); }} onPick={openPicker} /></div>}
            <div className="mt-4 flex flex-wrap gap-2">{(["text", "image", "gallery", "video", "gif", "quote", "divider"] as const).map((type) => <Button key={type} variant="outline" size="sm" type="button" onClick={() => addBlock(type)}><Plus size={14} />{blockLabel(type)}</Button>)}</div>
          </section>

          <details className="rounded-xl border border-genesis-border bg-white p-4 shadow-sm sm:p-6" open>
            <summary className="cursor-pointer list-none"><SectionHeading eyebrow="04 · Descoberta" title="SEO da matéria" description="Metadados próprios para buscadores e compartilhamento." /></summary>
            <div className="mt-5 grid gap-4">
              <Field label="Título SEO (máx. 70 caracteres)"><input required minLength={3} maxLength={70} value={revision.seoTitle} onChange={(event) => update("seoTitle", event.target.value)} className={inputClass} /></Field>
              <Field label="Descrição SEO (20 a 180 caracteres)"><textarea required minLength={20} maxLength={180} rows={3} value={revision.seoDescription} onChange={(event) => update("seoDescription", event.target.value)} className={textareaClass} /></Field>
              <Field label="Crédito público (opcional)"><input maxLength={500} value={revision.publicCredits} onChange={(event) => update("publicCredits", event.target.value)} className={inputClass} placeholder="Ex.: Fotos: equipe Rádio 88 FM" /></Field>
            </div>
          </details>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-5">
          <section className="rounded-xl border border-genesis-border bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-genesis-primary">Estado editorial</p>
            <p className="mt-2 font-display text-lg font-bold text-genesis-text">{currentPost ? statusText(currentPost.status) : "Rascunho novo"}</p>
            <p className="mt-1 text-sm leading-6 text-genesis-muted">Salvar mantém o conteúdo no banco administrativo. Visitantes só recebem o HTML estático após a confirmação do deploy.</p>
            <div className="mt-4 flex flex-col gap-2">
              <Button type="submit" disabled={!canSubmit || categories.isLoading || !revision.coverAssetId || !revision.openingAssetId}><Save size={16} />{save.isPending ? "Salvando…" : "Salvar rascunho"}</Button>
              <Button variant="outline" type="button" onClick={() => setPreviewOpen(true)} disabled={!revision.title || !revision.openingAssetId}><Eye size={16} /> Pré-visualizar</Button>
              <Button variant="secondary" type="button" disabled={!saved || !revision.blocks.length || publish.isPending || currentPost?.status === "archived"} onClick={() => { if (saved && window.confirm("Gerar uma release editorial e iniciar o build do site?")) publish.mutate(); }}><Send size={16} />Solicitar publicação</Button>
            </div>
            {dirty && <p className="mt-3 rounded-md bg-amber-50 p-2.5 text-xs font-semibold text-amber-800">Há alterações ainda não salvas.</p>}
            {saved && <p className="mt-3 flex items-center gap-2 text-xs text-emerald-700"><Check size={15} /> Revisão {saved.revisionNumber} salva</p>}
          </section>
          {releaseId && <section className="rounded-xl border border-genesis-border bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-genesis-muted">Publicação · {releaseStatusLabel(releaseStatus)}</p><p className="mt-2 text-sm leading-6 text-genesis-muted">A publicação ainda não é considerada concluída até o site responder com o marcador desta release.</p><div className="mt-3 grid gap-2"><Button variant="outline" type="button" disabled={checkRelease.isPending} onClick={() => checkRelease.mutate()}>{checkRelease.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCwIcon />} Atualizar situação</Button>{releaseStatus === "failed" && <Button variant="outline" type="button" disabled={retryRelease.isPending} onClick={() => retryRelease.mutate()}>{retryRelease.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />} Tentar novamente</Button>}</div></section>}
          <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950"><strong>Privacidade de Preview</strong><p className="mt-1">Os arquivos novos ficam no bucket privado até você solicitar a publicação. Ao publicar, as mídias aprovadas passam a ser públicas no R2.</p></section>
        </aside>
      </form>
      <FeedMediaPickerDialog open={mediaPicker.open} onOpenChange={(open) => setMediaPicker((current) => ({ ...current, open }))} allowedTypes={mediaPicker.types} onSelect={selectMedia} />
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen} title="Pré-visualização da matéria" description="Conteúdo privado, ainda não visível para os visitantes." className="sm:max-w-6xl" footer={<Button variant="outline" onClick={() => setPreviewOpen(false)}>Fechar</Button>}>
        <div className="mb-4 flex justify-end gap-2"><Button variant={previewDevice === "desktop" ? "primary" : "outline"} size="sm" onClick={() => setPreviewDevice("desktop")}>Desktop</Button><Button variant={previewDevice === "mobile" ? "primary" : "outline"} size="sm" onClick={() => setPreviewDevice("mobile")}>Mobile</Button></div>
        <div className={`mx-auto max-h-[68vh] overflow-y-auto rounded-lg border border-genesis-border bg-white transition-all ${previewDevice === "mobile" ? "max-w-[390px]" : "max-w-5xl"}`}><PrivateArticlePreview revision={effectiveRevision} categories={categories.data?.items ?? []} /></div>
      </Dialog>
    </div>
  </AppShell>;
}

function BlockList({ blocks, onChange, onMove, onReorder, onRemove, onDuplicate, onPick }: { blocks: EditorialBlock[]; onChange: (index: number, block: EditorialBlock) => void; onMove: (index: number, direction: -1 | 1) => void; onReorder: (blocks: EditorialBlock[]) => void; onRemove: (index: number) => void; onDuplicate: (index: number) => void; onPick: (target: string, types: FeedMediaType[]) => void }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const moveTo = (from: number, to: number) => {
    if (from === to) return;
    const ordered = [...blocks];
    const [block] = ordered.splice(from, 1);
    ordered.splice(to, 0, block);
    onReorder(ordered);
  };
  return <div className="space-y-3">{blocks.map((block, index) => <section key={block.id} draggable onDragStart={() => setDragIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex !== null) moveTo(dragIndex, index); setDragIndex(null); }} onDragEnd={() => setDragIndex(null)} className={`rounded-lg border border-genesis-border bg-white ${dragIndex === index ? "opacity-40" : ""}`}>
    <div className="flex items-center justify-between gap-3 border-b border-genesis-border bg-neutral-50 px-3 py-2"><div className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="cursor-grab rounded bg-white px-2 py-1 text-xs text-genesis-muted">⠿</span><p className="truncate text-sm font-bold text-genesis-text">{blockLabel(block.type)} <span className="font-mono text-xs font-normal text-genesis-muted">· bloco {index + 1}</span></p></div><div className="flex shrink-0 items-center gap-1"><button type="button" aria-label={`Mover bloco ${index + 1} para cima`} disabled={index === 0} onClick={() => onMove(index, -1)} className={iconButtonClass}><ArrowUp size={15} /></button><button type="button" aria-label={`Mover bloco ${index + 1} para baixo`} disabled={index === blocks.length - 1} onClick={() => onMove(index, 1)} className={iconButtonClass}><ArrowDown size={15} /></button><button type="button" aria-label={`Duplicar bloco ${index + 1}`} onClick={() => onDuplicate(index)} className={iconButtonClass}><Copy size={15} /></button><button type="button" aria-label={`Remover bloco ${index + 1}`} onClick={() => onRemove(index)} className={`${iconButtonClass} text-red-700`}><Trash2 size={15} /></button></div></div>
    <div className="space-y-4 p-3 sm:p-4"><BlockFields block={block} index={index} onChange={(next) => onChange(index, next)} onPick={onPick} /></div>
  </section>)}</div>;
}

function BlockFields({ block, index, onChange, onPick }: { block: EditorialBlock; index: number; onChange: (block: EditorialBlock) => void; onPick: (target: string, types: FeedMediaType[]) => void }) {
  if (block.type === "text") return <><RichTextBlockEditor value={block.content as EditorialTextBlock["content"]} onChange={(content) => onChange({ ...block, content })} /><label className="text-xs font-semibold text-genesis-muted">Largura do texto<select value={String(block.width ?? "reading")} onChange={(event) => onChange({ ...block, width: event.target.value as "reading" | "wide" })} className={smallSelect}><option value="reading">Coluna confortável</option><option value="wide">Ampla</option></select></label></>;
  if (block.type === "image") return <><AssetField usage="body" title="Imagem" assetId={String(block.assetId ?? "")} onPick={() => onPick(`block:${index}:image`, ["image"])} /><div className="grid gap-3 md:grid-cols-2"><Field label="Texto alternativo"><input required minLength={2} maxLength={220} value={String(block.alt ?? "")} onChange={(event) => onChange({ ...block, alt: event.target.value })} className={inputClass} /></Field><Field label="Crédito (opcional)"><input maxLength={160} value={String(block.credit ?? "")} onChange={(event) => onChange({ ...block, credit: event.target.value })} className={inputClass} /></Field><Field label="Legenda (opcional)" className="md:col-span-2"><input maxLength={500} value={String(block.caption ?? "")} onChange={(event) => onChange({ ...block, caption: event.target.value })} className={inputClass} /></Field></div><label className="text-xs font-semibold text-genesis-muted">Exibição<select value={String(block.width ?? "wide")} onChange={(event) => onChange({ ...block, width: event.target.value })} className={smallSelect}><option value="wide">Imagem ampla</option><option value="reading">Largura de leitura</option></select></label></>;
  if (block.type === "gallery") {
    const items = Array.isArray(block.items) ? block.items as Array<{ assetId: string; alt: string; caption?: string }> : [];
    return <><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-genesis-text">{items.length} de 12 imagens selecionadas</p><Button size="sm" variant="outline" type="button" disabled={items.length >= 12} onClick={() => onPick(`block:${index}:gallery`, ["image"])}><ImagePlus size={15} /> Adicionar imagem</Button></div><FeedMediaGuidance usage="body" />{items.map((item, at) => <div key={`${item.assetId}-${at}`} className="grid gap-3 rounded-md border border-genesis-border p-3 sm:grid-cols-[5rem_1fr_auto] sm:items-center"><AssetPreview assetId={item.assetId} className="aspect-square w-20 rounded object-cover" /><div className="grid gap-2 sm:grid-cols-2"><input aria-label={`Descrição da imagem ${at + 1}`} required minLength={2} maxLength={220} value={item.alt} onChange={(event) => onChange({ ...block, items: items.map((value, itemIndex) => itemIndex === at ? { ...value, alt: event.target.value } : value) })} className={inputClass} placeholder="Texto alternativo" /><input aria-label={`Legenda da imagem ${at + 1}`} maxLength={300} value={item.caption ?? ""} onChange={(event) => onChange({ ...block, items: items.map((value, itemIndex) => itemIndex === at ? { ...value, caption: event.target.value } : value) })} className={inputClass} placeholder="Legenda opcional" /></div><Button size="icon" variant="ghost" type="button" aria-label={`Remover imagem ${at + 1}`} onClick={() => onChange({ ...block, items: items.filter((_, itemIndex) => itemIndex !== at) })}><Trash2 size={16} /></Button></div>)}<label className="text-xs font-semibold text-genesis-muted">Organização<select value={String(block.layout ?? "mosaic")} onChange={(event) => onChange({ ...block, layout: event.target.value })} className={smallSelect}><option value="mosaic">Mosaico editorial</option><option value="carousel">Carrossel manual</option></select></label>{items.length < 2 && <p className="text-xs text-amber-800">Inclua pelo menos duas imagens para salvar uma galeria.</p>}</>;
  }
  if (block.type === "video") {
    const source = block.source as { kind: "asset" | "youtube"; assetId?: string; videoId?: string } | undefined;
    return <><Field label="Fonte do vídeo"><select value={source?.kind ?? "youtube"} onChange={(event) => onChange({ ...block, source: event.target.value === "asset" ? { kind: "asset", assetId: "" } : { kind: "youtube", videoId: "" } })} className={inputClass}><option value="youtube">YouTube</option><option value="asset">Arquivo MP4 do acervo</option></select></Field>{source?.kind === "asset" ? <AssetField usage="video" title="Vídeo MP4" assetId={source.assetId ?? ""} mediaType="video" posterAssetId={String(block.posterAssetId ?? "")} onPick={() => onPick(`block:${index}:video`, ["video"])} /> : <Field label="URL ou ID do vídeo YouTube"><input value={source?.videoId ?? ""} onChange={(event) => onChange({ ...block, source: { kind: "youtube", videoId: youtubeId(event.target.value) } })} className={inputClass} placeholder="https://youtube.com/watch?v=…" /></Field>}<div className="grid gap-3 md:grid-cols-2"><Field label="Título acessível"><input required minLength={2} maxLength={180} value={String(block.title ?? "")} onChange={(event) => onChange({ ...block, title: event.target.value })} className={inputClass} /></Field><Field label="Legenda (opcional)"><input maxLength={500} value={String(block.caption ?? "")} onChange={(event) => onChange({ ...block, caption: event.target.value })} className={inputClass} /></Field></div><AssetField usage="poster" title="Poster estático" assetId={String(block.posterAssetId ?? "")} onPick={() => onPick(`block:${index}:poster`, ["image"])} /><p className="text-xs text-genesis-muted">Vídeo MP4 exige poster. Arquivos próprios são progressivos; legendas em arquivo ainda não estão disponíveis nesta etapa.</p></>;
  }
  if (block.type === "gif") return <><AssetField usage="gif" title="GIF animado" assetId={String(block.assetId ?? "")} mediaType="gif" posterAssetId={String(block.posterAssetId ?? "")} onPick={() => onPick(`block:${index}:gif`, ["gif"])} /><div className="grid gap-3 md:grid-cols-2"><Field label="Texto alternativo"><input required minLength={2} maxLength={220} value={String(block.alt ?? "")} onChange={(event) => onChange({ ...block, alt: event.target.value })} className={inputClass} /></Field><Field label="Legenda (opcional)"><input maxLength={500} value={String(block.caption ?? "")} onChange={(event) => onChange({ ...block, caption: event.target.value })} className={inputClass} /></Field></div><AssetField usage="poster" title="Poster estático opcional" assetId={String(block.posterAssetId ?? "")} onPick={() => onPick(`block:${index}:poster`, ["image"])} /><p className="text-xs text-genesis-muted">O leitor público começa pelo poster e oferece controle para iniciar ou pausar a animação.</p></>;
  if (block.type === "quote") return <><Field label="Citação"><textarea required minLength={2} maxLength={1200} rows={3} value={String(block.text ?? "")} onChange={(event) => onChange({ ...block, text: event.target.value })} className={textareaClass} /></Field><Field label="Autoria pública (opcional)"><input maxLength={180} value={String(block.attribution ?? "")} onChange={(event) => onChange({ ...block, attribution: event.target.value })} className={inputClass} /></Field></>;
  return <p className="text-sm text-genesis-muted">Separador visual de seção; sem estilo arbitrário.</p>;
}

function AssetField({ title, usage, assetId, onPick, mediaType = "image", posterAssetId = "" }: { title: string; usage: FeedMediaUsage; assetId: string; onPick: () => void; mediaType?: FeedMediaType; posterAssetId?: string }) {
  const preview = mediaType === "video"
    ? <PrivateVideoPreview assetId={assetId} posterAssetId={posterAssetId} className="mt-3 max-h-48 w-full rounded-md bg-black" />
    : mediaType === "gif"
      ? <PrivateGifPreview assetId={assetId} posterAssetId={posterAssetId} className="mt-3 max-h-48 w-full rounded-md bg-white object-contain" />
      : <AssetPreview assetId={assetId} className="mt-3 max-h-48 w-full rounded-md bg-white object-contain" />;
  return <div className="rounded-lg border border-genesis-border bg-neutral-50 p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-genesis-text">{title}</p><p className="mt-1 text-xs text-genesis-muted">{assetId ? `Arquivo selecionado · ${assetId.slice(0, 8)}…` : "Nenhuma mídia escolhida"}</p></div><Button type="button" variant="outline" size="sm" onClick={onPick}><ImagePlus size={15} />{assetId ? "Trocar" : "Escolher"}</Button></div><FeedMediaGuidance usage={usage} />{assetId && preview}</div>;
}

function AssetPreview({ assetId, className, alt = "Prévia privada da mídia" }: { assetId: string; className?: string; alt?: string }) {
  const preview = useQuery({ queryKey: ["feed-asset-preview", assetId], queryFn: () => api.getFeedAssetPreview(assetId), enabled: Boolean(assetId), staleTime: 180_000, refetchOnWindowFocus: false });
  if (!assetId) return <div className={`grid place-items-center rounded-md border border-dashed border-genesis-border bg-white text-xs text-genesis-muted ${className ?? "aspect-[4/3]"}`}>Selecione um arquivo</div>;
  return preview.data ? <img src={preview.data.url} alt={alt} className={className} /> : <div role="status" className={`grid place-items-center rounded-md bg-neutral-100 text-xs text-genesis-muted ${className ?? "aspect-[4/3]"}`}>{preview.isError ? "Prévia indisponível" : "Carregando prévia…"}</div>;
}

function PrivateGifPreview({ assetId, posterAssetId, className, alt = "Prévia privada animada" }: { assetId: string; posterAssetId: string; className?: string; alt?: string }) {
  const [playing, setPlaying] = useState(false);
  const preview = useQuery({ queryKey: ["feed-asset-preview", assetId], queryFn: () => api.getFeedAssetPreview(assetId), enabled: Boolean(assetId), staleTime: 180_000, refetchOnWindowFocus: false });
  const poster = useQuery({ queryKey: ["feed-asset-preview", posterAssetId], queryFn: () => api.getFeedAssetPreview(posterAssetId), enabled: Boolean(posterAssetId), staleTime: 180_000, refetchOnWindowFocus: false });
  if (!preview.data) return <div role="status" className={`grid aspect-video place-items-center rounded-md bg-neutral-100 text-xs text-genesis-muted ${className ?? ""}`}>{preview.isError ? "Prévia indisponível" : "Carregando prévia…"}</div>;
  const posterUrl = poster.data?.url ?? preview.data.posterUrl;
  return <div><div className="grid min-h-28 place-items-center overflow-hidden bg-neutral-100">{playing ? <img src={preview.data.url} alt={alt} className={className} /> : posterUrl ? <img src={posterUrl} alt="Poster estático do GIF" className={className} /> : <span className="p-4 text-xs text-genesis-muted">GIF pronto para reprodução</span>}</div><button type="button" aria-pressed={playing} onClick={() => setPlaying((value) => !value)} className="mt-2 min-h-9 rounded-full border border-genesis-border px-3 text-xs font-semibold text-genesis-text">{playing ? "Pausar animação" : "Reproduzir animação"}</button></div>;
}

function PrivateVideoPreview({ assetId, posterAssetId, className }: { assetId: string; posterAssetId: string; className?: string }) {
  const preview = useQuery({ queryKey: ["feed-asset-preview", assetId], queryFn: () => api.getFeedAssetPreview(assetId), enabled: Boolean(assetId), staleTime: 180_000, refetchOnWindowFocus: false });
  const poster = useQuery({ queryKey: ["feed-asset-preview", posterAssetId], queryFn: () => api.getFeedAssetPreview(posterAssetId), enabled: Boolean(posterAssetId), staleTime: 180_000, refetchOnWindowFocus: false });
  if (!preview.data) return <div role="status" className={`grid aspect-video place-items-center rounded-md bg-neutral-100 text-xs text-genesis-muted ${className ?? ""}`}>{preview.isError ? "Prévia indisponível" : "Carregando prévia…"}</div>;
  return <video controls preload="none" poster={poster.data?.url} aria-label="Prévia privada do vídeo MP4" className={className}><source src={preview.data.url} type={preview.data.mimeType ?? "video/mp4"} /></video>;
}

function PrivateArticlePreview({ revision, categories }: { revision: EditorialRevisionInput; categories: Array<{ id: string; name: string; slug: string }> }) {
  const category = categories.find((item) => item.id === revision.categoryId);
  return <article className="pb-10"><div className="bg-neutral-100"><AssetPreview assetId={revision.openingAssetId} className="mx-auto max-h-[60vh] w-full object-contain" /></div><header className="mx-auto max-w-3xl px-6 py-9"><p className="text-xs font-bold uppercase tracking-[0.18em] text-genesis-primary">{category?.name ?? "Rádio 88 FM"}</p><h1 className="mt-3 font-display text-3xl font-black leading-tight text-genesis-text sm:text-5xl">{revision.title || "Título da matéria"}</h1><p className="mt-4 text-lg leading-8 text-genesis-muted">{revision.excerpt}</p><p className="mt-4 text-xs uppercase tracking-wide text-genesis-muted">{revision.eventDate ? new Date(`${revision.eventDate}T12:00:00`).toLocaleDateString("pt-BR", { dateStyle: "long" }) : "Data do acontecimento não informada"}</p></header><div className="mx-auto max-w-5xl space-y-8 px-6"><p className="rounded bg-blue-50 p-3 text-center text-xs font-semibold text-blue-900">A prévia usa os mesmos tipos de bloco e metadados do conteúdo público.</p>{revision.blocks.map((block) => <PreviewBlock key={block.id} block={block} />)}</div></article>;
}

function PreviewBlock({ block }: { block: EditorialBlock }) {
  if (block.type === "text") return <div className={`prose prose-neutral mx-auto w-full ${block.width === "wide" ? "max-w-5xl" : "max-w-3xl"}`}><PreviewRichText value={block.content} /></div>;
  if (block.type === "divider") return <hr className="mx-auto w-full max-w-3xl border-neutral-200" />;
  if (block.type === "quote") return <figure className="mx-auto max-w-3xl border-l-4 border-genesis-primary pl-5"><blockquote className="font-display text-2xl font-bold">{String(block.text ?? "")}</blockquote>{Boolean(block.attribution) && <figcaption className="mt-2 text-sm text-genesis-muted">{String(block.attribution)}</figcaption>}</figure>;
  if (block.type === "image") return <figure className="mx-auto w-full max-w-5xl"><AssetPreview assetId={String(block.assetId ?? "")} alt={String(block.alt ?? "Imagem da matéria")} className="mx-auto h-auto max-h-[78vh] w-full rounded-sm object-contain" />{Boolean(block.caption || block.credit) && <figcaption className="mt-2 text-center text-sm text-genesis-muted">{String(block.caption ?? "")}{block.credit ? ` · ${String(block.credit)}` : ""}</figcaption>}</figure>;
  if (block.type === "gif") return <figure className="mx-auto w-full max-w-5xl"><PrivateGifPreview assetId={String(block.assetId ?? "")} posterAssetId={String(block.posterAssetId ?? "")} alt={String(block.alt ?? "GIF da matéria")} className="mx-auto h-auto max-h-[78vh] w-full rounded-sm object-contain" />{Boolean(block.caption) && <figcaption className="mt-2 text-center text-sm text-genesis-muted">{String(block.caption)}</figcaption>}</figure>;
  if (block.type === "gallery") return <PreviewGallery block={block} />;
  if (block.type === "video") return <PreviewVideo block={block} />;
  return null;
}

function PreviewGallery({ block }: { block: EditorialBlock }) {
  const items = Array.isArray(block.items) ? block.items as Array<{ assetId: string; alt: string; caption?: string }> : [];
  const [index, setIndex] = useState(0);
  if (block.layout === "carousel") {
    const item = items[index];
    if (!item) return null;
    return <section className="mx-auto w-full max-w-5xl" aria-label={`Prévia da galeria com ${items.length} imagens`}><figure><AssetPreview assetId={item.assetId} alt={item.alt} className="mx-auto h-auto max-h-[78vh] w-full bg-neutral-50 object-contain" />{item.caption && <figcaption className="mt-2 text-center text-sm text-genesis-muted">{item.caption}</figcaption>}</figure><div className="mt-3 flex items-center justify-center gap-3"><button type="button" aria-label="Imagem anterior da prévia" disabled={index === 0} onClick={() => setIndex((value) => value - 1)} className="min-h-9 rounded-full border border-genesis-border px-3 disabled:opacity-40">Anterior</button><span aria-live="polite" className="text-xs text-genesis-muted">{index + 1} / {items.length}</span><button type="button" aria-label="Próxima imagem da prévia" disabled={index === items.length - 1} onClick={() => setIndex((value) => value + 1)} className="min-h-9 rounded-full border border-genesis-border px-3 disabled:opacity-40">Próxima</button></div></section>;
  }
  return <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">{items.map((item, at) => <figure key={`${item.assetId}-${at}`}><AssetPreview assetId={item.assetId} alt={item.alt} className="mx-auto h-auto max-h-[78vh] w-full rounded-sm bg-neutral-50 object-contain" />{item.caption && <figcaption className="mt-2 text-center text-sm text-genesis-muted">{item.caption}</figcaption>}</figure>)}</div>;
}

function PreviewVideo({ block }: { block: EditorialBlock }) {
  const source = block.source as { kind?: string; assetId?: string; videoId?: string } | undefined;
  if (source?.kind === "asset") return <figure className="mx-auto w-full max-w-5xl"><PrivateVideoPreview assetId={String(source.assetId ?? "")} posterAssetId={String(block.posterAssetId ?? "")} className="max-h-[75vh] w-full bg-black" />{Boolean(block.caption) && <figcaption className="mt-2 text-center text-sm text-genesis-muted">{String(block.caption)}</figcaption>}</figure>;
  if (source?.kind === "youtube" && source.videoId) return <PrivateYoutubePreview videoId={source.videoId} posterAssetId={String(block.posterAssetId ?? "")} title={String(block.title ?? "Prévia do vídeo YouTube")} />;
  return <div className="mx-auto grid aspect-video w-full max-w-5xl place-items-center rounded-lg bg-neutral-100 p-8 text-center text-sm text-genesis-muted">Selecione uma fonte de vídeo para visualizar.</div>;
}

function PrivateYoutubePreview({ videoId, posterAssetId, title }: { videoId: string; posterAssetId: string; title: string }) {
  const [started, setStarted] = useState(false);
  const poster = useQuery({ queryKey: ["feed-asset-preview", posterAssetId], queryFn: () => api.getFeedAssetPreview(posterAssetId), enabled: Boolean(posterAssetId), staleTime: 180_000, refetchOnWindowFocus: false });
  return <div className="relative mx-auto aspect-video w-full max-w-5xl bg-black">{started ? <iframe title={title} src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0`} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen className="absolute inset-0 h-full w-full" /> : <button type="button" onClick={() => setStarted(true)} className="absolute inset-0 grid w-full place-items-center bg-neutral-900 text-white" style={poster.data?.url ? { background: `center / contain no-repeat url("${poster.data.url}")` } : undefined}><span className="rounded bg-black/70 px-5 py-3 text-sm font-bold">Carregar prévia do YouTube</span></button>}</div>;
}

function PreviewRichText({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") return null;
  const node = value as { type?: string; text?: string; attrs?: { level?: number }; content?: unknown[]; marks?: Array<{ type?: string; attrs?: { href?: string } }> };
  if (node.type === "text") { let text: ReactNode = node.text ?? ""; for (const mark of node.marks ?? []) { if (mark.type === "bold") text = <strong>{text}</strong>; if (mark.type === "italic") text = <em>{text}</em>; if (mark.type === "strike") text = <s>{text}</s>; if (mark.type === "link") text = <a href={mark.attrs?.href}>{text}</a>; } return text; }
  const children = (node.content ?? []).map((child, index) => <PreviewRichText key={index} value={child} />);
  if (node.type === "heading") return node.attrs?.level === 3 ? <h3>{children}</h3> : <h2>{children}</h2>;
  if (node.type === "paragraph") return <p>{children}</p>;
  if (node.type === "bulletList") return <ul>{children}</ul>;
  if (node.type === "orderedList") return <ol>{children}</ol>;
  if (node.type === "listItem") return <li>{children}</li>;
  if (node.type === "blockquote") return <blockquote>{children}</blockquote>;
  if (node.type === "doc") return <>{children}</>;
  return null;
}

function FocusControls({ label, x, y, onChange }: { label: string; x: number; y: number; onChange: (x: number, y: number) => void }) {
  return <fieldset className="grid grid-cols-2 gap-2"><legend className="mb-1 text-xs font-bold text-genesis-muted">{label} (%)</legend><label className="text-xs text-genesis-muted">Horizontal<input type="range" min="0" max="100" value={x} onChange={(event) => onChange(Number(event.target.value), y)} className="mt-1 block w-full accent-genesis-primary" /></label><label className="text-xs text-genesis-muted">Vertical<input type="range" min="0" max="100" value={y} onChange={(event) => onChange(x, Number(event.target.value))} className="mt-1 block w-full accent-genesis-primary" /></label></fieldset>;
}

function BlockMenu({ onAdd }: { onAdd: (type: EditorialBlock["type"]) => void }) { return <details className="relative"><summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md bg-genesis-primary px-4 text-sm font-semibold text-white"><Plus size={16} /> Inserir bloco <ChevronDown size={15} /></summary><div className="absolute right-0 z-10 mt-2 grid min-w-48 gap-1 rounded-lg border border-genesis-border bg-white p-2 shadow-panel">{(["text", "image", "gallery", "video", "gif", "quote", "divider"] as const).map((type) => <button key={type} type="button" onClick={() => onAdd(type)} className="rounded px-3 py-2 text-left text-sm font-semibold text-genesis-text hover:bg-neutral-100">{blockLabel(type)}</button>)}</div></details>; }

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) { return <label className={`block text-sm font-semibold text-genesis-text ${className ?? ""}`}>{label}{hint && <span className="mt-1 block text-xs font-normal text-genesis-muted">{hint}</span>}{children}</label>; }
function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-genesis-primary">{eyebrow}</p><h2 className="mt-1 font-display text-xl font-bold text-genesis-text">{title}</h2><p className="mt-1 text-sm leading-6 text-genesis-muted">{description}</p></div>; }

const inputClass = "mt-1.5 block min-h-11 w-full rounded-md border border-genesis-border bg-white px-3 font-normal text-genesis-text outline-none transition focus:border-genesis-primary focus:ring-2 focus:ring-genesis-primary/15 disabled:bg-neutral-100 disabled:text-neutral-500";
const textareaClass = "mt-1.5 block w-full rounded-md border border-genesis-border bg-white p-3 font-normal text-genesis-text outline-none focus:border-genesis-primary focus:ring-2 focus:ring-genesis-primary/15";
const smallSelect = "ml-2 min-h-9 rounded-md border border-genesis-border bg-white px-2 text-xs text-genesis-text";
const iconButtonClass = "grid h-8 w-8 place-items-center rounded text-genesis-muted hover:bg-white hover:text-genesis-text disabled:opacity-35";

function validateRevision(input: EditorialRevisionInput): EditorialRevisionInput {
  if (!input.coverAssetId || !input.openingAssetId) throw new Error("Escolha as imagens de capa e de abertura.");
  if (!input.categoryId) throw new Error("Escolha uma categoria ativa.");
  if (input.blocks.some((block) => block.type === "gallery" && (!Array.isArray(block.items) || block.items.length < 2))) throw new Error("Cada galeria precisa ter pelo menos duas imagens.");
  if (input.blocks.some((block) => block.type === "video" && (block.source as { kind?: string; assetId?: string; videoId?: string }).kind === "asset" && (!(block.source as { assetId?: string }).assetId || !(block.posterAssetId as string)))) throw new Error("Selecione o vídeo MP4 e um poster estático para cada vídeo próprio.");
  return input;
}
function slugify(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 180); }
function youtubeId(value: string) { const trimmed = value.trim(); if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed; try { const url = new URL(trimmed); const id = url.searchParams.get("v") ?? url.pathname.split("/").filter(Boolean).at(-1) ?? ""; return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : ""; } catch { return ""; } }
function blockLabel(type: EditorialBlock["type"]) { return ({ text: "Texto rico", image: "Imagem", gallery: "Galeria", video: "Vídeo", gif: "GIF", quote: "Citação", divider: "Separador" })[type]; }
function statusText(status: EditorialPost["status"]) { return status === "published" ? "Publicada" : status === "archived" ? "Arquivada" : "Rascunho"; }
function releaseStatusLabel(status: string) { return status === "awaiting_confirmation" ? "aguardando o site" : status === "live" ? "no ar" : status || "processando"; }
function RefreshCwIcon() { return <RefreshCw size={16} />; }
