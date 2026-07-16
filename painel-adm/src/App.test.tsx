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
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/admin/auth/bootstrap-status")) {
        return jsonResponse({ canBootstrap: false });
      }

      if (url.endsWith("/api/admin/auth/login")) {
        return jsonResponse({
          accessToken: "jwt-test",
          expiresIn: "2h",
          user: {
            id: "admin-id",
            name: "Administrador",
            username: "admin",
            role: "admin",
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
    fireEvent.change(screen.getByLabelText("Usuário"), {
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

  it("cria o primeiro administrador quando o bootstrap esta disponivel", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/api/admin/auth/bootstrap-status")) {
        return jsonResponse({ canBootstrap: true });
      }

      if (url.endsWith("/api/admin/auth/bootstrap")) {
        return jsonResponse(
          {
            accessToken: "jwt-bootstrap",
            expiresIn: "2h",
            user: {
              id: "admin-bootstrap-id",
              name: "Administrador Inicial",
              username: "admin",
              role: "admin",
            },
          },
          201,
        );
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
    fireEvent.click(await screen.findByRole("button", { name: /criar primeiro acesso/i }));
    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Administrador Inicial" },
    });
    fireEvent.change(screen.getByLabelText("Usuário"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "development-admin-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar senha"), {
      target: { value: "development-admin-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /criar e entrar/i }));

    expect(
      await screen.findByRole("heading", { name: /cadastros de ouvintes/i }),
    ).toBeVisible();
    await waitFor(() => {
      expect(sessionStorage.getItem("radio88_cadastros_admin_session")).toContain(
        "jwt-bootstrap",
      );
    });
  });
});
