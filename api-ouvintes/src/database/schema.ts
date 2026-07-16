import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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

export type Campaign = typeof campaigns.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type ListenerRegistration = typeof listenerRegistrations.$inferSelect;
