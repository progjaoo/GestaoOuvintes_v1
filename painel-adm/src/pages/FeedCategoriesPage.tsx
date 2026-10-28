import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { api, ApiError } from "@/services/api";
import { usePageTitle } from "@/hooks/usePageTitle";
import type { EditorialCategory } from "@/types/feed";

export function FeedCategoriesPage() {
  usePageTitle("Categorias do Feed");
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ["feed-categories"], queryFn: api.listFeedCategories, refetchOnWindowFocus: false });
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      if (editingId) return api.updateFeedCategory(editingId, { name: name.trim(), slug: slugify(slug), active: true });
      return api.createFeedCategory({ name: name.trim(), slug: slugify(slug) });
    },
    onSuccess: async () => { toast.success(editingId ? "Categoria atualizada." : "Categoria criada."); reset(); await queryClient.invalidateQueries({ queryKey: ["feed-categories"] }); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : error.message || "Não foi possível salvar a categoria."),
  });
  const toggle = useMutation({
    mutationFn: (category: EditorialCategory) => api.updateFeedCategory(category.id, { active: !category.active }),
    onSuccess: async () => { toast.success("Status da categoria atualizado."); await queryClient.invalidateQueries({ queryKey: ["feed-categories"] }); },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Não foi possível atualizar a categoria."),
  });
  const reset = () => { setEditingId(""); setName(""); setSlug(""); setSlugTouched(false); };
  const beginEdit = (category: EditorialCategory) => { setEditingId(category.id); setName(category.name); setSlug(category.slug); setSlugTouched(true); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return <AppShell><div className="space-y-6">
    <PageHeader eyebrow="Conteúdo editorial · Feed" title="Categorias" description="Organize as histórias por tema. Categorias inativas continuam associadas ao histórico, mas não aparecem em novas matérias." actions={<Link to="/conteudo/feed"><Button variant="outline"><ArrowLeft size={16} /> Feed</Button></Link>} />
    <section className="rounded-xl border border-genesis-border bg-white p-4 shadow-sm sm:p-6">
      <h2 className="font-display text-xl font-bold text-genesis-text">{editingId ? "Editar categoria" : "Nova categoria"}</h2>
      <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
        <label className="text-sm font-semibold text-genesis-text">Nome<input required minLength={2} maxLength={80} value={name} onChange={(event) => { setName(event.target.value); if (!slugTouched) setSlug(slugify(event.target.value)); }} className={inputClass} placeholder="Ex.: Festa da Rádio" /></label>
        <label className="text-sm font-semibold text-genesis-text">Slug<input required minLength={2} maxLength={90} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={(event) => { setSlugTouched(true); setSlug(slugify(event.target.value)); }} className={`${inputClass} font-mono text-sm`} placeholder="festa-da-radio" /></label>
        <Button type="submit" disabled={save.isPending}>{editingId ? <Check size={16} /> : <Plus size={16} />}{save.isPending ? "Salvando…" : editingId ? "Salvar" : "Criar categoria"}</Button>
        {editingId && <Button variant="ghost" type="button" onClick={reset}><X size={16} /> Cancelar</Button>}
      </form>
    </section>
    <section className="overflow-hidden rounded-xl border border-genesis-border bg-white shadow-sm">
      <div className="border-b border-genesis-border px-4 py-4 sm:px-6"><h2 className="font-display text-lg font-bold text-genesis-text">Categorias cadastradas</h2></div>
      {categories.isLoading ? <p role="status" className="py-12 text-center text-sm text-genesis-muted">Carregando categorias…</p> : categories.isError ? <div role="alert" className="p-5 text-sm text-red-700">Não foi possível carregar as categorias.</div> : categories.data?.items.length ? <div className="divide-y divide-genesis-border">{categories.data.items.map((category) => <article key={category.id} className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center sm:px-6"><div><div className="flex items-center gap-2"><h3 className="font-semibold text-genesis-text">{category.name}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${category.active ? "bg-emerald-50 text-emerald-800" : "bg-neutral-100 text-neutral-500"}`}>{category.active ? "Ativa" : "Inativa"}</span></div><p className="mt-1 font-mono text-xs text-genesis-muted">/categoria/{category.slug}</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => beginEdit(category)}><Pencil size={14} /> Editar</Button><Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => { if (window.confirm(`${category.active ? "Desativar" : "Reativar"} a categoria “${category.name}”?`)) toggle.mutate(category); }}>{category.active ? "Desativar" : "Reativar"}</Button></div></article>)}</div> : <p className="p-8 text-center text-sm text-genesis-muted">Nenhuma categoria cadastrada.</p>}
    </section>
  </div></AppShell>;
}

const inputClass = "mt-1.5 block min-h-11 w-full rounded-md border border-genesis-border bg-white px-3 font-normal text-genesis-text outline-none focus:border-genesis-primary focus:ring-2 focus:ring-genesis-primary/15";
function slugify(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90); }
