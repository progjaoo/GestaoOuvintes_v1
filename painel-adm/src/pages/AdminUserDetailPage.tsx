import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { api, ApiError } from "@/services/api";
import { hasPermission } from "@/services/permissions";
import type { AdminAccessScope, ManagedAdminUser } from "@/types/api";

export function AdminUserDetailPage({ embedded = false }: { embedded?: boolean }) {
  const { userId = "" } = useParams();
  const { user: actor } = useAuth();
  const details = useQuery({ queryKey: ["admin-user", userId], queryFn: () => api.getAdminUser(userId), enabled: Boolean(userId), refetchOnWindowFocus: false });
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: api.listAdminRoles, refetchOnWindowFocus: false });
  usePageTitle(details.data?.user.name ?? "Usuário interno");

  if (details.isLoading || roles.isLoading) {
    const loading = <p role="status" className="py-16 text-center text-genesis-muted">Carregando acesso…</p>;
    return embedded ? loading : <AppShell>{loading}</AppShell>;
  }
  if (details.isError || roles.isError || !details.data?.user) {
    const failure = <div role="alert" className="rounded-xl border border-genesis-border bg-genesis-surface p-6"><p className="font-semibold text-genesis-error">Não foi possível carregar este usuário.</p><Link to="/administracao/acessos/usuarios" className="mt-4 inline-block text-sm font-semibold text-genesis-primary">Voltar à equipe</Link></div>;
    return embedded ? failure : <AppShell>{failure}</AppShell>;
  }
  return <AdminUserDetailEditor key={`${details.data.user.id}:${details.data.user.version}`} item={details.data.user} roles={(roles.data?.items ?? []).filter((role) => actor?.isSuperAdmin || role.key !== "admin")} embedded={embedded} />;
}

function AdminUserDetailEditor({ item, roles, embedded }: { item: ManagedAdminUser; roles: Array<{ id: string; key: string; name: string; description: string | null }>; embedded: boolean }) {
  const { user: actor } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(item.name);
  const [email, setEmail] = useState(item.email ?? "");
  const [phone, setPhone] = useState(item.phone ?? "");
  const [active, setActive] = useState(item.active);
  const [roleIds, setRoleIds] = useState(item.roles.map((role) => role.id));
  const [reauthPassword, setReauthPassword] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [permissionKey, setPermissionKey] = useState("");
  const [effect, setEffect] = useState<"ALLOW" | "DENY">("DENY");
  const [scopeType, setScopeType] = useState<AdminAccessScope>("global");
  const [overrideReason, setOverrideReason] = useState("");
  const [draftOverrides, setDraftOverrides] = useState<Array<{ permissionKey: string; effect: "ALLOW" | "DENY"; scopeType?: AdminAccessScope; reason: string }>>((item.overrides ?? []).map((override) => ({ permissionKey: override.permission_key, effect: override.effect, ...(override.scope_type ? { scopeType: override.scope_type } : {}), reason: override.reason })));
  const [error, setError] = useState("");
  const canEdit = hasPermission(actor, "user.update") && !item.is_super_admin;
  const canDeactivate = hasPermission(actor, "user.deactivate") && !item.is_super_admin;
  const canManageOverrides = hasPermission(actor, "user.permissions.manage") && Boolean(actor?.isSuperAdmin) && !item.is_super_admin;
  const effectivePermissions = useMemo(() => item.effectivePermissions ?? [], [item.effectivePermissions]);
  const reauth = async () => api.reauthenticate(reauthPassword);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-user", item.id] });

  const saveProfile = useMutation({ mutationFn: async () => {
    await reauth();
    const initialRoleIds = item.roles.map((role) => role.id);
    const rolesChanged = roleIds.length !== initialRoleIds.length || roleIds.some((id) => !initialRoleIds.includes(id));
    return api.updateAdminUser(item.id, {
      ...(name !== item.name ? { name } : {}),
      ...(email.trim() && email.trim() !== (item.email ?? "") ? { email: email.trim() } : {}),
      ...(phone !== (item.phone ?? "") ? { phone: phone || null } : {}),
      ...(active !== item.active ? { active } : {}),
      ...(rolesChanged ? { roleIds } : {}),
      version: item.version,
    });
  }, onSuccess: async (result) => { toast.success(result.emailDeliveryStatus === "sent" ? "Acesso atualizado. Enviamos um link para confirmar o novo e-mail." : "Acesso atualizado."); setReauthPassword(""); setError(""); await refresh(); await queryClient.invalidateQueries({ queryKey: ["admin-users"] }); }, onError: (cause) => setError(cause instanceof ApiError ? [cause.message, ...(cause.fields ?? []).map((field) => `${field.path}: ${field.message}`)].join(" · ") : "Não foi possível atualizar o acesso.") });
  const sendReset = useMutation({ mutationFn: async () => { await reauth(); return api.requestAdminPasswordReset(item.id, resetReason); }, onSuccess: (result) => { toast.success(result.deliveryStatus === "sent" ? "Link de redefinição enviado." : "Solicitação registrada; o envio de e-mail ainda não está disponível."); setResetReason(""); setReauthPassword(""); }, onError: (cause) => setError(cause instanceof ApiError ? cause.message : "Não foi possível solicitar a redefinição.") });
  const resendInvite = useMutation({ mutationFn: async () => { await reauth(); return api.resendAdminInvitation(item.id); }, onSuccess: (result) => { toast.success(result.deliveryStatus === "sent" ? "Convite reenviado." : "Convite pendente; configure o envio de e-mail para entregá-lo."); setReauthPassword(""); }, onError: (cause) => setError(cause instanceof ApiError ? cause.message : "Não foi possível reenviar o convite.") });
  const saveOverrides = useMutation({ mutationFn: async () => { await reauth(); return api.updateAdminOverrides(item.id, draftOverrides); }, onSuccess: async () => { toast.success("Exceções atualizadas; sessões anteriores revogadas."); setReauthPassword(""); await refresh(); }, onError: (cause) => setError(cause instanceof ApiError ? cause.message : "Não foi possível atualizar as exceções.") });
  const revokeSession = useMutation({ mutationFn: async (sessionId: string) => { await reauth(); return api.revokeAdminSession(item.id, sessionId); }, onSuccess: async () => { toast.success("Sessão revogada."); setReauthPassword(""); await refresh(); }, onError: (cause) => setError(cause instanceof ApiError ? cause.message : "Não foi possível revogar a sessão.") });

  const content = <div className="space-y-6">
    <PageHeader eyebrow="Administração · Equipe" title={item.name} description={`${item.email ?? item.username} · ${item.is_super_admin ? "Super Admin protegido" : item.active ? "Acesso ativo" : "Acesso inativo ou convite pendente"}`} actions={<Link to="/administracao/acessos/usuarios"><Button variant="outline"><ArrowLeft size={16} /> Usuários</Button></Link>} />
    {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-genesis-error">{error}</p>}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
      <section className="rounded-xl border border-genesis-border bg-genesis-surface p-5 shadow-sm sm:p-6">
        <h2 className="font-display text-xl font-bold text-genesis-text">Identidade e acesso</h2>
        <form onSubmit={(event) => { event.preventDefault(); saveProfile.mutate(); }} className="mt-5 space-y-4">
          <Field label="Nome" htmlFor="name"><Input id="name" value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit} required minLength={2} /></Field>
          <Field label="E-mail" htmlFor="email" hint={item.email_verified_at ? `Confirmado em ${new Date(item.email_verified_at).toLocaleString("pt-BR")}` : "Ainda não confirmado. A mudança de e-mail exige confirmação no link enviado."}><Input id="email" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} disabled={!canEdit} /></Field>
          <Field label="Telefone" htmlFor="phone"><Input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={!canEdit} placeholder="+5524999999999" /></Field>
          <fieldset className="space-y-2"><legend className="text-sm font-semibold text-genesis-text">Papéis</legend>{roles.map((role) => <label key={role.id} className="flex items-start gap-3 rounded-md border border-genesis-border p-3"><input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => setRoleIds((current) => current.includes(role.id) ? current.filter((id) => id !== role.id) : [...current, role.id])} disabled={!canEdit} className="mt-1 accent-indigo-600" /><span><span className="block text-sm font-semibold text-genesis-text">{role.name}</span><span className="text-xs text-genesis-muted">{role.description ?? ""}</span></span></label>)}</fieldset>
          {canDeactivate && <label className="flex items-center gap-3 rounded-md border border-genesis-border p-3 text-sm font-semibold text-genesis-text"><input type="checkbox" checked={active} disabled={item.must_change_password && !item.email_verified_at} onChange={(event) => setActive(event.target.checked)} className="accent-indigo-600" /> Acesso ativo{item.must_change_password && !item.email_verified_at && <span className="text-xs font-normal text-genesis-muted">Concluir convite para ativar</span>}</label>}
          {(canEdit || canDeactivate) && <><Field label="Confirme sua senha" htmlFor="reauth" hint="Mudanças de acesso revogam as sessões existentes."><Input id="reauth" type="password" autoComplete="current-password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} required /></Field><Button type="submit" disabled={saveProfile.isPending || !reauthPassword}>{saveProfile.isPending && <LoaderCircle size={16} className="animate-spin" />} Salvar alterações</Button></>}
        </form>
        {item.is_super_admin && <p className="mt-4 rounded-md bg-accent p-3 text-sm text-indigo-900">A conta Super Admin é protegida: não pode ser editada, desativada ou ter papéis/overrides alterados nesta tela.</p>}
        {!item.active && item.email && !item.email_verified_at && hasPermission(actor, "user.create") && <Button className="mt-4" variant="outline" disabled={resendInvite.isPending || !reauthPassword} onClick={() => resendInvite.mutate()}>Reenviar convite</Button>}
      </section>
      <div className="space-y-6">
        <section className="rounded-xl border border-genesis-border bg-genesis-surface p-5 shadow-sm sm:p-6"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-genesis-primary" /><h2 className="font-display text-xl font-bold text-genesis-text">Acesso efetivo</h2></div><p className="mt-1 text-sm text-genesis-muted">Permissões e escopos aplicados pelo backend.</p><ul className="mt-4 max-h-72 space-y-2 overflow-auto">{effectivePermissions.length ? effectivePermissions.map((permission) => <li key={`${permission.permission_key}:${permission.scope_type}:${permission.department_id}`} className="rounded-md bg-genesis-bg px-3 py-2 font-mono text-xs text-genesis-text">{permission.permission_key} · {permission.scope_type}{permission.department_id ? ` (${permission.department_id})` : ""}</li>) : <li className="text-sm text-genesis-muted">Sem permissões efetivas.</li>}</ul></section>
        {canManageOverrides && <section className="rounded-xl border border-genesis-border bg-genesis-surface p-5 shadow-sm sm:p-6"><h2 className="font-display text-xl font-bold text-genesis-text">Exceções individuais</h2><p className="mt-1 text-sm text-genesis-muted">DENY prevalece. ALLOW é reservado ao Super Admin e exige escopo explícito.</p><div className="mt-4 space-y-3"><Field label="Chave da permissão" htmlFor="overridePermission"><Input id="overridePermission" value={permissionKey} onChange={(event) => setPermissionKey(event.target.value)} placeholder="ex.: feed.publish" /></Field><div className="grid grid-cols-2 gap-2"><select aria-label="Efeito" value={effect} onChange={(event) => setEffect(event.target.value as typeof effect)} className="min-h-10 rounded-md border border-genesis-border px-3 text-sm"><option value="DENY">Negar</option><option value="ALLOW">Permitir</option></select>{effect === "ALLOW" && <select aria-label="Escopo" value={scopeType} onChange={(event) => setScopeType(event.target.value as AdminAccessScope)} className="min-h-10 rounded-md border border-genesis-border px-3 text-sm"><option value="global">Global</option><option value="own">Próprio</option><option value="participation">Participação</option><option value="department">Departamento</option></select>}</div><Field label="Motivo auditável" htmlFor="overrideReason"><Input id="overrideReason" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} minLength={5} placeholder="Motivo da exceção" /></Field><Button variant="outline" onClick={() => { if (!permissionKey.trim() || overrideReason.trim().length < 5) return; setDraftOverrides((current) => [...current.filter((entry) => entry.permissionKey !== permissionKey.trim()), { permissionKey: permissionKey.trim(), effect, ...(effect === "ALLOW" ? { scopeType } : {}), reason: overrideReason.trim() }]); setPermissionKey(""); setOverrideReason(""); }}>Adicionar exceção</Button></div><ul className="mt-4 space-y-2">{draftOverrides.map((entry) => <li key={entry.permissionKey} className="flex items-center justify-between gap-3 rounded-md border border-genesis-border p-3 text-sm"><span><strong>{entry.effect}</strong> · <code>{entry.permissionKey}</code> {entry.scopeType && `· ${entry.scopeType}`}</span><button type="button" className="font-semibold text-genesis-error" onClick={() => setDraftOverrides((current) => current.filter((draft) => draft.permissionKey !== entry.permissionKey))}>Remover</button></li>)}</ul><Field className="mt-4" label="Confirme sua senha" htmlFor="overridePassword"><Input id="overridePassword" type="password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} /></Field><Button className="mt-3" disabled={saveOverrides.isPending || !reauthPassword} onClick={() => saveOverrides.mutate()}>Salvar exceções</Button></section>}
      </div>
    </div>
    {hasPermission(actor, "user.password.reset") && !item.is_super_admin && <section className="rounded-xl border border-genesis-border bg-genesis-surface p-5 shadow-sm sm:p-6"><h2 className="font-display text-xl font-bold text-genesis-text">Redefinir senha</h2><p className="mt-1 text-sm text-genesis-muted">Envia um link de uso único para o e-mail confirmado. A senha nunca é exibida nem definida diretamente pelo administrador.</p><div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"><Field label="Motivo (auditado)" htmlFor="resetReason"><Input id="resetReason" value={resetReason} onChange={(event) => setResetReason(event.target.value)} minLength={5} /></Field><Field label="Confirme sua senha" htmlFor="resetReauth"><Input id="resetReauth" type="password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} /></Field><Button variant="outline" disabled={sendReset.isPending || resetReason.trim().length < 5 || !reauthPassword} onClick={() => sendReset.mutate()}>Enviar link de reset</Button></div></section>}
    <section className="rounded-xl border border-genesis-border bg-genesis-surface p-5 shadow-sm sm:p-6"><h2 className="font-display text-xl font-bold text-genesis-text">Sessões recentes</h2><div className="mt-4 divide-y divide-genesis-border">{(item.sessions ?? []).map((session) => <div key={session.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-sm"><p className="font-semibold text-genesis-text">Criada {new Date(session.created_at).toLocaleString("pt-BR")}</p><p className="text-xs text-genesis-muted">Expira {new Date(session.expires_at).toLocaleString("pt-BR")} {session.revoked_at ? `· Revogada (${session.revoke_reason})` : "· Ativa"}</p></div>{!session.revoked_at && hasPermission(actor, "user.session.revoke") && <Button size="sm" variant="outline" disabled={revokeSession.isPending || !reauthPassword} onClick={() => revokeSession.mutate(session.id)}>Revogar sessão</Button>}</div>)}{!item.sessions?.length && <p className="text-sm text-genesis-muted">Nenhuma sessão registrada.</p>}</div></section>
    {item.email && !item.email_verified_at && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">E-mail ainda não confirmado; a recuperação por link não ficará disponível até a confirmação.</p>}
  </div>;
  return embedded ? content : <AppShell>{content}</AppShell>;
}
