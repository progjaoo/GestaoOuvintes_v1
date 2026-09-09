import { createHmac, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../database/client.js";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import {
  requireDeviceToken,
  resolvePublicDevice,
  type PublicPlatform,
} from "./public-session-service.js";
import type { RecoveryPurpose } from "../schemas/listener-recovery.js";

function featureDisabled(code: string, message: string): never {
  throw new AppError(404, code, message);
}

function hashRecoveryToken(token: string): string {
  return createHmac("sha256", env.LISTENER_RECOVERY_HANDOFF_SECRET)
    .update(token)
    .digest("hex");
}

function genericHandoffUnavailable(): AppError {
  return new AppError(
    409,
    "RECOVERY_HANDOFF_UNAVAILABLE",
    "A recuperacao nao esta disponivel para este cadastro.",
  );
}

function assertHandoffFeatureEnabled() {
  if (!env.LISTENER_RECOVERY_HANDOFF_ENABLED) {
    featureDisabled(
      "RECOVERY_HANDOFF_DISABLED",
      "A recuperacao cross-device esta temporariamente indisponivel.",
    );
  }
}

function profileComplete(profile: {
  name: string;
  neighborhood: string;
  city: string;
  phone_normalized: string | null;
}): boolean {
  return Boolean(
    profile.name.trim() &&
      profile.neighborhood.trim() &&
      profile.city.trim() &&
      profile.phone_normalized,
  );
}

async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createListenerRecoveryHandoff(input: {
  deviceToken: string;
  purpose: RecoveryPurpose;
  platform: PublicPlatform;
  tenantId: string;
}) {
  assertHandoffFeatureEnabled();

  const sourceDeviceToken = requireDeviceToken(input.deviceToken);
  const device = await resolvePublicDevice(
    sourceDeviceToken,
    input.platform,
    input.tenantId,
  );

  if (!device.listenerProfileId || !device.listenerIdentityId) {
    throw genericHandoffUnavailable();
  }

  const profileResult = await pool.query<{
    id: string;
    name: string;
    neighborhood: string;
    city: string;
    phone_normalized: string | null;
  }>(
    "select id, name, neighborhood, city, phone_normalized " +
      "from listener_profile where id = $1 and tenant_id = $2 and deleted_at is null",
    [device.listenerProfileId, input.tenantId],
  );
  const profile = profileResult.rows[0];
  if (!profile) throw genericHandoffUnavailable();

  const recentResult = await pool.query<{ count: number | string }>(
    "select count(*)::int as count from listener_recovery_handoff " +
      "where tenant_id = $1 and listener_identity_id = $2 and source_device_id = $3 " +
      "and created_at > now() - interval '1 hour' " +
      "and revoked_at is null and consumed_at is null",
    [input.tenantId, device.listenerIdentityId, device.id],
  );
  if (Number(recentResult.rows[0]?.count ?? 0) >= env.LISTENER_RECOVERY_HANDOFF_MAX_PER_HOUR) {
    throw new AppError(
      429,
      "RECOVERY_HANDOFF_RATE_LIMITED",
      "Aguarde antes de gerar uma nova recuperacao.",
    );
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + env.LISTENER_RECOVERY_HANDOFF_TTL_MINUTES * 60 * 1000,
  );
  const tokenHash = hashRecoveryToken(token);

  const handoff = await withTransaction(async (client) => {
    const inserted = await client.query<{
      id: string;
      purpose: RecoveryPurpose;
      expires_at: Date;
    }>(
      "insert into listener_recovery_handoff " +
        "(tenant_id, listener_identity_id, source_device_id, token_hash, purpose, expires_at) " +
        "values ($1, $2, $3, $4, $5, $6) " +
        "returning id, purpose, expires_at",
      [
        input.tenantId,
        device.listenerIdentityId,
        device.id,
        tokenHash,
        input.purpose,
        expiresAt,
      ],
    );

    await client.query(
      "insert into listener_activity_log " +
        "(tenant_id, listener_identity_id, listener_profile_id, event_type, metadata) " +
        "values ($1, $2, $3, $4, $5::jsonb)",
      [
        input.tenantId,
        device.listenerIdentityId,
        profile.id,
        "recovery_handoff.created",
        JSON.stringify({
          purpose: input.purpose,
          expiresAt: expiresAt.toISOString(),
        }),
      ],
    );

    return inserted.rows[0];
  });

  if (!handoff) {
    throw new AppError(
      500,
      "RECOVERY_HANDOFF_CREATE_FAILED",
      "Falha ao criar recuperacao.",
    );
  }

  return {
    token,
    purpose: handoff.purpose,
    expiresAt: new Date(handoff.expires_at).toISOString(),
    profileComplete: profileComplete(profile),
  };
}

export async function consumeListenerRecoveryHandoff(input: {
  token: string;
  purpose: RecoveryPurpose;
  deviceToken: string;
  platform: PublicPlatform;
  tenantId: string;
}) {
  assertHandoffFeatureEnabled();

  const token = input.token.trim();
  const destinationDevice = await resolvePublicDevice(
    requireDeviceToken(input.deviceToken),
    input.platform,
    input.tenantId,
  );
  const tokenHash = hashRecoveryToken(token);

  return withTransaction(async (client) => {
    const selected = await client.query<{
      id: string;
      listener_identity_id: string;
      source_device_id: string;
      purpose: RecoveryPurpose;
      expires_at: Date;
      consumed_at: Date | null;
      revoked_at: Date | null;
    }>(
      "select id, listener_identity_id, source_device_id, purpose, expires_at, consumed_at, revoked_at " +
        "from listener_recovery_handoff " +
        "where tenant_id = $1 and token_hash = $2 and purpose = $3 for update",
      [input.tenantId, tokenHash, input.purpose],
    );
    const handoff = selected.rows[0];

    if (
      !handoff ||
      handoff.consumed_at ||
      handoff.revoked_at ||
      new Date(handoff.expires_at).getTime() <= Date.now() ||
      handoff.source_device_id === destinationDevice.id
    ) {
      throw genericHandoffUnavailable();
    }

    const profileResult = await client.query<{
      id: string;
      name: string;
      neighborhood: string;
      city: string;
      phone_normalized: string | null;
    }>(
      "select id, name, neighborhood, city, phone_normalized " +
        "from listener_profile " +
        "where tenant_id = $1 and listener_identity_id = $2 and deleted_at is null",
      [input.tenantId, handoff.listener_identity_id],
    );
    const profile = profileResult.rows[0];
    if (!profile) throw genericHandoffUnavailable();

    if (
      destinationDevice.listenerProfileId &&
      destinationDevice.listenerProfileId !== profile.id
    ) {
      throw genericHandoffUnavailable();
    }

    await client.query(
      "update listener_device set listener_identity_id = $1, listener_profile_id = $2, " +
        "linked_at = now(), last_seen_at = now(), platform = $3 " +
        "where id = $4 and tenant_id = $5 and revoked_at is null",
      [
        handoff.listener_identity_id,
        profile.id,
        input.platform,
        destinationDevice.id,
        input.tenantId,
      ],
    );

    await client.query(
      "update listener_recovery_handoff set consumed_at = now() " +
        "where id = $1 and tenant_id = $2 and consumed_at is null and revoked_at is null",
      [handoff.id, input.tenantId],
    );

    await client.query(
      "insert into listener_activity_log " +
        "(tenant_id, listener_identity_id, listener_profile_id, event_type, metadata) " +
        "values ($1, $2, $3, $4, $5::jsonb)",
      [
        input.tenantId,
        handoff.listener_identity_id,
        profile.id,
        "recovery_handoff.consumed",
        JSON.stringify({ purpose: input.purpose }),
      ],
    );

    return {
      linked: true,
      profileComplete: profileComplete(profile),
    };
  });
}

export async function revokeListenerRecoveryHandoff(input: {
  id: string;
  tenantId: string;
}) {
  await pool.query(
    "update listener_recovery_handoff set revoked_at = now() " +
      "where id = $1 and tenant_id = $2 and consumed_at is null and revoked_at is null",
    [input.id, input.tenantId],
  );
}
