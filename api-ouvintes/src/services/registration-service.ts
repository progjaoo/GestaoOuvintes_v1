import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../database/client.js";
import {
  campaignParticipations,
  campaigns,
  listenerActivityLogs,
  listenerCommunicationPreferences,
  listenerConsents,
  listenerIdentities,
  listenerProfiles,
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
import { hashListenerPhone } from "./listener-profile-service.js";
import { DEFAULT_TENANT_ID } from "./tenant-service.js";

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

function phoneAlreadyParticipatingError() {
  return new AppError(
    409,
    "PHONE_ALREADY_PARTICIPATING",
    "Você já está participando do sorteio.",
  );
}

function isCampaignPhoneUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const databaseError = error as {
    code?: string;
    constraint?: string;
    cause?: unknown;
  };

  return (
    (databaseError.code === "23505" &&
      databaseError.constraint ===
        "listener_registration_campaign_phone_unique") ||
    isCampaignPhoneUniqueViolation(databaseError.cause)
  );
}

function isProfilePhoneUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const databaseError = error as {
    code?: string;
    constraint?: string;
    cause?: unknown;
  };

  return (
    (databaseError.code === "23505" &&
      databaseError.constraint === "listener_profile_tenant_phone_unique") ||
    isProfilePhoneUniqueViolation(databaseError.cause)
  );
}

export async function createListenerRegistration(
  input: CreateRegistrationInput,
  context: RegistrationRequestContext,
  tenantId = DEFAULT_TENANT_ID,
) {
  const campaign = await findActiveCampaignForRegistration(input.campaignSlug, tenantId);

  if (input.privacyNoticeVersion !== campaign.privacyNoticeVersion) {
    throw new AppError(
      409,
      "PRIVACY_NOTICE_VERSION_MISMATCH",
      "O aviso de privacidade foi atualizado. Recarregue a pagina.",
    );
  }

  const now = new Date();
  const phone = normalizePhone(input.phone);
  const values = {
    tenantId,
    campaignId: campaign.id,
    name: normalizeText(input.name),
    neighborhood: normalizeText(input.neighborhood),
    city: normalizeText(input.city),
    phone,
    phoneNormalized: phone,
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

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`listener-registration:token:${campaign.id}:${input.submissionToken}`}))`,
      );

      const existing = await tx.query.listenerRegistrations.findFirst({
        columns: {
          id: true,
          createdAt: true,
        },
        where: and(
          eq(listenerRegistrations.campaignId, campaign.id),
          eq(listenerRegistrations.submissionToken, input.submissionToken),
        ),
      });

      if (existing) {
        return {
          created: false,
          id: existing.id,
          createdAt: existing.createdAt.toISOString(),
        };
      }

      if (phone) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`listener-profile:phone:${tenantId}:${phone}`}))`,
        );

        const registrationWithPhone =
          await tx.query.listenerRegistrations.findFirst({
            columns: { id: true },
            where: and(
              eq(listenerRegistrations.tenantId, tenantId),
              eq(listenerRegistrations.campaignId, campaign.id),
              eq(listenerRegistrations.phoneNormalized, phone),
              isNull(listenerRegistrations.deletedAt),
            ),
          });

        if (registrationWithPhone) {
          throw phoneAlreadyParticipatingError();
        }
      }

      let profile = phone
        ? await tx.query.listenerProfiles.findFirst({
            where: and(
              eq(listenerProfiles.tenantId, tenantId),
              eq(listenerProfiles.phoneNormalized, phone),
              isNull(listenerProfiles.deletedAt),
            ),
          })
        : undefined;
      let identity = profile
        ? await tx.query.listenerIdentities.findFirst({
            where: and(
              eq(listenerIdentities.id, profile.listenerIdentityId),
              eq(listenerIdentities.tenantId, tenantId),
            ),
          })
        : undefined;
      let profileWasCreated = false;

      if (profile) {
        if (!phone) {
          throw new AppError(
            400,
            "PHONE_REQUIRED",
            "Informe um telefone com DDD.",
          );
        }

        if (!identity) {
          throw new AppError(
            500,
            "LISTENER_IDENTITY_MISSING",
            "O cadastro do ouvinte esta sem identidade vinculada.",
          );
        }

        const existingParticipation = await tx.query.campaignParticipations.findFirst({
          where: and(
            eq(campaignParticipations.tenantId, tenantId),
            eq(campaignParticipations.campaignId, campaign.id),
            eq(campaignParticipations.listenerProfileId, profile.id),
          ),
        });
        if (existingParticipation) {
          throw phoneAlreadyParticipatingError();
        }

        const [updatedProfile] = await tx
          .update(listenerProfiles)
          .set({
            name: values.name,
            neighborhood: values.neighborhood,
            city: values.city,
            phone,
            phoneNormalized: phone,
            phoneHash: hashListenerPhone(phone),
            marketingOptIn: profile.marketingOptIn || input.marketingOptIn,
            completedAt: now,
            updatedAt: now,
          })
          .where(and(eq(listenerProfiles.id, profile.id), eq(listenerProfiles.tenantId, tenantId)))
          .returning();
        profile = updatedProfile;
      } else if (phone) {
        profileWasCreated = true;
        const [createdIdentity] = await tx
          .insert(listenerIdentities)
          .values({
            tenantId,
            provider: "anonymous",
            providerSubject: `legacy-registration:${campaign.id}:${input.submissionToken}`,
            status: "unclaimed",
          })
          .returning();
        identity = createdIdentity;

        const [createdProfile] = await tx
          .insert(listenerProfiles)
          .values({
            tenantId,
            listenerIdentityId: identity!.id,
            name: values.name,
            neighborhood: values.neighborhood,
            city: values.city,
            phone,
            phoneNormalized: phone,
            phoneHash: hashListenerPhone(phone),
            marketingOptIn: input.marketingOptIn,
            completedAt: now,
          })
          .returning();
        profile = createdProfile;
      }

      const [inserted] = await tx
        .insert(listenerRegistrations)
        .values(values)
        .returning({
          id: listenerRegistrations.id,
          createdAt: listenerRegistrations.createdAt,
        });

      if (!inserted) {
        throw new AppError(
          500,
          "REGISTRATION_CREATE_FAILED",
          "Falha ao criar cadastro.",
        );
      }

      if (profile && identity) {
        await tx.insert(campaignParticipations).values({
          tenantId,
          campaignId: campaign.id,
          listenerProfileId: profile.id,
          source: input.source === "admin_import" ? "import" : "web",
          status: "eligible",
        });

        await tx.insert(listenerConsents).values([
          {
            tenantId,
            listenerProfileId: profile.id,
            consentType: "privacy_registration",
            documentVersion: input.privacyNoticeVersion,
            granted: true,
            source: input.source,
          },
          {
            tenantId,
            listenerProfileId: profile.id,
            consentType: "campaign_participation",
            documentVersion: input.privacyNoticeVersion,
            granted: true,
            source: input.source,
          },
          {
            tenantId,
            listenerProfileId: profile.id,
            consentType: "campaign_updates",
            documentVersion: input.privacyNoticeVersion,
            granted: input.marketingOptIn,
            source: input.source,
            revokedAt: input.marketingOptIn ? null : now,
          },
        ]);

        await tx
          .insert(listenerCommunicationPreferences)
          .values({
            tenantId,
            listenerProfileId: profile.id,
            receiveCampaignUpdates: input.marketingOptIn,
          })
          .onConflictDoUpdate({
            target: [
              listenerCommunicationPreferences.tenantId,
              listenerCommunicationPreferences.listenerProfileId,
            ],
            set: {
              receiveCampaignUpdates: sql`${listenerCommunicationPreferences.receiveCampaignUpdates} OR ${input.marketingOptIn}`,
              updatedAt: now,
            },
          });

        await tx.insert(listenerActivityLogs).values({
          tenantId,
          listenerIdentityId: identity.id,
          listenerProfileId: profile.id,
          eventType: profileWasCreated ? "profile.created" : "profile.reused",
          metadata: { campaignId: campaign.id, source: input.source },
        });
      }

      return {
        created: true,
        id: inserted.id,
        createdAt: inserted.createdAt.toISOString(),
      };
    });
  } catch (error) {
    if (isCampaignPhoneUniqueViolation(error)) {
      throw phoneAlreadyParticipatingError();
    }

    if (isProfilePhoneUniqueViolation(error)) {
      throw new AppError(
        409,
        "LISTENER_PROFILE_EXISTS",
        "Voce ja tem um cadastro conosco. Use o dispositivo cadastrado ou faca a recuperacao da conta.",
      );
    }

    throw error;
  }
}

export function buildRegistrationConditions(
  filters: Omit<RegistrationFilters, "format">,
  tenantId = DEFAULT_TENANT_ID,
): SQL[] {
  const conditions: SQL[] = [eq(listenerRegistrations.tenantId, tenantId), isNull(listenerRegistrations.deletedAt)];

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
    conditions.push(ilike(listenerRegistrations.neighborhood, `%${filters.neighborhood}%`));
  }
  if (filters.name) {
    conditions.push(ilike(listenerRegistrations.name, `%${filters.name}%`));
  }
  if (filters.q) {
    const query = `%${filters.q}%`;
    const phoneDigits = filters.q.replace(/\D/g, "");
    const searchCondition = or(
      ilike(listenerRegistrations.name, query),
      ilike(listenerRegistrations.city, query),
      ilike(listenerRegistrations.neighborhood, query),
      ilike(campaigns.name, query),
      ...(phoneDigits.length > 0 ? [ilike(listenerRegistrations.phone, `%${phoneDigits}%`)] : []),
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }
  if (filters.hasPhone === true) {
    conditions.push(isNotNull(listenerRegistrations.phone));
  }
  if (filters.hasPhone === false) {
    conditions.push(isNull(listenerRegistrations.phone));
  }

  return conditions;
}

function getRegistrationOrderBy(filters: Omit<RegistrationFilters, "format">) {
  const direction = filters.sortDirection === "asc" ? asc : desc;

  if (filters.sortBy === "name") {
    return direction(listenerRegistrations.name);
  }
  if (filters.sortBy === "city") {
    return direction(listenerRegistrations.city);
  }

  return direction(listenerRegistrations.createdAt);
}
export async function listListenerRegistrations(
  filters: Omit<RegistrationFilters, "format"> & {
    page: number;
    pageSize: number;
  },
  tenantId = DEFAULT_TENANT_ID,
) {
  const { page, pageSize, ...filterValues } = filters;
  const where = and(...buildRegistrationConditions(filterValues, tenantId));

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
      .innerJoin(campaigns, and(eq(campaigns.id, listenerRegistrations.campaignId), eq(campaigns.tenantId, tenantId)))
      .where(where)
      .orderBy(getRegistrationOrderBy(filters))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(listenerRegistrations)
      .innerJoin(campaigns, and(eq(campaigns.id, listenerRegistrations.campaignId), eq(campaigns.tenantId, tenantId)))
      .where(where),
  ]);

  return {
    rows,
    total: Number(totalRows[0]?.total ?? 0),
  };
}

export async function getListenerRegistration(id: string, tenantId = DEFAULT_TENANT_ID) {
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
    .innerJoin(campaigns, and(eq(campaigns.id, listenerRegistrations.campaignId), eq(campaigns.tenantId, tenantId)))
    .where(
      and(
        eq(listenerRegistrations.id, id),
        eq(listenerRegistrations.tenantId, tenantId),
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
  tenantId = DEFAULT_TENANT_ID,
) {
  const where = and(...buildRegistrationConditions(filters, tenantId));
  const orderBy = getRegistrationOrderBy(filters);

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
    .innerJoin(campaigns, and(eq(campaigns.id, listenerRegistrations.campaignId), eq(campaigns.tenantId, tenantId)))
    .where(where)
    .orderBy(orderBy)
    .limit(env.EXPORT_MAX_ROWS);
}

export async function auditExport(input: {
  adminUserId: string;
  tenantId?: string;
  campaignId?: string;
  format: "csv" | "xlsx";
  filters: Record<string, unknown>;
  rowCount: number;
}) {
  await db.insert(registrationExportAudits).values({
    tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
    adminUserId: input.adminUserId,
    campaignId: input.campaignId,
    format: input.format,
    filtersJson: input.filters,
    rowCount: input.rowCount,
  });
}
