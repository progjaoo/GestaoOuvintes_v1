import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";

function normalizeSegment(value: string, fallback: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function normalizeTenantSlug(value = env.DEFAULT_TENANT_SLUG) {
  return normalizeSegment(value, "tenant");
}

export function normalizedObjectPrefix() {
  return env.R2_OBJECT_PREFIX.replace(/^\/+|\/+$/g, "");
}

export function tenantObjectPrefix(tenantSlug = env.DEFAULT_TENANT_SLUG) {
  return `tenants/${normalizeTenantSlug(tenantSlug)}/${normalizedObjectPrefix()}`;
}

export function createMediaObjectKey(extension: string, tenantSlug = env.DEFAULT_TENANT_SLUG) {
  const now = new Date();
  const prefix = env.TENANT_MEDIA_PATHS_ENABLED
    ? tenantObjectPrefix(tenantSlug)
    : normalizedObjectPrefix();

  return [
    prefix,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${randomUUID()}.${extension}`,
  ].join("/");
}

export function isManagedMediaObjectKey(key: string, tenantSlug = env.DEFAULT_TENANT_SLUG) {
  const normalized = key.trim().replace(/^\/+/, "");
  const prefix = normalizedObjectPrefix();
  const tenantPrefix = tenantObjectPrefix(tenantSlug);

  return (
    normalized === prefix ||
    normalized.startsWith(`${prefix}/`) ||
    normalized === tenantPrefix ||
    normalized.startsWith(`${tenantPrefix}/`)
  );
}
