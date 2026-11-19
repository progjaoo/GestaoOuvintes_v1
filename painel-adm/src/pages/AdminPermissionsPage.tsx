import { useMemo, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/Input";
import { api } from "@/services/api";
import { usePageTitle } from "@/hooks/usePageTitle";

export function AdminPermissionsPage() {
  usePageTitle("Catálogo de permissões");
  const [query, setQuery] = useState("");
  const permissions = useQuery({ queryKey: ["admin-permissions"], queryFn: api.listAdminPermissions, refetchOnWindowFocus: false });
  const items = useMemo(() => (permissions.data?.items ?? []).filter((item) => `${item.key} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [permissions.data, query]);
  return <AppShell><div className="space-y-6"><PageHeader eyebrow="Administração · Acesso" title="Catálogo de permissões" description="Consulta read-only das capacidades registradas e dos papéis que as concedem. A autorização final sempre é decidida pela API." />
    <label className="relative block"><span className="sr-only">Buscar permissão</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-genesis-muted" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar módulo, ação ou descrição" className="pl-10" /></label>
    <section className="overflow-hidden rounded-xl border border-genesis-border bg-genesis-surface shadow-sm">{permissions.isLoading ? <p role="status" className="p-10 text-center text-sm text-genesis-muted">Carregando catálogo…</p> : permissions.isError ? <p role="alert" className="p-5 text-sm text-genesis-error">Não foi possível carregar as permissões.</p> : <div className="divide-y divide-genesis-border">{items.map((item) => <article key={item.key} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:px-6"><div className="flex items-start gap-3"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-genesis-primary" /><div><code className="text-sm font-bold text-genesis-text">{item.key}</code><p className="mt-1 text-sm text-genesis-muted">{item.description}</p></div></div><div className="flex flex-wrap content-start gap-2">{item.role_grants.length ? item.role_grants.map((grant) => <span key={`${grant.roleId}:${grant.scopeType}`} className="rounded-full bg-genesis-bg px-2.5 py-1 text-xs text-genesis-text">{grant.roleName} · {grant.scopeType}{grant.departmentId ? ` · ${grant.departmentId}` : ""}</span>) : <span className="text-xs text-genesis-muted">Nenhum papel concede esta permissão.</span>}</div></article>)}</div>}</section>
  </div></AppShell>;
}
