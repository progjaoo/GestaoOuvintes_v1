import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, MailPlus, Search, ShieldCheck, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { api, ApiError } from "@/services/api";
import { hasPermission } from "@/services/permissions";
import type { ManagedAdminRole } from "@/types/api";

export function AdminUsersPage({ embedded = false }: { embedded?: boolean }) {
  usePageTitle("Usuários internos");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [reauthPassword, setReauthPassword] = useState("");
  const [error, setError] = useState("");

  const usersQuery = useQuery({ queryKey: ["admin-users", query, status], queryFn: () => api.listAdminUsers({ q: query, status, page: 1, pageSize: 50 }), refetchOnWindowFocus: false });
  const rolesQuery = useQuery({ queryKey: ["admin-roles"], queryFn: api.listAdminRoles, refetchOnWindowFocus: false });
  const canInvite = hasPermission(user, "user.create");
  const canViewAccess = hasPermission(user, "user.permissions.read");

  const invite = useMutation({
    mutationFn: async () => {
      await api.reauthenticate(reauthPassword);
      return api.createAdminUser({ name, email, phone: phone || null, roleIds });
    },
    onSuccess: async (result) => {
      toast.success(result.deliveryStatus === "sent" ? "Convite enviado." : "Usuário criado. O envio de convite está pendente de configuração do e-mail.");
      setInviteOpen(false); setName(""); setEmail(""); setPhone(""); setRoleIds([]); setReauthPassword(""); setError("");
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : "Não foi possível criar o acesso."),
  });

  const roles = useMemo(() => (rolesQuery.data?.items ?? []).filter((role) => user?.isSuperAdmin || role.key !== "admin"), [rolesQuery.data, user?.isSuperAdmin]);
  const toggleRole = (role: ManagedAdminRole) => setRoleIds((current) => current.includes(role.id) ? current.filter((id) => id !== role.id) : [...current, role.id]);
  const submitInvite = (event: FormEvent) => { event.preventDefault(); setError(""); invite.mutate(); };

  const content = <div className="space-y-5">
    {!embedded && <PageHeader eyebrow="Administração · Equipe" title="Usuários internos" description="Convide pessoas da equipe, acompanhe o status do acesso e atribua papéis permitidos pela sua autorização." actions={canInvite ? <Button onClick={() => setInviteOpen(true)}><MailPlus size={16} /> Convidar usuário</Button> : undefined} />}
    {embedded && <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-display text-lg font-bold text-genesis-text">Usuários</h2><p className="text-sm text-genesis-muted">Gerencie os usuários, papéis e status de acesso da equipe.</p></div>{canInvite && <Button onClick={() => setInviteOpen(true)}><MailPlus size={16} /> Novo usuário</Button>}</div>}
    <section className="rounded-xl border border-genesis-border bg-genesis-surface p-4 shadow-sm sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <label className="relative"><span className="sr-only">Buscar usuário</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-genesis-muted" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, usuário ou e-mail" className="pl-10" /></label>
        <select aria-label="Filtrar situação" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="min-h-10 rounded-md border border-genesis-border bg-genesis-surface px-3 text-sm text-genesis-text"><option value="all">Todos os acessos</option><option value="active">Ativos</option><option value="inactive">Convites pendentes/inativos</option></select>
      </div>
    </section>
    <section className="overflow-hidden rounded-xl border border-genesis-border bg-genesis-surface shadow-sm">
      <div className="border-b border-genesis-border px-4 py-4 sm:px-6"><h2 className="font-display text-lg font-bold text-genesis-text">Acessos da equipe</h2></div>
      {usersQuery.isLoading ? <p role="status" className="py-12 text-center text-sm text-genesis-muted">Carregando usuários…</p> : usersQuery.isError ? <p role="alert" className="p-5 text-sm text-genesis-error">Não foi possível carregar usuários. Confira sua permissão e tente novamente.</p> : usersQuery.data?.items.length ? <div className="divide-y divide-genesis-border">
        {usersQuery.data.items.map((item) => <article key={item.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent text-genesis-primary">{item.is_super_admin ? <ShieldCheck size={19} /> : <UserRoundCog size={19} />}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-genesis-text">{item.name}</h3>{item.is_super_admin && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase text-genesis-primary">Super Admin</span>}<span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${item.active ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{item.active ? "Ativo" : item.must_change_password && !item.email_verified_at ? "Convite pendente" : "Inativo"}</span></div><p className="mt-1 truncate text-sm text-genesis-muted">{item.email ?? item.username} · {item.roles.map((role) => role.name).join(", ") || item.role}</p></div></div>
          {canViewAccess && <Link to={`/administracao/acessos/usuarios/${item.id}`}><Button variant="outline" size="sm">Ver acesso</Button></Link>}
        </article>)}
      </div> : <p className="p-10 text-center text-sm text-genesis-muted">Nenhum usuário encontrado.</p>}
    </section>
    <Dialog open={inviteOpen} onOpenChange={(open) => { setInviteOpen(open); if (!open) setError(""); }} title="Convidar usuário" description="O acesso só será ativado após a pessoa confirmar o e-mail e definir a própria senha." footer={<><Button variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button><Button type="submit" form="invite-admin-form" disabled={invite.isPending || roleIds.length === 0}>{invite.isPending && <LoaderCircle size={16} className="animate-spin" />} Enviar convite</Button></>}>
      <form id="invite-admin-form" onSubmit={submitInvite} className="space-y-4">
        <Field label="Nome" htmlFor="adminName"><Input id="adminName" required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="E-mail corporativo" htmlFor="adminEmail"><Input id="adminEmail" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Telefone (opcional)" htmlFor="adminPhone" hint="Formato internacional, por exemplo +5524999999999."><Input id="adminPhone" inputMode="tel" pattern="\+[1-9][0-9]{7,14}" value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
        <fieldset className="space-y-2"><legend className="text-sm font-semibold text-genesis-text">Papéis</legend>{rolesQuery.isLoading ? <p className="text-sm text-genesis-muted">Carregando papéis…</p> : roles.map((role) => <label key={role.id} className="flex items-start gap-3 rounded-md border border-genesis-border p-3"><input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => toggleRole(role)} className="mt-1 accent-indigo-600" /><span><span className="block text-sm font-semibold text-genesis-text">{role.name}</span><span className="text-xs text-genesis-muted">{role.description || "Sem descrição"}</span></span></label>)}</fieldset>
        <Field label="Confirme sua senha" htmlFor="reauthPassword" hint="Necessária para confirmar esta alteração administrativa."><Input id="reauthPassword" type="password" autoComplete="current-password" required value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} /></Field>
        {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm font-semibold text-genesis-error">{error}</p>}
      </form>
    </Dialog>
  </div>;
  return embedded ? content : <AppShell>{content}</AppShell>;
}
