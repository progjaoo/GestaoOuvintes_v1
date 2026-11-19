import { Navigate, Outlet, useLocation } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { hasPermission } from "@/services/permissions";

export function ProtectedRoute() {
  const { isAuthenticated, isRestoring } = useAuth();
  const location = useLocation();

  if (isRestoring) {
    return (
      <main className="grid min-h-screen place-items-center bg-genesis-bg">
        <div className="flex items-center gap-3 text-genesis-text">
          <LoaderCircle className="h-5 w-5 animate-spin" />
          <span className="font-semibold">Validando sua sessão...</span>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export function PermissionRoute({ permission }: { permission: string | readonly string[] }) {
  const { user } = useAuth();

  const permissions = typeof permission === "string" ? [permission] : permission;
  if (!permissions.some(key => hasPermission(user, key))) {
    return (
      <main className="grid min-h-screen place-items-center bg-genesis-bg p-6">
        <section className="max-w-lg rounded-xl border border-genesis-border bg-genesis-surface p-6 text-center">
          <h1 className="font-display text-xl font-semibold text-genesis-text">Acesso não autorizado</h1>
          <p className="mt-2 text-sm text-genesis-muted">Seu perfil não possui permissão para esta área.</p>
        </section>
      </main>
    );
  }

  return <Outlet />;
}
