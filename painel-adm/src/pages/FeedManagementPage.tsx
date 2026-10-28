import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BookOpen, CirclePlus, ExternalLink, Image, Pencil, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { api, ApiError } from "@/services/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { EditorialPost } from "@/types/feed";

export function FeedManagementPage() {
  usePageTitle("Conteúdo do Feed");
  const queryClient = useQueryClient();
  const [query, setQuery] = useState<{ q: string; status: "all" | "draft" | "published" | "archived"; categoryId: string }>({ q: "", status: "all", categoryId: "" });
  const [applied, setApplied] = useState(query);
  const [page, setPage] = useState(1);
  const categories = useQuery({ queryKey: ["feed-categories"], queryFn: api.listFeedCategories, refetchOnWindowFocus: false });
  const posts = useQuery({
    queryKey: ["feed-posts", applied, page],
    queryFn: () => api.listFeedPosts({ page, pageSize: 20, status: applied.status, q: applied.q || undefined, categoryId: applied.categoryId || undefined }),
    refetchOnWindowFocus: false,
  });
  const publish = useMutation({
    mutationFn: ({ postId, revisionId }: { postId: string; revisionId: string }) => api.publishFeedPost(postId, revisionId),
    onSuccess: async ({ releaseId, status }) => {
      toast.success(`Publicação enviada para o site. Situação da release: ${releaseLabel(status)}.`);
      await queryClient.invalidateQueries({ queryKey: ["feed-posts"] });
      window.dispatchEvent(new CustomEvent("radio88-feed-release", { detail: { releaseId } }));
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Não foi possível iniciar a publicação."),
  });
  const archive = useMutation({
    mutationFn: ({ postId, revisionId }: { postId: string; revisionId: string }) => api.archiveFeedPost(postId, revisionId),
    onSuccess: async ({ releaseId }) => {
      toast.success("Retirada solicitada. A matéria continua no ar até o novo deploy ser confirmado.");
      window.dispatchEvent(new CustomEvent("radio88-feed-release", { detail: { releaseId } }));
      await queryClient.invalidateQueries({ queryKey: ["feed-posts"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Não foi possível retirar a publicação."),
  });

  const pages = Math.max(1, Math.ceil((posts.data?.total ?? 0) / 20));

  return <AppShell>
    <div className="space-y-6">
      <PageHeader eyebrow="Editorial · Rádio 88 FM" title="Feed" description="Crie matérias visuais com texto e mídia. Rascunhos ficam privados; a publicação só é concluída depois que o site confirma o deploy." actions={<div className="flex flex-wrap gap-2"><Link to="/conteudo/feed/midias"><Button variant="outline"><Image size={16} /> Biblioteca</Button></Link><Link to="/conteudo/feed/categorias"><Button variant="outline">Categorias</Button></Link><Link to="/conteudo/feed/novo"><Button><CirclePlus size={16} /> Nova matéria</Button></Link></div>} />

      <section className="overflow-hidden rounded-xl border border-genesis-border bg-white shadow-sm">
        <div className="grid gap-3 border-b border-genesis-border bg-neutral-50/70 p-4 md:grid-cols-[minmax(15rem,1fr)_12rem_15rem_auto_auto] md:items-end">
          <label className="text-xs font-bold uppercase tracking-wide text-genesis-muted">Buscar matéria
            <input value={query.q} onChange={(event) => setQuery({ ...query, q: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setApplied(query); setPage(1); } }} placeholder="Título ou slug" className="mt-1.5 block h-10 w-full rounded-md border border-genesis-border bg-white px-3 text-sm font-normal normal-case tracking-normal text-genesis-text" />
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-genesis-muted">Status
            <select value={query.status} onChange={(event) => setQuery({ ...query, status: event.target.value as typeof query.status })} className="mt-1.5 block h-10 w-full rounded-md border border-genesis-border bg-white px-3 text-sm font-normal normal-case tracking-normal text-genesis-text"><option value="all">Todos</option><option value="draft">Rascunhos</option><option value="published">Publicadas</option><option value="archived">Arquivadas</option></select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wide text-genesis-muted">Categoria
            <select value={query.categoryId} onChange={(event) => setQuery({ ...query, categoryId: event.target.value })} className="mt-1.5 block h-10 w-full rounded-md border border-genesis-border bg-white px-3 text-sm font-normal normal-case tracking-normal text-genesis-text"><option value="">Todas</option>{categories.data?.items.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          </label>
          <Button variant="outline" onClick={() => { setApplied(query); setPage(1); }}>Filtrar</Button>
          <Button variant="ghost" onClick={() => { const cleared = { q: "", status: "all" as const, categoryId: "" }; setQuery(cleared); setApplied(cleared); setPage(1); }}><RefreshCw size={15} /> Limpar</Button>
        </div>

        {posts.isLoading ? <p role="status" className="py-16 text-center text-sm text-genesis-muted">Carregando matérias…</p> : posts.isError ? <div role="alert" className="m-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Não foi possível consultar o Feed. Verifique se a API e a migration editorial estão ativas.</div> : posts.data?.items.length ? <>
          <div className="divide-y divide-genesis-border">
            {posts.data.items.map((post) => <PostRow key={post.id} post={post} onPublish={() => publish.mutate({ postId: post.id, revisionId: post.draftRevision?.id ?? "" })} onArchive={() => archive.mutate({ postId: post.id, revisionId: post.publishedRevision?.id ?? "" })} busy={publish.isPending || archive.isPending} />)}
          </div>
          <div className="flex items-center justify-between border-t border-genesis-border px-4 py-3 text-sm text-genesis-muted"><span>{posts.data.total} matéria(s) · página {page} de {pages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Próxima</Button></div></div>
        </> : <div className="px-5 py-16 text-center"><BookOpen className="mx-auto text-genesis-primary" size={28} /><h2 className="mt-3 font-display text-xl font-bold text-genesis-text">Nenhuma matéria neste filtro</h2><p className="mt-1 text-sm text-genesis-muted">Comece registrando uma história, festa ou ação da Rádio 88 FM.</p><Link to="/conteudo/feed/novo" className="mt-5 inline-block"><Button><CirclePlus size={16} /> Criar matéria</Button></Link></div>}
      </section>
    </div>
  </AppShell>;
}

function PostRow({ post, onPublish, onArchive, busy }: { post: EditorialPost; onPublish: () => void; onArchive: () => void; busy: boolean }) {
  const title = post.draftRevision?.title ?? post.publishedRevision?.title ?? post.slug;
  const revision = post.draftRevision ?? post.publishedRevision;
  const canPublish = post.status !== "archived" && Boolean(post.draftRevision?.id);
  const canArchive = post.status === "published" && Boolean(post.publishedRevision?.id);
  return <article className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${post.status === "published" ? "bg-emerald-50 text-emerald-800" : post.status === "archived" ? "bg-neutral-100 text-neutral-600" : "bg-amber-50 text-amber-800"}`}>{post.status === "published" ? "Publicada" : post.status === "archived" ? "Arquivada" : "Rascunho"}</span>{post.category?.name && <span className="text-xs font-semibold text-genesis-muted">{post.category.name}</span>}</div><h2 className="mt-2 truncate font-display text-lg font-bold text-genesis-text">{title}</h2><p className="mt-1 truncate font-mono text-xs text-genesis-muted">/feed/{post.slug} · atualizado {new Date(post.updatedAt).toLocaleString("pt-BR")}</p></div>
    <div className="flex flex-wrap gap-2"><Link to={`/conteudo/feed/${post.id}/editar`}><Button variant="outline" size="sm"><Pencil size={14} /> Editar</Button></Link>{canPublish && <Button size="sm" disabled={busy} onClick={() => { if (revision?.id && window.confirm(`Solicitar publicação de “${title}”?`)) onPublish(); }}><Send size={14} /> Publicar</Button>}{canArchive && <Button variant="outline" size="sm" disabled={busy} onClick={() => { if (post.publishedRevision?.id && window.confirm(`Solicitar retirada de “${title}”? A versão pública atual seguirá no ar até o deploy.`)) onArchive(); }}><Archive size={14} /> Retirar</Button>}{post.status === "published" && <a href={`/feed/${post.slug}`} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-genesis-muted hover:bg-neutral-100"><ExternalLink size={14} /> Ver</a>}</div>
  </article>;
}

function releaseLabel(value: string) {
  return value === "awaiting_confirmation" ? "aguardando confirmação no site" : value === "live" ? "publicada" : value;
}
