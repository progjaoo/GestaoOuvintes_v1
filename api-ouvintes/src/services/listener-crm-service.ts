import { pool } from "../database/client.js";
import { AppError } from "../lib/errors.js";
import { createPagination } from "../lib/pagination.js";
import type { ListenerProfileListQuery } from "../schemas/listener-crm.js";

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length <= 4) return "****";
  if (phone.length <= 7) return phone.slice(0, 2) + "****" + phone.slice(-2);
  return "(" + phone.slice(0, 2) + ") *****-" + phone.slice(-4);
}

function normalizeDateBoundary(value: string | undefined, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  return value + (endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z");
}

function addParam(params: unknown[], value: unknown): string {
  params.push(value);
  return "$" + params.length;
}

function profileRow(row: {
  id: string;
  name: string;
  neighborhood: string;
  city: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  ageRange: string | null;
  status: string;
  completedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  clerkUserId: string | null;
  participationCount: number | string;
  activeConsentCount: number | string;
}, includeSensitive: boolean) {
  const phone = includeSensitive ? row.phone : null;
  return {
    id: row.id,
    name: row.name,
    neighborhood: row.neighborhood,
    city: row.city,
    phone,
    phoneMasked: maskPhone(row.phone),
    email: includeSensitive ? row.email : null,
    gender: includeSensitive ? row.gender : null,
    ageRange: includeSensitive ? row.ageRange : null,
    status: row.status,
    profileComplete: Boolean(row.completedAt),
    accountLinked: Boolean(row.clerkUserId),
    participationCount: Number(row.participationCount),
    activeConsentCount: Number(row.activeConsentCount),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function buildWhere(
  filters: ListenerProfileListQuery,
  tenantId: string,
  params: unknown[],
) {
  const conditions = ["lp.tenant_id = " + addParam(params, tenantId), "lp.deleted_at is null"];

  if (filters.q) {
    const p = addParam(params, "%" + filters.q + "%");
    conditions.push(
      "(lp.name ilike " +
        p +
        " or lp.city ilike " +
        p +
        " or lp.neighborhood ilike " +
        p +
        " or coalesce(lp.phone, '') ilike " +
        p +
        " or coalesce(lp.email, '') ilike " +
        p +
        ")",
    );
  }
  if (filters.city) {
    conditions.push("lp.city ilike " + addParam(params, "%" + filters.city + "%"));
  }
  if (filters.neighborhood) {
    conditions.push("lp.neighborhood ilike " + addParam(params, "%" + filters.neighborhood + "%"));
  }
  if (filters.campaignId) {
    conditions.push(
      "exists (select 1 from campaign_participation cpf where cpf.tenant_id = lp.tenant_id and cpf.listener_profile_id = lp.id and cpf.campaign_id = " +
        addParam(params, filters.campaignId) +
        ")",
    );
  }
  if (filters.consentType) {
    conditions.push(
      "exists (select 1 from listener_consent lc where lc.tenant_id = lp.tenant_id and lc.listener_profile_id = lp.id and lc.consent_type = " +
        addParam(params, filters.consentType) +
        " and lc.granted = true and lc.revoked_at is null)",
    );
  }
  if (filters.status) {
    conditions.push("lp.status = " + addParam(params, filters.status));
  }
  const startDate = normalizeDateBoundary(filters.startDate, false);
  if (startDate) conditions.push("lp.created_at >= " + addParam(params, startDate));
  const endDate = normalizeDateBoundary(filters.endDate, true);
  if (endDate) conditions.push("lp.created_at <= " + addParam(params, endDate));

  return conditions.join(" and ");
}

const sortColumns: Record<string, string> = {
  createdAt: "lp.created_at",
  updatedAt: "lp.updated_at",
  name: "lp.name",
  city: "lp.city",
  participations: "participation_count",
};

export async function listListenerProfiles(
  filters: ListenerProfileListQuery,
  tenantId: string,
  includeSensitive: boolean,
) {
  const params: unknown[] = [];
  const where = buildWhere(filters, tenantId, params);
  const orderColumn = sortColumns[filters.sortBy] ?? sortColumns.createdAt;
  const direction = filters.sortDirection === "asc" ? "asc" : "desc";
  const limit = addParam(params, filters.pageSize);
  const offset = addParam(params, (filters.page - 1) * filters.pageSize);

  const result = await pool.query({
    text:
      "select lp.id, lp.name, lp.neighborhood, lp.city, lp.phone, lp.email, lp.gender, " +
      "lp.age_range as \"ageRange\", lp.status, lp.completed_at as \"completedAt\", " +
      "lp.created_at as \"createdAt\", lp.updated_at as \"updatedAt\", " +
      "li.clerk_user_id as \"clerkUserId\", count(distinct cp.id)::int as \"participationCount\", " +
      "count(distinct lc.id) filter (where lc.granted = true and lc.revoked_at is null)::int as \"activeConsentCount\" " +
      "from listener_profile lp " +
      "left join listener_identity li on li.id = lp.listener_identity_id and li.tenant_id = lp.tenant_id " +
      "left join campaign_participation cp on cp.listener_profile_id = lp.id and cp.tenant_id = lp.tenant_id " +
      "left join listener_consent lc on lc.listener_profile_id = lp.id and lc.tenant_id = lp.tenant_id " +
      "where " + where +
      " group by lp.id, li.clerk_user_id order by " + orderColumn + " " + direction +
      ", lp.id asc limit " + limit + " offset " + offset,
    values: params,
  });

  const countParams: unknown[] = [];
  const countWhere = buildWhere(filters, tenantId, countParams);
  const countResult = await pool.query(
    "select count(*)::int as count from listener_profile lp where " + countWhere,
    countParams,
  );

  const rows = result.rows as Array<Parameters<typeof profileRow>[0]>;
  return createPagination(
    rows.map((row) => profileRow(row, includeSensitive)),
    filters.page,
    filters.pageSize,
    Number((countResult.rows[0] as { count: number | string } | undefined)?.count ?? 0),
  );
}

export async function getListenerProfile(
  profileId: string,
  tenantId: string,
  includeSensitive: boolean,
) {
  const result = await pool.query(
    "select lp.id, lp.name, lp.neighborhood, lp.city, lp.phone, lp.email, lp.gender, " +
      "lp.age_range as \"ageRange\", lp.status, lp.completed_at as \"completedAt\", " +
      "lp.created_at as \"createdAt\", lp.updated_at as \"updatedAt\", " +
      "li.clerk_user_id as \"clerkUserId\", count(distinct cp.id)::int as \"participationCount\", " +
      "count(distinct lc.id) filter (where lc.granted = true and lc.revoked_at is null)::int as \"activeConsentCount\" " +
      "from listener_profile lp " +
      "left join listener_identity li on li.id = lp.listener_identity_id and li.tenant_id = lp.tenant_id " +
      "left join campaign_participation cp on cp.listener_profile_id = lp.id and cp.tenant_id = lp.tenant_id " +
      "left join listener_consent lc on lc.listener_profile_id = lp.id and lc.tenant_id = lp.tenant_id " +
      "where lp.id = $1 and lp.tenant_id = $2 and lp.deleted_at is null " +
      "group by lp.id, li.clerk_user_id",
    [profileId, tenantId],
  );
  const row = result.rows[0] as Parameters<typeof profileRow>[0] | undefined;
  if (!row) throw new AppError(404, "LISTENER_PROFILE_NOT_FOUND", "Perfil nao encontrado.");
  return profileRow(row, includeSensitive);
}

export async function listProfileParticipations(
  profileId: string,
  tenantId: string,
) {
  const result = await pool.query(
    "select cp.id, cp.status, cp.source, cp.created_at as \"createdAt\", " +
      "c.id as \"campaignId\", c.name as \"campaignName\", c.slug as \"campaignSlug\" " +
      "from campaign_participation cp join campaign c on c.id = cp.campaign_id and c.tenant_id = cp.tenant_id " +
      "where cp.listener_profile_id = $1 and cp.tenant_id = $2 order by cp.created_at desc",
    [profileId, tenantId],
  );
  return {
    items: result.rows.map((row) => ({
      id: row.id as string,
      status: row.status as string,
      source: row.source as string,
      createdAt: new Date(row.createdAt as Date | string).toISOString(),
      campaignId: row.campaignId as string,
      campaignName: row.campaignName as string,
      campaignSlug: row.campaignSlug as string,
    })),
  };
}

export async function listProfileConsents(profileId: string, tenantId: string) {
  const result = await pool.query(
    "select id, consent_type as \"consentType\", document_version as \"documentVersion\", " +
      "granted, source, created_at as \"createdAt\", revoked_at as \"revokedAt\" " +
      "from listener_consent where listener_profile_id = $1 and tenant_id = $2 order by created_at desc",
    [profileId, tenantId],
  );
  return {
    items: result.rows.map((row) => ({
      id: row.id as string,
      consentType: row.consentType as string,
      documentVersion: row.documentVersion as string | null,
      granted: Boolean(row.granted),
      source: row.source as string,
      createdAt: new Date(row.createdAt as Date | string).toISOString(),
      revokedAt: row.revokedAt ? new Date(row.revokedAt as Date | string).toISOString() : null,
    })),
  };
}

export async function listProfileActivity(profileId: string, tenantId: string) {
  const result = await pool.query(
    "select id, event_type as \"eventType\", metadata, created_at as \"createdAt\" " +
      "from listener_activity_log where listener_profile_id = $1 and tenant_id = $2 " +
      "order by created_at desc limit 200",
    [profileId, tenantId],
  );
  return {
    items: result.rows.map((row) => ({
      id: row.id as string,
      eventType: row.eventType as string,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: new Date(row.createdAt as Date | string).toISOString(),
    })),
  };
}
