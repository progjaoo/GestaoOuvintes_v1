import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { buildApp } from "../../src/app.js";
import { db, pool } from "../../src/database/client.js";

const describeLegacy = process.env.RUN_LEGACY_SCHEMA_TESTS === "true"
  ? describe
  : describe.skip;

const expectedMigrations = [
  "0001_initial_schema.sql",
  "0002_campaign_platform_identity_rbac.sql",
  "0003_institutional_banners_r2.sql",
  "0004_institutional_banner_action_type.sql",
  "0005_listener_registration_campaign_phone_unique.sql",
  "0006_sweepstake_draws.sql",
];

describeLegacy("compatibilidade com producao nas migrations 0001-0006", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
    if (
      databaseUrl.hostname !== "127.0.0.1" ||
      databaseUrl.port !== "5435" ||
      databaseUrl.pathname !== "/radio88_hotfix_compute_test"
    ) {
      throw new Error("O teste legado aceita somente o PostgreSQL Docker radio88_hotfix_compute_test.");
    }

    const migrations = await db.execute<{ id: string }>(sql`
      SELECT id FROM schema_migration ORDER BY id
    `);
    expect(migrations.rows.map(({ id }) => id)).toEqual(expectedMigrations);

    await db.execute(sql`DELETE FROM campaign_device_state`);
    await db.execute(sql`DELETE FROM listener_device`);
    await db.execute(sql`DELETE FROM campaign_placement`);
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("encerra o endpoint SSE legado sem manter a funcao ativa", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/public/events?placement=institutional_modal",
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toBe("");
  });

  it("100 resolucoes sem campanha nao criam nem atualizam dispositivos ou estados", async () => {
    const beforeDevices = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM listener_device
    `);
    const beforeStates = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM campaign_device_state
    `);

    for (let index = 0; index < 100; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/public/session/resolve",
        headers: {
          "x-device-token": `legacy-device-token-${String(index).padStart(32, "0")}`,
          "x-platform": "web_desktop",
        },
        payload: { placement: "institutional_modal", platform: "web_desktop" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        campaign: null,
        listenerState: "anonymous",
        experience: "campaign_unavailable",
      });
    }

    const afterDevices = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM listener_device
    `);
    const afterStates = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM campaign_device_state
    `);
    expect(afterDevices.rows[0]?.count).toBe(beforeDevices.rows[0]?.count);
    expect(afterStates.rows[0]?.count).toBe(beforeStates.rows[0]?.count);
  });

  it("mantem a resolucao e o registro de dispositivo quando a campanha esta vigente", async () => {
    const campaignResult = await db.execute<{ id: string }>(sql`
      UPDATE campaign
      SET status = 'active',
          starts_at = now() - interval '1 day',
          ends_at = now() + interval '1 day'
      WHERE slug = 'lancamento-institucional-2026'
      RETURNING id
    `);
    const campaignId = campaignResult.rows[0]?.id;
    expect(campaignId).toBeTruthy();

    await db.execute(sql`
      INSERT INTO campaign_placement (placement_key, campaign_id, version, published_at)
      VALUES ('institutional_modal', ${campaignId}, 1, now())
    `);

    const response = await app.inject({
      method: "POST",
      url: "/api/public/session/resolve",
      headers: {
        "x-device-token": "legacy-active-campaign-device-token-00000001",
        "x-platform": "web_desktop",
      },
      payload: { placement: "institutional_modal", platform: "web_desktop" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().experience).toBe("anonymous_registration_required");
    const deviceCount = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM listener_device
    `);
    const stateCount = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM campaign_device_state
    `);
    expect(deviceCount.rows[0]?.count).toBe("1");
    expect(stateCount.rows[0]?.count).toBe("1");
  });
});
