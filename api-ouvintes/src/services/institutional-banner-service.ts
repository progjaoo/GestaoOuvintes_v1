import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../database/client.js";
import {
  adminAuditLogs,
  institutionalBanners,
  mediaAssets,
} from "../database/banner-schema.js";
import { AppError } from "../lib/errors.js";
import {
  institutionalBannerActionStateSchema,
  type InstitutionalBannerActionType,
} from "../schemas/institutional-banner.js";
import { processBannerImage } from "./media-storage/media-image-processor.js";
import type { MediaStorage } from "./media-storage/media-storage.js";
import {
  getSnapshotBanners,
  isPublicConfigSnapshotReadEnabled,
  publicConfigCacheControl,
  readPublicConfigSnapshot,
} from "./public-config-snapshot.js";

const PUBLIC_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=60";
const OBJECT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const EXISTING_OBJECT_MIME_TYPES: Record<string, string> = {
  avif: "image/avif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

type BannerTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockBannerConfiguration(tx: BannerTransaction) {
  // One transaction lock also covers moves between placements and concurrent deletes.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('institutional_banner:configuration'))`);
}

function validatePrimaryChoice(isPrimary: boolean | undefined, active: boolean, placement: string) {
  if (!isPrimary) return;
  if (!env.INSTITUTIONAL_PRIMARY_BANNER_ENABLED) {
    throw new AppError(409, "PRIMARY_BANNER_DISABLED", "O banner principal ainda nao esta habilitado neste ambiente.");
  }
  if (!active || placement !== "home_hero") {
    throw new AppError(422, "INVALID_PRIMARY_BANNER", "O banner principal deve estar publicado no carrossel da pagina inicial.");
  }
}

async function clearPreviousPrimary(tx: BannerTransaction, adminUserId: string, keepId?: string) {
  const [previous] = await tx.select({ id: institutionalBanners.id }).from(institutionalBanners)
    .where(and(eq(institutionalBanners.isPrimary, true), isNull(institutionalBanners.deletedAt)))
    .limit(1);
  if (previous && previous.id !== keepId) {
    await tx.update(institutionalBanners)
      .set({ isPrimary: false, updatedByAdminUserId: adminUserId, updatedAt: new Date() })
      .where(eq(institutionalBanners.id, previous.id));
  }
  return previous?.id ?? null;
}

async function auditPrimaryChange(tx: BannerTransaction, adminUserId: string, before: string | null, after: string | null) {
  if (before === after) return;
  await audit(tx, {
    adminUserId,
    action: "primary.change",
    resourceType: "institutional_banner",
    resourceId: after ?? before ?? undefined,
    metadata: { previousBannerId: before, primaryBannerId: after },
  });
}

async function orphanUnusedAsset(tx: BannerTransaction, assetId: string) {
  const [reference] = await tx.select({ id: institutionalBanners.id }).from(institutionalBanners)
    .where(and(eq(institutionalBanners.mediaAssetId, assetId), isNull(institutionalBanners.deletedAt)))
    .limit(1);
  if (!reference) {
    await tx.update(mediaAssets).set({ status: "orphaned", updatedAt: new Date() })
      .where(eq(mediaAssets.id, assetId));
  }
}

function publicUrl(key: string): string | null {
  if (!env.R2_PUBLIC_BASE_URL) return null;
  return env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "") + "/" +
    key.split("/").map(encodeURIComponent).join("/");
}

function normalizedObjectPrefix() {
  return env.R2_OBJECT_PREFIX.replace(/^\/+|\/+$/g, "");
}

function createObjectKey(extension: string) {
  const now = new Date();
  const prefix = normalizedObjectPrefix();
  return [
    prefix,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    randomUUID() + "." + extension,
  ].join("/");
}

function normalizeExistingObjectKey(key: string) {
  const normalized = key.trim().replace(/^\/+/, "");
  const prefix = normalizedObjectPrefix();
  if (prefix && normalized !== prefix && !normalized.startsWith(prefix + "/")) {
    throw new AppError(422, "OBJECT_KEY_OUTSIDE_PREFIX", "Use um arquivo dentro de " + prefix + "/.");
  }
  const extension = normalized.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = EXISTING_OBJECT_MIME_TYPES[extension];
  if (!mimeType) {
    throw new AppError(415, "INVALID_IMAGE_TYPE", "Use um arquivo SVG, JPEG, PNG, WebP ou AVIF.");
  }
  return { key: normalized, mimeType };
}

function originalNameFromKey(key: string) {
  return key.split("/").pop()?.slice(0, 255) || "banner";
}

async function audit(
  executor: Pick<typeof db, "insert">,
  input: {
    adminUserId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await executor.insert(adminAuditLogs).values({
    adminUserId: input.adminUserId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata ?? {},
  });
}

const bannerSelection = {
  id: institutionalBanners.id,
  title: institutionalBanners.title,
  altText: institutionalBanners.altText,
  placementKey: institutionalBanners.placementKey,
  mediaAssetId: institutionalBanners.mediaAssetId,
  actionType: institutionalBanners.actionType,
  destinationUrl: institutionalBanners.destinationUrl,
  openInNewTab: institutionalBanners.openInNewTab,
  displayOrder: institutionalBanners.displayOrder,
  active: institutionalBanners.active,
  isPrimary: institutionalBanners.isPrimary,
  createdAt: institutionalBanners.createdAt,
  updatedAt: institutionalBanners.updatedAt,
  objectKey: mediaAssets.objectKey,
  mimeType: mediaAssets.mimeType,
  width: mediaAssets.width,
  height: mediaAssets.height,
  byteSize: mediaAssets.byteSize,
  mediaStatus: mediaAssets.status,
};

function serializeBanner<T extends { objectKey: string }>(banner: T) {
  return { ...banner, imageUrl: publicUrl(banner.objectKey) };
}

export async function listAdminInstitutionalBanners(placementKey = "home_hero") {
  const rows = await db
    .select(bannerSelection)
    .from(institutionalBanners)
    .innerJoin(mediaAssets, eq(mediaAssets.id, institutionalBanners.mediaAssetId))
    .where(and(
      eq(institutionalBanners.placementKey, placementKey),
      isNull(institutionalBanners.deletedAt),
    ))
    .orderBy(asc(institutionalBanners.displayOrder), asc(institutionalBanners.createdAt));
  return rows.map(serializeBanner);
}

export async function listPublicInstitutionalBanners(placementKey: string) {
  if (isPublicConfigSnapshotReadEnabled()) {
    const snapshot = await readPublicConfigSnapshot();
    return {
      ...getSnapshotBanners(snapshot, placementKey),
      cacheControl: publicConfigCacheControl(snapshot),
    };
  }
  if (!env.R2_PUBLIC_BASE_URL) {
    return { version: 0, items: [], cacheControl: PUBLIC_CACHE_CONTROL };
  }
  const rows = await db
    .select(bannerSelection)
    .from(institutionalBanners)
    .innerJoin(mediaAssets, eq(mediaAssets.id, institutionalBanners.mediaAssetId))
    .where(and(
      eq(institutionalBanners.placementKey, placementKey),
      eq(institutionalBanners.active, true),
      isNull(institutionalBanners.deletedAt),
      eq(mediaAssets.status, "ready"),
    ))
    .orderBy(asc(institutionalBanners.displayOrder), asc(institutionalBanners.createdAt));

  const version = rows.reduce(
    (latest, item) => Math.max(latest, item.updatedAt.getTime()),
    0,
  );
  return {
    version,
    cacheControl: PUBLIC_CACHE_CONTROL,
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      altText: row.altText,
      imageUrl: publicUrl(row.objectKey) as string,
      actionType: row.actionType,
      destinationUrl: row.destinationUrl,
      openInNewTab: row.openInNewTab,
      order: row.displayOrder,
      isPrimary: env.INSTITUTIONAL_PRIMARY_BANNER_ENABLED && row.isPrimary,
    })),
  };
}

export async function createInstitutionalBannerFromR2Object(
  input: {
    title: string;
    altText: string;
    placementKey: string;
    objectKey: string;
    actionType: InstitutionalBannerActionType;
    destinationUrl: string | null;
    openInNewTab: boolean;
    active: boolean;
    isPrimary?: boolean;
  },
  adminUserId: string,
) {
  if (!env.R2_PUBLIC_BASE_URL) {
    throw new AppError(503, "MEDIA_PUBLIC_URL_NOT_CONFIGURED", "A URL publica do armazenamento nao foi configurada.");
  }

  const object = normalizeExistingObjectKey(input.objectKey);
  const action = institutionalBannerActionStateSchema.parse(input);
  validatePrimaryChoice(input.isPrimary, input.active, input.placementKey);

  return db.transaction(async (tx) => {
    await lockBannerConfiguration(tx);

    const [existingAsset] = await tx.select().from(mediaAssets)
      .where(eq(mediaAssets.objectKey, object.key)).limit(1);

    const asset = existingAsset ?? (await tx.insert(mediaAssets).values({
      storageProvider: "r2",
      objectKey: object.key,
      originalName: originalNameFromKey(object.key),
      mimeType: object.mimeType,
      byteSize: 1,
      width: 1,
      height: 1,
      etag: null,
      status: "ready",
      createdByAdminUserId: adminUserId,
    }).returning())[0];

    if (!asset || asset.status !== "ready") {
      throw new AppError(422, "MEDIA_NOT_READY", "O arquivo informado nao esta pronto para uso.");
    }

    const [last] = await tx.select({ displayOrder: institutionalBanners.displayOrder })
      .from(institutionalBanners)
      .where(and(
        eq(institutionalBanners.placementKey, input.placementKey),
        isNull(institutionalBanners.deletedAt),
      ))
      .orderBy(desc(institutionalBanners.displayOrder)).limit(1);

    const previousPrimaryId = input.isPrimary ? await clearPreviousPrimary(tx, adminUserId) : null;
    const [created] = await tx.insert(institutionalBanners).values({
      title: input.title,
      altText: input.altText,
      placementKey: input.placementKey,
      mediaAssetId: asset.id,
      actionType: action.actionType,
      destinationUrl: action.destinationUrl,
      openInNewTab: action.openInNewTab,
      active: input.active,
      isPrimary: input.isPrimary ?? false,
      displayOrder: (last?.displayOrder ?? 0) + 1,
      createdByAdminUserId: adminUserId,
      updatedByAdminUserId: adminUserId,
    }).returning();

    if (!created) throw new AppError(500, "BANNER_CREATE_FAILED", "Falha ao criar o banner.");
    if (input.isPrimary) await auditPrimaryChange(tx, adminUserId, previousPrimaryId, created.id);

    await audit(tx, {
      adminUserId,
      action: "create_from_r2_object",
      resourceType: "institutional_banner",
      resourceId: created.id,
      metadata: { objectKey: object.key },
    });

    return serializeBanner({
      ...created,
      objectKey: asset.objectKey,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      byteSize: asset.byteSize,
      mediaStatus: asset.status,
    });
  });
}
export async function uploadInstitutionalBannerAsset(input: {
  buffer: Buffer;
  filename: string;
  adminUserId: string;
  storage: MediaStorage;
}) {
  if (input.buffer.length > env.INSTITUTIONAL_BANNER_MAX_BYTES) {
    throw new AppError(413, "IMAGE_TOO_LARGE", "A imagem deve ter no maximo 10 MiB.");
  }

  const processed = await processBannerImage(input.buffer, input.filename);
  const key = createObjectKey(processed.extension);
  const uploaded = await input.storage.put({
    key,
    body: processed.buffer,
    contentType: processed.mimeType,
    cacheControl: OBJECT_CACHE_CONTROL,
  });

  try {
    const [asset] = await db.insert(mediaAssets).values({
      storageProvider: "r2",
      objectKey: key,
      originalName: processed.originalName,
      mimeType: processed.mimeType,
      byteSize: processed.buffer.length,
      width: processed.width,
      height: processed.height,
      etag: uploaded.etag,
      status: "ready",
      createdByAdminUserId: input.adminUserId,
    }).returning();
    if (!asset) throw new AppError(500, "ASSET_PERSIST_FAILED", "Falha ao registrar a imagem.");

    await audit(db, {
      adminUserId: input.adminUserId,
      action: "asset.upload",
      resourceType: "media_asset",
      resourceId: asset.id,
      metadata: { objectKey: key, width: processed.width, height: processed.height },
    });
    return { ...asset, imageUrl: input.storage.publicUrl(key) };
  } catch (error) {
    await input.storage.delete(key).catch(() => undefined);
    throw error;
  }
}

export async function createInstitutionalBanner(
  input: {
    title: string;
    altText: string;
    placementKey: string;
    mediaAssetId: string;
    actionType: InstitutionalBannerActionType;
    destinationUrl: string | null;
    openInNewTab: boolean;
    active: boolean;
    isPrimary?: boolean;
  },
  adminUserId: string,
) {
  const action = institutionalBannerActionStateSchema.parse(input);
  validatePrimaryChoice(input.isPrimary, input.active, input.placementKey);

  return db.transaction(async (tx) => {
    await lockBannerConfiguration(tx);

    const [asset] = await tx.select({ id: mediaAssets.id, status: mediaAssets.status })
      .from(mediaAssets).where(eq(mediaAssets.id, input.mediaAssetId)).limit(1);
    if (!asset || asset.status !== "ready") {
      throw new AppError(422, "MEDIA_NOT_READY", "Selecione uma imagem pronta para uso.");
    }

    const [last] = await tx.select({ displayOrder: institutionalBanners.displayOrder })
      .from(institutionalBanners)
      .where(and(
        eq(institutionalBanners.placementKey, input.placementKey),
        isNull(institutionalBanners.deletedAt),
      ))
      .orderBy(desc(institutionalBanners.displayOrder)).limit(1);

    const previousPrimaryId = input.isPrimary ? await clearPreviousPrimary(tx, adminUserId) : null;
    const [created] = await tx.insert(institutionalBanners).values({
      ...input,
      isPrimary: input.isPrimary ?? false,
      actionType: action.actionType,
      destinationUrl: action.destinationUrl,
      openInNewTab: action.openInNewTab,
      displayOrder: (last?.displayOrder ?? 0) + 1,
      createdByAdminUserId: adminUserId,
      updatedByAdminUserId: adminUserId,
    }).returning();
    if (!created) throw new AppError(500, "BANNER_CREATE_FAILED", "Falha ao criar o banner.");
    if (input.isPrimary) await auditPrimaryChange(tx, adminUserId, previousPrimaryId, created.id);

    await audit(tx, {
      adminUserId,
      action: "create",
      resourceType: "institutional_banner",
      resourceId: created.id,
    });
    return created;
  });
}

export async function updateInstitutionalBanner(
  id: string,
  input: Partial<{
    title: string;
    altText: string;
    placementKey: string;
    mediaAssetId: string;
    actionType: InstitutionalBannerActionType;
    destinationUrl: string | null;
    openInNewTab: boolean;
    active: boolean;
    isPrimary: boolean;
  }>,
  adminUserId: string,
  auditAction = "update",
) {
  return db.transaction(async (tx) => {
    await lockBannerConfiguration(tx);
    const [existing] = await tx.select().from(institutionalBanners)
      .where(and(eq(institutionalBanners.id, id), isNull(institutionalBanners.deletedAt)))
      .limit(1);
    if (!existing) throw new AppError(404, "BANNER_NOT_FOUND", "Banner nao encontrado.");

    const nextActive = input.active ?? existing.active;
    const nextPlacement = input.placementKey ?? existing.placementKey;
    validatePrimaryChoice(input.isPrimary, nextActive, nextPlacement);
    const nextPrimary = nextActive && nextPlacement === "home_hero" &&
      (input.isPrimary ?? existing.isPrimary);

    const action = institutionalBannerActionStateSchema.parse({
      actionType: input.actionType ?? existing.actionType,
      destinationUrl:
        input.destinationUrl !== undefined
          ? input.destinationUrl
          : existing.destinationUrl,
      openInNewTab:
        input.openInNewTab !== undefined
          ? input.openInNewTab
          : existing.openInNewTab,
    });

    if (input.mediaAssetId || nextPrimary) {
      const [asset] = await tx.select({ status: mediaAssets.status }).from(mediaAssets)
        .where(eq(mediaAssets.id, input.mediaAssetId ?? existing.mediaAssetId)).limit(1);
      if (!asset || asset.status !== "ready") {
        throw new AppError(422, "MEDIA_NOT_READY", "Selecione uma imagem pronta para uso.");
      }
    }

    const previousPrimaryId = nextPrimary
      ? await clearPreviousPrimary(tx, adminUserId, id)
      : existing.isPrimary ? id : null;

    const [updated] = await tx.update(institutionalBanners)
      .set({
        ...input,
        isPrimary: nextPrimary,
        actionType: action.actionType,
        destinationUrl: action.destinationUrl,
        openInNewTab: action.openInNewTab,
        updatedByAdminUserId: adminUserId,
        updatedAt: new Date(),
      })
      .where(eq(institutionalBanners.id, id)).returning();

    if (input.mediaAssetId && input.mediaAssetId !== existing.mediaAssetId) {
      await orphanUnusedAsset(tx, existing.mediaAssetId);
    }

    if (nextPrimary || existing.isPrimary) {
      await auditPrimaryChange(tx, adminUserId, previousPrimaryId, nextPrimary ? id : null);
    }

    await audit(tx, {
      adminUserId,
      action: auditAction,
      resourceType: "institutional_banner",
      resourceId: id,
    });
    return updated;
  });
}

export async function setInstitutionalBannerActive(
  id: string,
  active: boolean,
  adminUserId: string,
) {
  return updateInstitutionalBanner(id, { active }, adminUserId, active ? "activate" : "deactivate");
}

export async function reorderInstitutionalBanners(
  placementKey: string,
  orderedIds: string[],
  adminUserId: string,
) {
  return db.transaction(async (tx) => {
    await lockBannerConfiguration(tx);
    const current = await tx.select({ id: institutionalBanners.id })
      .from(institutionalBanners)
      .where(and(
        eq(institutionalBanners.placementKey, placementKey),
        isNull(institutionalBanners.deletedAt),
      ));
    const currentIds = new Set(current.map(({ id }) => id));
    if (currentIds.size !== orderedIds.length || orderedIds.some((id) => !currentIds.has(id))) {
      throw new AppError(
        422,
        "INVALID_BANNER_ORDER",
        "A ordenacao deve conter todos os banners do placement uma unica vez.",
      );
    }

    for (const [index, id] of orderedIds.entries()) {
      await tx.update(institutionalBanners).set({
        displayOrder: index + 1,
        updatedByAdminUserId: adminUserId,
        updatedAt: new Date(),
      }).where(eq(institutionalBanners.id, id));
    }
    await audit(tx, {
      adminUserId,
      action: "reorder",
      resourceType: "institutional_banner",
      metadata: { placementKey, orderedIds },
    });
  });
}

export async function deleteInstitutionalBanner(id: string, adminUserId: string) {
  await db.transaction(async (tx) => {
    await lockBannerConfiguration(tx);
    const [banner] = await tx.select().from(institutionalBanners)
      .where(and(eq(institutionalBanners.id, id), isNull(institutionalBanners.deletedAt)))
      .limit(1);
    if (!banner) throw new AppError(404, "BANNER_NOT_FOUND", "Banner nao encontrado.");

    await tx.update(institutionalBanners).set({
      active: false,
      isPrimary: false,
      deletedAt: new Date(),
      updatedByAdminUserId: adminUserId,
      updatedAt: new Date(),
    }).where(eq(institutionalBanners.id, id));
    await orphanUnusedAsset(tx, banner.mediaAssetId);
    if (banner.isPrimary) await auditPrimaryChange(tx, adminUserId, id, null);
    await audit(tx, {
      adminUserId,
      action: "delete",
      resourceType: "institutional_banner",
      resourceId: id,
    });
  });
}
