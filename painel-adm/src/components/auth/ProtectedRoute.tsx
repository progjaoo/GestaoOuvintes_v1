import { Navigate, Outlet, useLocation } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

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
