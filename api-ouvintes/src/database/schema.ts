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
import { sql } from "drizzle-orm";

export const listenerIdentities = pgTable(
  "listener_identity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
    provider: varchar("provider", { length: 20 }).notNull().default("anonymous"),
    providerSubject: varchar("provider_subject", { length: 255 }),
    clerkUserId: varchar("clerk_user_id", { length: 255 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    clerkLastEventAt: timestamp("clerk_last_event_at", { withTimezone: true }),
    clerkDeletedAt: timestamp("clerk_deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("listener_identity_tenant_clerk_unique")
      .on(table.tenantId, table.clerkUserId)
      .where(sql`${table.clerkUserId} is not null`),
    uniqueIndex("listener_identity_tenant_provider_subject_unique")
      .on(table.tenantId, table.provider, table.providerSubject)
      .where(sql`${table.providerSubject} is not null`),
    index("listener_identity_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const clerkWebhookEvents = pgTable(
  "clerk_webhook_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceKey: varchar("instance_key", { length: 120 }).notNull(),
    eventId: varchar("event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    clerkUserId: varchar("clerk_user_id", { length: 255 }),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: varchar("status", { length: 20 }).notNull().default("received"),
    attempts: integer("attempts").notNull().default(1),
    affectedTenantCount: integer("affected_tenant_count").notNull().default(0),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
  },
  (table) => [
    uniqueIndex("clerk_webhook_event_instance_id_unique").on(
      table.instanceKey,
      table.eventId,
    ),
    index("clerk_webhook_event_status_received_idx").on(
      table.status,
      table.receivedAt,
    ),
    index("clerk_webhook_event_user_received_idx").on(
      table.clerkUserId,
      table.receivedAt,
    ),
  ],
);

export const campaigns = pgTable(
  "campaign",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
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
  (table) => [uniqueIndex("campaign_tenant_slug_unique").on(table.tenantId, table.slug)],
);

export const adminUsers = pgTable(
  "admin_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    username: varchar("username", { length: 100 }).notNull(),
    clerkUserId: varchar("clerk_user_id", { length: 255 }),
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
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 160 }).notNull(),
    neighborhood: varchar("neighborhood", { length: 120 }).notNull(),
    city: varchar("city", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    phoneNormalized: varchar("phone_normalized", { length: 20 }),
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
    uniqueIndex("listener_registration_tenant_submission_unique").on(
      table.tenantId,
      table.campaignId,
      table.submissionToken,
    ),
    uniqueIndex("listener_registration_tenant_phone_unique")
      .on(table.tenantId, table.campaignId, table.phoneNormalized)
      .where(sql`${table.phoneNormalized} is not null and ${table.deletedAt} is null`),
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
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
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
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
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
    uniqueIndex("campaign_placement_tenant_key_unique").on(table.tenantId, table.placementKey),
    index("campaign_placement_campaign_idx").on(table.campaignId),
  ],
);

export const listenerProfiles = pgTable(
  "listener_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
    listenerIdentityId: uuid("listener_identity_id")
      .notNull()
      .references(() => listenerIdentities.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 160 }).notNull(),
    neighborhood: varchar("neighborhood", { length: 120 }).notNull(),
    city: varchar("city", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    phoneNormalized: varchar("phone_normalized", { length: 20 }),
    phoneHash: varchar("phone_hash", { length: 64 }),
    email: varchar("email", { length: 320 }),
    gender: varchar("gender", { length: 40 }),
    ageRange: varchar("age_range", { length: 40 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("listener_profile_phone_normalized_idx").on(table.phoneNormalized),
    index("listener_profile_phone_hash_idx").on(table.phoneHash),
    index("listener_profile_city_idx").on(table.city),
    uniqueIndex("listener_profile_tenant_phone_unique")
      .on(table.tenantId, table.phoneNormalized)
      .where(sql`${table.phoneNormalized} is not null and ${table.deletedAt} is null`),
  ],
);

export const listenerDevices = pgTable(
  "listener_device",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
    listenerIdentityId: uuid("listener_identity_id").references(
      () => listenerIdentities.id,
      { onDelete: "set null" },
    ),
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
    uniqueIndex("listener_device_tenant_token_unique").on(table.tenantId, table.tokenHash),
    index("listener_device_profile_idx").on(table.listenerProfileId),
  ],
);

export const campaignParticipations = pgTable(
  "campaign_participation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
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
    uniqueIndex("campaign_participation_tenant_profile_unique").on(
      table.tenantId,
      table.campaignId,
      table.listenerProfileId,
    ),
    index("campaign_participation_campaign_created_idx").on(
      table.campaignId,
      table.createdAt,
    ),
  ],
);

export const listenerConsents = pgTable(
  "listener_consent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
    listenerProfileId: uuid("listener_profile_id")
      .notNull()
      .references(() => listenerProfiles.id, { onDelete: "restrict" }),
    consentType: varchar("consent_type", { length: 40 }).notNull(),
    documentVersion: varchar("document_version", { length: 40 }),
    granted: boolean("granted").notNull(),
    source: varchar("source", { length: 50 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("listener_consent_profile_created_idx").on(
      table.tenantId,
      table.listenerProfileId,
      table.createdAt,
    ),
  ],
);

export const listenerCommunicationPreferences = pgTable(
  "listener_communication_preference",
  {
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
    listenerProfileId: uuid("listener_profile_id")
      .notNull()
      .references(() => listenerProfiles.id, { onDelete: "cascade" }),
    receivePortalNews: boolean("receive_portal_news").notNull().default(false),
    receiveCampaignUpdates: boolean("receive_campaign_updates").notNull().default(false),
    receiveEmail: boolean("receive_email").notNull().default(false),
    receiveWhatsapp: boolean("receive_whatsapp").notNull().default(false),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.listenerProfileId],
      name: "listener_communication_preference_pkey",
    }),
  ],
);

export const listenerActivityLogs = pgTable(
  "listener_activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
    listenerIdentityId: uuid("listener_identity_id").references(
      () => listenerIdentities.id,
      { onDelete: "set null" },
    ),
    listenerProfileId: uuid("listener_profile_id").references(
      () => listenerProfiles.id,
      { onDelete: "set null" },
    ),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("listener_activity_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("listener_activity_profile_created_idx").on(
      table.listenerProfileId,
      table.createdAt,
    ),
  ],
);


export const listenerRecoveryHandoffs = pgTable(
  "listener_recovery_handoff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    listenerIdentityId: uuid("listener_identity_id").notNull().references(
      () => listenerIdentities.id,
      { onDelete: "restrict" },
    ),
    sourceDeviceId: uuid("source_device_id").notNull().references(
      () => listenerDevices.id,
      { onDelete: "restrict" },
    ),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    purpose: varchar("purpose", { length: 40 }).notNull().default("listener_profile"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("listener_recovery_handoff_tenant_token_unique").on(
      table.tenantId,
      table.tokenHash,
    ),
    index("listener_recovery_handoff_identity_idx").on(
      table.tenantId,
      table.listenerIdentityId,
      table.createdAt,
    ),
    index("listener_recovery_handoff_expiry_idx").on(
      table.tenantId,
      table.expiresAt,
    ),
  ],
);

export const campaignDeviceStates = pgTable(
  "campaign_device_state",
  {
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
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
      columns: [table.tenantId, table.campaignId, table.listenerDeviceId],
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

export const sweepstakeDraws = pgTable(
  "sweepstake_draw",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("selected"),
    winnerParticipationId: uuid("winner_participation_id")
      .notNull()
      .references(() => campaignParticipations.id, { onDelete: "restrict" }),
    rootDrawId: uuid("root_draw_id"),
    previousDrawId: uuid("previous_draw_id"),
    executedByAdminUserId: uuid("executed_by_admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    algorithm: varchar("algorithm", { length: 80 }).notNull(),
    eligibleCount: integer("eligible_count").notNull(),
    entriesHash: varchar("entries_hash", { length: 64 }).notNull(),
    reasonCode: varchar("reason_code", { length: 80 }),
    requestToken: uuid("request_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sweepstake_draw_tenant_campaign_sequence_unique").on(
      table.tenantId,
      table.campaignId,
      table.sequence,
    ),
    uniqueIndex("sweepstake_draw_tenant_campaign_selected_unique")
      .on(table.tenantId, table.campaignId)
      .where(sql`${table.status} = 'selected'`),
    uniqueIndex("sweepstake_draw_tenant_request_token_unique").on(table.tenantId, table.requestToken),
    index("sweepstake_draw_campaign_created_idx").on(
      table.campaignId,
      table.createdAt,
    ),
    index("sweepstake_draw_winner_idx").on(table.winnerParticipationId),
  ],
);

export const sweepstakeDrawEntries = pgTable(
  "sweepstake_draw_entry",
  {
    tenantId: uuid("tenant_id").notNull().default(sql`current_default_tenant_id()`),
    drawId: uuid("draw_id")
      .notNull()
      .references(() => sweepstakeDraws.id, { onDelete: "restrict" }),
    participationId: uuid("participation_id")
      .notNull()
      .references(() => campaignParticipations.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.drawId, table.participationId],
      name: "sweepstake_draw_entry_pkey",
    }),
    uniqueIndex("sweepstake_draw_entry_tenant_ordinal_unique").on(
      table.tenantId,
      table.drawId,
      table.ordinal,
    ),
    index("sweepstake_draw_entry_participation_idx").on(table.participationId),
  ],
);

export type Campaign = typeof campaigns.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type ListenerRegistration = typeof listenerRegistrations.$inferSelect;
export type ListenerIdentity = typeof listenerIdentities.$inferSelect;
export type CampaignPlacement = typeof campaignPlacements.$inferSelect;
export type ListenerProfile = typeof listenerProfiles.$inferSelect;
export type ListenerDevice = typeof listenerDevices.$inferSelect;
export type CampaignParticipation = typeof campaignParticipations.$inferSelect;
export type ListenerConsent = typeof listenerConsents.$inferSelect;
export type ListenerCommunicationPreference = typeof listenerCommunicationPreferences.$inferSelect;
export type ListenerActivityLog = typeof listenerActivityLogs.$inferSelect;
export type ListenerRecoveryHandoff = typeof listenerRecoveryHandoffs.$inferSelect;
export type SweepstakeDraw = typeof sweepstakeDraws.$inferSelect;
export type SweepstakeDrawEntry = typeof sweepstakeDrawEntries.$inferSelect;
