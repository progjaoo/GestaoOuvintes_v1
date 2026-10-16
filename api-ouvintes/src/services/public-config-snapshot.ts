import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../config/env.js";
import { db } from "../database/client.js";
import { campaigns, campaignPlacements } from "../database/schema.js";
import { institutionalBanners, mediaAssets } from "../database/banner-schema.js";
import { AppError } from "../lib/errors.js";

const campaignSchema = z.object({
  id: z.uuid(),
  slug: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  title: z.string(),
  description: z.string(),
  privacyNoticeVersion: z.string(),
  privacyNoticeUrl: z.string(),
  termsUrl: z.string().nullable(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
});

const placementSchema = z.object({
  placementKey: z.string().min(1),
  campaignId: z.uuid().nullable(),
  version: z.number().int().nonnegative(),
});

const bannerSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  altText: z.string(),
  placementKey: z.string().min(1),
  imageUrl: z.string().url(),
  actionType: z.string(),
  destinationUrl: z.string().nullable(),
  openInNewTab: z.boolean(),
  order: z.number().int(),
});

const snapshotContentSchema = z.object({
  schemaVersion: z.literal(1),
  namespace: z.string(),
  campaigns: z.array(campaignSchema),
  placements: z.array(placementSchema),
  banners: z.array(bannerSchema),
});

const snapshotSchema = snapshotContentSchema.extend({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.iso.datetime({ offset: true }),
});

export type PublicConfigSnapshot = z.infer<typeof snapshotSchema>;
type SnapshotContent = z.infer<typeof snapshotContentSchema>;

const CACHE_TTL_MS = 15_000;
let cachedSnapshot: { value: PublicConfigSnapshot; expiresAt: number } | null = null;
let client: S3Client | null = null;

function objectKey() {
  if (!env.PUBLIC_CONFIG_NAMESPACE) {
    throw new AppError(503, "PUBLIC_CONFIG_NAMESPACE_MISSING", "Configuracao publica indisponivel.");
  }
  return `public-config/${env.PUBLIC_CONFIG_NAMESPACE}/current.json`;
}

function getClient() {
  if (client) return client;
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new AppError(503, "PUBLIC_CONFIG_STORAGE_UNAVAILABLE", "Configuracao publica indisponivel.");
  }
  client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

function revisionFor(content: SnapshotContent) {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function parseSnapshot(value: unknown): PublicConfigSnapshot {
  const parsed = snapshotSchema.parse(value);
  const { revision, generatedAt: _generatedAt, ...content } = parsed;
  if (revisionFor(content) !== revision || content.namespace !== env.PUBLIC_CONFIG_NAMESPACE) {
    throw new Error("Snapshot revision or namespace mismatch");
  }
  return parsed;
}

export function isPublicConfigSnapshotReadEnabled() {
  return env.PUBLIC_CONFIG_READ_MODE === "r2";
}

export function isPublicConfigSnapshotWriteEnabled() {
  return env.PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED;
}

async function querySnapshotContent(executor: Pick<typeof db, "select">): Promise<SnapshotContent> {
  const [campaignRows, placementRows, bannerRows] = await Promise.all([
    executor.select({
      id: campaigns.id,
      slug: campaigns.slug,
      type: campaigns.type,
      status: campaigns.status,
      title: campaigns.title,
      description: campaigns.description,
      privacyNoticeVersion: campaigns.privacyNoticeVersion,
      privacyNoticeUrl: campaigns.privacyNoticeUrl,
      termsUrl: campaigns.termsUrl,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
    }).from(campaigns)
      .where(and(isNull(campaigns.archivedAt), ne(campaigns.status, "draft")))
      .orderBy(asc(campaigns.slug)),
    executor.select({
      placementKey: campaignPlacements.placementKey,
      campaignId: campaignPlacements.campaignId,
      version: campaignPlacements.version,
    }).from(campaignPlacements).orderBy(asc(campaignPlacements.placementKey)),
    executor.select({
      id: institutionalBanners.id,
      title: institutionalBanners.title,
      altText: institutionalBanners.altText,
      placementKey: institutionalBanners.placementKey,
      objectKey: mediaAssets.objectKey,
      actionType: institutionalBanners.actionType,
      destinationUrl: institutionalBanners.destinationUrl,
      openInNewTab: institutionalBanners.openInNewTab,
      displayOrder: institutionalBanners.displayOrder,
    }).from(institutionalBanners)
      .innerJoin(mediaAssets, eq(mediaAssets.id, institutionalBanners.mediaAssetId))
      .where(and(
        eq(institutionalBanners.active, true),
        isNull(institutionalBanners.deletedAt),
        eq(mediaAssets.status, "ready"),
      ))
      .orderBy(asc(institutionalBanners.placementKey), asc(institutionalBanners.displayOrder)),
  ]);

  if (!env.R2_PUBLIC_BASE_URL && bannerRows.length > 0) {
    throw new AppError(503, "MEDIA_PUBLIC_URL_NOT_CONFIGURED", "A URL publica dos banners nao foi configurada.");
  }

  const banners = bannerRows.map((banner) => ({
    id: banner.id,
    title: banner.title,
    altText: banner.altText,
    placementKey: banner.placementKey,
    imageUrl: `${env.R2_PUBLIC_BASE_URL!.replace(/\/+$/, "")}/${banner.objectKey
      .split("/").map(encodeURIComponent).join("/")}`,
    actionType: banner.actionType,
    destinationUrl: banner.destinationUrl,
    openInNewTab: banner.openInNewTab,
    order: banner.displayOrder,
  }));

  return snapshotContentSchema.parse({
    schemaVersion: 1,
    namespace: env.PUBLIC_CONFIG_NAMESPACE,
    campaigns: campaignRows.map((campaign) => ({
      ...campaign,
      startsAt: campaign.startsAt.toISOString(),
      endsAt: campaign.endsAt?.toISOString() ?? null,
    })),
    placements: placementRows,
    banners,
  });
}

export async function publishPublicConfigSnapshot() {
  if (!isPublicConfigSnapshotWriteEnabled()) {
    return { syncStatus: "disabled" as const, revision: null };
  }

  const snapshot = await db.transaction(async (tx) => {
    await tx.execute(
      // Serialize publishers across API instances; this runs only after admin mutations.
      sql`select pg_advisory_xact_lock(hashtext(${`radio88-public-config:${env.PUBLIC_CONFIG_NAMESPACE}`}))`,
    );
    const content = await querySnapshotContent(tx);
    const next = snapshotSchema.parse({
      ...content,
      revision: revisionFor(content),
      generatedAt: new Date().toISOString(),
    });
    const body = Buffer.from(JSON.stringify(next));
    await getClient().send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: objectKey(),
        Body: body,
        ContentLength: body.length,
        ContentType: "application/json; charset=utf-8",
        CacheControl: "no-store",
      }),
      { abortSignal: AbortSignal.timeout(env.PUBLIC_CONFIG_R2_TIMEOUT_MS) },
    );
    cachedSnapshot = { value: next, expiresAt: Date.now() + CACHE_TTL_MS };
    return next;
  });

  return { syncStatus: "published" as const, revision: snapshot.revision };
}

export async function readPublicConfigSnapshot(): Promise<PublicConfigSnapshot> {
  if (!isPublicConfigSnapshotReadEnabled()) {
    throw new AppError(503, "PUBLIC_CONFIG_SNAPSHOT_DISABLED", "Configuracao publica indisponivel.");
  }
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) return cachedSnapshot.value;

  try {
    const response = await getClient().send(
      new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: objectKey() }),
      { abortSignal: AbortSignal.timeout(env.PUBLIC_CONFIG_R2_TIMEOUT_MS) },
    );
    if (!response.Body) throw new Error("Snapshot body missing");
    const text = await response.Body.transformToString();
    if (Buffer.byteLength(text) > 2_000_000) throw new Error("Snapshot exceeds maximum size");
    const snapshot = parseSnapshot(JSON.parse(text));
    cachedSnapshot = { value: snapshot, expiresAt: Date.now() + CACHE_TTL_MS };
    return snapshot;
  } catch (cause) {
    cachedSnapshot = null;
    throw new AppError(
      503,
      "PUBLIC_CONFIG_SNAPSHOT_UNAVAILABLE",
      "A configuracao publica esta temporariamente indisponivel.",
      undefined,
      { cause },
    );
  }
}

function isAvailable(campaign: PublicConfigSnapshot["campaigns"][number] | undefined, now: Date) {
  return Boolean(
    campaign &&
    campaign.status === "active" &&
    new Date(campaign.startsAt) <= now &&
    (!campaign.endsAt || new Date(campaign.endsAt) > now),
  );
}

export function publicConfigCacheControl(
  snapshot: PublicConfigSnapshot,
  campaign?: PublicConfigSnapshot["campaigns"][number],
  now = new Date(),
) {
  const transitions = campaign
    ? [campaign.startsAt, campaign.endsAt].filter((value): value is string => value !== null)
      .map((value) => new Date(value).getTime()).filter((time) => time > now.getTime())
    : [];
  const nextTransition = Math.min(...transitions);
  const untilTransition = Number.isFinite(nextTransition)
    ? Math.max(0, Math.floor((nextTransition - now.getTime()) / 1000))
    : 60;
  const ttl = Math.min(60, untilTransition);
  return `public, max-age=0, s-maxage=${ttl}`;
}

export function getSnapshotCampaign(snapshot: PublicConfigSnapshot, slug: string, now = new Date()) {
  const campaign = snapshot.campaigns.find((item) => item.slug === slug);
  if (!campaign || !isAvailable(campaign, now)) return { slug, active: false };
  return {
    slug,
    active: true,
    title: campaign.title,
    description: campaign.description,
    privacyNoticeVersion: campaign.privacyNoticeVersion,
    privacyNoticeUrl: campaign.privacyNoticeUrl,
    termsUrl: campaign.termsUrl,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
  };
}

export function getSnapshotPlacement(snapshot: PublicConfigSnapshot, placementKey: string, now = new Date()) {
  const placement = snapshot.placements.find((item) => item.placementKey === placementKey);
  const campaign = placement?.campaignId
    ? snapshot.campaigns.find((item) => item.id === placement.campaignId)
    : undefined;
  const activeCampaign = campaign && isAvailable(campaign, now) ? campaign : null;
  return {
    placement: placementKey,
    version: placement?.version ?? 0,
    campaign: activeCampaign
      ? {
          id: activeCampaign.id,
          slug: activeCampaign.slug,
          type: activeCampaign.type,
          active: true as const,
          title: activeCampaign.title,
          description: activeCampaign.description,
          privacyNoticeVersion: activeCampaign.privacyNoticeVersion,
          privacyNoticeUrl: activeCampaign.privacyNoticeUrl,
          termsUrl: activeCampaign.termsUrl,
          startsAt: activeCampaign.startsAt,
          endsAt: activeCampaign.endsAt,
        }
      : null,
    sourceCampaign: campaign,
  };
}

export function getSnapshotBanners(snapshot: PublicConfigSnapshot, placementKey: string) {
  const selected = snapshot.banners.filter(
    (banner) => banner.placementKey === placementKey,
  );
  const version = Number.parseInt(snapshot.revision.slice(0, 12), 16);
  return { version, items: selected };
}

export function resetPublicConfigSnapshotCacheForTests() {
  cachedSnapshot = null;
}
