import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, THEME_STORAGE_KEY } from "@/contexts/ThemeContext";
import { SidebarProvider } from "@/components/ui/shadcn/sidebar";
import { NavUser } from "./NavUser";
const auth = vi.hoisted(() => ({ user: { name: "Operador da Rádio", username: "operador" }, logout: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
function Location() { return <output aria-label="Rota">{useLocation().pathname}</output>; }
function mount() {
  render(<MemoryRouter initialEntries={["/programas"]}><ThemeProvider><SidebarProvider><NavUser /><Location /></SidebarProvider></ThemeProvider></MemoryRouter>);
}
async function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "Abrir menu do usuário" }), { key: "ArrowDown" });
  return screen.findByRole("menuitemradio", { name: "Escuro" });
}
beforeEach(() => { localStorage.clear(); auth.logout.mockResolvedValue(undefined); });
afterEach(() => localStorage.clear());
describe("NavUser", () => {
  it("offers a keyboard-accessible theme menu and persists only preference", async () => {
    mount();
    const dark = await openMenu();
    expect(screen.getByRole("menuitemradio", { name: "Claro" })).toBeVisible();
    expect(screen.getByRole("menuitemradio", { name: "Sistema" })).toBeVisible();
    fireEvent.click(dark);
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect([...Array(localStorage.length)].map((_, i) => localStorage.key(i))).toEqual([THEME_STORAGE_KEY]);
  });
  it("logs out through the existing authentication flow", async () => {
    mount(); await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sair" }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Rota")).toHaveTextContent("/login");
  });
});
