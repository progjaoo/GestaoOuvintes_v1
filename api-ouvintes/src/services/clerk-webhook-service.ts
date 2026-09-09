import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../database/client.js";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { normalizePhone } from "../lib/normalization.js";
import {
  clerkDeletedUserWebhookDataSchema,
  clerkUserWebhookDataSchema,
  getPrimaryVerifiedEmail,
  getPrimaryVerifiedPhone,
  isSupportedClerkWebhookType,
  toDateFromClerkTimestamp,
  type ClerkDeletedUserWebhookData,
  type ClerkUserWebhookData,
  type ClerkWebhookType,
} from "../schemas/clerk-webhook.js";

type WebhookEventStatus = "processed" | "ignored";

export interface ClerkWebhookInput {
  eventId: string;
  eventType: string;
  clerkUserId: string | null;
  instanceKey: string;
  payloadHash: string;
  occurredAt: Date;
  data: unknown;
}

interface StoredWebhookEvent {
  id: string;
  payload_hash: string;
  status: string;
  attempts: number;
}

interface LinkedIdentityRow {
  identity_id: string;
  tenant_id: string;
  identity_status: string;
  clerk_last_event_at: Date | string | null;
  clerk_deleted_at: Date | string | null;
  profile_id: string | null;
  profile_email: string | null;
  profile_phone_normalized: string | null;
}

function invalidWebhook(code: string, message: string): AppError {
  return new AppError(400, code, message);
}

function asDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function errorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  return "CLERK_WEBHOOK_PROCESSING_FAILED";
}

function errorIsRetryable(error: unknown): boolean {
  return !(error instanceof AppError && error.statusCode < 500);
}

function getDataId(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("id" in data)) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function normalizeClerkPhoneForProfile(value: string): string | null {
  const digits = normalizePhone(value);
  if (!digits) return null;

  // O cadastro legado armazena telefones brasileiros sem o DDI +55.
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits.slice(2);
  }

  return digits;
}

export function hashClerkWebhookPayload(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function getClerkWebhookEventDate(
  eventType: string,
  data: unknown,
  envelopeTimestamp: number | undefined,
): Date {
  if (eventType !== "user.deleted" && typeof data === "object" && data !== null) {
    const timestamps = data as { updated_at?: unknown; created_at?: unknown };
    const preferred = eventType === "user.updated" ? timestamps.updated_at : timestamps.created_at;
    if (typeof preferred === "number") {
      const date = toDateFromClerkTimestamp(preferred);
      if (date) return date;
    }
  }

  const envelopeDate = toDateFromClerkTimestamp(envelopeTimestamp);
  return envelopeDate ?? new Date();
}

function validateSupportedData(
  eventType: ClerkWebhookType,
  data: unknown,
): ClerkUserWebhookData | ClerkDeletedUserWebhookData {
  const result = eventType === "user.deleted"
    ? clerkDeletedUserWebhookDataSchema.safeParse(data)
    : clerkUserWebhookDataSchema.safeParse(data);

  if (!result.success) {
    throw invalidWebhook(
      "CLERK_WEBHOOK_PAYLOAD_INVALID",
      "O evento Clerk nao possui os dados esperados.",
    );
  }

  return result.data;
}

async function markEventFailed(input: ClerkWebhookInput, code: string): Promise<void> {
  await pool.query(
    `INSERT INTO clerk_webhook_event
      (instance_key, event_id, event_type, clerk_user_id, payload_hash, occurred_at, status, attempts, last_error_code)
     VALUES ($1, $2, $3, $4, $5, $6, 'failed', 1, $7)
     ON CONFLICT (instance_key, event_id)
     DO UPDATE SET
       status = 'failed',
       attempts = clerk_webhook_event.attempts + 1,
       last_error_code = EXCLUDED.last_error_code`,
    [
      input.instanceKey,
      input.eventId,
      input.eventType,
      input.clerkUserId,
      input.payloadHash,
      input.occurredAt,
      code,
    ],
  );
}

async function recordActivity(
  client: PoolClient,
  input: {
    tenantId: string;
    identityId: string;
    profileId?: string | null;
    eventType: string;
    eventId: string;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO listener_activity_log
      (tenant_id, listener_identity_id, listener_profile_id, event_type, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.tenantId,
      input.identityId,
      input.profileId ?? null,
      input.eventType,
      JSON.stringify({
        source: "clerk_webhook",
        eventId: input.eventId,
        ...input.extra,
      }),
    ],
  );
}

async function findLinkedIdentities(
  client: PoolClient,
  clerkUserId: string,
): Promise<LinkedIdentityRow[]> {
  const result = await client.query<LinkedIdentityRow>(
    `SELECT
       i.id AS identity_id,
       i.tenant_id,
       i.status AS identity_status,
       i.clerk_last_event_at,
       i.clerk_deleted_at,
       p.id AS profile_id,
       p.email AS profile_email,
       p.phone_normalized AS profile_phone_normalized
     FROM listener_identity i
     LEFT JOIN listener_profile p
       ON p.listener_identity_id = i.id
      AND p.tenant_id = i.tenant_id
      AND p.deleted_at IS NULL
     WHERE i.clerk_user_id = $1
     ORDER BY i.tenant_id, i.id
     FOR UPDATE OF i`,
    [clerkUserId],
  );
  return result.rows;
}

async function updateEmailVerification(
  client: PoolClient,
  row: LinkedIdentityRow,
  email: string,
  event: ClerkWebhookInput,
  fields: string[],
): Promise<void> {
  if (!row.profile_id) return;

  if (!row.profile_email) {
    await client.query(
      "UPDATE listener_profile SET email = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3",
      [email, row.profile_id, row.tenant_id],
    );
    fields.push("email");
  } else if (row.profile_email.toLowerCase() !== email) {
    await recordActivity(client, {
      tenantId: row.tenant_id,
      identityId: row.identity_id,
      profileId: row.profile_id,
      eventType: "identity.clerk_contact_conflict",
      eventId: event.eventId,
      extra: { field: "email" },
    });
    return;
  }

  await client.query(
    `INSERT INTO listener_communication_preference
      (tenant_id, listener_profile_id, email_verified_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, listener_profile_id)
     DO UPDATE SET email_verified_at = EXCLUDED.email_verified_at, updated_at = now()`,
    [row.tenant_id, row.profile_id, event.occurredAt],
  );
  fields.push("email_verified");
}

async function updatePhoneVerification(
  client: PoolClient,
  row: LinkedIdentityRow,
  phone: string,
  event: ClerkWebhookInput,
  fields: string[],
): Promise<void> {
  if (!row.profile_id) return;

  const normalizedPhone = normalizeClerkPhoneForProfile(phone);
  if (!normalizedPhone) return;

  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [`listener-profile:phone:${row.tenant_id}:${normalizedPhone}`],
  );

  if (!row.profile_phone_normalized) {
    const conflict = await client.query<{ id: string }>(
      `SELECT id FROM listener_profile
       WHERE tenant_id = $1
         AND phone_normalized = $2
         AND deleted_at IS NULL
         AND id <> $3
       LIMIT 1`,
      [row.tenant_id, normalizedPhone, row.profile_id],
    );
    if (conflict.rowCount) {
      await recordActivity(client, {
        tenantId: row.tenant_id,
        identityId: row.identity_id,
        profileId: row.profile_id,
        eventType: "identity.clerk_contact_conflict",
        eventId: event.eventId,
        extra: { field: "phone" },
      });
      return;
    }

    await client.query(
      `UPDATE listener_profile
       SET phone = $1, phone_normalized = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3`,
      [normalizedPhone, row.profile_id, row.tenant_id],
    );
    fields.push("phone");
  } else if (row.profile_phone_normalized !== normalizedPhone) {
    await recordActivity(client, {
      tenantId: row.tenant_id,
      identityId: row.identity_id,
      profileId: row.profile_id,
      eventType: "identity.clerk_contact_conflict",
      eventId: event.eventId,
      extra: { field: "phone" },
    });
    return;
  }

  await client.query(
    `INSERT INTO listener_communication_preference
      (tenant_id, listener_profile_id, phone_verified_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, listener_profile_id)
     DO UPDATE SET phone_verified_at = EXCLUDED.phone_verified_at, updated_at = now()`,
    [row.tenant_id, row.profile_id, event.occurredAt],
  );
  fields.push("phone_verified");
}

async function syncUserEvent(
  client: PoolClient,
  event: ClerkWebhookInput,
  data: ClerkUserWebhookData,
): Promise<{ status: WebhookEventStatus; affectedTenantCount: number }> {
  const rows = await findLinkedIdentities(client, data.id);
  if (rows.length === 0) return { status: "ignored", affectedTenantCount: 0 };

  const email = getPrimaryVerifiedEmail(data);
  const phone = getPrimaryVerifiedPhone(data);
  let processedCount = 0;

  for (const row of rows) {
    const lastEventAt = asDate(row.clerk_last_event_at);
    if (lastEventAt && event.occurredAt <= lastEventAt) continue;

    await client.query(
      `UPDATE listener_identity
       SET clerk_last_event_at = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3`,
      [event.occurredAt, row.identity_id, row.tenant_id],
    );

    if (row.identity_status === "disabled" || row.clerk_deleted_at) continue;

    const fields: string[] = [];
    if (email) await updateEmailVerification(client, row, email, event, fields);
    if (phone) await updatePhoneVerification(client, row, phone, event, fields);

    await recordActivity(client, {
      tenantId: row.tenant_id,
      identityId: row.identity_id,
      profileId: row.profile_id,
      eventType: "identity.clerk_synced",
      eventId: event.eventId,
      extra: { eventType: event.eventType, fields },
    });
    processedCount += 1;
  }

  return {
    status: processedCount > 0 ? "processed" : "ignored",
    affectedTenantCount: rows.length,
  };
}

async function disableUser(
  client: PoolClient,
  event: ClerkWebhookInput,
  data: ClerkDeletedUserWebhookData,
): Promise<{ status: WebhookEventStatus; affectedTenantCount: number }> {
  const rows = await findLinkedIdentities(client, data.id);
  if (rows.length === 0) return { status: "ignored", affectedTenantCount: 0 };

  for (const row of rows) {
    const lastEventAt = asDate(row.clerk_last_event_at);
    if (lastEventAt && event.occurredAt < lastEventAt) continue;

    await client.query(
      `UPDATE listener_identity
       SET status = 'disabled', clerk_deleted_at = $1,
           clerk_last_event_at = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3`,
      [event.occurredAt, row.identity_id, row.tenant_id],
    );

    if (row.profile_id) {
      await client.query(
        `UPDATE listener_profile
         SET status = 'deleted', deleted_at = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3`,
        [event.occurredAt, row.profile_id, row.tenant_id],
      );
      await client.query(
        `UPDATE listener_communication_preference
         SET receive_portal_news = false,
             receive_campaign_updates = false,
             receive_email = false,
             receive_whatsapp = false,
             updated_at = now()
         WHERE tenant_id = $1 AND listener_profile_id = $2`,
        [row.tenant_id, row.profile_id],
      );
    }

    await client.query(
      `UPDATE listener_device
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE tenant_id = $1 AND listener_identity_id = $2`,
      [row.tenant_id, row.identity_id],
    );
    await client.query(
      `UPDATE listener_recovery_handoff
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE tenant_id = $1 AND listener_identity_id = $2
         AND consumed_at IS NULL`,
      [row.tenant_id, row.identity_id],
    );
    await recordActivity(client, {
      tenantId: row.tenant_id,
      identityId: row.identity_id,
      profileId: row.profile_id,
      eventType: "identity.clerk_deleted",
      eventId: event.eventId,
    });
  }

  return { status: "processed", affectedTenantCount: rows.length };
}

export async function processClerkWebhook(
  input: ClerkWebhookInput,
): Promise<{ received: true; status: WebhookEventStatus | "duplicate" }> {
  if (!input.eventId || !input.instanceKey || !input.payloadHash) {
    throw invalidWebhook("CLERK_WEBHOOK_ENVELOPE_INVALID", "Envelope Clerk invalido.");
  }

  let supportedData: ClerkUserWebhookData | ClerkDeletedUserWebhookData | null = null;
  if (isSupportedClerkWebhookType(input.eventType)) {
    supportedData = validateSupportedData(input.eventType, input.data);
    if (input.clerkUserId !== supportedData.id) {
      throw invalidWebhook("CLERK_WEBHOOK_SUBJECT_INVALID", "Sujeito do evento Clerk invalido.");
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingResult = await client.query<StoredWebhookEvent>(
      `SELECT id, payload_hash, status, attempts
       FROM clerk_webhook_event
       WHERE instance_key = $1 AND event_id = $2
       FOR UPDATE`,
      [input.instanceKey, input.eventId],
    );
    const existing = existingResult.rows[0];

    if (existing && existing.payload_hash !== input.payloadHash) {
      throw invalidWebhook(
        "CLERK_WEBHOOK_EVENT_ID_REUSED",
        "O identificador do evento Clerk ja foi utilizado com outro payload.",
      );
    }

    if (existing && (existing.status === "processed" || existing.status === "ignored")) {
      await client.query("COMMIT");
      return { received: true, status: "duplicate" };
    }

    if (existing) {
      await client.query(
        `UPDATE clerk_webhook_event
         SET status = 'processing', attempts = attempts + 1, last_error_code = NULL
         WHERE id = $1`,
        [existing.id],
      );
    } else {
      await client.query(
        `INSERT INTO clerk_webhook_event
          (instance_key, event_id, event_type, clerk_user_id, payload_hash, occurred_at, status, attempts)
         VALUES ($1, $2, $3, $4, $5, $6, 'processing', 1)`,
        [
          input.instanceKey,
          input.eventId,
          input.eventType,
          input.clerkUserId,
          input.payloadHash,
          input.occurredAt,
        ],
      );
    }

    const result = !isSupportedClerkWebhookType(input.eventType)
      ? { status: "ignored" as const, affectedTenantCount: 0 }
      : input.eventType === "user.deleted"
        ? await disableUser(client, input, supportedData as ClerkDeletedUserWebhookData)
        : await syncUserEvent(client, input, supportedData as ClerkUserWebhookData);

    await client.query(
      `UPDATE clerk_webhook_event
       SET status = $1, processed_at = now(), affected_tenant_count = $2,
           last_error_code = NULL
       WHERE instance_key = $3 AND event_id = $4`,
      [result.status, result.affectedTenantCount, input.instanceKey, input.eventId],
    );
    await client.query("COMMIT");
    return { received: true, status: result.status };
  } catch (error) {
    await client.query("ROLLBACK");
    if (errorIsRetryable(error)) {
      await markEventFailed(input, errorCode(error));
    }
    throw error;
  } finally {
    client.release();
  }
}

export function getClerkWebhookUserId(data: unknown): string | null {
  return getDataId(data);
}
