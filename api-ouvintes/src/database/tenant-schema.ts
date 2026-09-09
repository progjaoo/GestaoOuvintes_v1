import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { adminUsers, roles } from "./schema.js";

export const tenants = pgTable(
  "tenant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 100 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    timezone: varchar("timezone", { length: 80 }).notNull().default("America/Sao_Paulo"),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    settingsJson: jsonb("settings_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("tenant_slug_unique_ci").on(table.slug)],
);

export const tenantDomains = pgTable(
  "tenant_domain",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    hostname: varchar("hostname", { length: 255 }).notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tenant_domain_hostname_unique_ci").on(table.hostname),
    index("tenant_domain_tenant_idx").on(table.tenantId, table.active),
  ],
);

export const tenantAdminMemberships = pgTable(
  "tenant_admin_membership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminUserId: uuid("admin_user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tenant_admin_membership_unique").on(
      table.adminUserId,
      table.tenantId,
      table.roleId,
    ),
    index("tenant_admin_membership_active_idx").on(
      table.adminUserId,
      table.tenantId,
      table.active,
    ),
  ],
);

export const tenantFeatureFlags = pgTable(
  "tenant_feature_flag",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    flagKey: varchar("flag_key", { length: 100 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    metadataJson: jsonb("metadata_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.flagKey], name: "tenant_feature_flag_pkey" }),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type TenantDomain = typeof tenantDomains.$inferSelect;
export type TenantAdminMembership = typeof tenantAdminMemberships.$inferSelect;
export type TenantFeatureFlag = typeof tenantFeatureFlags.$inferSelect;
