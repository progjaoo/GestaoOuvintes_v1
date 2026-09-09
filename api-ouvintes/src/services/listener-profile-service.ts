import { createHmac } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../database/client.js";
import {
  campaignParticipations,
  campaigns,
  listenerActivityLogs,
  listenerCommunicationPreferences,
  listenerConsents,
  listenerDevices,
  listenerIdentities,
  listenerProfiles,
} from "../database/schema.js";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { normalizePhone, normalizeText } from "../lib/normalization.js";
import type { ListenerAuthContext } from "./clerk-identity-service.js";
import type { ListenerProfileUpdate } from "../schemas/listener-profile.js";

export function hashListenerPhone(phone: string): string {
  return createHmac("sha256", env.PHONE_HASH_SECRET)
    .update(phone)
    .digest("hex");
}

export function isListenerProfileComplete(
  profile: Pick<
    typeof listenerProfiles.$inferSelect,
    "name" | "neighborhood" | "city" | "phoneNormalized"
  > | null,
): boolean {
  return Boolean(
    profile?.name.trim() &&
      profile.neighborhood.trim() &&
      profile.city.trim() &&
      profile.phoneNormalized,
  );
}

function assertDefined<T>(value: T | undefined, code: string, message: string): T {
  if (!value) throw new AppError(500, code, message);
  return value;
}

async function ensureClerkIdentity(tenantId: string, clerkUserId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`listener-clerk:${tenantId}:${clerkUserId}`}))`,
    );

    const existing = await tx.query.listenerIdentities.findFirst({
      where: and(
        eq(listenerIdentities.tenantId, tenantId),
        eq(listenerIdentities.clerkUserId, clerkUserId),
      ),
    });
    if (existing) return existing;

    const [created] = await tx
      .insert(listenerIdentities)
      .values({
        tenantId,
        provider: "clerk",
        providerSubject: clerkUserId,
        clerkUserId,
        status: "active",
      })
      .returning();

    return assertDefined(
      created,
      "LISTENER_IDENTITY_CREATE_FAILED",
      "Falha ao criar identidade do ouvinte.",
    );
  });
}

function assertListenerIdentityActive(identity: typeof listenerIdentities.$inferSelect): void {
  if (identity.status === "disabled" || identity.clerkDeletedAt) {
    throw new AppError(
      403,
      "LISTENER_ACCOUNT_DISABLED",
      "A conta do ouvinte esta desativada.",
    );
  }
}

async function recordActivity(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    tenantId: string;
    listenerIdentityId?: string | null;
    listenerProfileId?: string | null;
    eventType: string;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.insert(listenerActivityLogs).values({
    tenantId: input.tenantId,
    listenerIdentityId: input.listenerIdentityId ?? null,
    listenerProfileId: input.listenerProfileId ?? null,
    eventType: input.eventType,
    metadata: input.metadata ?? {},
  });
}

function buildProfileResponse(
  profile: typeof listenerProfiles.$inferSelect | null,
  identity: typeof listenerIdentities.$inferSelect,
  preferences: typeof listenerCommunicationPreferences.$inferSelect | null,
  consents: Array<typeof listenerConsents.$inferSelect>,
) {
  return {
    identity: {
      id: identity.id,
      provider: identity.provider,
      status: identity.status,
      createdAt: identity.createdAt.toISOString(),
    },
    profile: profile
      ? {
          id: profile.id,
          name: profile.name,
          neighborhood: profile.neighborhood,
          city: profile.city,
          phone: profile.phone,
          email: profile.email,
          gender: profile.gender,
          ageRange: profile.ageRange,
          status: profile.status,
          completedAt: profile.completedAt?.toISOString() ?? null,
          createdAt: profile.createdAt.toISOString(),
          updatedAt: profile.updatedAt.toISOString(),
        }
      : null,
    profileComplete: isListenerProfileComplete(profile),
    preferences: preferences
      ? {
          receivePortalNews: preferences.receivePortalNews,
          receiveCampaignUpdates: preferences.receiveCampaignUpdates,
          receiveEmail: preferences.receiveEmail,
          receiveWhatsapp: preferences.receiveWhatsapp,
          emailVerifiedAt: preferences.emailVerifiedAt?.toISOString() ?? null,
        }
      : null,
    consents: consents.map((consent) => ({
      type: consent.consentType,
      granted: consent.granted,
      documentVersion: consent.documentVersion,
      createdAt: consent.createdAt.toISOString(),
      revokedAt: consent.revokedAt?.toISOString() ?? null,
    })),
  };
}

export async function getListenerMe(context: ListenerAuthContext) {
  const identity = await ensureClerkIdentity(context.tenantId, context.clerkUserId);
  assertListenerIdentityActive(identity);
  const profile = await db.query.listenerProfiles.findFirst({
    where: and(
      eq(listenerProfiles.tenantId, context.tenantId),
      eq(listenerProfiles.listenerIdentityId, identity.id),
      isNull(listenerProfiles.deletedAt),
    ),
  });
  const preferences = profile
    ? await db.query.listenerCommunicationPreferences.findFirst({
        where: and(
          eq(listenerCommunicationPreferences.tenantId, context.tenantId),
          eq(listenerCommunicationPreferences.listenerProfileId, profile.id),
        ),
      })
    : null;
  const consents = profile
    ? await db.query.listenerConsents.findMany({
        where: and(
          eq(listenerConsents.tenantId, context.tenantId),
          eq(listenerConsents.listenerProfileId, profile.id),
        ),
        orderBy: [asc(listenerConsents.createdAt)],
      })
    : [];

  await db.insert(listenerActivityLogs).values({
    tenantId: context.tenantId,
    listenerIdentityId: identity.id,
    listenerProfileId: profile?.id ?? null,
    eventType: "login.observed",
    metadata: {},
  });

  return buildProfileResponse(profile ?? null, identity, preferences ?? null, consents);
}

export async function updateListenerProfile(
  context: ListenerAuthContext,
  input: ListenerProfileUpdate,
) {
  const identity = await ensureClerkIdentity(context.tenantId, context.clerkUserId);
  assertListenerIdentityActive(identity);
  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      const existing = await tx.query.listenerProfiles.findFirst({
        where: and(
          eq(listenerProfiles.tenantId, context.tenantId),
          eq(listenerProfiles.listenerIdentityId, identity.id),
          isNull(listenerProfiles.deletedAt),
        ),
      });

      if (!existing && input.privacyAcknowledged !== true) {
        throw new AppError(
          400,
          "PRIVACY_CONSENT_REQUIRED",
          "Aceite o aviso de privacidade para criar seu perfil.",
        );
      }

      const phone = normalizePhone(input.phone ?? existing?.phoneNormalized);
      if (!phone) {
        throw new AppError(400, "PHONE_REQUIRED", "Informe um telefone com DDD.");
      }

      const values = {
        name: normalizeText(input.name ?? existing?.name ?? ""),
        neighborhood: normalizeText(input.neighborhood ?? existing?.neighborhood ?? ""),
        city: normalizeText(input.city ?? existing?.city ?? ""),
        phone,
        phoneNormalized: phone,
        phoneHash: hashListenerPhone(phone),
        email: input.email ?? existing?.email ?? null,
        gender: input.gender ?? existing?.gender ?? null,
        ageRange: input.ageRange ?? existing?.ageRange ?? null,
        marketingOptIn: input.marketingOptIn ?? existing?.marketingOptIn ?? false,
        completedAt: now,
        updatedAt: now,
      };

      if (!values.name || !values.neighborhood || !values.city) {
        throw new AppError(
          400,
          "PROFILE_REQUIRED_FIELDS",
          "Nome, bairro e cidade sao obrigatorios.",
        );
      }

      const [profile] = existing
        ? await tx
            .update(listenerProfiles)
            .set(values)
            .where(
              and(
                eq(listenerProfiles.id, existing.id),
                eq(listenerProfiles.tenantId, context.tenantId),
              ),
            )
            .returning()
        : await tx
            .insert(listenerProfiles)
            .values({
              tenantId: context.tenantId,
              listenerIdentityId: identity.id,
              ...values,
            })
            .returning();

      const savedProfile = assertDefined(
        profile,
        "LISTENER_PROFILE_SAVE_FAILED",
        "Falha ao salvar perfil do ouvinte.",
      );

      const preferenceValues = {
        receivePortalNews: input.receivePortalNews ?? false,
        receiveCampaignUpdates:
          input.receiveCampaignUpdates ?? input.marketingOptIn ?? false,
        receiveEmail: input.receiveEmail ?? false,
        receiveWhatsapp: input.receiveWhatsapp ?? false,
        updatedAt: now,
      };

      await tx
        .insert(listenerCommunicationPreferences)
        .values({
          tenantId: context.tenantId,
          listenerProfileId: savedProfile.id,
          ...preferenceValues,
        })
        .onConflictDoUpdate({
          target: [
            listenerCommunicationPreferences.tenantId,
            listenerCommunicationPreferences.listenerProfileId,
          ],
          set: preferenceValues,
        });

      if (input.privacyAcknowledged === true) {
        await tx.insert(listenerConsents).values({
          tenantId: context.tenantId,
          listenerProfileId: savedProfile.id,
          consentType: "privacy_registration",
          documentVersion: input.privacyNoticeVersion ?? null,
          granted: true,
          source: "clerk_profile",
        });
      }

      if (input.marketingOptIn !== undefined) {
        await tx.insert(listenerConsents).values({
          tenantId: context.tenantId,
          listenerProfileId: savedProfile.id,
          consentType: "campaign_updates",
          documentVersion: input.privacyNoticeVersion ?? null,
          granted: input.marketingOptIn,
          source: "clerk_profile",
          revokedAt: input.marketingOptIn ? null : now,
        });
      }

      await recordActivity(tx, {
        tenantId: context.tenantId,
        listenerIdentityId: identity.id,
        listenerProfileId: savedProfile.id,
        eventType: existing ? "profile.updated" : "profile.created",
        metadata: { source: "clerk_profile" },
      });

      return savedProfile.id;
    });
    return getListenerMe(context);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505") {
      throw new AppError(
        409,
        "LISTENER_PHONE_IN_USE",
        "Nao foi possivel vincular este telefone ao perfil.",
      );
    }
    throw error;
  }
}

export async function listListenerParticipations(context: ListenerAuthContext) {
  const identity = await ensureClerkIdentity(context.tenantId, context.clerkUserId);
  assertListenerIdentityActive(identity);
  const profile = await db.query.listenerProfiles.findFirst({
    where: and(
      eq(listenerProfiles.tenantId, context.tenantId),
      eq(listenerProfiles.listenerIdentityId, identity.id),
      isNull(listenerProfiles.deletedAt),
    ),
  });
  if (!profile) return { items: [] };

  const rows = await db
    .select({
      id: campaignParticipations.id,
      status: campaignParticipations.status,
      createdAt: campaignParticipations.createdAt,
      campaignId: campaigns.id,
      campaignName: campaigns.name,
      campaignSlug: campaigns.slug,
    })
    .from(campaignParticipations)
    .innerJoin(
      campaigns,
      and(
        eq(campaigns.id, campaignParticipations.campaignId),
        eq(campaigns.tenantId, context.tenantId),
      ),
    )
    .where(
      and(
        eq(campaignParticipations.tenantId, context.tenantId),
        eq(campaignParticipations.listenerProfileId, profile.id),
      ),
    )
    .orderBy(asc(campaignParticipations.createdAt));

  return {
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      campaign: {
        id: row.campaignId,
        name: row.campaignName,
        slug: row.campaignSlug,
      },
    })),
  };
}

export async function linkAnonymousDeviceToListener(
  context: ListenerAuthContext,
  deviceToken: string,
) {
  const tokenHash = createHmac("sha256", env.DEVICE_TOKEN_SECRET)
    .update(deviceToken)
    .digest("hex");
  const identity = await ensureClerkIdentity(context.tenantId, context.clerkUserId);
  assertListenerIdentityActive(identity);
  const profile = await db.query.listenerProfiles.findFirst({
    where: and(
      eq(listenerProfiles.tenantId, context.tenantId),
      eq(listenerProfiles.listenerIdentityId, identity.id),
      isNull(listenerProfiles.deletedAt),
    ),
  });

  if (!profile) {
    throw new AppError(
      409,
      "PROFILE_REQUIRED",
      "Complete seu perfil antes de vincular outro dispositivo.",
    );
  }

  const device = await db.query.listenerDevices.findFirst({
    where: and(
      eq(listenerDevices.tenantId, context.tenantId),
      eq(listenerDevices.tokenHash, tokenHash),
      isNull(listenerDevices.revokedAt),
    ),
  });
  if (!device) {
    throw new AppError(404, "DEVICE_NOT_FOUND", "Dispositivo nao encontrado.");
  }
  if (device.listenerProfileId && device.listenerProfileId !== profile.id) {
    throw new AppError(
      409,
      "ANONYMOUS_PROFILE_CLAIM_REQUIRED",
      "Este dispositivo ja esta vinculado a outro perfil e exige uma confirmacao adicional.",
    );
  }

  await db
    .update(listenerDevices)
    .set({
      listenerIdentityId: identity.id,
      listenerProfileId: profile.id,
      linkedAt: new Date(),
    })
    .where(and(eq(listenerDevices.id, device.id), eq(listenerDevices.tenantId, context.tenantId)));

  await db.insert(listenerActivityLogs).values({
    tenantId: context.tenantId,
    listenerIdentityId: identity.id,
    listenerProfileId: profile.id,
    eventType: "device.linked",
    metadata: {},
  });

  return { linked: true };
}
