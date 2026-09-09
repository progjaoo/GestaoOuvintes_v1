import { and, eq } from "drizzle-orm";
import { db } from "../database/client.js";
import { tenantFeatureFlags } from "../database/tenant-schema.js";

export const TENANT_FEATURE_KEYS = [
  "crm_v2",
  "programming",
  "polls",
  "push",
  "promotions_v2",
  "blog",
  "feed",
  "dashboard",
] as const;

export type TenantFeatureKey = (typeof TENANT_FEATURE_KEYS)[number];

export async function isTenantFeatureEnabled(
  tenantId: string,
  flagKey: TenantFeatureKey,
): Promise<boolean> {
  const result = await db
    .select({ enabled: tenantFeatureFlags.enabled })
    .from(tenantFeatureFlags)
    .where(and(eq(tenantFeatureFlags.tenantId, tenantId), eq(tenantFeatureFlags.flagKey, flagKey)))
    .limit(1);

  return result[0]?.enabled ?? false;
}

export async function getTenantFeatureFlags(tenantId: string) {
  const rows = await db
    .select({ flagKey: tenantFeatureFlags.flagKey, enabled: tenantFeatureFlags.enabled })
    .from(tenantFeatureFlags)
    .where(eq(tenantFeatureFlags.tenantId, tenantId));

  return TENANT_FEATURE_KEYS.reduce<Record<TenantFeatureKey, boolean>>((flags, key) => {
    flags[key] = rows.find((row) => row.flagKey === key)?.enabled ?? false;
    return flags;
  }, {} as Record<TenantFeatureKey, boolean>);
}
