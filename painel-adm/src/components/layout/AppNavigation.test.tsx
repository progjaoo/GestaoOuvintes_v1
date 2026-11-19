import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppNavigation } from "./AppNavigation";
import { Sidebar, SidebarProvider, SidebarTrigger } from "@/components/ui/shadcn/sidebar";

const auth = vi.hoisted(() => ({ user: { permissions: [] as string[] } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
function navigation(permissions: string[]) {
  auth.user.permissions = permissions;
  return render(<MemoryRouter initialEntries={["/programas"]}><SidebarProvider><SidebarTrigger /><AppNavigation /><input aria-label="Editor" /></SidebarProvider></MemoryRouter>);
}
describe("AppNavigation", () => {
  it("groups only permitted modules and preserves destinations", () => {
    navigation(["program.read", "feed.read", "user.read"]);
    expect(screen.getByText("Operação")).toBeVisible();
    expect(screen.getByText("Conteúdo")).toBeVisible();
    expect(screen.getByText("Administração")).toBeVisible();
    expect(screen.getByRole("link", { name: "Programas e grade" })).toHaveAttribute("href", "/programas");
    expect(screen.getByRole("link", { name: "Programas e grade" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Cadastros" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Banners institucionais" })).not.toBeInTheDocument();
  });
  it("does not show empty groups or treat partial role grants as access", () => {
    navigation(["program.read", "role.read"]);
    expect(screen.queryByText("Conteúdo")).not.toBeInTheDocument();
    expect(screen.queryByText("Administração")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Acessos" })).not.toBeInTheDocument();
  });
  it("does not hijack the editor shortcut or write a sidebar cookie", () => {
    navigation(["program.read"]);
    const editor = screen.getByLabelText("Editor");
    const event = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true });
    editor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Alternar menu" }));
    expect(document.cookie).not.toContain("sidebar_state");
  });
});

 it("opens a titled mobile sheet and closes it after navigation", async () => {
   vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: query.includes("max-width"), media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }));
   auth.user.permissions = ["program.read"];
   render(<MemoryRouter><SidebarProvider><SidebarTrigger aria-label="Abrir menu" /><Sidebar><AppNavigation /></Sidebar></SidebarProvider></MemoryRouter>);
   fireEvent.click(screen.getByRole("button", { name: "Abrir menu" }));
   expect(await screen.findByRole("dialog", { name: "Navegação do painel" })).toBeVisible();
   fireEvent.click(screen.getByRole("link", { name: "Programas e grade" }));
   await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
 });

it("integra mensagens no menu Enquetes sem menu Participações",()=>{
 navigation(["participation.read"]);expect(screen.getByRole("link",{name:"Enquetes"})).toHaveAttribute("href","/enquetes");expect(screen.queryByRole("link",{name:"Participações"})).not.toBeInTheDocument();
});

it("oferece Enquetes a quem pode consultar a agenda, sem conceder a Gestão",()=>{
 navigation(["calendar_integration.read"]);expect(screen.getByRole("link",{name:"Enquetes"})).toHaveAttribute("href","/enquetes");expect(screen.queryByRole("link",{name:"Participações"})).not.toBeInTheDocument();
});
