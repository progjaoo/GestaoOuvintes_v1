import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  type SQL,
} from "drizzle-orm";
import { db } from "../database/client.js";
import {
  campaigns,
  listenerRegistrations,
  registrationExportAudits,
} from "../database/schema.js";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import {
  hashIp,
  normalizePhone,
  normalizeText,
  summarizeUserAgent,
} from "../lib/normalization.js";
import type { RegistrationFilters } from "../schemas/registration.js";
import { findActiveCampaignForRegistration } from "./campaign-service.js";

interface CreateRegistrationInput {
  campaignSlug: string;
  name: string;
  neighborhood: string;
  city: string;
  phone?: string | null;
  submissionToken: string;
  privacyNoticeVersion: string;
  marketingOptIn: boolean;
  source: "institutional_web" | "institutional_mobile" | "admin_import";
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
  };
}

interface RegistrationRequestContext {
  ip: string;
  userAgent?: string;
}

export async function createListenerRegistration(
  input: CreateRegistrationInput,
  context: RegistrationRequestContext,
) {
  const campaign = await findActiveCampaignForRegistration(input.campaignSlug);

  if (input.privacyNoticeVersion !== campaign.privacyNoticeVersion) {
    throw new AppError(
      409,
      "PRIVACY_NOTICE_VERSION_MISMATCH",
      "O aviso de privacidade foi atualizado. Recarregue a pagina.",
    );
  }

  const now = new Date();
  const values = {
    campaignId: campaign.id,
    name: normalizeText(input.name),
    neighborhood: normalizeText(input.neighborhood),
    city: normalizeText(input.city),
    phone: normalizePhone(input.phone),
    source: input.source,
    submissionToken: input.submissionToken,
    privacyNoticeVersion: input.privacyNoticeVersion,
    privacyAcknowledgedAt: now,
    marketingOptIn: input.marketingOptIn,
    marketingOptInAt: input.marketingOptIn ? now : null,
    utmSource: input.utm?.source ?? null,
    utmMedium: input.utm?.medium ?? null,
    utmCampaign: input.utm?.campaign ?? null,
    utmContent: input.utm?.content ?? null,
    ipHash: hashIp(context.ip, env.IP_HASH_SECRET),
    userAgentSummary: summarizeUserAgent(context.userAgent),
  };

  const inserted = await db
    .insert(listenerRegistrations)
    .values(values)
    .onConflictDoNothing({
      target: [
        listenerRegistrations.campaignId,
        listenerRegistrations.submissionToken,
      ],
    })
    .returning({
      id: listenerRegistrations.id,
      createdAt: listenerRegistrations.createdAt,
    });

  if (inserted[0]) {
    return {
      created: true,
      id: inserted[0].id,
      createdAt: inserted[0].createdAt.toISOString(),
    };
  }

  const existing = await db.query.listenerRegistrations.findFirst({
    columns: {
      id: true,
      createdAt: true,
    },
    where: and(
      eq(listenerRegistrations.campaignId, campaign.id),
      eq(listenerRegistrations.submissionToken, input.submissionToken),
    ),
  });

  if (!existing) {
    throw new AppError(500, "REGISTRATION_LOOKUP_FAILED", "Falha ao confirmar cadastro.");
  }

  return {
    created: false,
    id: existing.id,
    createdAt: existing.createdAt.toISOString(),
  };
}

export function buildRegistrationConditions(
  filters: Omit<RegistrationFilters, "format">,
): SQL[] {
  const conditions: SQL[] = [isNull(listenerRegistrations.deletedAt)];

  if (filters.campaignId) {
    conditions.push(eq(listenerRegistrations.campaignId, filters.campaignId));
  }
  if (filters.startDate) {
    conditions.push(gte(listenerRegistrations.createdAt, new Date(filters.startDate)));
  }
  if (filters.endDate) {
    conditions.push(lte(listenerRegistrations.createdAt, new Date(filters.endDate)));
  }
  if (filters.city) {
    conditions.push(ilike(listenerRegistrations.city, `%${filters.city}%`));
  }
  if (filters.neighborhood) {
    conditions.push(
      ilike(listenerRegistrations.neighborhood, `%${filters.neighborhood}%`),
    );
  }
  if (filters.name) {
    conditions.push(ilike(listenerRegistrations.name, `%${filters.name}%`));
  }
  if (filters.hasPhone === true) {
    conditions.push(isNotNull(listenerRegistrations.phone));
  }
  if (filters.hasPhone === false) {
    conditions.push(isNull(listenerRegistrations.phone));
  }

  return conditions;
}

export async function listListenerRegistrations(
  filters: Omit<RegistrationFilters, "format"> & {
    page: number;
    pageSize: number;
  },
) {
  const { page, pageSize, ...filterValues } = filters;
  const where = and(...buildRegistrationConditions(filterValues));

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: listenerRegistrations.id,
        campaignId: listenerRegistrations.campaignId,
        campaignName: campaigns.name,
        name: listenerRegistrations.name,
        neighborhood: listenerRegistrations.neighborhood,
        city: listenerRegistrations.city,
        phone: listenerRegistrations.phone,
        source: listenerRegistrations.source,
        marketingOptIn: listenerRegistrations.marketingOptIn,
        createdAt: listenerRegistrations.createdAt,
      })
      .from(listenerRegistrations)
      .innerJoin(campaigns, eq(campaigns.id, listenerRegistrations.campaignId))
      .where(where)
      .orderBy(desc(listenerRegistrations.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(listenerRegistrations)
      .where(where),
  ]);

  return {
    rows,
    total: Number(totalRows[0]?.total ?? 0),
  };
}

export async function getListenerRegistration(id: string) {
  const [registration] = await db
    .select({
      id: listenerRegistrations.id,
      campaignId: listenerRegistrations.campaignId,
      campaignName: campaigns.name,
      name: listenerRegistrations.name,
      neighborhood: listenerRegistrations.neighborhood,
      city: listenerRegistrations.city,
      phone: listenerRegistrations.phone,
      source: listenerRegistrations.source,
      privacyNoticeVersion: listenerRegistrations.privacyNoticeVersion,
      privacyAcknowledgedAt: listenerRegistrations.privacyAcknowledgedAt,
      marketingOptIn: listenerRegistrations.marketingOptIn,
      marketingOptInAt: listenerRegistrations.marketingOptInAt,
      utmSource: listenerRegistrations.utmSource,
      utmMedium: listenerRegistrations.utmMedium,
      utmCampaign: listenerRegistrations.utmCampaign,
      utmContent: listenerRegistrations.utmContent,
      createdAt: listenerRegistrations.createdAt,
    })
    .from(listenerRegistrations)
    .innerJoin(campaigns, eq(campaigns.id, listenerRegistrations.campaignId))
    .where(
      and(
        eq(listenerRegistrations.id, id),
        isNull(listenerRegistrations.deletedAt),
      ),
    )
    .limit(1);

  if (!registration) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Cadastro nao encontrado.");
  }

  return registration;
}

export async function getRegistrationsForExport(
  filters: Omit<RegistrationFilters, "format">,
) {
  const where = and(...buildRegistrationConditions(filters));

  return db
    .select({
      id: listenerRegistrations.id,
      campaignId: listenerRegistrations.campaignId,
      campaignName: campaigns.name,
      name: listenerRegistrations.name,
      neighborhood: listenerRegistrations.neighborhood,
      city: listenerRegistrations.city,
      phone: listenerRegistrations.phone,
      source: listenerRegistrations.source,
      marketingOptIn: listenerRegistrations.marketingOptIn,
      createdAt: listenerRegistrations.createdAt,
    })
    .from(listenerRegistrations)
    .innerJoin(campaigns, eq(campaigns.id, listenerRegistrations.campaignId))
    .where(where)
    .orderBy(desc(listenerRegistrations.createdAt))
    .limit(env.EXPORT_MAX_ROWS);
}

export async function auditExport(input: {
  adminUserId: string;
  campaignId?: string;
  format: "csv" | "xlsx";
  filters: Record<string, unknown>;
  rowCount: number;
}) {
  await db.insert(registrationExportAudits).values({
    adminUserId: input.adminUserId,
    campaignId: input.campaignId,
    format: input.format,
    filtersJson: input.filters,
    rowCount: input.rowCount,
  });
}
