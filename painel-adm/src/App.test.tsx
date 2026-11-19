import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "@/App";
import { renderApp } from "@/test/renderApp";

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("App", () => {
  it("redireciona rota protegida para o login sem sessão", async () => {
    renderApp(<App />, ["/ouvintes/cadastros"]);
    expect(await screen.findByRole("heading", { name: /acesse sua conta/i })).toBeVisible();
  });

  it("realiza login e abre o dashboard", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);

      if (url.endsWith("/api/admin/auth/login")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ identifier: "admin" });
        return jsonResponse({
          accessToken: "jwt-test",
          expiresIn: "2h",
          user: {
            id: "admin-id",
            name: "Administrador",
            username: "admin",
            role: "admin",
            permissions: ["listener.read", "campaign.read", "registration.export"],
          },
        });
      }

      if (url.endsWith("/api/admin/campaigns")) {
        return jsonResponse({ items: [] });
      }

      if (url.includes("/api/admin/listener-registrations")) {
        return jsonResponse({
          items: [],
          pagination: {
            page: 1,
            pageSize: 20,
            total: 0,
            totalPages: 0,
          },
        });
      }

      return jsonResponse({}, 404);
    });

    renderApp(<App />, ["/login"]);
    fireEvent.change(screen.getByLabelText("E-mail ou usuário"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "development-admin-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /entrar no painel/i }));

    expect(
      await screen.findByRole("heading", { name: /cadastros de ouvintes/i }),
    ).toBeVisible();
    await waitFor(() => {
      expect(sessionStorage.getItem("radio88_cadastros_admin_session")).toContain(
        "jwt-test",
      );
    });
  });

  it("nao oferece cadastro publico nem bootstrap de administrador", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => jsonResponse({}, 404));
    renderApp(<App />, ["/login"]);
    expect(await screen.findByText("Acesso interno somente por convite")).toBeVisible();
    expect(screen.queryByRole("button", { name: /criar primeiro acesso/i })).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/bootstrap"))).toBe(false);
  });

  it("consolida a navegação RBAC em Acessos com abas de Administração", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, _init) => {
      const url = String(input);
      if (url.endsWith("/api/admin/auth/login")) {
        return jsonResponse({ accessToken: "jwt-rbac", expiresIn: "2h", user: {
          id: "role-admin", name: "Gestor", username: "gestor", role: "viewer",
          permissions: ["role.read", "permission.read"],
        } });
      }
      if (url.endsWith("/api/admin/roles")) {
        return jsonResponse({ items: [{
          id: "marketing-role", key: "gestor_marketing", name: "Gestor Marketing",
          description: "Equipe de marketing", version: 1, user_count: 2,
          grants: [{ permissionKey: "campaign.read", scopeType: "global", departmentId: null }],
        }] });
      }
      if (url.endsWith("/api/admin/permissions")) {
        return jsonResponse({ items: [{ key: "campaign.read", description: "Consultar campanhas", role_grants: [] }] });
      }
      return jsonResponse({}, 404);
    });

    renderApp(<App />, ["/login"]);
    fireEvent.change(screen.getByLabelText("E-mail ou usuário"), { target: { value: "gestor" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "password-rbac" } });
    fireEvent.click(screen.getByRole("button", { name: /entrar no painel/i }));

    expect(await screen.findByRole("heading", { name: "Administração" })).toBeVisible();
    expect(await screen.findByText("Permissões · Gestor Marketing")).toBeVisible();
    expect(screen.getByRole("link", { name: "Acessos" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Papéis" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Usuários internos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Permissões" })).not.toBeInTheDocument();
  });

  it("preserva exceções fora das telas ao salvar a matriz de acesso", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith("/api/admin/auth/login")) {
        return jsonResponse({ accessToken: "jwt-super", expiresIn: "2h", user: {
          id: "super-admin", name: "Super Admin", username: "root", role: "admin",
          isSuperAdmin: true,
          permissions: ["user.read", "user.permissions.read", "user.permissions.manage"],
        } });
      }
      if (url.includes("/api/admin/users?") && init?.method !== "PUT") {
        return jsonResponse({ items: [{
          id: "marketing-user", name: "Ana Marketing", username: "ana", email: "ana@example.com",
          email_verified_at: "2026-01-01T00:00:00Z", phone: null, active: true, is_super_admin: false,
          role: "viewer", version: 1, roles: [{ id: "role-1", key: "gestor_marketing", name: "Gestor Marketing" }],
        }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } });
      }
      if (url.endsWith("/api/admin/users/marketing-user")) {
        return jsonResponse({ user: {
          id: "marketing-user", name: "Ana Marketing", username: "ana", email: "ana@example.com",
          email_verified_at: "2026-01-01T00:00:00Z", phone: null, active: true, is_super_admin: false,
          role: "viewer", version: 1, roles: [{ id: "role-1", key: "gestor_marketing", name: "Gestor Marketing" }],
          effectivePermissions: [{ permission_key: "listener.read", scope_type: "department", department_id: "marketing" }],
          overrides: [{ permission_key: "feed.publish", effect: "DENY", scope_type: null, department_id: null, reason: "Aguardando aprovação", created_at: "2026-01-01T00:00:00Z" }],
          sessions: [],
        } });
      }
      if (url.endsWith("/api/admin/auth/reauthenticate")) return Promise.resolve(new Response(null, { status: 204 }));
      if (url.endsWith("/api/admin/users/marketing-user/overrides")) return Promise.resolve(new Response(null, { status: 204 }));
      return jsonResponse({}, 404);
    });

    renderApp(<App />, ["/administracao/acessos/telas"]);
    fireEvent.change(await screen.findByLabelText("E-mail ou usuário"), { target: { value: "root" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "password-super" } });
    fireEvent.click(screen.getByRole("button", { name: /entrar no painel/i }));

    expect(await screen.findByText("Limitado por escopo")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Exceção para Acessar Cadastros"), { target: { value: "ALLOW" } });
    fireEvent.change(screen.getByLabelText("Motivo da alteração (auditoria)"), { target: { value: "Acesso global aprovado" } });
    fireEvent.change(screen.getByLabelText("Confirme sua senha"), { target: { value: "password-super" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar acessos/i }));

    await waitFor(() => expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith("/api/admin/users/marketing-user/overrides"))).toBe(true));
    const updateCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith("/api/admin/users/marketing-user/overrides"));
    const body = JSON.parse(String(updateCall?.[1]?.body));
    expect(body.overrides).toEqual(expect.arrayContaining([
      { permissionKey: "feed.publish", effect: "DENY", reason: "Aguardando aprovação" },
      { permissionKey: "listener.read", effect: "ALLOW", scopeType: "global", reason: "Acesso global aprovado" },
    ]));
  });
});
