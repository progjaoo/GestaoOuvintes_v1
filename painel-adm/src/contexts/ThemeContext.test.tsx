import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from "@/contexts/ThemeContext";

let systemDark = false;
let mediaQuery: MediaQueryList;

function Consumer() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <>
      <output data-testid="theme">{theme}</output>
      <output data-testid="resolved-theme">{resolvedTheme}</output>
      <button onClick={() => setTheme("light")}>Claro</button>
      <button onClick={() => setTheme("dark")}>Escuro</button>
      <button onClick={() => setTheme("system")}>Sistema</button>
    </>
  );
}

function renderTheme() {
  return render(<ThemeProvider><Consumer /></ThemeProvider>);
}

function expectTheme(theme: string, resolvedTheme: string) {
  expect(screen.getByTestId("theme")).toHaveTextContent(theme);
  expect(screen.getByTestId("resolved-theme")).toHaveTextContent(resolvedTheme);
  expect(document.documentElement).toHaveClass(resolvedTheme);
  expect(document.documentElement).not.toHaveClass(resolvedTheme === "dark" ? "light" : "dark");
  expect(document.documentElement.style.colorScheme).toBe(resolvedTheme);
}

function changeSystemPreference(dark: boolean) {
  act(() => {
    systemDark = dark;
    mediaQuery.dispatchEvent(new Event("change"));
  });
}

function storageChange(newValue: string | null, key: string | null = THEME_STORAGE_KEY, storageArea?: Storage) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea }));
  });
}

beforeEach(() => {
  localStorage.clear();
  systemDark = false;
  const events = new EventTarget();
  mediaQuery = {
    get matches() { return systemDark; },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(events.addEventListener.bind(events)),
    removeEventListener: vi.fn(events.removeEventListener.bind(events)),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: events.dispatchEvent.bind(events),
  } as MediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ThemeProvider", () => {
  it("defaults to system, resolves light deterministically and does not persist on mount", () => {
    renderTheme();
    expectTheme("system", "light");
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it.each(["light", "dark", "system"] as const)("restores the saved %s preference", (theme) => {
    systemDark = true;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    renderTheme();
    expectTheme(theme, theme === "system" ? "dark" : theme);
  });

  it("persists only the selected preference and restores it after remount", () => {
    const view = renderTheme();
    fireEvent.click(screen.getByRole("button", { name: "Escuro" }));
    expectTheme("dark", "dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(localStorage.length).toBe(1);
    view.unmount();
    renderTheme();
    expectTheme("dark", "dark");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    expectTheme("light", "light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "Sistema" }));
    expectTheme("system", "light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("tracks system changes only when system is selected", () => {
    renderTheme();
    changeSystemPreference(true);
    expectTheme("system", "dark");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    changeSystemPreference(false);
    changeSystemPreference(true);
    expectTheme("light", "light");
    fireEvent.click(screen.getByRole("button", { name: "Sistema" }));
    expectTheme("system", "dark");
    changeSystemPreference(false);
    expectTheme("system", "light");
  });

  it("ignores invalid persisted values", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "invalid");
    systemDark = true;
    renderTheme();
    expectTheme("system", "dark");
  });

  it("synchronizes cross-tab changes without echoing storage writes", () => {
    renderTheme();
    const write = vi.spyOn(Storage.prototype, "setItem");
    storageChange("dark", THEME_STORAGE_KEY, localStorage);
    expectTheme("dark", "dark");
    storageChange("light", THEME_STORAGE_KEY, localStorage);
    expectTheme("light", "light");
    changeSystemPreference(true);
    storageChange("system", THEME_STORAGE_KEY, localStorage);
    expectTheme("system", "dark");
    expect(write).not.toHaveBeenCalled();
  });

  it("returns to system when the preference is removed or storage is cleared", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    systemDark = true;
    renderTheme();
    storageChange(null);
    expectTheme("system", "dark");
    storageChange("light");
    expectTheme("light", "light");
    storageChange(null, null);
    expectTheme("system", "dark");
  });

  it("ignores unrelated keys, invalid values and sessionStorage events", () => {
    renderTheme();
    storageChange("dark", "unrelated-key");
    storageChange("invalid");
    storageChange("dark", THEME_STORAGE_KEY, sessionStorage);
    expectTheme("system", "light");
  });

  it("survives storage read failures", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    systemDark = true;
    renderTheme();
    expectTheme("system", "dark");
    fireEvent.click(screen.getByRole("button", { name: "Claro" }));
    expectTheme("light", "light");
  });

  it("survives storage write failures and keeps responding to system changes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    renderTheme();
    fireEvent.click(screen.getByRole("button", { name: "Escuro" }));
    expectTheme("dark", "dark");
    fireEvent.click(screen.getByRole("button", { name: "Sistema" }));
    changeSystemPreference(true);
    expectTheme("system", "dark");
  });

  it("survives the localStorage getter itself throwing", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    renderTheme();
    expectTheme("system", "light");
    fireEvent.click(screen.getByRole("button", { name: "Escuro" }));
    expectTheme("dark", "dark");
  });

  it("falls back to light if matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    renderTheme();
    expectTheme("system", "light");
    fireEvent.click(screen.getByRole("button", { name: "Escuro" }));
    expectTheme("dark", "dark");
  });

  it("supports the legacy media query listener API and removes the listener", () => {
    Object.defineProperty(mediaQuery, "addEventListener", { value: undefined });
    const view = renderTheme();
    expect(mediaQuery.addListener).toHaveBeenCalledOnce();
    const listener = vi.mocked(mediaQuery.addListener).mock.calls[0][0];
    act(() => {
      systemDark = true;
      listener?.call(mediaQuery, { matches: true } as MediaQueryListEvent);
    });
    expectTheme("system", "dark");
    view.unmount();
    expect(mediaQuery.removeListener).toHaveBeenCalledWith(listener);
  });

  it("cleans up listeners and preserves unrelated root classes in StrictMode", () => {
    document.documentElement.classList.add("unrelated");
    const removeStorage = vi.spyOn(window, "removeEventListener");
    const view = render(<StrictMode><ThemeProvider><Consumer /></ThemeProvider></StrictMode>);
    changeSystemPreference(true);
    expectTheme("system", "dark");
    const listener = vi.mocked(mediaQuery.addEventListener).mock.lastCall?.[1];
    view.unmount();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith("change", listener);
    expect(removeStorage).toHaveBeenCalledWith("storage", expect.any(Function));
    expect(document.documentElement).toHaveClass("unrelated");
    expect(document.documentElement).not.toHaveClass("light", "dark");
    expect(document.documentElement.style.colorScheme).toBe("");
    document.documentElement.classList.remove("unrelated");
  });

  it("requires useTheme to be inside a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const suppressExpectedError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", suppressExpectedError);
    try {
      expect(() => render(<Consumer />)).toThrow("useTheme deve ser usado dentro de ThemeProvider.");
    } finally {
      window.removeEventListener("error", suppressExpectedError);
    }
  });
});
