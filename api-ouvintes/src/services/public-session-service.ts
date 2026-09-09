import { createHmac, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../database/client.js";
import {
  campaignDeviceStates,
  campaignParticipations,
  campaigns,
  listenerActivityLogs,
  listenerCommunicationPreferences,
  listenerConsents,
  listenerDevices,
  listenerIdentities,
  listenerProfiles,
  listenerRegistrations,
} from "../database/schema.js";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import {
  hashIp,
  normalizePhone,
  normalizeText,
  summarizeUserAgent,
} from "../lib/normalization.js";
import { getPublicPlacementCampaign } from "./campaign-service.js";
import { DEFAULT_TENANT_ID } from "./tenant-service.js";

export type PublicPlatform =
  | "web_mobile"
  | "web_desktop"
  | "web_tablet"
  | "expo_ios"
  | "expo_android";

const registrationSourceByPlatform: Record<PublicPlatform, string> = {
  web_mobile: "institutional_mobile",
  web_desktop: "institutional_web",
  web_tablet: "institutional_web",
  expo_ios: "expo_ios",
  expo_android: "expo_android",
};

interface RequestContext {
  ip: string;
  userAgent?: string;
}

interface RegistrationInput {
  campaignId: string;
  name: string;
  neighborhood: string;
  city: string;
  phone: string;
  privacyNoticeVersion: string;
  marketingOptIn: boolean;
  source: "web" | "expo" | "receptionist" | "import";
  submissionToken?: string;
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
  };
}

function hashDeviceToken(token: string) {
  return createHmac("sha256", env.DEVICE_TOKEN_SECRET).update(token).digest("hex");
}

function hashListenerPhone(phone: string) {
  return createHmac("sha256", env.PHONE_HASH_SECRET).update(phone).digest("hex");
}

function assertDefined<T>(value: T | undefined, code: string, message: string): T {
  if (!value) {
    throw new AppError(500, code, message);
  }

  return value;
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

export function requireDeviceToken(value: unknown) {
  const token = Array.isArray(value) ? value[0] : value;
  if (typeof token !== "string" || token.trim().length < 32 || token.length > 256) {
    throw new AppError(
      400,
      "DEVICE_TOKEN_REQUIRED",
      "Token do dispositivo ausente ou invalido.",
    );
  }

  return token.trim();
}

async function findActiveCampaignById(campaignId: string, tenantId = DEFAULT_TENANT_ID) {
  const now = new Date();
  const campaign = await db.query.campaigns.findFirst({
    where: and(
      eq(campaigns.id, campaignId),
      eq(campaigns.tenantId, tenantId),
      eq(campaigns.status, "active"),
      lte(campaigns.startsAt, now),
      or(isNull(campaigns.endsAt), gt(campaigns.endsAt, now)),
      isNull(campaigns.archivedAt),
    ),
  });

  if (!campaign) {
    throw new AppError(409, "CAMPAIGN_CLOSED", "Campanha encerrada ou pausada.");
  }

  return campaign;
}

export async function resolvePublicDevice(token: string, platform: PublicPlatform, tenantId = DEFAULT_TENANT_ID) {
  const tokenHash = hashDeviceToken(token);
  const now = new Date();
  const existing = await db.query.listenerDevices.findFirst({
    where: and(eq(listenerDevices.tenantId, tenantId), eq(listenerDevices.tokenHash, tokenHash)),
  });

  if (existing) {
    const shouldTouch = now.getTime() - existing.lastSeenAt.getTime() > 5 * 60 * 1000;
    if (shouldTouch) {
      await db
        .update(listenerDevices)
        .set({ lastSeenAt: now, platform })
        .where(and(eq(listenerDevices.id, existing.id), eq(listenerDevices.tenantId, tenantId)));
    }
    return existing;
  }

  const [device] = await db
    .insert(listenerDevices)
    .values({
      tenantId,
      tokenHash,
      platform,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning();

  return assertDefined(device, "DEVICE_CREATE_FAILED", "Falha ao criar dispositivo.");
}

function buildCampaignPayload(campaign: Awaited<ReturnType<typeof findActiveCampaignById>>) {
  return {
    id: campaign.id,
    slug: campaign.slug,
    type: campaign.type,
    active: true as const,
    title: campaign.title,
    description: campaign.description,
    privacyNoticeVersion: campaign.privacyNoticeVersion,
    privacyNoticeUrl: campaign.privacyNoticeUrl,
    termsUrl: campaign.termsUrl,
    startsAt: campaign.startsAt.toISOString(),
    endsAt: campaign.endsAt?.toISOString() ?? null,
  };
}

export async function resolvePublicSession(
  input: { placement: string; platform: PublicPlatform; deviceToken: string },
  tenantId = DEFAULT_TENANT_ID,
) {
  const placement = await getPublicPlacementCampaign(input.placement, tenantId);
  const device = await resolvePublicDevice(input.deviceToken, input.platform, tenantId);

  if (!placement.campaign) {
    return {
      placement: input.placement,
      placementVersion: placement.version,
      campaign: null,
      listenerState: device.listenerProfileId ? "known" : "anonymous",
      experience: "campaign_unavailable",
      participation: null,
      dismissedUntil: null,
    };
  }

  const now = new Date();
  const campaignId = placement.campaign.id;

  const [state] = await db
    .insert(campaignDeviceStates)
    .values({
      tenantId,
      campaignId,
      listenerDeviceId: device.id,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [
        campaignDeviceStates.tenantId,
        campaignDeviceStates.campaignId,
        campaignDeviceStates.listenerDeviceId,
      ],
      set: { lastSeenAt: now },
    })
    .returning();
  const deviceState = assertDefined(
    state,
    "DEVICE_STATE_CREATE_FAILED",
    "Falha ao resolver estado da campanha.",
  );

  const listenerState = device.listenerProfileId ? "known" : "anonymous";
  let participation: { id: string; status: string; createdAt: string } | null = null;

  if (device.listenerProfileId) {
    const existingParticipation = await db.query.campaignParticipations.findFirst({
      where: and(
        eq(campaignParticipations.tenantId, tenantId),
        eq(campaignParticipations.campaignId, campaignId),
        eq(campaignParticipations.listenerProfileId, device.listenerProfileId),
      ),
    });

    if (existingParticipation) {
      participation = {
        id: existingParticipation.id,
        status: existingParticipation.status,
        createdAt: existingParticipation.createdAt.toISOString(),
      };
    }
  }

  const dismissedUntil =
    deviceState.dismissedUntil && deviceState.dismissedUntil > now
      ? deviceState.dismissedUntil.toISOString()
      : null;

  let experience:
    | "anonymous_registration_required"
    | "known_listener_confirmation_required"
    | "already_participating"
    | "campaign_unavailable";

  if (participation) {
    experience = "already_participating";
  } else if (listenerState === "known") {
    experience = "known_listener_confirmation_required";
  } else {
    experience = "anonymous_registration_required";
  }

  return {
    placement: input.placement,
    placementVersion: placement.version,
    campaign: placement.campaign,
    listenerState,
    experience,
    participation,
    dismissedUntil,
  };
}

export async function registerAndParticipate(
  input: RegistrationInput & { deviceToken: string; platform: PublicPlatform },
  context: RequestContext,
  tenantId = DEFAULT_TENANT_ID,
) {
  const campaign = await findActiveCampaignById(input.campaignId, tenantId);

  if (input.privacyNoticeVersion !== campaign.privacyNoticeVersion) {
    throw new AppError(
      409,
      "PRIVACY_NOTICE_VERSION_MISMATCH",
      "O aviso de privacidade foi atualizado. Recarregue a pagina.",
    );
  }

  const device = await resolvePublicDevice(input.deviceToken, input.platform, tenantId);
  const now = new Date();
  const phone = normalizePhone(input.phone);
  if (!phone) {
    throw new AppError(
      400,
      "PHONE_REQUIRED",
      "Informe um telefone com DDD.",
    );
  }
  const submissionToken = input.submissionToken ?? randomUUID();
  const normalizedName = normalizeText(input.name);
  const normalizedNeighborhood = normalizeText(input.neighborhood);
  const normalizedCity = normalizeText(input.city);

  let result;

  try {
    result = await db.transaction(async (tx) => {
    // Locks serialize equal retries and equal phones without blocking other listeners.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`listener-registration:token:${campaign.id}:${submissionToken}`}))`,
    );

    const existingRegistration =
      await tx.query.listenerRegistrations.findFirst({
        where: and(
          eq(listenerRegistrations.tenantId, tenantId),
          eq(listenerRegistrations.campaignId, campaign.id),
          eq(listenerRegistrations.submissionToken, submissionToken),
        ),
      });

    if (existingRegistration) {
      return {
        status: "already_processed" as const,
        id: existingRegistration.id,
        createdAt: existingRegistration.createdAt,
      };
    }

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

    const deviceProfile = device.listenerProfileId
      ? await tx.query.listenerProfiles.findFirst({
          where: and(
            eq(listenerProfiles.id, device.listenerProfileId),
            eq(listenerProfiles.tenantId, tenantId),
            isNull(listenerProfiles.deletedAt),
          ),
        })
      : undefined;
    const phoneProfile = await tx.query.listenerProfiles.findFirst({
      where: and(
        eq(listenerProfiles.tenantId, tenantId),
        eq(listenerProfiles.phoneNormalized, phone),
        isNull(listenerProfiles.deletedAt),
      ),
    });

    if (deviceProfile && phoneProfile && deviceProfile.id !== phoneProfile.id) {
      throw new AppError(
        409,
        "LISTENER_PROFILE_CONFLICT",
        "Nao foi possivel confirmar este cadastro neste dispositivo.",
      );
    }

    if (!deviceProfile && phoneProfile) {
      throw new AppError(
        409,
        "LISTENER_PROFILE_EXISTS",
        "Voce ja tem um cadastro conosco. Use o dispositivo cadastrado ou faca a recuperacao da conta.",
      );
    }

    let profile = deviceProfile;
    let profileWasCreated = false;
    let identity = profile
      ? await tx.query.listenerIdentities.findFirst({
          where: and(
            eq(listenerIdentities.id, profile.listenerIdentityId),
            eq(listenerIdentities.tenantId, tenantId),
          ),
        })
      : undefined;

    if (profile && profile.phoneNormalized && profile.phoneNormalized !== phone) {
      throw new AppError(
        409,
        "LISTENER_PROFILE_PHONE_MISMATCH",
        "O telefone informado nao corresponde ao cadastro deste dispositivo.",
      );
    }

    if (!profile) {
      profileWasCreated = true;
      const [createdIdentity] = await tx
        .insert(listenerIdentities)
        .values({
          tenantId,
          provider: "anonymous",
          providerSubject: `device:${device.tokenHash}`,
          status: "active",
        })
        .returning();
      identity = assertDefined(
        createdIdentity,
        "LISTENER_IDENTITY_CREATE_FAILED",
        "Falha ao criar identidade do ouvinte.",
      );

      const [createdProfile] = await tx
        .insert(listenerProfiles)
        .values({
          tenantId,
          listenerIdentityId: identity.id,
          name: normalizedName,
          neighborhood: normalizedNeighborhood,
          city: normalizedCity,
          phone,
          phoneNormalized: phone,
          phoneHash: hashListenerPhone(phone),
          marketingOptIn: input.marketingOptIn,
          completedAt: now,
        })
        .returning();
      profile = assertDefined(
        createdProfile,
        "LISTENER_PROFILE_CREATE_FAILED",
        "Falha ao criar perfil do ouvinte.",
      );
    } else {
      if (!identity) {
        throw new AppError(
          500,
          "LISTENER_IDENTITY_MISSING",
          "O cadastro do ouvinte esta sem identidade vinculada.",
        );
      }

      const [updatedProfile] = await tx
        .update(listenerProfiles)
        .set({
          name: normalizedName,
          neighborhood: normalizedNeighborhood,
          city: normalizedCity,
          phone,
          phoneNormalized: phone,
          phoneHash: hashListenerPhone(phone),
          marketingOptIn: profile.marketingOptIn || input.marketingOptIn,
          completedAt: now,
          updatedAt: now,
        })
        .where(and(eq(listenerProfiles.id, profile.id), eq(listenerProfiles.tenantId, tenantId)))
        .returning();
      profile = assertDefined(
        updatedProfile,
        "LISTENER_PROFILE_UPDATE_FAILED",
        "Falha ao atualizar perfil do ouvinte.",
      );
    }

    const [registration] = await tx
      .insert(listenerRegistrations)
      .values({
        tenantId,
        campaignId: campaign.id,
        name: normalizedName,
        neighborhood: normalizedNeighborhood,
        city: normalizedCity,
        phone,
        phoneNormalized: phone,
        source: registrationSourceByPlatform[input.platform],
        submissionToken,
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
      })
      .returning();

    const createdRegistration = assertDefined(
      registration,
      "REGISTRATION_CREATE_FAILED",
      "Falha ao criar cadastro.",
    );

    const [updatedDevice] = await tx
      .update(listenerDevices)
      .set({
        listenerIdentityId: identity.id,
        listenerProfileId: profile.id,
        linkedAt: now,
        lastSeenAt: now,
        platform: input.platform,
      })
      .where(and(eq(listenerDevices.id, device.id), eq(listenerDevices.tenantId, tenantId)))
      .returning();
    const linkedDevice = assertDefined(
      updatedDevice,
      "DEVICE_LINK_FAILED",
      "Falha ao vincular dispositivo.",
    );

    const [participation] = await tx
      .insert(campaignParticipations)
      .values({
        tenantId,
        campaignId: campaign.id,
        listenerProfileId: profile.id,
        listenerDeviceId: linkedDevice.id,
        source: input.source,
        status: "eligible",
      })
      .onConflictDoNothing({
        target: [
          campaignParticipations.tenantId,
          campaignParticipations.campaignId,
          campaignParticipations.listenerProfileId,
        ],
      })
      .returning();

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

    await tx
      .insert(campaignDeviceStates)
      .values({
        tenantId,
        campaignId: campaign.id,
        listenerDeviceId: linkedDevice.id,
        firstSeenAt: now,
        lastSeenAt: now,
        dismissedUntil: null,
      })
      .onConflictDoUpdate({
        target: [
          campaignDeviceStates.tenantId,
          campaignDeviceStates.campaignId,
          campaignDeviceStates.listenerDeviceId,
        ],
        set: {
          lastSeenAt: now,
          dismissedUntil: null,
        },
      });

    return {
      status: "created" as const,
      id: createdRegistration.id,
      createdAt: createdRegistration.createdAt,
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

  return {
    id: result.id,
    status: result.status,
    createdAt: result.createdAt.toISOString(),
    campaign: buildCampaignPayload(campaign),
  };
}

export async function participateKnownListener(
  input: { campaignId: string; deviceToken: string; platform: PublicPlatform },
  tenantId = DEFAULT_TENANT_ID,
) {
  const campaign = await findActiveCampaignById(input.campaignId, tenantId);
  const device = await resolvePublicDevice(input.deviceToken, input.platform, tenantId);

  if (!device.listenerProfileId) {
    throw new AppError(
      409,
      "LISTENER_PROFILE_REQUIRED",
      "Este dispositivo ainda nao possui cadastro vinculado.",
    );
  }

  const now = new Date();
  const [participation] = await db
    .insert(campaignParticipations)
    .values({
      tenantId,
      campaignId: campaign.id,
      listenerProfileId: device.listenerProfileId,
      listenerDeviceId: device.id,
      source: input.platform.startsWith("expo") ? "expo" : "web",
      status: "eligible",
    })
    .onConflictDoNothing({
      target: [
          campaignParticipations.tenantId,
          campaignParticipations.campaignId,
          campaignParticipations.listenerProfileId,
      ],
    })
    .returning();

  const existing =
    participation ??
    (await db.query.campaignParticipations.findFirst({
      where: and(
        eq(campaignParticipations.tenantId, tenantId),
        eq(campaignParticipations.campaignId, campaign.id),
        eq(campaignParticipations.listenerProfileId, device.listenerProfileId),
      ),
    }));

  await db
    .insert(campaignDeviceStates)
    .values({
      tenantId,
      campaignId: campaign.id,
      listenerDeviceId: device.id,
      firstSeenAt: now,
      lastSeenAt: now,
      dismissedUntil: null,
    })
    .onConflictDoUpdate({
      target: [
        campaignDeviceStates.tenantId,
        campaignDeviceStates.campaignId,
        campaignDeviceStates.listenerDeviceId,
      ],
      set: { lastSeenAt: now, dismissedUntil: null },
    });

  return {
    id: existing?.id,
    status: participation ? "created" : "already_processed",
    createdAt: (existing?.createdAt ?? now).toISOString(),
  };
}

export async function updateCampaignDeviceState(input: {
  campaignId: string;
  deviceToken: string;
  platform: PublicPlatform;
  dismissedUntil?: string | null;
  incrementOpenCount?: boolean;
  tenantId?: string;
}) {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  await findActiveCampaignById(input.campaignId, tenantId);
  const device = await resolvePublicDevice(input.deviceToken, input.platform, tenantId);
  const now = new Date();
  const dismissedUntil = input.dismissedUntil ? new Date(input.dismissedUntil) : null;
  const conflictSet = input.incrementOpenCount
    ? {
        lastSeenAt: now,
        dismissedUntil,
        modalOpenCount: sql`${campaignDeviceStates.modalOpenCount} + 1`,
      }
    : {
        lastSeenAt: now,
        dismissedUntil,
      };

  const [state] = await db
    .insert(campaignDeviceStates)
    .values({
      tenantId,
      campaignId: input.campaignId,
      listenerDeviceId: device.id,
      firstSeenAt: now,
      lastSeenAt: now,
      dismissedUntil,
      modalOpenCount: input.incrementOpenCount ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [
        campaignDeviceStates.tenantId,
        campaignDeviceStates.campaignId,
        campaignDeviceStates.listenerDeviceId,
      ],
      set: conflictSet,
    })
    .returning();
  const deviceState = assertDefined(
    state,
    "DEVICE_STATE_UPDATE_FAILED",
    "Falha ao atualizar estado da campanha.",
  );

  return {
    dismissedUntil: deviceState.dismissedUntil?.toISOString() ?? null,
    modalOpenCount: deviceState.modalOpenCount,
  };
}
