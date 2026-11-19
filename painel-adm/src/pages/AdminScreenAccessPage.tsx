import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/services/api";
import { hasPermission } from "@/services/permissions";
import type { ManagedAdminUser } from "@/types/api";

const screenPermissions = [
  { key: "program.read", title: "Acessar Programas e grade", description: "Consultar programas no escopo autorizado." },
  { key: "listener.read", title: "Acessar Cadastros", description: "Consultar cadastros e dados dos ouvintes." },
  { key: "campaign.read", title: "Acessar Campanhas", description: "Consultar campanhas e seus participantes." },
  { key: "institutional_banner.read", title: "Acessar Banners", description: "Consultar banners institucionais." },
  { key: "feed.read", title: "Acessar Conteúdo do Feed", description: "Consultar matérias e conteúdo editorial." },
  { key: "user.read", title: "Acessar Usuários", description: "Consultar a equipe administrativa." },
  { key: "role.read", title: "Acessar Papéis", description: "Consultar papéis e suas permissões." },
  { key: "permission.read", title: "Acessar Catálogo", description: "Consultar o catálogo de permissões." },
  { key: "user.permissions.read", title: "Acessar Permissões por tela", description: "Consultar acessos efetivos e exceções individuais." },
] as const;

type ScreenKey = (typeof screenPermissions)[number]["key"];
type ScreenMode = "inherit" | "ALLOW" | "DENY";
type ScreenDraft = {
  userId: string;
  modes: Partial<Record<ScreenKey, ScreenMode>>;
  reason: string;
  password: string;
  error: string;
};
const pollScreen = { key: "poll.read", title: "Acessar Enquetes", description: "Consulta no escopo autorizado; gerencie concessões pelos papéis e vínculos, sem ampliar para global nesta tela." };
const participationScreen = { key: "participation.read", title: "Mensagens nas enquetes", description: "Consultar mensagens privadas dentro de cada enquete, sem edição ou aprovação. Acesso independente dos resultados. Nenhuma concessão global nesta matriz." };
const emptyUsers: ManagedAdminUser[] = [];

function persistedMode(user: ManagedAdminUser, key: ScreenKey): ScreenMode {
  return user.overrides?.find((item) => item.permission_key === key)?.effect ?? "inherit";
}

function statusFor(user: ManagedAdminUser, key: string) {
  if (user.is_super_admin) return { label: "Liberado", className: "bg-emerald-100 text-emerald-800" };
  const override = user.overrides?.find((item) => item.permission_key === key);
  if (override?.effect === "DENY") return { label: "Bloqueado", className: "bg-rose-100 text-rose-800" };
  if (override?.effect === "ALLOW" && override.scope_type === "global") {
    return { label: "Liberado", className: "bg-emerald-100 text-emerald-800" };
  }
  const grants = user.effectivePermissions?.filter((grant) => grant.permission_key === key) ?? [];
  if (grants.some((grant) => grant.scope_type === "global")) {
    return { label: "Liberado", className: "bg-emerald-100 text-emerald-800" };
  }
  if (grants.length > 0) return { label: "Limitado por escopo", className: "bg-amber-100 text-amber-900" };
  return { label: "Bloqueado", className: "bg-rose-100 text-rose-800" };
}

export function AdminScreenAccessPage() {
  const { user: actor } = useAuth();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [requestedUserId, setRequestedUserId] = useState("");
  const [draft, setDraft] = useState<ScreenDraft | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin-users", "all-for-screen-access"],
    queryFn: () => api.listAdminUsers({ status: "all", page: 1, pageSize: 100 }),
    refetchOnWindowFocus: false,
  });
  const users = usersQuery.data?.items ?? emptyUsers;
  const filteredUsers = useMemo(() => users.filter((item) => `${item.name} ${item.email ?? item.username}`.toLowerCase().includes(search.toLowerCase())), [users, search]);
  const selectedOption = filteredUsers.find((item) => item.id === requestedUserId) ?? filteredUsers[0] ?? null;
  const selectedId = selectedOption?.id ?? "";

  const detailQuery = useQuery({
    queryKey: ["admin-user", selectedId],
    queryFn: () => api.getAdminUser(selectedId),
    enabled: Boolean(selectedId),
    refetchOnWindowFocus: false,
  });
  const selectedUser = detailQuery.data?.user;
  const editable = Boolean(actor?.isSuperAdmin && hasPermission(actor, "user.permissions.manage") && selectedUser && !selectedUser.is_super_admin && selectedUser.id !== actor?.id);
  const currentDraft = selectedUser && draft?.userId === selectedUser.id ? draft : null;
  const modes = currentDraft?.modes ?? (selectedUser ? Object.fromEntries(screenPermissions.map(({ key }) => [key, persistedMode(selectedUser, key)])) : {});
  const reason = currentDraft?.reason ?? "";
  const password = currentDraft?.password ?? "";
  const error = currentDraft?.error ?? "";
  const updateDraft = (changes: Partial<Omit<ScreenDraft, "userId">>) => {
    if (!selectedUser) return;
    setDraft((current) => {
      const base = current?.userId === selectedUser.id
        ? current
        : {
          userId: selectedUser.id,
          modes: Object.fromEntries(screenPermissions.map(({ key }) => [key, persistedMode(selectedUser, key)])),
          reason: "",
          password: "",
          error: "",
        };
      return { ...base, ...changes };
    });
  };
  const changed = selectedUser ? screenPermissions.some(({ key }) => (modes[key] ?? "inherit") !== persistedMode(selectedUser, key)) : false;
  const save = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error("Selecione um usuário.");
      await api.reauthenticate(password);
      const screenKeys = new Set<string>(screenPermissions.map(({ key }) => key));
      const unchangedOverrides = (selectedUser.overrides ?? [])
        .filter((item) => !screenKeys.has(item.permission_key))
        .map((item) => ({ permissionKey: item.permission_key, effect: item.effect, ...(item.scope_type ? { scopeType: item.scope_type } : {}), ...(item.department_id ? { departmentId: item.department_id } : {}), reason: item.reason }));
      const screenOverrides = screenPermissions.flatMap(({ key }) => {
        const mode = modes[key] ?? "inherit";
        if (mode === "inherit") return [];
        const existing = selectedUser.overrides?.find((item) => item.permission_key === key);
        const isChanged = mode !== persistedMode(selectedUser, key);
        if (!isChanged && existing) {
          return [{
            permissionKey: key,
            effect: existing.effect,
            ...(existing.scope_type ? { scopeType: existing.scope_type } : {}),
            ...(existing.department_id ? { departmentId: existing.department_id } : {}),
            reason: existing.reason,
          }];
        }
        return [{
          permissionKey: key,
          effect: mode,
          ...(mode === "ALLOW" ? { scopeType: "global" as const } : {}),
          reason: reason.trim(),
        }];
      });
      return api.updateAdminOverrides(selectedUser.id, [...unchangedOverrides, ...screenOverrides]);
    },
    onSuccess: async () => {
      toast.success("Acessos por tela atualizados. As sessões anteriores do usuário foram revogadas.");
      updateDraft({ password: "", reason: "", error: "" });
      await client.invalidateQueries({ queryKey: ["admin-user", selectedId] });
      await client.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (cause) => updateDraft({ error: cause instanceof ApiError ? cause.message : "Não foi possível atualizar os acessos." }),
  });

  return (
    <section className="rounded-xl border border-genesis-border bg-genesis-surface p-4 shadow-sm sm:p-6">
      <div className="border-b border-genesis-border pb-4">
        <h2 className="font-display text-lg font-bold text-genesis-text">Acesso por tela</h2>
        <p className="mt-1 text-sm text-genesis-muted">Confira as permissões efetivas e aplique exceções individuais sem alterar os papéis do usuário.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(220px,0.65fr)_minmax(240px,1fr)]">
          <label className="relative"><span className="sr-only">Buscar usuário</span><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-genesis-muted" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar usuários" className="pl-10" /></label>
          <Select aria-label="Selecionar usuário" value={selectedId} onChange={(event) => setRequestedUserId(event.target.value)} disabled={!filteredUsers.length}>
            {filteredUsers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.roles.map((role) => role.key).join(", ") || item.role}</option>)}
          </Select>
        </div>
      </div>

      {usersQuery.isLoading ? <p role="status" className="py-12 text-center text-sm text-genesis-muted">Carregando usuários…</p>
        : usersQuery.isError ? <p role="alert" className="py-8 text-sm text-genesis-error">Não foi possível carregar usuários. Verifique seu acesso e tente novamente.</p>
          : !filteredUsers.length ? <p className="py-10 text-center text-sm text-genesis-muted">Nenhum usuário encontrado.</p>
            : detailQuery.isLoading ? <p role="status" className="py-12 text-center text-sm text-genesis-muted">Consultando permissões efetivas…</p>
              : detailQuery.isError || !selectedUser ? <p role="alert" className="py-8 text-sm text-genesis-error">Não foi possível consultar as permissões deste usuário.</p>
                : <>
                  <div className="mt-4 flex items-center gap-2 text-sm text-genesis-muted"><ShieldCheck size={16} /><span>Permissões efetivas de <strong className="text-genesis-text">{selectedUser.name}</strong></span>{selectedUser.is_super_admin && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-genesis-primary">Super Admin protegido</span>}</div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                    {[pollScreen, participationScreen, ...screenPermissions].map(({ key, title, description }) => {
                      const status = statusFor(selectedUser, key);
                      const mode = modes[key as ScreenKey] ?? "inherit";
                      const locked = !editable || selectedUser.is_super_admin;
                      return <article key={key} className="flex min-w-0 flex-col rounded-lg border border-genesis-border p-3 sm:p-4">
                        <h3 className="font-semibold text-genesis-text">{title}</h3>
                        <code className="mt-0.5 break-all text-xs text-genesis-muted">{key}</code>
                        <p className="mt-2 min-h-10 text-xs leading-5 text-genesis-muted">{description}</p>
                        <span className={`mt-2 w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                        {(key === pollScreen.key || key === participationScreen.key) ? <p className="mt-3 text-xs text-genesis-muted">Somente consulta. Concessões e escopos não são alterados por esta matriz.</p> : <Select
                          className="mt-3 text-sm"
                          aria-label={`Exceção para ${title}`}
                          value={mode}
                          disabled={locked}
                          onChange={(event) => updateDraft({ modes: { ...modes, [key]: event.target.value as ScreenMode }, error: "" })}
                        >
                          <option value="inherit">Herdar do papel</option>
                          <option value="ALLOW">Permitir globalmente</option>
                          <option value="DENY">Bloquear</option>
                        </Select>}
                      </article>;
                    })}
                  </div>
                  {editable && changed && <div className="mt-5 grid gap-3 rounded-lg bg-genesis-bg p-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)_auto] md:items-end">
                    <Field label="Motivo da alteração (auditoria)" htmlFor="screenAccessReason"><Input id="screenAccessReason" value={reason} onChange={(event) => updateDraft({ reason: event.target.value, error: "" })} minLength={5} maxLength={500} placeholder="Informe por que o acesso está sendo alterado" /></Field>
                    <Field label="Confirme sua senha" htmlFor="screenAccessPassword"><Input id="screenAccessPassword" type="password" autoComplete="current-password" value={password} onChange={(event) => updateDraft({ password: event.target.value, error: "" })} /></Field>
                    <Button disabled={save.isPending || reason.trim().length < 5 || !password} onClick={() => save.mutate()}>{save.isPending && <LoaderCircle size={16} className="animate-spin" />} Salvar acessos</Button>
                  </div>}
                  {!editable && <p className="mt-4 rounded-md bg-genesis-bg p-3 text-sm text-genesis-muted">Consulta somente leitura. Exceções individuais são gerenciadas exclusivamente pelo Super Admin e não podem ser aplicadas à própria conta ou à conta Super Admin protegida.</p>}
                  <p className="mt-4 text-xs leading-5 text-genesis-muted">Permissões parciais aparecem como “Limitado por escopo”. As exceções editáveis desta matriz liberam ou bloqueiam globalmente. Enquetes e Participações respeitam escopos próprios e aparecem somente para consulta, sem concessão global por esta tela. Permissão de tela não concede automaticamente ações como editar, exportar ou publicar.</p>
                  {error && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm font-semibold text-genesis-error">{error}</p>}
                </>}
    </section>
  );
}
