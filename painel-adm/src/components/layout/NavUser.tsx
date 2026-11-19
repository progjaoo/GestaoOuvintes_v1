import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronsUpDown, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Avatar, AvatarFallback } from "@/components/ui/shadcn/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/shadcn/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/shadcn/sidebar";

export function NavUser() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const initials = user?.name.trim().split(/\s+/).slice(0, 2).map(name => name[0]).join("").toUpperCase() || "88";
  const signOut = async () => {
    setSigningOut(true);
    try { await logout(); navigate("/login", { replace: true }); }
    catch { toast.error("Não foi possível sair. Tente novamente."); }
    finally { setSigningOut(false); }
  };
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label="Abrir menu do usuário">
              <Avatar className="size-9"><AvatarFallback>{initials}</AvatarFallback></Avatar>
              <span className="grid min-w-0 flex-1 text-left">
                <span className="truncate font-semibold">{user?.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user?.email || user?.username}</span>
              </span>
              <ChevronsUpDown aria-hidden="true" data-icon="inline-end" className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" sideOffset={8} className="min-w-60">
            <DropdownMenuLabel>Minha conta</DropdownMenuLabel>
            <DropdownMenuGroup>
              <div className="px-2 py-1.5 text-sm text-muted-foreground">{user?.name}</div>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Tema</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={value => {
              if (value === "light" || value === "dark" || value === "system") setTheme(value);
            }}>
              <DropdownMenuRadioItem value="light"><Sun aria-hidden="true" data-icon="inline-start" />Claro</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark"><Moon aria-hidden="true" data-icon="inline-start" />Escuro</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system"><Monitor aria-hidden="true" data-icon="inline-start" />Sistema</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={signingOut} onSelect={() => void signOut()}>
                <LogOut aria-hidden="true" data-icon="inline-start" />{signingOut ? "Saindo…" : "Sair"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
