import { NavLink, Outlet } from "react-router-dom";
import { AppShell, PageHeader } from "@/components/layout/AppShell";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";
import { cn } from "@/lib/utils";

const accessTabs = [
  { label: "Usuários", path: "/administracao/acessos/usuarios", permissions: ["user.read"] },
  { label: "Papéis", path: "/administracao/acessos/papeis", permissions: ["role.read", "permission.read"] },
  { label: "Acesso por tela", path: "/administracao/acessos/telas", permissions: ["user.read", "user.permissions.read"] },
];

export function AdminAccessLayout() {
  const { user } = useAuth();
  usePageTitle("Administração de acessos");
  const visibleTabs = accessTabs.filter((tab) => tab.permissions.every((permission) => hasPermission(user, permission)));

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Equipe e segurança"
          title="Administração"
          description="Gerencie usuários, papéis e permissões de acesso do sistema em um só lugar."
        />
        <nav aria-label="Seções de acessos" className="flex w-full gap-1 overflow-x-auto rounded-lg border border-genesis-border bg-genesis-bg p-1 sm:w-fit">
          {visibleTabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={false}
              className={({ isActive }) => cn(
                "min-h-10 shrink-0 rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-genesis-primary focus-visible:ring-offset-2",
                isActive
                  ? "bg-genesis-surface text-genesis-text shadow-sm"
                  : "text-genesis-muted hover:bg-genesis-surface/70 hover:text-genesis-text",
              )}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
    </AppShell>
  );
}
