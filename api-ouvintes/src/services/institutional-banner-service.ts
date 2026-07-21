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
import { processBannerImage } from "./media-storage/media-image-processor.js";
import type { MediaStorage } from "./media-storage/media-storage.js";

const PUBLIC_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";
const OBJECT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const EXISTING_OBJECT_MIME_TYPES: Record<string, string> = {
  avif: "image/avif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

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
  destinationUrl: institutionalBanners.destinationUrl,
  openInNewTab: institutionalBanners.openInNewTab,
  displayOrder: institutionalBanners.displayOrder,
  active: institutionalBanners.active,
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
      destinationUrl: row.destinationUrl,
      openInNewTab: row.openInNewTab,
      order: row.displayOrder,
    })),
  };
}

export async function createInstitutionalBannerFromR2Object(
  input: {
    title: string;
    altText: string;
    placementKey: string;
    objectKey: string;
    destinationUrl: string | null;
    openInNewTab: boolean;
    active: boolean;
  },
  adminUserId: string,
) {
  if (!env.R2_PUBLIC_BASE_URL) {
    throw new AppError(503, "MEDIA_PUBLIC_URL_NOT_CONFIGURED", "A URL publica do armazenamento nao foi configurada.");
  }

  const object = normalizeExistingObjectKey(input.objectKey);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"institutional_banner:" + input.placementKey}))`,
    );

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

    const [created] = await tx.insert(institutionalBanners).values({
      title: input.title,
      altText: input.altText,
      placementKey: input.placementKey,
      mediaAssetId: asset.id,
      destinationUrl: input.destinationUrl,
      openInNewTab: input.openInNewTab,
      active: input.active,
      displayOrder: (last?.displayOrder ?? 0) + 1,
      createdByAdminUserId: adminUserId,
      updatedByAdminUserId: adminUserId,
    }).returning();

    if (!created) throw new AppError(500, "BANNER_CREATE_FAILED", "Falha ao criar o banner.");

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
    destinationUrl: string | null;
    openInNewTab: boolean;
    active: boolean;
  },
  adminUserId: string,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"institutional_banner:" + input.placementKey}))`,
    );

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

    const [created] = await tx.insert(institutionalBanners).values({
      ...input,
      displayOrder: (last?.displayOrder ?? 0) + 1,
      createdByAdminUserId: adminUserId,
      updatedByAdminUserId: adminUserId,
    }).returning();
    if (!created) throw new AppError(500, "BANNER_CREATE_FAILED", "Falha ao criar o banner.");

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
    destinationUrl: string | null;
    openInNewTab: boolean;
    active: boolean;
  }>,
  adminUserId: string,
) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(institutionalBanners)
      .where(and(eq(institutionalBanners.id, id), isNull(institutionalBanners.deletedAt)))
      .limit(1);
    if (!existing) throw new AppError(404, "BANNER_NOT_FOUND", "Banner nao encontrado.");

    if (input.mediaAssetId) {
      const [asset] = await tx.select({ status: mediaAssets.status }).from(mediaAssets)
        .where(eq(mediaAssets.id, input.mediaAssetId)).limit(1);
      if (!asset || asset.status !== "ready") {
        throw new AppError(422, "MEDIA_NOT_READY", "Selecione uma imagem pronta para uso.");
      }
    }

    const [updated] = await tx.update(institutionalBanners)
      .set({ ...input, updatedByAdminUserId: adminUserId, updatedAt: new Date() })
      .where(eq(institutionalBanners.id, id)).returning();

    if (input.mediaAssetId && input.mediaAssetId !== existing.mediaAssetId) {
      await tx.update(mediaAssets).set({ status: "orphaned", updatedAt: new Date() })
        .where(eq(mediaAssets.id, existing.mediaAssetId));
    }

    await audit(tx, {
      adminUserId,
      action: "update",
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
  const [updated] = await db.update(institutionalBanners)
    .set({ active, updatedByAdminUserId: adminUserId, updatedAt: new Date() })
    .where(and(eq(institutionalBanners.id, id), isNull(institutionalBanners.deletedAt)))
    .returning();
  if (!updated) throw new AppError(404, "BANNER_NOT_FOUND", "Banner nao encontrado.");
  await audit(db, {
    adminUserId,
    action: active ? "activate" : "deactivate",
    resourceType: "institutional_banner",
    resourceId: id,
  });
  return updated;
}

export async function reorderInstitutionalBanners(
  placementKey: string,
  orderedIds: string[],
  adminUserId: string,
) {
  return db.transaction(async (tx) => {
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
    const [banner] = await tx.select().from(institutionalBanners)
      .where(and(eq(institutionalBanners.id, id), isNull(institutionalBanners.deletedAt)))
      .limit(1);
    if (!banner) throw new AppError(404, "BANNER_NOT_FOUND", "Banner nao encontrado.");

    await tx.update(institutionalBanners).set({
      active: false,
      deletedAt: new Date(),
      updatedByAdminUserId: adminUserId,
      updatedAt: new Date(),
    }).where(eq(institutionalBanners.id, id));
    await tx.update(mediaAssets).set({ status: "orphaned", updatedAt: new Date() })
      .where(eq(mediaAssets.id, banner.mediaAssetId));
    await audit(tx, {
      adminUserId,
      action: "delete",
      resourceType: "institutional_banner",
      resourceId: id,
    });
  });
}
