import { env } from "../config/env.js";
import { pool } from "../database/client.js";
import { AppError } from "../lib/errors.js";

export const DEFAULT_TENANT_ID = "00000000-0000-4000-8000-000000000088";

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  timezone: string;
}

export interface AdminTenantContext extends TenantContext {
  membershipId: string | null;
  roleKeys: string[];
  permissionKeys: string[];
}

export function getDefaultTenantContext(): AdminTenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    tenantSlug: env.DEFAULT_TENANT_SLUG,
    timezone: env.PROGRAMMING_TIMEZONE,
    membershipId: null,
    roleKeys: [],
    permissionKeys: [],
  };
}

function deduplicate(values: string[]) {
  return [...new Set(values)].sort();
}

export async function resolveAdminTenantContext(
  adminUserId: string,
  requestedTenantId?: string,
): Promise<AdminTenantContext> {
  if (!env.TENANCY_ENABLED && !env.TENANT_MEMBERSHIP_RBAC_ENABLED) {
    return getDefaultTenantContext();
  }

  const result = await pool.query<{
    membership_id: string;
    tenant_id: string;
    tenant_slug: string;
    timezone: string;
    role_key: string;
    permission_key: string | null;
  }>(
    `SELECT tam.id AS membership_id,
            t.id AS tenant_id,
            t.slug AS tenant_slug,
            t.timezone,
            r.key AS role_key,
            p.key AS permission_key
       FROM tenant_admin_membership tam
       JOIN tenant t ON t.id = tam.tenant_id
       JOIN role r ON r.id = tam.role_id
       LEFT JOIN role_permission rp ON rp.role_id = r.id
       LEFT JOIN permission p ON p.id = rp.permission_id
      WHERE tam.admin_user_id = $1
        AND tam.active = true
        AND t.status = 'active'
        AND ($2::uuid IS NULL OR t.id = $2::uuid)
      ORDER BY t.slug, r.key, p.key`,
    [adminUserId, requestedTenantId ?? null],
  );

  const first = result.rows[0];
  if (!first) {
    throw new AppError(403, "TENANT_ACCESS_DENIED", "Tenant nao autorizado para este usuario.");
  }

  return {
    tenantId: first.tenant_id,
    tenantSlug: first.tenant_slug,
    timezone: first.timezone,
    membershipId: first.membership_id,
    roleKeys: deduplicate(result.rows.map((row) => row.role_key)),
    permissionKeys: deduplicate(
      result.rows.flatMap((row) => row.permission_key ? [row.permission_key] : []),
    ),
  };
}

export async function listAdminTenants(adminUserId: string) {
  if (!env.TENANCY_ENABLED && !env.TENANT_MEMBERSHIP_RBAC_ENABLED) {
    const fallback = getDefaultTenantContext();
    return [{
      id: fallback.tenantId,
      slug: fallback.tenantSlug,
      name: "Radio 88 FM",
      timezone: fallback.timezone,
      roleKeys: ["admin"],
    }];
  }

  const result = await pool.query<{
    id: string;
    slug: string;
    name: string;
    timezone: string;
    role_key: string;
  }>(
    `SELECT t.id, t.slug, t.name, t.timezone, r.key AS role_key
       FROM tenant_admin_membership tam
       JOIN tenant t ON t.id = tam.tenant_id
       JOIN role r ON r.id = tam.role_id
      WHERE tam.admin_user_id = $1
        AND tam.active = true
        AND t.status = 'active'
      ORDER BY t.name`,
    [adminUserId],
  );

  return result.rows.reduce<Array<{
    id: string;
    slug: string;
    name: string;
    timezone: string;
    roleKeys: string[];
  }>>((tenants, row) => {
    const current = tenants.find((tenant) => tenant.id === row.id);
    if (current) {
      current.roleKeys = deduplicate([...current.roleKeys, row.role_key]);
    } else {
      tenants.push({
        id: row.id,
        slug: row.slug,
        name: row.name,
        timezone: row.timezone,
        roleKeys: [row.role_key],
      });
    }
    return tenants;
  }, []);
}

export async function ensureAdminDefaultMembership(adminUserId: string) {
  if (!env.TENANCY_ENABLED && !env.TENANT_MEMBERSHIP_RBAC_ENABLED) return;

  await pool.query(
    `INSERT INTO tenant_admin_membership (admin_user_id, tenant_id, role_id)
     SELECT $1, t.id, r.id
       FROM tenant t
       JOIN role r ON r.key = 'admin'
      WHERE t.slug = $2
     ON CONFLICT (admin_user_id, tenant_id, role_id) DO UPDATE
       SET active = true, updated_at = now()`,
    [adminUserId, env.DEFAULT_TENANT_SLUG],
  );
}

export async function resolvePublicTenant(host?: string): Promise<TenantContext> {
  const fallback = getDefaultTenantContext();
  if (!env.TENANCY_ENABLED || !host) return fallback;

  const hostname = host.split(":", 1)[0]?.trim().toLowerCase();
  if (!hostname) return fallback;

  const result = await pool.query<{
    tenant_id: string;
    tenant_slug: string;
    timezone: string;
  }>(
    `SELECT t.id AS tenant_id, t.slug AS tenant_slug, t.timezone
       FROM tenant_domain td
       JOIN tenant t ON t.id = td.tenant_id
      WHERE lower(td.hostname) = $1
        AND td.active = true
        AND t.status = 'active'
      LIMIT 1`,
    [hostname],
  );
  const tenant = result.rows[0];
  return tenant
    ? { tenantId: tenant.tenant_id, tenantSlug: tenant.tenant_slug, timezone: tenant.timezone }
    : fallback;
}
