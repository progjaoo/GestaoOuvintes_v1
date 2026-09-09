import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/database/client.js";
import {
  hashClerkWebhookPayload,
  processClerkWebhook,
} from "../../src/services/clerk-webhook-service.js";

const describeIntegration =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeIntegration("ciclo de vida Clerk", () => {
  const tenantId = "00000000-0000-4000-8000-000000000088";
  const instanceKey = `test-${randomUUID()}`;
  const clerkUserId = `user_webhook_${randomUUID()}`;
  const identityId = randomUUID();
  const profileId = randomUUID();
  const deviceId = randomUUID();
  const handoffId = randomUUID();
  const phone = "24999990001";

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes("_test")) {
      throw new Error(
        "Os testes de integracao exigem um DATABASE_URL exclusivo contendo '_test'.",
      );
    }

    await pool.query(
      `INSERT INTO listener_identity
        (id, tenant_id, provider, provider_subject, clerk_user_id, status)
       VALUES ($1, $2, 'clerk', $3, $3, 'active')`,
      [identityId, tenantId, clerkUserId],
    );
    await pool.query(
      `INSERT INTO listener_profile
        (id, tenant_id, listener_identity_id, name, neighborhood, city, phone, phone_normalized, status)
       VALUES ($1, $2, $3, 'Ouvinte Webhook', 'Centro', 'Volta Redonda', NULL, NULL, 'active')`,
      [profileId, tenantId, identityId],
    );
    await pool.query(
      `INSERT INTO listener_communication_preference
        (tenant_id, listener_profile_id, receive_campaign_updates, receive_email, receive_whatsapp)
       VALUES ($1, $2, true, true, true)`,
      [tenantId, profileId],
    );
    await pool.query(
      `INSERT INTO listener_device
        (id, tenant_id, listener_identity_id, listener_profile_id, token_hash, platform)
       VALUES ($1, $2, $3, $4, $5, 'web_desktop')`,
      [deviceId, tenantId, identityId, profileId, `device-${randomUUID()}`],
    );
    await pool.query(
      `INSERT INTO listener_recovery_handoff
        (id, tenant_id, listener_identity_id, source_device_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '15 minutes')`,
      [handoffId, tenantId, identityId, deviceId, `handoff-${randomUUID()}`],
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM clerk_webhook_event WHERE instance_key = $1", [instanceKey]);
    await pool.query("DELETE FROM listener_recovery_handoff WHERE id = $1", [handoffId]);
    await pool.query("DELETE FROM listener_device WHERE id = $1", [deviceId]);
    await pool.query("DELETE FROM listener_activity_log WHERE listener_identity_id = $1", [identityId]);
    await pool.query("DELETE FROM listener_communication_preference WHERE listener_profile_id = $1", [profileId]);
    await pool.query("DELETE FROM listener_profile WHERE id = $1", [profileId]);
    await pool.query("DELETE FROM listener_identity WHERE id = $1", [identityId]);
    await pool.end();
  });

  it("sincroniza contato verificado, ignora replay e bloqueia payload reutilizado", async () => {
    const updatedAt = Date.now();
    const data = {
      id: clerkUserId,
      primary_email_address_id: "email_001",
      primary_phone_number_id: "phone_001",
      email_addresses: [
        {
          id: "email_001",
          email_address: "ouvinte@example.com",
          verification: { status: "verified" },
        },
      ],
      phone_numbers: [
        {
          id: "phone_001",
          phone_number: "+55 (24) 99999-0001",
          verification: { status: "verified" },
        },
      ],
      updated_at: updatedAt,
      public_metadata: { tenant_id: "tenant-adulterado" },
    };
    const rawBody = Buffer.from(JSON.stringify(data));
    const input = {
      eventId: "msg_test_sync_001",
      eventType: "user.updated",
      clerkUserId,
      instanceKey,
      payloadHash: hashClerkWebhookPayload(rawBody),
      occurredAt: new Date(updatedAt),
      data,
    };

    await expect(processClerkWebhook(input)).resolves.toEqual({
      received: true,
      status: "processed",
    });
    await expect(processClerkWebhook(input)).resolves.toEqual({
      received: true,
      status: "duplicate",
    });
    await expect(
      processClerkWebhook({ ...input, payloadHash: "different-payload-hash" }),
    ).rejects.toMatchObject({ code: "CLERK_WEBHOOK_EVENT_ID_REUSED" });

    const profile = await pool.query<{
      email: string | null;
      phone_normalized: string | null;
    }>(
      "SELECT email, phone_normalized FROM listener_profile WHERE id = $1",
      [profileId],
    );
    expect(profile.rows[0]).toEqual({
      email: "ouvinte@example.com",
      phone_normalized: phone,
    });

    const preference = await pool.query<{
      email_verified_at: Date | null;
      phone_verified_at: Date | null;
      receive_email: boolean;
    }>(
      `SELECT email_verified_at, phone_verified_at, receive_email
       FROM listener_communication_preference
       WHERE listener_profile_id = $1`,
      [profileId],
    );
    expect(preference.rows[0]?.email_verified_at).toBeInstanceOf(Date);
    expect(preference.rows[0]?.phone_verified_at).toBeInstanceOf(Date);
    expect(preference.rows[0]?.receive_email).toBe(true);
  });

  it("desativa identidade, comunicacoes, dispositivos e handoff sem apagar historico", async () => {
    const deletedAt = new Date(Date.now() + 10_000);
    await expect(
      processClerkWebhook({
        eventId: "msg_test_delete_001",
        eventType: "user.deleted",
        clerkUserId,
        instanceKey,
        payloadHash: hashClerkWebhookPayload(Buffer.from("delete-event")),
        occurredAt: deletedAt,
        data: { id: clerkUserId, deleted: true },
      }),
    ).resolves.toEqual({ received: true, status: "processed" });

    const state = await pool.query<{
      identity_status: string;
      profile_status: string;
      receive_campaign_updates: boolean;
      receive_email: boolean;
      device_revoked_at: Date | null;
      handoff_revoked_at: Date | null;
    }>(
      `SELECT
         i.status AS identity_status,
         p.status AS profile_status,
         preference.receive_campaign_updates,
         preference.receive_email,
         device.revoked_at AS device_revoked_at,
         handoff.revoked_at AS handoff_revoked_at
       FROM listener_identity i
       JOIN listener_profile p ON p.listener_identity_id = i.id
       JOIN listener_communication_preference preference
         ON preference.listener_profile_id = p.id
       JOIN listener_device device ON device.listener_identity_id = i.id
       JOIN listener_recovery_handoff handoff ON handoff.listener_identity_id = i.id
       WHERE i.id = $1`,
      [identityId],
    );

    expect(state.rows[0]).toMatchObject({
      identity_status: "disabled",
      profile_status: "deleted",
      receive_campaign_updates: false,
      receive_email: false,
    });
    expect(state.rows[0]?.device_revoked_at).toBeInstanceOf(Date);
    expect(state.rows[0]?.handoff_revoked_at).toBeInstanceOf(Date);
  });
});
