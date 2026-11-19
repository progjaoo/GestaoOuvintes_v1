import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Pencil, Plus, Shield } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { api, ApiError } from "@/services/api";
import { hasPermission } from "@/services/permissions";
import type { AdminAccessScope, AdminPermissionCatalogItem, ManagedAdminRole } from "@/types/api";

type GrantDraft = { permissionKey: string; scopeType: AdminAccessScope };
const emptyRoles: ManagedAdminRole[] = [];

const protectedRoleKeys = new Set(["admin", "viewer", "campaign_manager", "receptionist", "announcer", "auditor"]);
const protectedPermissionKeys = new Set([
  "user.manage", "user.permissions.manage", "role.manage", "user.deactivate",
  "user.password.reset", "user.session.revoke", "role.create", "role.update",
]);
const groupLabels: Record<string, string> = {
  admin: "Administração",
  listener: "Ouvintes",
  registration: "Cadastros",
  campaign: "Campanhas",
  sweepstake: "Sorteios",
  institutional_banner: "Banners institucionais",
  program: "Programas",
  schedule: "Grade semanal",
  feed: "Conteúdo do Feed",
  media: "Biblioteca de mídia",
  public_config: "Configuração pública",
  user: "Usuários e acessos",
  role: "Papéis",
  permission: "Permissões",
  board: "Quadros",
  task: "Tarefas",
  comment: "Comentários",
  checklist: "Checklist",
  attachment: "Anexos",
  notification: "Notificações",
};

export function AdminRolesPage({ embedded = false }: { embedded?: boolean }) {
  usePageTitle("Papéis e permissões");
  const { user } = useAuth();
  const client = useQueryClient();
  const rolesQuery = useQuery({ queryKey: ["admin-roles"], queryFn: api.listAdminRoles, refetchOnWindowFocus: false });
  const permissionsQuery = useQuery({ queryKey: ["admin-permissions"], queryFn: api.listAdminPermissions, refetchOnWindowFocus: false });
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [editing, setEditing] = useState<ManagedAdminRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [grants, setGrants] = useState<GrantDraft[]>([]);
  const [permissionQuery, setPermissionQuery] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [error, setError] = useState("");
  const canCreate = hasPermission(user, "role.create");
  const canUpdate = hasPermission(user, "role.update");
  const isSuperAdmin = Boolean(user?.isSuperAdmin);
  const catalog = useMemo(() => permissionsQuery.data?.items ?? [], [permissionsQuery.data]);
  const roles = rolesQuery.data?.items ?? emptyRoles;
  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? roles[0] ?? null;
  const activeGrants = creating || editing
    ? grants
    : (selectedRole?.grants ?? []).map(({ permissionKey, scopeType }) => ({ permissionKey, scopeType }));
  const editableRole = Boolean(editing && canUpdate && !protectedRoleKeys.has(editing.key));
  const canEditForm = creating ? canCreate : editableRole;
  const visibleCatalog = useMemo(
    () => catalog.filter((permission) => `${permission.key} ${permission.description}`.toLowerCase().includes(permissionQuery.toLowerCase())),
    [catalog, permissionQuery],
  );
  const groupedCatalog = useMemo(() => visibleCatalog.reduce<Record<string, AdminPermissionCatalogItem[]>>((groups, permission) => {
    const groupKey = permission.key.split(".")[0] ?? "outros";
    (groups[groupKey] ??= []).push(permission);
    return groups;
  }, {}), [visibleCatalog]);

  const resetForm = () => {
    setSelectedRoleId(""); setEditing(null); setCreating(false); setKey(""); setName("");
    setDescription(""); setGrants([]); setReauthPassword(""); setError("");
  };
  const beginCreate = () => {
    setSelectedRoleId(""); setEditing(null); setCreating(true); setKey(""); setName("");
    setDescription(""); setGrants([]); setReauthPassword(""); setError("");
  };
  const selectRole = (role: ManagedAdminRole) => {
    setSelectedRoleId(role.id); setEditing(role); setCreating(false); setKey(role.key); setName(role.name);
    setDescription(role.description ?? "");
    setGrants(role.grants.map(({ permissionKey, scopeType }) => ({ permissionKey, scopeType })));
    setReauthPassword(""); setError("");
  };

  const save = useMutation({
    mutationFn: async () => {
      await api.reauthenticate(reauthPassword);
      if (editing) return api.updateAdminRole(editing.id, { name, description: description || null, version: editing.version, grants });
      return api.createAdminRole({ key, name, description: description || null, grants });
    },
    onSuccess: async (result) => {
      toast.success(editing ? "Papel atualizado. As sessões dos usuários foram revogadas." : "Papel criado.");
      setCreating(false); setSelectedRoleId(result.id); setEditing(result); setKey(result.key);
      setName(result.name); setDescription(result.description ?? "");
      setGrants(result.grants.map(({ permissionKey, scopeType }) => ({ permissionKey, scopeType })));
      setReauthPassword(""); setError("");
      await client.invalidateQueries({ queryKey: ["admin-roles"] });
      await client.invalidateQueries({ queryKey: ["admin-permissions"] });
      await client.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : "Não foi possível salvar o papel."),
  });

  const toggleGrant = (permission: AdminPermissionCatalogItem) => setGrants((current) => {
    if (current.some((grant) => grant.permissionKey === permission.key)) {
      return current.filter((grant) => grant.permissionKey !== permission.key);
    }
    return [...current, { permissionKey: permission.key, scopeType: "global" }];
  });
  const setScope = (permissionKey: string, scopeType: AdminAccessScope) => setGrants((current) => current.map((grant) => grant.permissionKey === permissionKey ? { ...grant, scopeType } : grant));

  const content = <div className="space-y-5">
    {!embedded && <PageHeader eyebrow="Administração · Acesso" title="Papéis" description="Papéis agrupam permissões por módulo e escopo. A API valida novamente cada alteração." />}
    <div className="grid gap-4 lg:grid-cols-[minmax(230px,0.32fr)_minmax(0,1fr)]">
      <section className="h-fit rounded-xl border border-genesis-border bg-genesis-surface p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="font-display text-lg font-bold text-genesis-text">Papéis</h2><p className="mt-1 text-sm text-genesis-muted">Selecione um papel para conferir ou editar.</p></div>
          {canCreate && <Button size="icon" aria-label="Criar papel" title="Criar papel" onClick={beginCreate}><Plus size={18} /></Button>}
        </div>
        {rolesQuery.isLoading ? <p role="status" className="py-8 text-center text-sm text-genesis-muted">Carregando papéis…</p>
          : rolesQuery.isError ? <p role="alert" className="py-5 text-sm text-genesis-error">Não foi possível carregar papéis.</p>
            : <div className="mt-4 space-y-2">{roles.map((role) => {
              const active = selectedRole?.id === role.id && !creating;
              return <button key={role.id} type="button" aria-pressed={active} onClick={() => selectRole(role)} className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-genesis-primary ${active ? "border-genesis-primary bg-accent/70" : "border-genesis-border hover:bg-genesis-bg"}`}>
                <span className="flex items-center justify-between gap-2"><span className="font-semibold text-genesis-text">{role.name}</span><span className="rounded-full border border-genesis-border bg-genesis-surface px-2 py-0.5 text-xs text-genesis-muted">{role.grants.length}</span></span>
                <code className="mt-1 block text-[11px] text-genesis-muted">{role.key}</code>
                <span className="mt-1 block text-xs leading-5 text-genesis-muted">{role.description || `${role.user_count} usuário(s) · ${role.grants.length} permissão(ões)`}</span>
              </button>;
            })}</div>}
      </section>

      <section className="min-w-0 rounded-xl border border-genesis-border bg-genesis-surface p-4 shadow-sm sm:p-5">
        {!creating && !selectedRole ? <div className="grid min-h-52 place-items-center text-center"><div><Shield className="mx-auto h-8 w-8 text-genesis-muted" /><p className="mt-3 font-semibold text-genesis-text">Selecione um papel</p><p className="mt-1 text-sm text-genesis-muted">As permissões disponíveis serão exibidas aqui.</p></div></div>
          : <>
            <div className="flex flex-col gap-3 border-b border-genesis-border pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div><h2 className="font-display text-lg font-bold text-genesis-text">{creating ? "Novo papel" : `Permissões · ${selectedRole?.name}`}</h2><p className="mt-1 text-sm text-genesis-muted">Marque as ações permitidas e defina o escopo de cada concessão.</p></div>
              {canEditForm && <div className="flex gap-2"><Button variant="outline" size="sm" onClick={resetForm}>Cancelar</Button><Button size="sm" form="role-form" type="submit" disabled={save.isPending || !reauthPassword}>{save.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />} Salvar</Button></div>}
              {!canEditForm && selectedRole && canUpdate && !protectedRoleKeys.has(selectedRole.key) && <Button size="sm" variant="outline" onClick={() => selectRole(selectedRole)}><Pencil size={14} /> Editar</Button>}
            </div>
            {(creating || editableRole) && <form id="role-form" onSubmit={(event: FormEvent) => { event.preventDefault(); setError(""); save.mutate(); }} className="grid gap-3 border-b border-genesis-border py-4 md:grid-cols-2">
              <Field label="Chave" htmlFor="roleKey" hint="Identificador estável; não pode ser alterado depois de criado."><Input id="roleKey" value={key} onChange={(event) => setKey(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))} pattern="[a-z][a-z0-9_-]{2,79}" required disabled={!creating} /></Field>
              <Field label="Nome" htmlFor="roleName"><Input id="roleName" value={name} onChange={(event) => setName(event.target.value)} minLength={2} required disabled={!canEditForm} /></Field>
              <Field className="md:col-span-2" label="Descrição" htmlFor="roleDescription"><Input id="roleDescription" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} disabled={!canEditForm} /></Field>
            </form>}
            {!creating && selectedRole && protectedRoleKeys.has(selectedRole.key) && <p className="mt-4 rounded-md bg-genesis-bg p-3 text-sm text-genesis-muted">Este é um papel protegido do sistema e não pode ser alterado por esta tela.</p>}
            <div className="mt-4">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-sm font-bold text-genesis-text">Permissões por módulo</h3><p className="text-xs text-genesis-muted">Acesso à tela não concede automaticamente ações como editar, exportar ou publicar.</p></div><Input aria-label="Filtrar permissões" className="sm:max-w-xs" placeholder="Buscar permissão" value={permissionQuery} onChange={(event) => setPermissionQuery(event.target.value)} /></div>
              {permissionsQuery.isLoading ? <p role="status" className="py-8 text-center text-sm text-genesis-muted">Carregando catálogo…</p>
                : permissionsQuery.isError ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-genesis-error">Não foi possível carregar o catálogo de permissões.</p>
                  : <div className="max-h-[62vh] space-y-5 overflow-auto pr-1">{Object.entries(groupedCatalog).map(([group, permissions]) => <section key={group} aria-labelledby={`role-group-${group}`}>
                    <h4 id={`role-group-${group}`} className="mb-2 text-sm font-semibold text-genesis-text">{groupLabels[group] ?? group.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())}</h4>
                    <div className="grid gap-2 xl:grid-cols-2">{permissions.map((permission) => {
                      const grant = activeGrants.find((item) => item.permissionKey === permission.key);
                      const protectedGrant = protectedPermissionKeys.has(permission.key);
                      const selectable = canEditForm && (isSuperAdmin || !protectedGrant);
                      return <div key={permission.key} className="grid min-w-0 gap-2 rounded-md border border-genesis-border p-3 sm:grid-cols-[minmax(0,1fr)_170px] sm:items-center">
                        <label className="flex min-w-0 items-start gap-3"><input type="checkbox" checked={Boolean(grant)} disabled={!selectable} onChange={() => toggleGrant(permission)} className="mt-1 accent-indigo-600 focus-visible:ring-2 focus-visible:ring-genesis-primary" /><span className="min-w-0"><span className="block text-sm font-medium text-genesis-text">{permission.description || permission.key}</span><code className="mt-0.5 block break-all text-[11px] text-genesis-muted">{permission.key}</code>{protectedGrant && <span className="mt-1 block text-[10px] font-semibold uppercase text-amber-800">Delegação reservada ao Super Admin</span>}</span></label>
                        {grant && <select aria-label={`Escopo de ${permission.key}`} value={grant.scopeType} disabled={!selectable} onChange={(event) => setScope(permission.key, event.target.value as AdminAccessScope)} className="min-h-9 rounded-md border border-genesis-border bg-genesis-surface px-2 text-xs text-genesis-text focus:border-genesis-primary focus:outline-none focus:ring-2 focus:ring-genesis-primary/20"><option value="global">Global</option><option value="own">Próprio</option><option value="participation">Participação</option><option value="department">Departamento</option></select>}
                      </div>;
                    })}</div>
                  </section>)}{!visibleCatalog.length && <p className="py-8 text-center text-sm text-genesis-muted">Nenhuma permissão corresponde à busca.</p>}</div>}
            </div>
            {canEditForm && <div className="mt-4 border-t border-genesis-border pt-4">
              <div className="max-w-md"><Field label="Confirme sua senha" htmlFor="roleReauth" hint="Obrigatória para salvar alterações no papel."><Input id="roleReauth" type="password" autoComplete="current-password" required value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} /></Field></div>
              {error && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm font-semibold text-genesis-error">{error}</p>}
              <div className="mt-3 flex gap-2"><Button form="role-form" type="submit" disabled={save.isPending || !reauthPassword}>{save.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}{creating ? "Criar papel" : "Salvar permissões"}</Button>{creating && <Button variant="outline" onClick={resetForm}>Cancelar</Button>}</div>
            </div>}
            {!canEditForm && error && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-genesis-error">{error}</p>}
          </>}
      </section>
    </div>
  </div>;
  return embedded ? content : <AppShell>{content}</AppShell>;
}
