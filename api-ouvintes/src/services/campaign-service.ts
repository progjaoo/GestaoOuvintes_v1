import { and, desc, eq, lte, or, gt, isNull, sql } from "drizzle-orm";
import { db } from "../database/client.js";
import { campaigns, campaignPlacements } from "../database/schema.js";
import { AppError } from "../lib/errors.js";
import { normalizeText } from "../lib/normalization.js";
import { emitCampaignChanged } from "./campaign-events.js";

export async function getPublicCampaign(slug: string) {
  const now = new Date();
  const campaign = await db.query.campaigns.findFirst({
    where: and(
      eq(campaigns.slug, slug),
      eq(campaigns.status, "active"),
      lte(campaigns.startsAt, now),
      or(isNull(campaigns.endsAt), gt(campaigns.endsAt, now)),
    ),
  });

  if (!campaign) {
    return {
      slug,
      active: false,
    };
  }

  return {
    slug: campaign.slug,
    active: true,
    title: campaign.title,
    description: campaign.description,
    privacyNoticeVersion: campaign.privacyNoticeVersion,
    privacyNoticeUrl: campaign.privacyNoticeUrl,
    termsUrl: campaign.termsUrl,
    startsAt: campaign.startsAt.toISOString(),
    endsAt: campaign.endsAt?.toISOString() ?? null,
  };
}

export async function getPublicPlacementCampaign(placementKey: string) {
  const now = new Date();
  const [row] = await db
    .select({
      placement: campaignPlacements,
      campaign: campaigns,
    })
    .from(campaignPlacements)
    .leftJoin(campaigns, eq(campaignPlacements.campaignId, campaigns.id))
    .where(eq(campaignPlacements.placementKey, placementKey))
    .limit(1);

  const campaign = row?.campaign;
  const isAvailable =
    campaign &&
    campaign.status === "active" &&
    campaign.startsAt <= now &&
    (!campaign.endsAt || campaign.endsAt > now) &&
    !campaign.archivedAt;

  return {
    placement: placementKey,
    version: row?.placement.version ?? 0,
    campaign: isAvailable
      ? {
          id: campaign.id,
          slug: campaign.slug,
          type: campaign.type,
          active: true,
          title: campaign.title,
          description: campaign.description,
          privacyNoticeVersion: campaign.privacyNoticeVersion,
          privacyNoticeUrl: campaign.privacyNoticeUrl,
          termsUrl: campaign.termsUrl,
          startsAt: campaign.startsAt.toISOString(),
          endsAt: campaign.endsAt?.toISOString() ?? null,
        }
      : null,
  };
}

export async function findActiveCampaignForRegistration(slug: string) {
  const now = new Date();
  const campaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.slug, slug),
  });

  if (!campaign) {
    throw new AppError(409, "CAMPAIGN_UNAVAILABLE", "Campanha indisponivel.");
  }

  const isWithinPeriod =
    campaign.startsAt <= now && (!campaign.endsAt || campaign.endsAt > now);

  if (campaign.status !== "active" || !isWithinPeriod) {
    throw new AppError(409, "CAMPAIGN_CLOSED", "Campanha encerrada ou pausada.");
  }

  return campaign;
}

export async function listCampaigns() {
  return db.query.campaigns.findMany({
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
}

interface CampaignInput {
  slug: string;
  name: string;
  title: string;
  description: string;
  status: "draft" | "active" | "paused" | "closed";
  type?: "registration" | "sweepstake" | "engagement";
  startsAt: string;
  endsAt?: string | null;
  privacyNoticeVersion: string;
  privacyNoticeUrl: string;
  termsUrl?: string | null;
}

export async function createCampaign(input: CampaignInput) {
  const [campaign] = await db
    .insert(campaigns)
    .values({
      slug: input.slug,
      name: normalizeText(input.name),
      title: normalizeText(input.title),
      description: normalizeText(input.description),
      status: input.status,
      type: input.type ?? "registration",
      startsAt: new Date(input.startsAt),
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      privacyNoticeVersion: input.privacyNoticeVersion,
      privacyNoticeUrl: input.privacyNoticeUrl,
      termsUrl: input.termsUrl ?? null,
    })
    .returning();

  return campaign;
}

export async function updateCampaign(
  id: string,
  input: Partial<CampaignInput>,
) {
  const current = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, id),
  });

  if (!current) {
    throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campanha nao encontrada.");
  }

  const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
  const endsAt =
    input.endsAt === undefined
      ? current.endsAt
      : input.endsAt
        ? new Date(input.endsAt)
        : null;

  if (endsAt && endsAt <= startsAt) {
    throw new AppError(
      400,
      "INVALID_CAMPAIGN_PERIOD",
      "A data final deve ser posterior a data inicial.",
    );
  }

  const [campaign] = await db
    .update(campaigns)
    .set({
      ...(input.slug !== undefined && { slug: input.slug }),
      ...(input.name !== undefined && { name: normalizeText(input.name) }),
      ...(input.title !== undefined && { title: normalizeText(input.title) }),
      ...(input.description !== undefined && {
        description: normalizeText(input.description),
      }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.startsAt !== undefined && { startsAt }),
      ...(input.endsAt !== undefined && { endsAt }),
      ...(input.privacyNoticeVersion !== undefined && {
        privacyNoticeVersion: input.privacyNoticeVersion,
      }),
      ...(input.privacyNoticeUrl !== undefined && {
        privacyNoticeUrl: input.privacyNoticeUrl,
      }),
      ...(input.termsUrl !== undefined && { termsUrl: input.termsUrl }),
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, id))
    .returning();

  return campaign;
}

export async function publishCampaignToPlacement(input: {
  campaignId: string;
  placementKey: string;
  adminUserId?: string;
}) {
  const now = new Date();
  const campaign = await db.query.campaigns.findFirst({
    where: eq(campaigns.id, input.campaignId),
  });

  if (!campaign) {
    throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campanha nao encontrada.");
  }

  const isWithinPeriod =
    campaign.startsAt <= now && (!campaign.endsAt || campaign.endsAt > now);

  if (campaign.status !== "active" || !isWithinPeriod || campaign.archivedAt) {
    throw new AppError(
      409,
      "CAMPAIGN_NOT_PUBLISHABLE",
      "A campanha precisa estar ativa e dentro do periodo para ser publicada.",
    );
  }

  const [placement] = await db
    .insert(campaignPlacements)
    .values({
      placementKey: input.placementKey,
      campaignId: campaign.id,
      version: 1,
      publishedAt: now,
      publishedByAdminUserId: input.adminUserId,
    })
    .onConflictDoUpdate({
      target: campaignPlacements.placementKey,
      set: {
        campaignId: campaign.id,
        version: sql`${campaignPlacements.version} + 1`,
        publishedAt: now,
        publishedByAdminUserId: input.adminUserId,
        updatedAt: now,
      },
    })
    .returning();

  if (!placement) {
    throw new AppError(
      500,
      "PLACEMENT_PUBLISH_FAILED",
      "Falha ao publicar campanha.",
    );
  }

  emitCampaignChanged(input.placementKey, placement.version);

  return placement;
}

export async function listPlacements() {
  return db
    .select({
      id: campaignPlacements.id,
      placementKey: campaignPlacements.placementKey,
      campaignId: campaignPlacements.campaignId,
      version: campaignPlacements.version,
      publishedAt: campaignPlacements.publishedAt,
      updatedAt: campaignPlacements.updatedAt,
      campaignName: campaigns.name,
      campaignSlug: campaigns.slug,
      campaignStatus: campaigns.status,
    })
    .from(campaignPlacements)
    .leftJoin(campaigns, eq(campaignPlacements.campaignId, campaigns.id))
    .orderBy(desc(campaignPlacements.updatedAt));
}
