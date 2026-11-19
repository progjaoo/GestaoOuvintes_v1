import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<Theme, "system">;
export const THEME_STORAGE_KEY = "genesis-admin-theme";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function readTheme(): Theme {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

function getSystemPreference(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setCurrentTheme] = useState<Theme>(readTheme);
  const [mediaQuery] = useState(getSystemPreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(
    () => mediaQuery?.matches ? "dark" : "light",
  );
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  const setTheme = useCallback((nextTheme: Theme) => {
    if (!isTheme(nextTheme)) return;
    setCurrentTheme(nextTheme);
    try {
      // Persist only this preference, never account or session information.
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // A blocked or full storage must not prevent changing the current tab.
    }
  }, []);

  useEffect(() => {
    if (!mediaQuery) return;
    const updateSystemTheme = () => setSystemTheme(mediaQuery.matches ? "dark" : "light");
    updateSystemTheme();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateSystemTheme);
      return () => mediaQuery.removeEventListener("change", updateSystemTheme);
    }
    mediaQuery.addListener(updateSystemTheme);
    return () => mediaQuery.removeListener(updateSystemTheme);
  }, [mediaQuery]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      if (event.newValue === null) {
        setCurrentTheme("system");
      } else if (isTheme(event.newValue)) {
        // Do not write remote updates back: that would echo across tabs.
        setCurrentTheme(event.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains("light");
    const hadDark = root.classList.contains("dark");
    const previousColorScheme = root.style.colorScheme;
    root.classList.toggle("light", resolvedTheme === "light");
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;
    return () => {
      root.classList.toggle("light", hadLight);
      root.classList.toggle("dark", hadDark);
      root.style.colorScheme = previousColorScheme;
    };
  }, [resolvedTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme deve ser usado dentro de ThemeProvider.");
  }
  return context;
}
