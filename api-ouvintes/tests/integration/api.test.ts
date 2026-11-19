import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { db, pool } from "../../src/database/client.js";
import { updateAdminUser } from "../../src/services/admin-user-service.js";
import type { AuthorizationContext } from "../../src/services/authorization-service.js";

const describeIntegration =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;

describeIntegration("API integrada com PostgreSQL", () => {
  let app: FastifyInstance | undefined;
  let accessToken: string;

  async function createRoleSession(roleKey: string | null, usernamePrefix = "rbac") {
    const userId = randomUUID();
    const username = `${usernamePrefix}-${userId}`;
    const legacyRole = roleKey === "admin" ? "admin" : "viewer";
    await pool.query(
      `INSERT INTO admin_user (id, name, username, password_hash, role, active)
       VALUES ($1, $2, $3, 'not-used-by-test', $4, true)`,
      [userId, `Teste ${roleKey ?? "sem papel"}`, username, legacyRole],
    );

    if (roleKey) {
      await pool.query(
        `INSERT INTO admin_user_role (admin_user_id, role_id)
         SELECT $1, id FROM role WHERE key = $2`,
        [userId, roleKey],
      );
    }

    const sessionResult = await pool.query<{ id: string; authz_version: number }>(
      `INSERT INTO admin_session (admin_user_id, authz_version, expires_at)
       SELECT id, authz_version, now() + interval '1 hour'
       FROM admin_user WHERE id = $1
       RETURNING id, authz_version`,
      [userId],
    );
    const session = sessionResult.rows[0];
    if (!session) throw new Error("Falha ao criar sessao de teste.");

    const token = app!.jwt.sign({
      sub: userId,
      role: legacyRole,
      name: `Teste ${roleKey ?? "sem papel"}`,
      username,
      sid: session.id,
      authzVersion: Number(session.authz_version),
    });
    return { userId, sessionId: session.id, token, username };
  }

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
    await db.execute(sql`DELETE FROM sweepstake_draw_entry`);
    await db.execute(sql`DELETE FROM sweepstake_draw`);
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
    expect(response.headers["cache-control"]).toContain("s-maxage=60");
    expect(response.json()).toMatchObject({
      slug: "lancamento-institucional-2026",
      active: true,
      privacyNoticeVersion: "2026-08-01",
    });
  });

  it("define cache compartilhado curto para configuracao e banners publicos", async () => {
    const placement = await app!.inject({
      method: "GET",
      url: "/api/public/placements/institutional_modal/campaign",
    });
    const banners = await app!.inject({
      method: "GET",
      url: "/api/public/institutional-banners?placement=home_hero",
    });

    expect(placement.headers["cache-control"]).toContain("s-maxage=60");
    expect(placement.headers.vary).toContain("Origin");
    expect(banners.headers["cache-control"]).toContain("s-maxage=60");
    expect(banners.headers.etag).toBeTruthy();
    expect(banners.headers.vary).toContain("Origin");

    const unchanged = await app!.inject({
      method: "GET",
      url: "/api/public/institutional-banners?placement=home_hero",
      headers: { "if-none-match": banners.headers.etag as string },
    });
    expect(unchanged.statusCode).toBe(304);
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
    expect(bootstrapBlocked.statusCode).toBe(410);

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
    expect(me.json().user.permissions).toContain("sweepstake.draw");
    expect(logout.statusCode).toBe(204);

    const revokedSession = await app!.inject({
      method: "GET",
      url: "/api/admin/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(revokedSession.statusCode).toBe(401);

    const relogin = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: {
        username: "admin",
        password: "development-admin-password",
      },
    });
    expect(relogin.statusCode).toBe(200);
    accessToken = relogin.json().accessToken;
  });

  it("exige e-mail verificado para login por e-mail, preservando login legado", async () => {
    const email = `equipe-${randomUUID()}@example.test`;
    const password = "integration-password-012";
    const userId = randomUUID();
    const { default: argon2 } = await import("argon2");
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    await pool.query(
      `INSERT INTO admin_user
         (id, name, username, password_hash, role, active, email, email_normalized)
       VALUES ($1, 'Equipe teste', $2, $3, 'admin', true, $4, $5)`,
      [userId, `email-${userId.slice(0, 8)}`, passwordHash, email, email.toLowerCase()],
    );
    await pool.query(
      `INSERT INTO admin_user_role (admin_user_id, role_id)
       SELECT $1, id FROM role WHERE key = 'admin'`,
      [userId],
    );

    const unverified = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { identifier: email, password },
    });
    expect(unverified.statusCode).toBe(401);

    await pool.query(
      "UPDATE admin_user SET email_verified_at = now() WHERE id = $1",
      [userId],
    );
    const verified = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { identifier: email.toUpperCase(), password },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().user.email).toBe(email);
  });

  it("consome convite uma unica vez, ativa a conta e audita a identidade", async () => {
    const email = `invite-${randomUUID()}@example.test`;
    const userId = randomUUID();
    const token = `integration-${randomUUID()}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const passwordHash = "unused-test-hash";

    await pool.query(
      `INSERT INTO admin_user
         (id, name, username, password_hash, role, active, email, email_normalized,
          must_change_password)
       VALUES ($1, 'Convite teste', $2, $3, 'viewer', false, $4, $5, true)`,
      [userId, `invite-${userId.slice(0, 8)}`, passwordHash, email, email.toLowerCase()],
    );
    await pool.query(
      `INSERT INTO admin_identity_token
         (admin_user_id, kind, email_normalized_snapshot, token_hash, expires_at)
       VALUES ($1, 'invite', lower($2), $3, now() + interval '30 minutes')`,
      [userId, email, tokenHash],
    );
    const session = await pool.query(
      `INSERT INTO admin_session (admin_user_id, authz_version, expires_at)
       VALUES ($1, 1, now() + interval '1 hour') RETURNING id`,
      [userId],
    );

    const consumeRequests = await Promise.all([
      app!.inject({
        method: "POST",
        url: "/api/admin/auth/identity/consume",
        payload: { token, password: "invited-account-password" },
      }),
      app!.inject({
        method: "POST",
        url: "/api/admin/auth/identity/consume",
        payload: { token, password: "invited-account-password" },
      }),
    ]);
    expect(consumeRequests.map((response) => response.statusCode).sort()).toEqual([204, 400]);

    const state = await pool.query<{
      active: boolean;
      must_change_password: boolean;
      email_verified_at: Date | null;
      password_hash: string;
    }>(
      `SELECT active, must_change_password, email_verified_at, password_hash
       FROM admin_user WHERE id = $1`,
      [userId],
    );
    const tokenState = await pool.query<{ used_at: Date | null }>(
      "SELECT used_at FROM admin_identity_token WHERE token_hash = $1",
      [tokenHash],
    );
    const sessionState = await pool.query<{ revoked_at: Date | null }>(
      "SELECT revoked_at FROM admin_session WHERE id = $1",
      [session.rows[0]?.id],
    );
    const audit = await pool.query(
      `SELECT 1 FROM admin_audit_log
       WHERE admin_user_id = $1 AND action = 'identity.invite.consumed'`,
      [userId],
    );
    const { default: argon2 } = await import("argon2");
    expect(state.rows[0]).toMatchObject({ active: true, must_change_password: false });
    expect(state.rows[0]?.email_verified_at).toBeTruthy();
    expect(await argon2.verify(state.rows[0]!.password_hash, "invited-account-password")).toBe(true);
    expect(tokenState.rows[0]?.used_at).toBeTruthy();
    expect(sessionState.rows[0]?.revoked_at).toBeTruthy();
    expect(audit.rowCount).toBe(1);

    const replay = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/identity/consume",
      payload: { token, password: "another-account-password" },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().code).toBe("IDENTITY_TOKEN_INVALID");
  });

  it("revoga links de identidade ao desativar a conta e impede o uso posterior", async () => {
    const email = `inactive-${randomUUID()}@example.test`;
    const userId = randomUUID();
    const token = `reset-${randomUUID()}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await pool.query(
      `INSERT INTO admin_user
         (id, name, username, password_hash, role, active, email, email_normalized, email_verified_at)
       VALUES ($1, 'Conta alvo', $2, 'unused-test-hash', 'viewer', true, $3, $4, now())`,
      [userId, `inactive-${userId.slice(0, 8)}`, email, email.toLowerCase()],
    );
    await pool.query(
      `INSERT INTO admin_identity_token
         (admin_user_id, kind, email_normalized_snapshot, token_hash, expires_at)
       VALUES ($1, 'password_reset', lower($2), $3, now() + interval '30 minutes')`,
      [userId, email, tokenHash],
    );

    const login = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: "admin", password: "development-admin-password" },
    });
    expect(login.statusCode).toBe(200);
    const headers = { authorization: `Bearer ${login.json().accessToken}` };
    const reauthenticated = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/reauthenticate",
      headers,
      payload: { password: "development-admin-password" },
    });
    expect(reauthenticated.statusCode).toBe(204);

    const deactivated = await app!.inject({
      method: "PATCH",
      url: `/api/admin/users/${userId}`,
      headers,
      payload: { active: false, version: 1 },
    });
    expect(deactivated.statusCode).toBe(200);
    const tokenState = await pool.query<{ revoked_at: Date | null }>(
      "SELECT revoked_at FROM admin_identity_token WHERE token_hash = $1",
      [tokenHash],
    );
    expect(tokenState.rows[0]?.revoked_at).toBeTruthy();

    const consumed = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/identity/consume",
      payload: { token, password: "reset-password-that-must-not-work" },
    });
    expect(consumed.statusCode).toBe(400);
    expect(consumed.json().code).toBe("IDENTITY_TOKEN_INVALID");
  });

  it("preserva a ultima conta administrativa em desativacoes concorrentes", async () => {
    const actorResult = await pool.query<{ id: string }>(
      "SELECT id FROM admin_user WHERE username = 'admin'",
    );
    const actorId = actorResult.rows[0]?.id;
    const roleResult = await pool.query<{ id: string }>("SELECT id FROM role WHERE key = 'admin'");
    const adminRoleId = roleResult.rows[0]?.id;
    if (!actorId || !adminRoleId) throw new Error("Fixture administrativa ausente.");

    const previousMemberships = await pool.query<{ admin_user_id: string }>(
      "SELECT admin_user_id FROM admin_user_role WHERE role_id = $1",
      [adminRoleId],
    );
    const previousSuperAdmins = await pool.query<{ id: string }>(
      "SELECT id FROM admin_user WHERE is_super_admin = true AND active = true",
    );
    const testIds = [randomUUID(), randomUUID()];

    try {
      await pool.query("DELETE FROM admin_user_role WHERE role_id = $1", [adminRoleId]);
      await pool.query(
        "UPDATE admin_user SET active = false WHERE is_super_admin = true AND active = true",
      );
      for (const [index, id] of testIds.entries()) {
        await pool.query(
          `INSERT INTO admin_user (id, name, username, password_hash, role, active)
           VALUES ($1, $2, $3, 'unused-test-hash', 'admin', true)`,
          [id, `Admin de concorrencia ${index + 1}`, `admin-lock-${id.slice(0, 8)}`],
        );
        await pool.query(
          "INSERT INTO admin_user_role (admin_user_id, role_id) VALUES ($1, $2)",
          [id, adminRoleId],
        );
      }

      const authz: AuthorizationContext = {
        adminUserId: actorId,
        sessionId: randomUUID(),
        authzVersion: 1,
        permissions: new Set(),
        scopes: new Map(),
        departmentIds: new Set(),
      };
      const outcomes = await Promise.allSettled(
        testIds.map((id) => updateAdminUser(id, { active: false, version: 1 }, actorId, authz)),
      );
      const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "LAST_ACTIVE_ADMIN" });

      const remainingAdmins = await pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM admin_user u
         WHERE u.active = true AND (
           u.is_super_admin = true OR EXISTS (
             SELECT 1 FROM admin_user_role ur JOIN role r ON r.id = ur.role_id
             WHERE ur.admin_user_id = u.id AND r.key = 'admin'
           )
         )`,
      );
      expect(remainingAdmins.rows[0]?.total).toBe("1");
    } finally {
      await pool.query("DELETE FROM admin_user WHERE id = ANY($1::uuid[])", [testIds]);
      for (const membership of previousMemberships.rows) {
        await pool.query(
          "INSERT INTO admin_user_role (admin_user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [membership.admin_user_id, adminRoleId],
        );
      }
      if (previousSuperAdmins.rows.length) {
        await pool.query("UPDATE admin_user SET active = true WHERE id = ANY($1::uuid[])", [
          previousSuperAdmins.rows.map((row) => row.id),
        ]);
      }
    }
  });

  it("mantem a resposta de recuperacao generica para contas existentes e inexistentes", async () => {
    await pool.query(
      `UPDATE admin_user
       SET email = 'admin@example.test', email_normalized = 'admin@example.test',
           email_verified_at = now()
       WHERE username = 'admin'`,
    );
    const existing = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/forgot-password",
      payload: { email: "admin@example.test" },
    });
    const missing = await app!.inject({
      method: "POST",
      url: "/api/admin/auth/forgot-password",
      payload: { email: `missing-${randomUUID()}@example.test` },
    });

    expect(existing.statusCode).toBe(202);
    expect(missing.statusCode).toBe(202);
    expect(existing.json()).toEqual(missing.json());
    expect(existing.json().message).toContain("Se o e-mail estiver associado a uma conta");
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

  it("aplica a matriz de papeis granulares em campanhas, ouvintes, telefone e exportacao", async () => {
    const roles = ["campaign_manager", "receptionist", "announcer", "auditor", "viewer"];
    const roleUsers = new Map<string, Awaited<ReturnType<typeof createRoleSession>>>();
    for (const roleKey of roles) roleUsers.set(roleKey, await createRoleSession(roleKey));

    const baseCampaignSlug = `rbac-base-${Date.now()}`;
    const createdBase = await app!.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        slug: baseCampaignSlug,
        name: "Campanha matriz RBAC",
        title: "Campanha matriz RBAC",
        description: "Fixture para validar autorizacao por papel.",
        status: "active",
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
        privacyNoticeVersion: "2026-09-01",
        privacyNoticeUrl: "/privacidade",
      },
    });
    expect(createdBase.statusCode).toBe(201);

    const registrationFixture = await pool.query<{ id: string }>(
      `INSERT INTO listener_registration
         (campaign_id, name, neighborhood, city, phone, source, submission_token,
          privacy_notice_version, privacy_acknowledged_at)
       SELECT id, 'Ouvinte matriz RBAC', 'Centro', 'Volta Redonda', '24988887700',
              'test', $2, '2026-09-01', now()
       FROM campaign WHERE slug = $1
       RETURNING id`,
      ["lancamento-institucional-2026", randomUUID()],
    );
    const registrationId = registrationFixture.rows[0]?.id;
    expect(registrationId).toBeTruthy();

    const matrix = [
      { key: "admin", token: accessToken, canManageCampaign: true, canReadPhone: true, canExport: true },
      { key: "campaign_manager", token: roleUsers.get("campaign_manager")!.token, canManageCampaign: true, canReadPhone: false, canExport: false },
      { key: "receptionist", token: roleUsers.get("receptionist")!.token, canManageCampaign: false, canReadPhone: true, canExport: false },
      { key: "announcer", token: roleUsers.get("announcer")!.token, canManageCampaign: false, canReadPhone: false, canExport: false },
      { key: "auditor", token: roleUsers.get("auditor")!.token, canManageCampaign: false, canReadPhone: false, canExport: false },
      { key: "viewer", token: roleUsers.get("viewer")!.token, canManageCampaign: false, canReadPhone: false, canExport: false },
    ];

    for (const row of matrix) {
      const headers = { authorization: `Bearer ${row.token}` };
      expect((await app!.inject({ method: "GET", url: "/api/admin/campaigns", headers })).statusCode).toBe(200);
      const banners = await app!.inject({
        method: "GET",
        url: "/api/admin/institutional-banners",
        headers,
      });
      const feed = await app!.inject({
        method: "GET",
        url: "/api/admin/feed/posts",
        headers,
      });
      expect(banners.statusCode).toBe(row.key === "admin" ? 200 : 403);
      expect(feed.statusCode).toBe(row.key === "admin" ? 200 : 403);

      const registrations = await app!.inject({
        method: "GET",
        url: "/api/admin/listener-registrations?page=1&pageSize=20",
        headers,
      });
      expect(registrations.statusCode).toBe(200);
      expect(registrations.json().items.every((item: { phone: string | null }) =>
        row.canReadPhone || item.phone === null,
      )).toBe(true);

      const detail = await app!.inject({
        method: "GET",
        url: `/api/admin/listener-registrations/${registrationId}`,
        headers,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().phone).toBe(row.canReadPhone ? "24988887700" : null);

      const phoneFilter = await app!.inject({
        method: "GET",
        url: "/api/admin/listener-registrations?hasPhone=true",
        headers,
      });
      expect(phoneFilter.statusCode).toBe(row.canReadPhone ? 200 : 403);

      const phoneSearch = await app!.inject({
        method: "GET",
        url: "/api/admin/listener-registrations?q=24988887700",
        headers,
      });
      expect(phoneSearch.statusCode).toBe(200);
      expect(phoneSearch.json().pagination.total).toBe(row.canReadPhone ? 1 : 0);

      const exportResponse = await app!.inject({
        method: "GET",
        url: "/api/admin/listener-registrations/export?format=csv",
        headers,
      });
      expect(exportResponse.statusCode).toBe(row.canExport ? 200 : 403);
      if (row.canExport) expect(exportResponse.body).toContain("24988887700");

      const campaignSlug = `rbac-${row.key.replaceAll("_", "-")}-${Date.now()}`;
      const create = await app!.inject({
        method: "POST",
        url: "/api/admin/campaigns",
        headers,
        payload: {
          slug: campaignSlug,
          name: `Campanha ${row.key}`,
          title: `Campanha ${row.key}`,
          description: "Valida permissao granular de campanha.",
          status: "active",
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 86_400_000).toISOString(),
          privacyNoticeVersion: "2026-09-01",
          privacyNoticeUrl: "/privacidade",
        },
      });
      expect(create.statusCode).toBe(row.canManageCampaign ? 201 : 403);

      if (row.canManageCampaign) {
        const campaignId = create.json().id as string;
        const update = await app!.inject({
          method: "PUT",
          url: `/api/admin/campaigns/${campaignId}`,
          headers,
          payload: { description: "Descricao atualizada pela matriz RBAC." },
        });
        const publish = await app!.inject({
          method: "POST",
          url: `/api/admin/campaigns/${campaignId}/publish`,
          headers,
          payload: { placementKey: "institutional_modal" },
        });
        expect(update.statusCode).toBe(200);
        expect(publish.statusCode).toBe(200);
      } else {
        const update = await app!.inject({
          method: "PUT",
          url: `/api/admin/campaigns/${createdBase.json().id}`,
          headers,
          payload: { description: "Nao autorizado." },
        });
        const publish = await app!.inject({
          method: "POST",
          url: `/api/admin/campaigns/${createdBase.json().id}/publish`,
          headers,
          payload: { placementKey: "institutional_modal" },
        });
        expect(update.statusCode).toBe(403);
        expect(publish.statusCode).toBe(403);
      }

      const sweepstakeStatus = await app!.inject({
        method: "GET",
        url: `/api/admin/sweepstakes/${randomUUID()}/status`,
        headers,
      });
      expect(sweepstakeStatus.statusCode === 403).toBe(row.key !== "admin");

      const administrativeUnpublish = await app!.inject({
        method: "POST",
        url: "/api/admin/campaigns/placements/institutional_modal/unpublish",
        headers,
      });
      expect(administrativeUnpublish.statusCode).toBe(row.key === "admin" ? 501 : 403);
    }
  });

  it("prioriza DENY e nao transforma escopo proprio em leitura global", async () => {
    const manager = await createRoleSession("campaign_manager");
    const adminId = await pool.query<{ id: string }>(
      "SELECT id FROM admin_user WHERE username = 'admin' LIMIT 1",
    );
    await pool.query(
      `INSERT INTO admin_permission_override
         (admin_user_id, permission_id, effect, reason, created_by_admin_user_id)
       SELECT $1, p.id, 'DENY', 'Negacao explicita para teste', $2
       FROM permission p WHERE p.key = 'campaign.create'`,
      [manager.userId, adminId.rows[0]!.id],
    );
    const deniedCreate = await app!.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers: { authorization: `Bearer ${manager.token}` },
      payload: {
        slug: `rbac-deny-${Date.now()}`,
        name: "Negada",
        title: "Negada",
        description: "DENY deve prevalecer sobre papel.",
        status: "draft",
        startsAt: new Date(Date.now() + 60_000).toISOString(),
        privacyNoticeVersion: "2026-09-01",
        privacyNoticeUrl: "/privacidade",
      },
    });
    expect(deniedCreate.statusCode).toBe(403);

    const scopedUser = await createRoleSession(null, "rbac-scoped");
    await pool.query(
      `INSERT INTO admin_permission_override
         (admin_user_id, permission_id, effect, scope_type, reason, created_by_admin_user_id)
       SELECT $1, p.id, 'ALLOW', 'own', 'Escopo proprio para teste', $2
       FROM permission p WHERE p.key = 'campaign.read'`,
      [scopedUser.userId, adminId.rows[0]!.id],
    );
    const me = await app!.inject({
      method: "GET",
      url: "/api/admin/auth/me",
      headers: { authorization: `Bearer ${scopedUser.token}` },
    });
    const globalList = await app!.inject({
      method: "GET",
      url: "/api/admin/campaigns",
      headers: { authorization: `Bearer ${scopedUser.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.permissions).toContain("campaign.read");
    expect(globalList.statusCode).toBe(403);
  });

  it("recalcula o acesso na proxima requisicao apos remover um papel da sessao ativa", async () => {
    const manager = await createRoleSession("campaign_manager", "rbac-role-removal");
    const allowedBeforeRemoval = await app!.inject({
      method: "GET",
      url: "/api/admin/campaigns",
      headers: { authorization: `Bearer ${manager.token}` },
    });
    expect(allowedBeforeRemoval.statusCode).toBe(200);

    await pool.query(
      `DELETE FROM admin_user_role aur
       USING role r
       WHERE aur.admin_user_id = $1 AND aur.role_id = r.id AND r.key = 'campaign_manager'`,
      [manager.userId],
    );
    const deniedAfterRemoval = await app!.inject({
      method: "GET",
      url: "/api/admin/campaigns",
      headers: { authorization: `Bearer ${manager.token}` },
    });
    expect(deniedAfterRemoval.statusCode).toBe(403);
  });

  it("invalida sessoes expiradas, revogadas, desativadas e com versao antiga", async () => {
    const fixtures = await Promise.all([
      createRoleSession("viewer", "rbac-expired"),
      createRoleSession("viewer", "rbac-revoked"),
      createRoleSession("viewer", "rbac-inactive"),
      createRoleSession("viewer", "rbac-version"),
    ]);
    const [expired, revoked, inactive, staleVersion] = fixtures;

    await pool.query(
      `UPDATE admin_session
       SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
       WHERE id = $1`,
      [expired!.sessionId],
    );
    await pool.query(
      `UPDATE admin_session SET revoked_at = now(), revoke_reason = 'test'
       WHERE id = $1`,
      [revoked!.sessionId],
    );
    await pool.query("UPDATE admin_user SET active = false WHERE id = $1", [inactive!.userId]);
    await pool.query("UPDATE admin_user SET authz_version = authz_version + 1 WHERE id = $1", [staleVersion!.userId]);

    for (const fixture of fixtures) {
      const response = await app!.inject({
        method: "GET",
        url: "/api/admin/auth/me",
        headers: { authorization: `Bearer ${fixture!.token}` },
      });
      expect(response.statusCode).toBe(401);
    }
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

  it("distribui a mesma campanha para iOS e Android com origem e idempotencia corretas", async () => {
    const adminHeaders = { authorization: `Bearer ${accessToken}` };
    const slug = `campanha-expo-${Date.now()}`;
    const created = await app!.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers: adminHeaders,
      payload: {
        slug,
        name: "Campanha compartilhada Expo",
        title: "Participe pelo aplicativo",
        description: "Cadastro compartilhado entre site e aplicativo.",
        status: "active",
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
        privacyNoticeVersion: "2026-09-01",
        privacyNoticeUrl: "/privacidade",
      },
    });
    expect(created.statusCode).toBe(201);
    const campaignId = created.json().id as string;

    const published = await app!.inject({
      method: "POST",
      url: `/api/admin/campaigns/${campaignId}/publish`,
      headers: adminHeaders,
      payload: { placementKey: "institutional_modal" },
    });
    expect(published.statusCode).toBe(200);

    const iosDeviceToken = randomUUID();
    const androidDeviceToken = randomUUID();
    const resolveSession = (platform: "expo_ios" | "expo_android", deviceToken: string) =>
      app!.inject({
        method: "POST",
        url: "/api/public/session/resolve",
        headers: {
          "x-device-token": deviceToken,
          "x-platform": platform,
        },
        payload: {
          placement: "institutional_modal",
          platform,
        },
      });

    const [iosSession, androidSession] = await Promise.all([
      resolveSession("expo_ios", iosDeviceToken),
      resolveSession("expo_android", androidDeviceToken),
    ]);

    expect(iosSession.statusCode).toBe(200);
    expect(androidSession.statusCode).toBe(200);
    expect(iosSession.json()).toMatchObject({
      campaign: { id: campaignId, slug },
      experience: "anonymous_registration_required",
    });
    expect(androidSession.json()).toMatchObject({
      campaign: { id: campaignId, slug },
      experience: "anonymous_registration_required",
    });

    const register = (
      platform: "expo_ios" | "expo_android",
      deviceToken: string,
      submissionToken: string,
      name: string,
      phone: string,
    ) =>
      app!.inject({
        method: "POST",
        url: "/api/public/listeners/register-and-participate",
        headers: {
          "x-device-token": deviceToken,
          "x-platform": platform,
          "idempotency-key": submissionToken,
        },
        payload: {
          campaignId,
          name,
          neighborhood: "Aterrado",
          city: "Resende",
          phone,
          submissionToken,
          privacyNoticeVersion: "2026-09-01",
          privacyAcknowledged: true,
          marketingOptIn: false,
          source: "expo",
          website: "",
        },
      });

    const iosSubmissionToken = randomUUID();
    const [iosFirst, iosSecond] = await Promise.all([
      register(
        "expo_ios",
        iosDeviceToken,
        iosSubmissionToken,
        "Ouvinte iOS",
        "24999994444",
      ),
      register(
        "expo_ios",
        iosDeviceToken,
        iosSubmissionToken,
        "Ouvinte iOS",
        "24999994444",
      ),
    ]);
    const androidCreated = await register(
      "expo_android",
      androidDeviceToken,
      randomUUID(),
      "Ouvinte Android",
      "24999995555",
    );

    const iosCreated = [iosFirst, iosSecond].find(
      (response) => response.statusCode === 201,
    );
    const iosRepeated = [iosFirst, iosSecond].find(
      (response) => response.statusCode === 200,
    );
    expect([iosFirst.statusCode, iosSecond.statusCode].sort()).toEqual([200, 201]);
    expect(iosCreated).toBeDefined();
    expect(iosRepeated).toBeDefined();
    if (!iosCreated || !iosRepeated) {
      throw new Error("Respostas idempotentes do iOS ausentes.");
    }
    expect(iosRepeated.json()).toMatchObject({
      id: iosCreated.json().id,
      status: "already_processed",
    });
    expect(androidCreated.statusCode).toBe(201);

    const iosResolvedAgain = await resolveSession("expo_ios", iosDeviceToken);
    expect(iosResolvedAgain.json()).toMatchObject({
      campaign: { id: campaignId },
      listenerState: "known",
      experience: "already_participating",
    });

    const registrations = await db.execute<{ source: string; total: string }>(
      sql`
        SELECT source, count(*)::text AS total
        FROM listener_registration
        WHERE campaign_id = ${campaignId}
        GROUP BY source
        ORDER BY source
      `,
    );
    expect(registrations.rows).toEqual([
      { source: "expo_android", total: "1" },
      { source: "expo_ios", total: "1" },
    ]);

    const profiles = await db.execute<{ total: string }>(
      sql`
        SELECT count(*)::text AS total
        FROM listener_profile
        WHERE name IN ('Ouvinte iOS', 'Ouvinte Android')
      `,
    );
    expect(profiles.rows[0]?.total).toBe("2");
  });

  it("impede o mesmo telefone na mesma campanha, mas permite em outra campanha", async () => {
    const adminHeaders = { authorization: `Bearer ${accessToken}` };
    const slug = `campanha-telefone-${Date.now()}`;
    const createdCampaign = await app!.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers: adminHeaders,
      payload: {
        slug,
        name: "Campanha de telefone unico",
        title: "Participe do sorteio",
        description: "Teste de telefone por campanha.",
        status: "active",
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
        privacyNoticeVersion: "2026-09-02",
        privacyNoticeUrl: "/privacidade",
      },
    });
    expect(createdCampaign.statusCode).toBe(201);
    const campaignId = createdCampaign.json().id as string;
    const phone = "24988887777";

    const register = (deviceToken: string, submissionToken: string) =>
      app!.inject({
        method: "POST",
        url: "/api/public/listeners/register-and-participate",
        headers: {
          "x-device-token": deviceToken,
          "x-platform": "web_desktop",
          "idempotency-key": submissionToken,
        },
        payload: {
          campaignId,
          name: "Ouvinte telefone",
          neighborhood: "Centro",
          city: "Volta Redonda",
          phone,
          submissionToken,
          privacyNoticeVersion: "2026-09-02",
          privacyAcknowledged: true,
          marketingOptIn: false,
          source: "web",
          website: "",
        },
      });

    const first = await register(randomUUID(), randomUUID());
    const duplicate = await register(randomUUID(), randomUUID());

    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      code: "PHONE_ALREADY_PARTICIPATING",
      message: "Você já está participando do sorteio.",
    });

    const otherCampaign = await app!.inject({
      method: "POST",
      url: "/api/public/listener-registrations",
      payload: {
        campaignSlug: "lancamento-institucional-2026",
        name: "Ouvinte em outra campanha",
        neighborhood: "Centro",
        city: "Volta Redonda",
        phone,
        submissionToken: randomUUID(),
        privacyNoticeVersion: "2026-08-01",
        privacyAcknowledged: true,
        marketingOptIn: false,
        source: "institutional_web",
      },
    });
    expect(otherCampaign.statusCode).toBe(201);
  });

  it("lista, detalha e exporta cadastros com auditoria", async () => {
    const headers = { authorization: `Bearer ${accessToken}` };
    await db.execute(sql`DELETE FROM registration_export_audit`);
    const list = await app!.inject({
      method: "GET",
      url: "/api/admin/listener-registrations?page=1&pageSize=20&city=Volta&q=Maria",
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
  it("sorteia e ressorteia participantes elegiveis com auditoria e idempotencia", async () => {
    const headers = { authorization: `Bearer ${accessToken}` };
    const unauthorized = await app!.inject({
      method: "GET",
      url: `/api/admin/sweepstakes/${randomUUID()}/status`,
    });
    const viewerId = randomUUID();
    await pool.query(
      `INSERT INTO admin_user (id, name, username, password_hash, role, active)
       VALUES ($1, 'Viewer', $2, 'not-used-by-test', 'viewer', true)`,
      [viewerId, `viewer-${viewerId}`],
    );
    await pool.query(
      `INSERT INTO admin_user_role (admin_user_id, role_id)
       SELECT $1, id FROM role WHERE key = 'viewer'`,
      [viewerId],
    );
    const viewerSession = await pool.query<{ id: string; authz_version: number }>(
      `INSERT INTO admin_session (admin_user_id, authz_version, expires_at)
       SELECT id, authz_version, now() + interval '1 hour'
       FROM admin_user WHERE id = $1
       RETURNING id, authz_version`,
      [viewerId],
    );
    const session = viewerSession.rows[0];
    const viewerToken = app!.jwt.sign({
      sub: viewerId,
      role: "viewer",
      name: "Viewer",
      username: `viewer-${viewerId}`,
      sid: session!.id,
      authzVersion: Number(session!.authz_version),
    });
    const forbidden = await app!.inject({
      method: "GET",
      url: `/api/admin/sweepstakes/${randomUUID()}/status`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(forbidden.statusCode).toBe(403);

    const registrations = await app!.inject({
      method: "GET",
      url: "/api/admin/listener-registrations?page=1&pageSize=20",
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(registrations.statusCode).toBe(200);
    expect(registrations.json().items.every((item: { phone: string | null }) => item.phone === null)).toBe(true);
    const campaign = await app!.inject({
      method: "POST",
      url: "/api/admin/campaigns",
      headers,
      payload: {
        slug: `sorteio-api-${Date.now()}`,
        name: "Sorteio integrado",
        title: "Sorteio integrado",
        description: "Campanha encerrada para validar a apuracao.",
        status: "closed",
        type: "sweepstake",
        startsAt: new Date(Date.now() - 86_400_000).toISOString(),
        endsAt: new Date(Date.now() - 60_000).toISOString(),
        privacyNoticeVersion: "2026-09-03",
        privacyNoticeUrl: "/privacidade",
      },
    });
    expect(campaign.statusCode).toBe(201);

    const campaignId = campaign.json().id as string;
    for (const [index, name] of ["Ana Sorteio", "Bruno Sorteio", "Carla Sorteio"].entries()) {
      const profile = await pool.query<{ id: string }>(
        `INSERT INTO listener_profile
           (name, neighborhood, city, phone, phone_normalized, status)
         VALUES ($1, $2, $3, $4, $4, 'active')
         RETURNING id`,
        [name, `Bairro ${index + 1}`, "Volta Redonda", `2499999000${index}`],
      );
      await pool.query(
        `INSERT INTO campaign_participation
           (campaign_id, listener_profile_id, source, status)
         VALUES ($1, $2, 'web', 'eligible')`,
        [campaignId, profile.rows[0]!.id],
      );
    }

    const status = await app!.inject({
      method: "GET",
      url: `/api/admin/sweepstakes/${campaignId}/status`,
      headers,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      campaignId,
      campaignStatus: "closed",
      eligibleCount: 3,
      legacyUnlinkedCount: 0,
      canDraw: true,
      currentDraw: null,
    });

    const requestToken = randomUUID();
    const first = await app!.inject({
      method: "POST",
      url: `/api/admin/sweepstakes/${campaignId}/draw`,
      headers: { ...headers, "idempotency-key": requestToken },
    });
    const repeated = await app!.inject({
      method: "POST",
      url: `/api/admin/sweepstakes/${campaignId}/draw`,
      headers: { ...headers, "idempotency-key": requestToken },
    });

    expect(first.statusCode).toBe(201);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json().winner).toMatchObject({
      name: expect.any(String),
      city: "Volta Redonda",
      neighborhood: expect.any(String),
      phone: expect.any(String),
    });
    expect(first.json().animationNames.at(-1)).toBe(first.json().winner.name);
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().drawId).toBe(first.json().drawId);

    const redraw = await app!.inject({
      method: "POST",
      url: `/api/admin/sweepstakes/${campaignId}/redraw`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { previousDrawId: first.json().drawId },
    });

    expect(redraw.statusCode).toBe(201);
    expect(redraw.json().sequence).toBe(2);
    expect(redraw.json().winner.participationId).not.toBe(
      first.json().winner.participationId,
    );

    const persisted = await pool.query<{ status: string; sequence: number }>(
      `SELECT status, sequence
       FROM sweepstake_draw
       WHERE campaign_id = $1
       ORDER BY sequence`,
      [campaignId],
    );
    expect(persisted.rows).toEqual([
      { status: "superseded", sequence: 1 },
      { status: "selected", sequence: 2 },
    ]);

    const audit = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM admin_audit_log
       WHERE resource_type = 'sweepstake_draw'
         AND metadata->>'campaignId' = $1`,
      [campaignId],
    );
    expect(audit.rows[0]?.total).toBe("2");
  });

});
