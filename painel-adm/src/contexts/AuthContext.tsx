import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, UNAUTHORIZED_EVENT } from "@/services/api";
import {
  clearSession,
  getSession,
  setSession,
  type AdminSession,
} from "@/services/session";
import type { AdminUser, BootstrapAdminInput } from "@/types/api";

interface AuthContextValue {
  user: AdminUser | null;
  isAuthenticated: boolean;
  isRestoring: boolean;
  bootstrapAdmin: (input: BootstrapAdminInput) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [initialSession] = useState<AdminSession | null>(() => getSession());
  const [session, setCurrentSession] = useState<AdminSession | null>(initialSession);
  const [isRestoring, setIsRestoring] = useState(Boolean(initialSession));

  const endSession = useCallback(() => {
    clearSession();
    setCurrentSession(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    const onUnauthorized = () => endSession();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [endSession]);

  useEffect(() => {
    const storedSession = initialSession;
    if (!storedSession) {
      return;
    }

    let active = true;
    api
      .me()
      .then(({ user }) => {
        if (!active) return;
        const refreshedSession = { ...storedSession, user };
        setSession(refreshedSession);
        setCurrentSession(refreshedSession);
      })
      .catch(() => {
        if (active) endSession();
      })
      .finally(() => {
        if (active) setIsRestoring(false);
      });

    return () => {
      active = false;
    };
  }, [endSession, initialSession]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await api.login(username, password);
    const nextSession = {
      accessToken: response.accessToken,
      user: response.user,
    };
    setSession(nextSession);
    setCurrentSession(nextSession);
  }, []);

  const bootstrapAdmin = useCallback(async (input: BootstrapAdminInput) => {
    const response = await api.bootstrapAdmin(input);
    const nextSession = {
      accessToken: response.accessToken,
      user: response.user,
    };
    setSession(nextSession);
    setCurrentSession(nextSession);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      endSession();
    }
  }, [endSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      isAuthenticated: Boolean(session),
      isRestoring,
      bootstrapAdmin,
      login,
      logout,
    }),
    [bootstrapAdmin, isRestoring, login, logout, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  }
  return context;
}
