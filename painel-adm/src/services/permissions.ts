import type { AdminUser } from "@/types/api";

export function hasPermission(user: AdminUser | null | undefined, key: string) {
  return user?.permissions?.includes(key) ?? false;
}

export function canDrawSweepstake(user: AdminUser | null | undefined) {
  return hasPermission(user, "sweepstake.draw") &&
    hasPermission(user, "sweepstake.read") &&
    hasPermission(user, "listener.phone.read");
}

export function canCreateCampaign(user: AdminUser | null | undefined) {
  return hasPermission(user, "campaign.create");
}

export function canUpdateCampaign(user: AdminUser | null | undefined) {
  return hasPermission(user, "campaign.update");
}

export function canPublishCampaign(user: AdminUser | null | undefined) {
  return hasPermission(user, "campaign.publish");
}

export function getDefaultAdminPath(user: AdminUser | null | undefined) {
  const candidates = [
    ["listener.read", "/ouvintes/cadastros"],
    ["campaign.read", "/campanhas"],
    ["institutional_banner.read", "/banners-institucionais"],
    ["feed.read", "/conteudo/feed"],
    ["program.read", "/programas"],
    ["calendar_integration.read", "/enquetes/calendario"],
    ["calendar_integration.manage", "/enquetes/calendario"],
    ["calendar_integration.sync", "/enquetes/calendario"],
    ["poll.read", "/enquetes"],
    ["poll.results.read", "/enquetes"],
    ["participation.read", "/enquetes"],
  ] as const;

  const standardPath = candidates.find(([permission]) => hasPermission(user, permission))?.[1];
  if (standardPath) return standardPath;
  return getDefaultAccessPath(user) ?? "/sem-acesso";
}

export function getDefaultAccessPath(user: AdminUser | null | undefined) {
  if (hasPermission(user, "user.read")) return "/administracao/acessos/usuarios";
  if (hasPermission(user, "role.read") && hasPermission(user, "permission.read")) {
    return "/administracao/acessos/papeis";
  }
  if (hasPermission(user, "user.read") && hasPermission(user, "user.permissions.read")) {
    return "/administracao/acessos/telas";
  }
  return null;
}
