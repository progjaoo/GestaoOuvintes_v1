import {
  bigint,
  boolean,
  index,
  jsonb,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { adminUsers } from "./schema.js";

export const mediaAssets = pgTable(
  "media_asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageProvider: varchar("storage_provider", { length: 20 }).notNull().default("r2"),
    objectKey: varchar("object_key", { length: 1024 }).notNull(),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    etag: varchar("etag", { length: 255 }),
    status: varchar("status", { length: 20 }).notNull().default("ready"),
    createdByAdminUserId: uuid("created_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_asset_object_key_unique").on(table.objectKey),
    index("media_asset_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const institutionalBanners = pgTable(
  "institutional_banner",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 160 }).notNull(),
    altText: varchar("alt_text", { length: 220 }).notNull(),
    placementKey: varchar("placement_key", { length: 80 }).notNull().default("home_hero"),
    mediaAssetId: uuid("media_asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "restrict" }),
    destinationUrl: varchar("destination_url", { length: 2048 }),
    openInNewTab: boolean("open_in_new_tab").notNull().default(false),
    displayOrder: integer("display_order").notNull(),
    active: boolean("active").notNull().default(false),
    createdByAdminUserId: uuid("created_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    updatedByAdminUserId: uuid("updated_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("institutional_banner_public_idx").on(
      table.placementKey,
      table.active,
      table.displayOrder,
    ),
  ],
);

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type InstitutionalBanner = typeof institutionalBanners.$inferSelect;

export const adminAuditLogs = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 120 }).notNull(),
    resourceType: varchar("resource_type", { length: 80 }).notNull(),
    resourceId: uuid("resource_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("admin_audit_log_created_idx").on(table.createdAt)],
);
