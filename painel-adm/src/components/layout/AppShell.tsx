import { useEffect, useState, type CSSProperties, type PropsWithChildren } from "react";

import { AlertTriangle, Radio, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

import {
  api,
  getPublicConfigSyncPending,
  PUBLIC_CONFIG_SYNC_EVENT,
  PUBLIC_CONFIG_SYNC_STORAGE_KEY,
} from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Sidebar, SidebarFooter, SidebarHeader, SidebarInset, SidebarProvider, SidebarSeparator, SidebarTrigger } from "@/components/ui/shadcn/sidebar";
import { AppNavigation } from "./AppNavigation";
import { NavUser } from "./NavUser";
import { hasPermission } from "@/services/permissions";
import { toast } from "sonner";
import logoRadio88 from "@/assets/logo-radio88.svg";

export function AppShell({ children }: PropsWithChildren) {
  const [publicConfigPending, setPublicConfigPending] = useState(false);
  const [republishing, setRepublishing] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const readPending = () => {
      const inMemory = getPublicConfigSyncPending();
      if (inMemory !== null) {
        setPublicConfigPending(inMemory);
        return;
      }

      try {
        const stored = window.localStorage.getItem(PUBLIC_CONFIG_SYNC_STORAGE_KEY);
        setPublicConfigPending(Boolean(stored && JSON.parse(stored).pending));
      } catch {
        setPublicConfigPending(false);
      }
    };
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ pending?: boolean }>).detail;
      setPublicConfigPending(Boolean(detail?.pending));
    };
    readPending();
    window.addEventListener(PUBLIC_CONFIG_SYNC_EVENT, onSync);
    window.addEventListener("storage", readPending);
    return () => {
      window.removeEventListener(PUBLIC_CONFIG_SYNC_EVENT, onSync);
      window.removeEventListener("storage", readPending);
    };
  }, []);

  const handleRepublish = async () => {
    setRepublishing(true);
    try {
      const result = await api.republishPublicConfig();
      if (result.syncStatus === "published") toast.success("Configuração pública republicada.");
      else toast.error("A publicação da configuração pública está desativada.");
    } catch {
      toast.error("Não foi possível republicar a configuração pública. Tente novamente.");
    } finally {
      setRepublishing(false);
    }
  };
  const handleVerifyEmail = async () => {
    try { const result = await api.requestEmailVerification(); toast.success(result.message); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível enviar a confirmação de e-mail."); }
  };

  return (
    <SidebarProvider style={{ "--sidebar-width": "17rem", "--sidebar-width-icon": "3.5rem" } as CSSProperties}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:p-3 focus:text-foreground">Pular para o conteúdo</a>
      <Sidebar collapsible="icon" aria-label="Barra lateral">
        <SidebarHeader>
          <div className="flex min-h-16 items-center gap-3 px-1">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-navy-900">
              <img src={logoRadio88} alt="Rádio 88 FM" width={36} height={36} className="size-9 object-contain" />
            </span>
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <p className="font-display text-sm font-semibold leading-tight">Sistema de Gestão de Ouvintes</p>
              <p className="text-xs text-muted-foreground">Rádio 88 FM</p>
            </div>
          </div>
          <SidebarTrigger aria-label="Alternar menu" className="self-end" />
        </SidebarHeader>
        <SidebarSeparator />
        <AppNavigation />
        <SidebarSeparator />
        <SidebarFooter><NavUser /></SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background px-4 lg:hidden">
          <SidebarTrigger aria-label="Abrir menu" />
          <span className="font-display text-sm font-semibold">Gestão de Ouvintes</span>
        </header>
        <main id="main-content" tabIndex={-1} className="min-h-svh min-w-0 p-4 outline-none sm:p-6 lg:p-8 xl:p-10">
          {user?.email && !user.emailVerifiedAt && (
            <div role="status" className="mb-5 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm">Confirme o e-mail <strong>{user.email}</strong> para ativar a recuperação segura de senha.</p>
              <Button variant="outline" size="sm" onClick={() => void handleVerifyEmail()}>Enviar confirmação</Button>
            </div>
          )}
          {hasPermission(user, "public_config.manage") && !publicConfigPending && (
            <div className="mb-3 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRepublish()}
                disabled={republishing}
                title="Publica campanhas e banners no snapshot de leitura da API."
              >
                <RefreshCw className={`h-4 w-4 ${republishing ? "animate-spin" : ""}`} />
                Republicar configuração pública
              </Button>
            </div>
          )}
          {publicConfigPending && hasPermission(user, "public_config.manage") && (
            <div
              role="status"
              className="mb-6 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <p className="text-sm">
                  A alteração foi salva, mas a configuração pública ainda não foi sincronizada.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => void handleRepublish()}
                disabled={republishing}
              >
                <RefreshCw className={`h-4 w-4 ${republishing ? "animate-spin" : ""}`} />
                Republicar configuração
              </Button>
            </div>
          )}
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
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
