import { and, eq, lte, or, gt, isNull } from "drizzle-orm";
import { db } from "../database/client.js";
import { campaigns } from "../database/schema.js";
import { AppError } from "../lib/errors.js";
import { normalizeText } from "../lib/normalization.js";

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
