import { createHmac, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../database/client.js";
import {
  campaignDeviceStates,
  campaignParticipations,
  campaigns,
  listenerDevices,
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

type PublicPlatform =
  | "web_mobile"
  | "web_desktop"
  | "web_tablet"
  | "expo_ios"
  | "expo_android";

interface RequestContext {
  ip: string;
  userAgent?: string;
}

interface RegistrationInput {
  campaignId: string;
  name: string;
  neighborhood: string;
  city: string;
  phone?: string | null;
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

function assertDefined<T>(value: T | undefined, code: string, message: string): T {
  if (!value) {
    throw new AppError(500, code, message);
  }

  return value;
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

async function findActiveCampaignById(campaignId: string) {
  const now = new Date();
  const campaign = await db.query.campaigns.findFirst({
    where: and(
      eq(campaigns.id, campaignId),
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

async function resolveDevice(token: string, platform: PublicPlatform) {
  const tokenHash = hashDeviceToken(token);
  const now = new Date();
  const existing = await db.query.listenerDevices.findFirst({
    where: eq(listenerDevices.tokenHash, tokenHash),
  });

  if (existing) {
    const shouldTouch = now.getTime() - existing.lastSeenAt.getTime() > 5 * 60 * 1000;
    if (shouldTouch) {
      await db
        .update(listenerDevices)
        .set({ lastSeenAt: now, platform })
        .where(eq(listenerDevices.id, existing.id));
    }
    return existing;
  }

  const [device] = await db
    .insert(listenerDevices)
    .values({
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

export async function resolvePublicSession(input: {
  placement: string;
  platform: PublicPlatform;
  deviceToken: string;
}) {
  const placement = await getPublicPlacementCampaign(input.placement);
  const device = await resolveDevice(input.deviceToken, input.platform);

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
      campaignId,
      listenerDeviceId: device.id,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [
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
  input: RegistrationInput & {
    deviceToken: string;
    platform: PublicPlatform;
  },
  context: RequestContext,
) {
  const campaign = await findActiveCampaignById(input.campaignId);

  if (input.privacyNoticeVersion !== campaign.privacyNoticeVersion) {
    throw new AppError(
      409,
      "PRIVACY_NOTICE_VERSION_MISMATCH",
      "O aviso de privacidade foi atualizado. Recarregue a pagina.",
    );
  }

  const device = await resolveDevice(input.deviceToken, input.platform);
  const now = new Date();
  const phone = normalizePhone(input.phone);
  const submissionToken = input.submissionToken ?? randomUUID();

  const result = await db.transaction(async (tx) => {
    const [profile] = await tx
      .insert(listenerProfiles)
      .values({
        name: normalizeText(input.name),
        neighborhood: normalizeText(input.neighborhood),
        city: normalizeText(input.city),
        phone,
        phoneNormalized: phone,
        marketingOptIn: input.marketingOptIn,
      })
      .returning();
    const createdProfile = assertDefined(
      profile,
      "LISTENER_PROFILE_CREATE_FAILED",
      "Falha ao criar perfil do ouvinte.",
    );

    const [updatedDevice] = await tx
      .update(listenerDevices)
      .set({
        listenerProfileId: createdProfile.id,
        linkedAt: now,
        lastSeenAt: now,
        platform: input.platform,
      })
      .where(eq(listenerDevices.id, device.id))
      .returning();
    const linkedDevice = assertDefined(
      updatedDevice,
      "DEVICE_LINK_FAILED",
      "Falha ao vincular dispositivo.",
    );

    const [participation] = await tx
      .insert(campaignParticipations)
      .values({
        campaignId: campaign.id,
        listenerProfileId: createdProfile.id,
        listenerDeviceId: linkedDevice.id,
        source: input.source,
        status: "eligible",
      })
      .onConflictDoNothing({
        target: [
          campaignParticipations.campaignId,
          campaignParticipations.listenerProfileId,
        ],
      })
      .returning();

    const [registration] = await tx
      .insert(listenerRegistrations)
      .values({
        campaignId: campaign.id,
        name: createdProfile.name,
        neighborhood: createdProfile.neighborhood,
        city: createdProfile.city,
        phone,
        source: input.platform === "web_mobile" ? "institutional_mobile" : "institutional_web",
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
      .onConflictDoNothing({
        target: [
          listenerRegistrations.campaignId,
          listenerRegistrations.submissionToken,
        ],
      })
      .returning();

    await tx
      .insert(campaignDeviceStates)
      .values({
        campaignId: campaign.id,
        listenerDeviceId: linkedDevice.id,
        firstSeenAt: now,
        lastSeenAt: now,
        dismissedUntil: null,
      })
      .onConflictDoUpdate({
        target: [
          campaignDeviceStates.campaignId,
          campaignDeviceStates.listenerDeviceId,
        ],
        set: {
          lastSeenAt: now,
          dismissedUntil: null,
        },
      });

    return { profile: createdProfile, participation, registration };
  });

  return {
    id: result.participation?.id ?? result.registration?.id ?? result.profile.id,
    status: "created" as const,
    createdAt: now.toISOString(),
    campaign: buildCampaignPayload(campaign),
  };
}

export async function participateKnownListener(input: {
  campaignId: string;
  deviceToken: string;
  platform: PublicPlatform;
}) {
  const campaign = await findActiveCampaignById(input.campaignId);
  const device = await resolveDevice(input.deviceToken, input.platform);

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
      campaignId: campaign.id,
      listenerProfileId: device.listenerProfileId,
      listenerDeviceId: device.id,
      source: input.platform.startsWith("expo") ? "expo" : "web",
      status: "eligible",
    })
    .onConflictDoNothing({
      target: [
        campaignParticipations.campaignId,
        campaignParticipations.listenerProfileId,
      ],
    })
    .returning();

  const existing =
    participation ??
    (await db.query.campaignParticipations.findFirst({
      where: and(
        eq(campaignParticipations.campaignId, campaign.id),
        eq(campaignParticipations.listenerProfileId, device.listenerProfileId),
      ),
    }));

  await db
    .insert(campaignDeviceStates)
    .values({
      campaignId: campaign.id,
      listenerDeviceId: device.id,
      firstSeenAt: now,
      lastSeenAt: now,
      dismissedUntil: null,
    })
    .onConflictDoUpdate({
      target: [
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
}) {
  await findActiveCampaignById(input.campaignId);
  const device = await resolveDevice(input.deviceToken, input.platform);
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
      campaignId: input.campaignId,
      listenerDeviceId: device.id,
      firstSeenAt: now,
      lastSeenAt: now,
      dismissedUntil,
      modalOpenCount: input.incrementOpenCount ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [
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
