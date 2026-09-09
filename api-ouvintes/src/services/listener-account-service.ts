import { createHmac } from "node:crypto";
import { pool } from "../database/client.js";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import type { ListenerAuthContext } from "./clerk-identity-service.js";
import { getListenerMe } from "./listener-profile-service.js";

function hashDeviceToken(token: string): string {
  return createHmac("sha256", env.DEVICE_TOKEN_SECRET).update(token).digest("hex");
}

function completeProfile(profile: {
  name: string;
  neighborhood: string;
  city: string;
  phone_normalized: string | null;
} | null): boolean {
  return Boolean(
    profile?.name.trim() &&
      profile.neighborhood.trim() &&
      profile.city.trim() &&
      profile.phone_normalized,
  );
}

function nextOnboardingStep(profile: {
  name: string;
  neighborhood: string;
  city: string;
  phone_normalized: string | null;
  email: string | null;
  gender: string | null;
  ageRange: string | null;
} | null): string | null {
  if (!profile) return "basic_profile";
  if (!profile.name.trim() || !profile.neighborhood.trim() || !profile.city.trim() || !profile.phone_normalized) {
    return "basic_profile";
  }
  if (!profile.gender) return "gender";
  if (!profile.ageRange) return "age_range";
  if (!profile.email) return "email";
  return null;
}

export async function getListenerAccount(context: ListenerAuthContext) {
  const response = await getListenerMe(context);
  const profile = response.profile;
  const profileCount = profile
    ? await pool.query<{ count: number | string }>(
        "select count(*)::int as count from campaign_participation where tenant_id = $1 and listener_profile_id = $2",
        [context.tenantId, profile.id],
      )
    : null;

  return {
    accountLinked: response.identity.provider === "clerk",
    provider: response.identity.provider,
    profileComplete: response.profileComplete,
    nextOnboardingStep: nextOnboardingStep(
      profile
        ? {
            name: profile.name,
            neighborhood: profile.neighborhood,
            city: profile.city,
            phone_normalized: profile.phone,
            email: profile.email,
            gender: profile.gender,
            ageRange: profile.ageRange,
          }
        : null,
    ),
    participationsCount: Number(profileCount?.rows[0]?.count ?? 0),
    activeConsents: response.consents.filter(
      (consent) => consent.granted && !consent.revokedAt,
    ).map((consent) => consent.type),
  };
}

export async function linkClerkIdentityToDevice(
  context: ListenerAuthContext,
  deviceToken: string,
) {
  const account = await getListenerMe(context);
  const tokenHash = hashDeviceToken(deviceToken);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const deviceResult = await client.query<{
      id: string;
      listener_identity_id: string | null;
      listener_profile_id: string | null;
    }>(
      "select id, listener_identity_id, listener_profile_id " +
        "from listener_device where tenant_id = $1 and token_hash = $2 and revoked_at is null for update",
      [context.tenantId, tokenHash],
    );
    const device = deviceResult.rows[0];
    if (!device) {
      throw new AppError(404, "DEVICE_NOT_FOUND", "Dispositivo nao encontrado.");
    }

    const clerkProfileResult = await client.query<{ id: string }>(
      "select id from listener_profile " +
        "where tenant_id = $1 and listener_identity_id = $2 and deleted_at is null",
      [context.tenantId, account.identity.id],
    );
    const clerkProfile = clerkProfileResult.rows[0];

    if (
      device.listener_profile_id &&
      clerkProfile &&
      device.listener_profile_id !== clerkProfile.id
    ) {
      throw new AppError(
        409,
        "LISTENER_PROFILE_CONFLICT",
        "Nao foi possivel vincular este dispositivo ao perfil.",
      );
    }

    const profileId = clerkProfile?.id ?? device.listener_profile_id;
    if (profileId && device.listener_identity_id && device.listener_identity_id !== account.identity.id) {
      await client.query(
        "update listener_profile set listener_identity_id = $1, updated_at = now() " +
          "where id = $2 and tenant_id = $3 and deleted_at is null",
        [account.identity.id, profileId, context.tenantId],
      );
      await client.query(
        "update listener_device set listener_identity_id = $1 " +
          "where tenant_id = $2 and listener_profile_id = $3 and revoked_at is null",
        [account.identity.id, context.tenantId, profileId],
      );
      await client.query(
        "update listener_identity set status = 'merged', updated_at = now() " +
          "where id = $1 and tenant_id = $2 and id <> $3",
        [device.listener_identity_id, context.tenantId, account.identity.id],
      );
    }

    await client.query(
      "update listener_device set listener_identity_id = $1, listener_profile_id = $2, " +
        "linked_at = now(), last_seen_at = now() " +
        "where id = $3 and tenant_id = $4 and revoked_at is null",
      [account.identity.id, profileId ?? null, device.id, context.tenantId],
    );

    await client.query(
      "insert into listener_activity_log " +
        "(tenant_id, listener_identity_id, listener_profile_id, event_type, metadata) " +
        "values ($1, $2, $3, $4, $5::jsonb)",
      [
        context.tenantId,
        account.identity.id,
        profileId ?? null,
        "identity.clerk_linked",
        JSON.stringify({ source: "listener_account" }),
      ],
    );

    await client.query("COMMIT");

    let profileState: {
      name: string;
      neighborhood: string;
      city: string;
      phone_normalized: string | null;
    } | null = null;
    if (profileId) {
      const profileResult = await pool.query<{
        name: string;
        neighborhood: string;
        city: string;
        phone_normalized: string | null;
      }>(
        "select name, neighborhood, city, phone_normalized from listener_profile where id = $1 and tenant_id = $2",
        [profileId, context.tenantId],
      );
      profileState = profileResult.rows[0] ?? null;
    }

    return {
      linked: true,
      profileComplete: completeProfile(profileState),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function unlinkClerkIdentity(context: ListenerAuthContext) {
  const result = await pool.query<{ id: string }>(
    "select id from listener_identity where tenant_id = $1 and clerk_user_id = $2 and status <> 'merged' limit 1",
    [context.tenantId, context.clerkUserId],
  );
  const identity = result.rows[0];
  if (!identity) return { linked: false };

  await pool.query(
    "update listener_identity set provider = 'anonymous', provider_subject = null, clerk_user_id = null, updated_at = now() " +
      "where id = $1 and tenant_id = $2",
    [identity.id, context.tenantId],
  );
  await pool.query(
    "insert into listener_activity_log " +
      "(tenant_id, listener_identity_id, event_type, metadata) " +
      "values ($1, $2, $3, $4::jsonb)",
    [
      context.tenantId,
      identity.id,
      "identity.clerk_unlinked",
      JSON.stringify({ source: "listener_account" }),
    ],
  );

  return { linked: false };
}
