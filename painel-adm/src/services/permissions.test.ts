import { describe, expect, it } from "vitest";
import {
  canCreateCampaign,
  canDrawSweepstake,
  canPublishCampaign,
  canUpdateCampaign,
  getDefaultAdminPath,
  getDefaultAccessPath,
  hasPermission,
} from "./permissions";
import type { AdminUser } from "@/types/api";

const user = (permissions: string[]): AdminUser => ({
  id: "user-1",
  name: "Operador",
  username: "operador",
  role: "viewer",
  permissions,
});

describe("panel authorization helpers", () => {
  it("does not infer access from the legacy admin role", () => {
    expect(hasPermission(user([]), "feed.read")).toBe(false);
  });

  it("chooses the first route currently allowed to the account", () => {
    expect(getDefaultAdminPath(user(["feed.read"]))).toBe("/conteudo/feed");
    expect(getDefaultAdminPath(user(["campaign.read", "listener.read"]))).toBe("/ouvintes/cadastros");
    expect(getDefaultAdminPath(user([]))).toBe("/sem-acesso");
  });

  it("routes RBAC-only accounts into the consolidated access area", () => {
    expect(getDefaultAdminPath(user(["role.read", "permission.read"]))).toBe("/administracao/acessos/papeis");
    expect(getDefaultAdminPath(user(["user.read"]))).toBe("/administracao/acessos/usuarios");
    expect(getDefaultAccessPath(user(["user.read", "user.permissions.read"]))).toBe("/administracao/acessos/usuarios");
    expect(getDefaultAccessPath(user(["user.permissions.read"]))).toBeNull();
  });

  it("shows draw actions only when the API-required permissions are all present", () => {
    expect(canDrawSweepstake(user(["sweepstake.draw", "sweepstake.read"]))).toBe(false);
    expect(canDrawSweepstake(user(["sweepstake.draw", "listener.phone.read"]))).toBe(false);
    expect(canDrawSweepstake(user([
      "sweepstake.draw",
      "sweepstake.read",
      "listener.phone.read",
    ]))).toBe(true);
  });

  it("keeps campaign actions aligned with granular permissions", () => {
    const campaignManager = user([
      "campaign.read",
      "campaign.create",
      "campaign.update",
      "campaign.publish",
    ]);
    expect(canCreateCampaign(campaignManager)).toBe(true);
    expect(canUpdateCampaign(campaignManager)).toBe(true);
    expect(canPublishCampaign(campaignManager)).toBe(true);
    expect(canCreateCampaign(user(["campaign.read"]))).toBe(false);
  });
});
