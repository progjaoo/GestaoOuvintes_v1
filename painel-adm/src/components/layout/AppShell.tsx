import { useState, type PropsWithChildren } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  CalendarRange,
  Images,
  Headphones,
  LogOut,
  Menu,
  Radio,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import logoRadio88 from "@/assets/logo-radio88.svg";

const navigation = [
  {
    label: "Cadastros",
    path: "/ouvintes/cadastros",
    icon: UsersRound,
  },
  {
    label: "Campanhas",
    path: "/campanhas",
    icon: CalendarRange,
  },
  {
    label: "Banners institucionais",
    path: "/banners-institucionais",
    icon: Images,
    adminOnly: true,
  },
];

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const visibleNavigation = navigation.filter((item) => !("adminOnly" in item) || !item.adminOnly || user?.role === "admin");

  return (
    <nav aria-label="Navegação principal" className="space-y-1">
      {visibleNavigation.map(({ label, path, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-all duration-200",
              isActive
                ? "bg-genesis-primary text-white shadow-sm"
                : "text-genesis-muted hover:bg-neutral-100 hover:text-genesis-text",
            )
          }
        >
          <Icon className="h-5 w-5" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell({ children }: PropsWithChildren) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[272px_1fr]">
      <aside className="hidden min-h-screen border-r border-genesis-border bg-genesis-surface/95 p-5 text-genesis-text lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex items-center gap-3 border-b border-genesis-border pb-5">
          <div className="grid h-11 w-11 place-items-center rounded-lg border border-genesis-border bg-genesis-text">
            <img src={logoRadio88} alt="Rádio 88 FM" className="h-9 w-9 object-contain" />
          </div>
          <div>
            <p className="font-display text-sm font-semibold leading-tight">
              Sistema de Gestão de Ouvintes
            </p>
            <p className="mt-0.5 text-xs text-genesis-muted">Rádio 88 FM</p>
          </div>
        </div>

        <div className="mt-7 flex-1">
          <NavigationLinks />
        </div>

        <div className="rounded-xl border border-genesis-border bg-genesis-bg p-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-indigo-50 font-display font-semibold text-genesis-primary">
              {user?.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-genesis-text">{user?.name}</p>
              <p className="truncate text-xs text-genesis-muted">{user?.username}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="mt-3 w-full justify-start"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-genesis-border bg-genesis-surface/92 px-4 backdrop-blur-xl sm:px-6 lg:hidden">
          <button
            type="button"
            className="flex items-center gap-2"
            onClick={() => navigate("/ouvintes/cadastros")}
          >
            <span className="grid h-9 w-9 place-items-center rounded-md bg-genesis-text">
              <img src={logoRadio88} alt="" className="h-7 w-7 object-contain" />
            </span>
            <span className="font-display text-sm font-semibold text-genesis-text">
              Gestão de Ouvintes
            </span>
          </button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Abrir menu"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </header>

        <main className="min-h-screen p-4 sm:p-6 lg:p-8 xl:p-10">{children}</main>
      </div>

      <Dialog
        open={mobileMenuOpen}
        onOpenChange={setMobileMenuOpen}
        title="Menu"
        description="Gestão de ouvintes da Rádio 88 FM"
        className="top-auto bottom-0 max-h-[85vh] translate-y-0 rounded-b-none sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-xl"
      >
        <div className="rounded-xl border border-genesis-border bg-genesis-surface p-4">
          <NavigationLinks onNavigate={() => setMobileMenuOpen(false)} />
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-genesis-bg p-4">
          <Headphones className="h-5 w-5 text-genesis-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-genesis-text">{user?.name}</p>
            <p className="truncate text-xs text-genesis-muted">{user?.username}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Sair" onClick={handleLogout}>
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-genesis-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 text-genesis-primary">
          <Radio className="h-4 w-4" />
          <p className="text-xs font-semibold uppercase tracking-[0.18em]">{eyebrow}</p>
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-genesis-text sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-genesis-muted sm:text-base">
          {description}
        </p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
