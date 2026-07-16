import type { AdminUser } from "@/types/api";

const SESSION_KEY = "radio88_cadastros_admin_session";

export interface AdminSession {
  accessToken: string;
  user: AdminUser;
}

let memorySession: AdminSession | null = null;

export function getSession(): AdminSession | null {
  if (memorySession) {
    return memorySession;
  }

  const stored = sessionStorage.getItem(SESSION_KEY);
  if (!stored) {
    return null;
  }

  try {
    memorySession = JSON.parse(stored) as AdminSession;
    return memorySession;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function setSession(session: AdminSession): void {
  memorySession = session;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  memorySession = null;
  sessionStorage.removeItem(SESSION_KEY);
}

export function getAccessToken(): string | null {
  return getSession()?.accessToken ?? null;
}
