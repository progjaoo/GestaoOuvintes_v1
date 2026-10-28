import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar, } from "drizzle-orm/pg-core";
import { adminUsers } from "./schema.js";
export const editorialCategories = pgTable("editorial_category", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 80 }).notNull(),
    slug: varchar("slug", { length: 90 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("editorial_category_slug_unique").on(table.slug)]);
export const editorialPosts = pgTable("editorial_post", {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 180 }).notNull(),
    categoryId: uuid("category_id").notNull().references(() => editorialCategories.id),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    draftRevisionId: uuid("draft_revision_id"),
    publishedRevisionId: uuid("published_revision_id"),
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    createdByAdminUserId: uuid("created_by_admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
    updatedByAdminUserId: uuid("updated_by_admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
    uniqueIndex("editorial_post_slug_unique").on(table.slug),
    index("editorial_post_public_order_idx").on(table.firstPublishedAt, table.id).where(sql `${table.status} = 'published' AND ${table.archivedAt} IS NULL`),
]);
export const editorialMediaAssets = pgTable("editorial_media_asset", {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaType: varchar("media_type", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("uploading"),
    privateObjectKey: varchar("private_object_key", { length: 1024 }).notNull(),
    publicObjectKey: varchar("public_object_key", { length: 1024 }),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    frameCount: integer("frame_count"),
    posterObjectKey: varchar("poster_object_key", { length: 1024 }),
    privateVariants: jsonb("private_variants").notNull().default([]),
    checksumSha256: varchar("checksum_sha256", { length: 64 }),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    createdByAdminUserId: uuid("created_by_admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex("editorial_media_private_key_unique").on(table.privateObjectKey),
    index("editorial_media_owner_status_idx").on(table.createdByAdminUserId, table.status, table.createdAt),
]);
export const editorialRevisions = pgTable("editorial_revision", {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").notNull().references(() => editorialPosts.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    title: varchar("title", { length: 180 }).notNull(),
    excerpt: varchar("excerpt", { length: 320 }).notNull(),
    coverAssetId: uuid("cover_asset_id").notNull().references(() => editorialMediaAssets.id),
    coverAlt: varchar("cover_alt", { length: 220 }).notNull(),
    coverFocusX: numeric("cover_focus_x", { precision: 5, scale: 2 }).notNull().default("50"),
    coverFocusY: numeric("cover_focus_y", { precision: 5, scale: 2 }).notNull().default("50"),
    blocks: jsonb("blocks").notNull().default([]),
    categorySnapshot: jsonb("category_snapshot").notNull(),
    seoTitle: varchar("seo_title", { length: 70 }).notNull(),
    seoDescription: varchar("seo_description", { length: 180 }).notNull(),
    eventDate: date("event_date"),
    publicCredits: varchar("public_credits", { length: 500 }),
    createdByAdminUserId: uuid("created_by_admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("editorial_revision_number_unique").on(table.postId, table.revisionNumber)]);
export const editorialRevisionAssets = pgTable("editorial_revision_asset", {
    revisionId: uuid("revision_id").notNull().references(() => editorialRevisions.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => editorialMediaAssets.id),
}, (table) => [primaryKey({ columns: [table.revisionId, table.assetId], name: "editorial_revision_asset_pkey" })]);
export const editorialReleases = pgTable("editorial_release", {
    id: uuid("id").primaryKey().defaultRandom(),
    namespace: varchar("namespace", { length: 120 }).notNull(),
    sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity(),
    status: varchar("status", { length: 30 }).notNull().default("preparing"),
    revisionIds: jsonb("revision_ids").notNull(),
    manifestKey: varchar("manifest_key", { length: 1024 }),
    manifestSha256: varchar("manifest_sha256", { length: 64 }),
    deployJobId: varchar("deploy_job_id", { length: 160 }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    errorCode: varchar("error_code", { length: 80 }),
    createdByAdminUserId: uuid("created_by_admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
    index("editorial_release_namespace_created_idx").on(table.namespace, table.createdAt),
    uniqueIndex("editorial_release_idempotency_unique").on(table.namespace, table.idempotencyKey),
]);
