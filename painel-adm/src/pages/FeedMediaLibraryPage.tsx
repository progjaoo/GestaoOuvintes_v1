import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Film, ImagePlus, RefreshCw } from "lucide-react";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { FeedMediaPickerDialog, type FeedMediaType } from "@/components/feed/FeedMediaPickerDialog";
import { FeedMediaGuidance } from "@/components/feed/FeedMediaGuidance";
import { Button } from "@/components/ui/Button";
import { api } from "@/services/api";
import { usePageTitle } from "@/hooks/usePageTitle";

export function FeedMediaLibraryPage() {
  usePageTitle("Biblioteca do Feed");
  const [filter, setFilter] = useState<"all" | FeedMediaType>("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const media = useQuery({ queryKey: ["feed-assets", "library"], queryFn: () => api.listFeedAssets({ page: 1, pageSize: 50 }), refetchOnWindowFocus: false });
  const items = (media.data?.items ?? []).filter((asset) => filter === "all" || asset.mediaType === filter);
  return <AppShell><div className="space-y-6">
    <PageHeader eyebrow="Conteúdo editorial · Feed" title="Biblioteca de mídia" description="Consulte os arquivos enviados para o Preview. Originais em revisão ficam privados; só mídias publicadas passam ao bucket público." actions={<div className="flex gap-2"><Link to="/conteudo/feed"><Button variant="outline"><ArrowLeft size={16} /> Feed</Button></Link><Button onClick={() => setPickerOpen(true)}><ImagePlus size={16} /> Enviar mídia</Button></div>} />
    <section className="rounded-xl border border-genesis-border bg-white p-4 sm:p-6"><FeedMediaGuidance /></section>
    <section className="rounded-xl border border-genesis-border bg-white p-4 shadow-sm sm:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar biblioteca por tipo">{(["all", "image", "gif", "video"] as const).map((type) => <button key={type} type="button" aria-pressed={filter === type} onClick={() => setFilter(type)} className={`min-h-9 rounded-full px-3 text-sm font-semibold transition ${filter === type ? "bg-genesis-text text-white" : "bg-neutral-100 text-genesis-muted hover:bg-neutral-200"}`}>{type === "all" ? "Todas" : type === "image" ? "Imagens" : type === "gif" ? "GIFs" : "Vídeos"}</button>)}</div><Button variant="outline" size="sm" disabled={media.isFetching} onClick={() => void media.refetch()}><RefreshCw size={15} className={media.isFetching ? "animate-spin" : ""} /> Atualizar</Button></div>
      {media.isLoading ? <p role="status" className="py-16 text-center text-sm text-genesis-muted">Carregando arquivos…</p> : media.isError ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Não foi possível carregar a biblioteca. Verifique o acesso `feed.read`.</div> : items.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{items.map((asset) => <article key={asset.id} className="overflow-hidden rounded-lg border border-genesis-border bg-white"><div className="relative aspect-[4/3] bg-neutral-100">{asset.mediaType === "video" ? asset.previewUrl ? <video controls preload="metadata" src={asset.previewUrl} className="h-full w-full object-contain" aria-label={`Vídeo ${asset.originalName ?? "do acervo"}`} /> : <Film className="absolute inset-0 m-auto text-genesis-muted" /> : asset.previewUrl ? <img src={asset.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ImagePlus className="absolute inset-0 m-auto text-genesis-muted" />}<span className="absolute bottom-2 left-2 rounded bg-black/75 px-2 py-1 text-[10px] font-bold uppercase text-white">{asset.mediaType === "image" ? "Imagem" : asset.mediaType === "gif" ? "GIF" : "MP4"}</span></div><div className="p-3"><p className="truncate text-sm font-semibold text-genesis-text">{asset.originalName}</p><p className="mt-1 text-xs text-genesis-muted">{asset.status} · {formatBytes(asset.byteSize)}</p><p className="mt-1 text-xs text-genesis-muted">{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "Metadados pendentes"}{asset.durationMs ? ` · ${(asset.durationMs / 1000).toFixed(1)} s` : ""}</p></div></article>)}</div> : <div className="rounded-lg border border-dashed border-genesis-border py-14 text-center"><p className="font-semibold text-genesis-text">Nenhum arquivo neste filtro</p><p className="mt-1 text-sm text-genesis-muted">Envie imagens, GIFs ou MP4 para montar as matérias.</p></div>}
      {media.data && media.data.items.length === 50 && <p className="mt-4 text-xs text-genesis-muted">Exibindo até 50 arquivos mais recentes. A paginação completa da biblioteca está pendente no contrato atual da API.</p>}
    </section>
    <FeedMediaPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} allowedTypes={["image", "gif", "video"]} selectable={false} onSelect={() => setPickerOpen(false)} />
  </div></AppShell>;
}

function formatBytes(value: number) { return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }
