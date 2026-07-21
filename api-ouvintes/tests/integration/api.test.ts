import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { db, pool } from "../../src/database/client.js";

const describeIntegration =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeIntegration("API integrada com PostgreSQL", () => {
  let app: FastifyInstance | undefined;
  let accessToken: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes("_test")) {
      throw new Error(
        "Os testes de integracao exigem um DATABASE_URL exclusivo contendo '_test'.",
      );
    }

    await db.execute(sql`
      UPDATE campaign
      SET starts_at = now() - interval '1 day',
          ends_at = now() + interval '30 days',
          status = 'active'
      WHERE slug = 'lancamento-institucional-2026'
    `);
    await db.execute(sql`DELETE FROM registration_export_audit`);
    await db.execute(sql`DELETE FROM campaign_device_state`);
    await db.execute(sql`DELETE FROM campaign_participation`);
    await db.execute(sql`DELETE FROM listener_device`);
    await db.execute(sql`DELETE FROM listener_profile`);
    await db.execute(sql`DELETE FROM listener_registration`);
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("responde health e ready", async () => {
    const health = await app!.inject({ method: "GET", url: "/health" });
    const ready = await app!.inject({ method: "GET", url: "/ready" });
    expect(health.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
  });

  it("retorna configuracao da campanha ativa", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/api/public/campaigns/lancamento-institucional-2026",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      slug: "lancamento-institucional-2026",
      active: true,
      privacyNoticeVersion: "2026-08-01",
    });
  });

  it("cria cadastro com telefone obrigatorio e impede duplicacao por idempotencia", async () => {
    const submissionToken = randomUUID();
    const payload = {
      campaignSlug: "lancamento-institucional-2026",
      name: "  Maria   da Silva ",
      neighborhood: "Retiro",
      city: "Volta Redonda",
      phone: "24999990000",
      submissionToken,
      privacyNoticeVersion: "2026-08-01",
      privacyAcknowledged: true,
      marketingOptIn: false,
      source: "institutional_web",
    };

    const created = await app!.inject({
      method: "POST",
      url: "/api/public/listener-registrations",
      payload,
    });
    const repeated = await app!.inject({
      method: "POST",
      url: "/api/public/listener-registrations",
      payload,
    });

    expect(created.statusCode).toBe(201);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().id).toBe(created.json().id);
  });

  it("rejeita campos obrigatorios e aviso de privacidade desatualizado", async () => {
    const invalid = await app!.inject({
      method: "POST",
      url: "/api/public/listener-registrations",
      payload: {
        campaignSlug: "lancamento-institucional-2026",
        name: "",
      },
    });
    const outdatedNotice = await app!.inject({
      method: "POST",
      url: "/api/public/listener-registrations",
      payload: {
        campaignSlug: "lancamento-institucional-2026",
        name: "Joao",
        neighborhood: "Centro",
        city: "Barra Mansa",
        phone: "(24) 99999-9999",
        submissionToken: randomUUID(),
        privacyNoticeVersion: "antiga",
        privacyAcknowledged: true,
        marketingOptIn: false,
        source: "institutional_web",
      },
    });

    expect(invalid.statusCode).toBe(400);
    expect(outdatedNotice.statusCode).toBe(409);
  });

  it("protege rotas administrativas e autentica administrador", async () => {
    const unauthorized = await app!.inject({
      method: "GET",
      url: "/api/admin/listener-registrations",
    });
    const login = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: {
        username: "admin",
        password: "development-admin-password",
      },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(login.statusCode).toBe(200);
    accessToken = login.json().accessToken;
    expect(accessToken).toBeTruthy();

    const bootstrapStatus = await app!.inject({
      method: "GET",
      url: "/api/admin/auth/bootstrap-status",
    });
    const bootstrapBlocked = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/bootstrap",
      payload: {
        name: "Outro administrador",
        username: "outro-admin",
        password: "development-admin-password",
      },
    });

    expect(bootstrapStatus.statusCode).toBe(200);
    expect(bootstrapStatus.json().canBootstrap).toBe(false);
    expect(bootstrapBlocked.statusCode).toBe(409);

    const me = await app!.inject({
      method: "GET",
      url: "/api/admin/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const logout = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/logout",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe("admin");
    expect(logout.statusCode).toBe(204);
  });

  it("lista, cria e atualiza campanhas", async () => {
    const headers = { authorization: `Bearer ${accessToken}` };
    const slug = `campanha-teste-${Date.now()}`;
    const list = await app!.inject({
      method: "GET",
      url: "/api/admin/campaigns",
      headers,
    });
    const created = await app!.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers,
      payload: {
        slug,
        name: "Campanha de teste",
        title: "Titulo da campanha",
        description: "Descricao da campanha",
        status: "draft",
        startsAt: "2026-09-01T00:00:00-03:00",
        endsAt: "2026-09-30T23:59:59-03:00",
        privacyNoticeVersion: "2026-09-01",
        privacyNoticeUrl: "/privacidade",
      },
    });

    expect(list.statusCode).toBe(200);
    expect(created.statusCode).toBe(201);

    const updated = await app!.inject({
      method: "PUT",
      url: `/api/admin/campaigns/${created.json().id}`,
      headers,
      payload: {
        status: "paused",
      },
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().status).toBe("paused");

    const duplicated = await app!.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers,
      payload: {
        slug,
        name: "Campanha duplicada",
        title: "Titulo duplicado",
        description: "Descricao duplicada",
        status: "draft",
        startsAt: "2026-09-01T00:00:00-03:00",
        endsAt: "2026-09-30T23:59:59-03:00",
        privacyNoticeVersion: "2026-09-01",
        privacyNoticeUrl: "/privacidade",
      },
    });

    expect(duplicated.statusCode).toBe(409);
    expect(duplicated.json()).toMatchObject({
      code: "RESOURCE_CONFLICT",
    });
  });

  it("publica campanha no modal institucional e resolve sessao publica por device token", async () => {
    const headers = { authorization: `Bearer ${accessToken}` };
    const slug = `campanha-modal-${Date.now()}`;
    const created = await app!.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers,
      payload: {
        slug,
        name: "Campanha do modal",
        title: "Participe do sorteio",
        description: "Cadastro para ouvintes do institucional.",
        status: "active",
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
        privacyNoticeVersion: "2026-09-01",
        privacyNoticeUrl: "/privacidade",
      },
    });

    expect(created.statusCode).toBe(201);

    const published = await app!.inject({
      method: "POST",
      url: `/api/admin/campaigns/${created.json().id}/publish`,
      headers,
      payload: { placementKey: "institutional_modal" },
    });

    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      campaignId: created.json().id,
      placementKey: "institutional_modal",
    });

    const placements = await app!.inject({
      method: "GET",
      url: "/api/admin/campaigns/placements/list",
      headers,
    });

    expect(placements.statusCode).toBe(200);
    expect(placements.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campaignId: created.json().id,
          placementKey: "institutional_modal",
          campaignSlug: slug,
          campaignStatus: "active",
        }),
      ]),
    );

    const session = await app!.inject({
      method: "POST",
      url: "/api/public/session/resolve",
      headers: {
        "x-device-token": "a".repeat(64),
        "x-platform": "web_desktop",
      },
      payload: {
        placement: "institutional_modal",
        platform: "web_desktop",
      },
    });

    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      placement: "institutional_modal",
      campaign: {
        id: created.json().id,
        slug,
        active: true,
      },
      listenerState: "anonymous",
      experience: "anonymous_registration_required",
    });
  });

  it("lista, detalha e exporta cadastros com auditoria", async () => {
    const headers = { authorization: `Bearer ${accessToken}` };
    const list = await app!.inject({
      method: "GET",
      url: "/api/admin/listener-registrations?page=1&pageSize=20&city=Volta",
      headers,
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().pagination.total).toBe(1);
    const id = list.json().items[0].id;

    const detail = await app!.inject({
      method: "GET",
      url: `/api/admin/listener-registrations/${id}`,
      headers,
    });
    const csv = await app!.inject({
      method: "GET",
      url: "/api/admin/listener-registrations/export?format=csv",
      headers,
    });
    const xlsx = await app!.inject({
      method: "GET",
      url: "/api/admin/listener-registrations/export?format=xlsx",
      headers,
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json().name).toBe("Maria da Silva");
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    const audit = await db.execute<{ total: string }>(
      sql`SELECT count(*)::text AS total FROM registration_export_audit`,
    );
    expect(audit.rows[0]?.total).toBe("2");
  });
});
