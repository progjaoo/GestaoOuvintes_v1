import { NavLink, useLocation } from "react-router-dom";
import { BookOpen, ChartNoAxesColumn, CalendarRange, Images, ShieldCheck, UsersRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";
import { SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/shadcn/sidebar";

const groups = [
  { label: "Operação", items: [
    { label: "Programas e grade", path: "/programas", icon: CalendarRange, permissions: [["program.read"]] },
    { label: "Enquetes", path: "/enquetes", icon: ChartNoAxesColumn, permissions: [["poll.read"], ["poll.results.read"], ["participation.read"], ["calendar_integration.read"], ["calendar_integration.manage"], ["calendar_integration.sync"]] },
    { label: "Cadastros", path: "/ouvintes/cadastros", icon: UsersRound, permissions: [["listener.read"]] },
    { label: "Campanhas", path: "/campanhas", icon: CalendarRange, permissions: [["campaign.read"]] },
  ] },
  { label: "Conteúdo", items: [
    { label: "Banners institucionais", path: "/banners-institucionais", icon: Images, permissions: [["institutional_banner.read"]] },
    { label: "Conteúdo do Feed", path: "/conteudo/feed", icon: BookOpen, permissions: [["feed.read"]] },
  ] },
  { label: "Administração", items: [
    { label: "Acessos", path: "/administracao/acessos", icon: ShieldCheck, permissions: [["user.read"], ["role.read", "permission.read"]] },
  ] },
];

export function AppNavigation() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarContent>
      <nav aria-label="Navegação principal">
        {groups.map(group => {
          const items = group.items.filter(item => item.permissions.some(keys => keys.every(key => hasPermission(user, key))));
          if (!items.length) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map(({ label, path, icon: Icon }) => (
                    <SidebarMenuItem key={path}>
                      <SidebarMenuButton asChild tooltip={label} isActive={pathname === path || pathname.startsWith(`${path}/`)}>
                        <NavLink to={path} onClick={() => setOpenMobile(false)}>
                          <Icon aria-hidden="true" data-icon="inline-start" />
                          <span>{label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </nav>
    </SidebarContent>
  );
}
