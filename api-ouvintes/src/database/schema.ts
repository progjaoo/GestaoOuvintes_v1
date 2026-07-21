import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  primaryKey,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const campaigns = pgTable(
  "campaign",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 100 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    privacyNoticeVersion: varchar("privacy_notice_version", { length: 30 }).notNull(),
    privacyNoticeUrl: text("privacy_notice_url").notNull(),
    termsUrl: text("terms_url"),
    type: varchar("type", { length: 30 }).notNull().default("registration"),
    publicVersion: integer("public_version").notNull().default(1),
    createdByAdminUserId: uuid("created_by_admin_user_id"),
    updatedByAdminUserId: uuid("updated_by_admin_user_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("campaign_slug_unique").on(table.slug)],
);

export const adminUsers = pgTable(
  "admin_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    username: varchar("username", { length: 100 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: varchar("role", { length: 30 }).notNull().default("admin"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("admin_user_username_unique").on(table.username)],
);

export const listenerRegistrations = pgTable(
  "listener_registration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 160 }).notNull(),
    neighborhood: varchar("neighborhood", { length: 120 }).notNull(),
    city: varchar("city", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    source: varchar("source", { length: 50 }).notNull().default("institutional_web"),
    submissionToken: uuid("submission_token").notNull(),
    privacyNoticeVersion: varchar("privacy_notice_version", { length: 30 }).notNull(),
    privacyAcknowledgedAt: timestamp("privacy_acknowledged_at", {
      withTimezone: true,
    }).notNull(),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    marketingOptInAt: timestamp("marketing_opt_in_at", { withTimezone: true }),
    utmSource: varchar("utm_source", { length: 120 }),
    utmMedium: varchar("utm_medium", { length: 120 }),
    utmCampaign: varchar("utm_campaign", { length: 120 }),
    utmContent: varchar("utm_content", { length: 120 }),
    ipHash: varchar("ip_hash", { length: 128 }),
    userAgentSummary: varchar("user_agent_summary", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("listener_registration_campaign_submission_unique").on(
      table.campaignId,
      table.submissionToken,
    ),
    index("listener_registration_campaign_created_idx").on(
      table.campaignId,
      table.createdAt,
    ),
    index("listener_registration_city_idx").on(table.city),
    index("listener_registration_neighborhood_idx").on(table.neighborhood),
  ],
);

export const registrationExportAudits = pgTable(
  "registration_export_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "restrict",
    }),
    format: varchar("format", { length: 10 }).notNull(),
    filtersJson: jsonb("filters_json").notNull().default({}),
    rowCount: integer("row_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("registration_export_audit_created_idx").on(table.createdAt)],
);

export const campaignPlacements = pgTable(
  "campaign_placement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    placementKey: varchar("placement_key", { length: 80 }).notNull(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull().default(1),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByAdminUserId: uuid("published_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "set null" },
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("campaign_placement_key_unique").on(table.placementKey),
    index("campaign_placement_campaign_idx").on(table.campaignId),
  ],
);

export const listenerProfiles = pgTable(
  "listener_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    neighborhood: varchar("neighborhood", { length: 120 }).notNull(),
    city: varchar("city", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    phoneNormalized: varchar("phone_normalized", { length: 20 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("listener_profile_phone_normalized_idx").on(table.phoneNormalized),
    index("listener_profile_city_idx").on(table.city),
  ],
);

export const listenerDevices = pgTable(
  "listener_device",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listenerProfileId: uuid("listener_profile_id").references(
      () => listenerProfiles.id,
      { onDelete: "set null" },
    ),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    platform: varchar("platform", { length: 30 }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("listener_device_token_hash_unique").on(table.tokenHash),
    index("listener_device_profile_idx").on(table.listenerProfileId),
  ],
);

export const campaignParticipations = pgTable(
  "campaign_participation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    listenerProfileId: uuid("listener_profile_id")
      .notNull()
      .references(() => listenerProfiles.id, { onDelete: "restrict" }),
    listenerDeviceId: uuid("listener_device_id").references(() => listenerDevices.id, {
      onDelete: "set null",
    }),
    source: varchar("source", { length: 50 }).notNull().default("web"),
    status: varchar("status", { length: 20 }).notNull().default("eligible"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("campaign_participation_campaign_profile_unique").on(
      table.campaignId,
      table.listenerProfileId,
    ),
    index("campaign_participation_campaign_created_idx").on(
      table.campaignId,
      table.createdAt,
    ),
  ],
);

export const campaignDeviceStates = pgTable(
  "campaign_device_state",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    listenerDeviceId: uuid("listener_device_id")
      .notNull()
      .references(() => listenerDevices.id, { onDelete: "cascade" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    dismissedUntil: timestamp("dismissed_until", { withTimezone: true }),
    modalOpenCount: integer("modal_open_count").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.campaignId, table.listenerDeviceId],
      name: "campaign_device_state_pkey",
    }),
  ],
);

export const roles = pgTable("role", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 80 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable("permission", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 120 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type ListenerRegistration = typeof listenerRegistrations.$inferSelect;
export type CampaignPlacement = typeof campaignPlacements.$inferSelect;
export type ListenerProfile = typeof listenerProfiles.$inferSelect;
export type ListenerDevice = typeof listenerDevices.$inferSelect;
export type CampaignParticipation = typeof campaignParticipations.$inferSelect;
