import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PollAreaNavigation } from "./PollAreaNavigation";

const auth = vi.hoisted(() => ({ user: { permissions: [] as string[] } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

function renderNavigation(permissions: string[]) {
  auth.user.permissions = permissions;
  return render(<MemoryRouter><PollAreaNavigation /></MemoryRouter>);
}

describe("PollAreaNavigation", () => {
  beforeEach(() => { auth.user.permissions = []; });

  it("shows only the calendar for a user with calendar permission", () => {
    renderNavigation(["calendar_integration.read"]);
    expect(screen.getByRole("link", { name: "Calendário" })).toHaveAttribute("href", "/enquetes/calendario");
    expect(screen.queryByRole("link", { name: "Gestão" })).not.toBeInTheDocument();
  });

  it("does not imply calendar permission from poll access", () => {
    renderNavigation(["poll.read"]);
    expect(screen.getByRole("link", { name: "Gestão" })).toHaveAttribute("href", "/enquetes/gestao");
    expect(screen.queryByRole("link", { name: "Calendário" })).not.toBeInTheDocument();
  });

  it("keeps result/message-only access separate from the poll catalog", () => {
    renderNavigation(["participation.read"]);
    expect(screen.getByRole("link", { name: "Gestão" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Calendário" })).not.toBeInTheDocument();
  });
});
