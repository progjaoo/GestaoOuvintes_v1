import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "../../src/database/client.js";
import { institutionalBanners, mediaAssets } from "../../src/database/banner-schema.js";
import { adminUsers } from "../../src/database/schema.js";
import { env } from "../../src/config/env.js";
import { buildApp } from "../../src/app.js";
import {
  createInstitutionalBanner, updateInstitutionalBanner, setInstitutionalBannerActive,
  deleteInstitutionalBanner, reorderInstitutionalBanners,
} from "../../src/services/institutional-banner-service.js";

const localTests = process.env.RUN_LEGACY_SCHEMA_TESTS === "true" ? describe : describe.skip;

localTests("banner principal em PostgreSQL legado + 0013", () => {
  let adminId: string;
  let assetId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.port !== "5436" || url.pathname !== "/radio88_primary_banner_test") {
      throw new Error("Aceita somente o banco Docker descartavel do Plan 050.");
    }
    adminId = (await db.select().from(adminUsers).where(eq(adminUsers.username, "admin")))[0]!.id;
    assetId = (await db.insert(mediaAssets).values({
      objectKey: `banners-institucional/test/${randomUUID()}.webp`, originalName: "fixture.webp",
      mimeType: "image/webp", byteSize: 1000, width: 1920, height: 1080, status: "ready",
    }).returning())[0]!.id;
    app = await buildApp();
  });

  beforeEach(async () => {
    await db.delete(institutionalBanners);
    await db.update(mediaAssets).set({ status: "ready" }).where(eq(mediaAssets.id, assetId));
    env.INSTITUTIONAL_PRIMARY_BANNER_ENABLED = true;
  });

  afterAll(async () => { await app?.close(); await pool.end(); });

  const create = (title: string, isPrimary = false) => createInstitutionalBanner({
    title, altText: title, placementKey: "home_hero", mediaAssetId: assetId,
    actionType: "none", destinationUrl: null, openInNewTab: false, active: true, isPrimary,
  }, adminId);

  it("troca o principal preservando ordem e impede duplicacao no banco", async () => {
    const a = await create("Banner A", true);
    const b = await create("Banner B");
    await updateInstitutionalBanner(b.id, { isPrimary: true }, adminId);
    const rows = await db.select().from(institutionalBanners).orderBy(institutionalBanners.displayOrder);
    expect(rows.map(row => [row.id, row.isPrimary, row.displayOrder])).toEqual([[a.id, false, 1], [b.id, true, 2]]);
    await expect(db.update(institutionalBanners).set({ isPrimary: true }).where(eq(institutionalBanners.id, a.id)))
      .rejects.toThrow();
  });

  it("serializa duas escolhas concorrentes e deixa exatamente um principal", async () => {
    const a = await create("Banner A");
    const b = await create("Banner B");
    await Promise.all([
      updateInstitutionalBanner(a.id, { isPrimary: true }, adminId),
      updateInstitutionalBanner(b.id, { isPrimary: true }, adminId),
    ]);
    const rows = await db.select().from(institutionalBanners).where(eq(institutionalBanners.isPrimary, true));
    expect(rows).toHaveLength(1);
    expect([a.id, b.id]).toContain(rows[0]!.id);
  });

  it("desmarcar um antigo principal e editar campos comuns nao remove o novo destaque", async () => {
    const a = await create("Banner A", true);
    const b = await create("Banner B", true);
    await updateInstitutionalBanner(a.id, { isPrimary: false, title: "Banner A editado" }, adminId);
    await updateInstitutionalBanner(b.id, { altText: "Nova descricao" }, adminId);
    const rows = await db.select().from(institutionalBanners).where(eq(institutionalBanners.isPrimary, true));
    expect(rows.map(row => row.id)).toEqual([b.id]);
  });

  it("desativar e excluir restaura o estado comum; reativacao nao reassume destaque", async () => {
    const a = await create("Banner A", true);
    expect(await setInstitutionalBannerActive(a.id, false, adminId)).toMatchObject({ active: false, isPrimary: false });
    expect(await setInstitutionalBannerActive(a.id, true, adminId)).toMatchObject({ active: true, isPrimary: false });
    await updateInstitutionalBanner(a.id, { isPrimary: true }, adminId);
    await deleteInstitutionalBanner(a.id, adminId);
    const [row] = await db.select().from(institutionalBanners).where(eq(institutionalBanners.id, a.id));
    expect(row).toMatchObject({ active: false, isPrimary: false });
    expect(row!.deletedAt).not.toBeNull();
  });

  it("rejeita alvo invalido e flag desligada sem perder o principal anterior", async () => {
    const a = await create("Banner A", true);
    const b = await create("Banner B");
    await expect(updateInstitutionalBanner(b.id, { active: false, isPrimary: true }, adminId))
      .rejects.toMatchObject({ code: "INVALID_PRIMARY_BANNER" });
    env.INSTITUTIONAL_PRIMARY_BANNER_ENABLED = false;
    await expect(updateInstitutionalBanner(b.id, { isPrimary: true }, adminId))
      .rejects.toMatchObject({ code: "PRIMARY_BANNER_DISABLED" });
    const rows = await db.select().from(institutionalBanners).where(eq(institutionalBanners.isPrimary, true));
    expect(rows.map(row => row.id)).toEqual([a.id]);
  });

  it("reordenacao nao muda principal e exclusao de midia compartilhada nao o invalida", async () => {
    const a = await create("Banner A", true);
    const b = await create("Banner B");
    await reorderInstitutionalBanners("home_hero", [b.id, a.id], adminId);
    await deleteInstitutionalBanner(b.id, adminId);
    const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId));
    expect(asset!.status).toBe("ready");
    const rows = await db.select().from(institutionalBanners)
      .where(and(eq(institutionalBanners.isPrimary, true), isNull(institutionalBanners.deletedAt)));
    expect(rows[0]).toMatchObject({ id: a.id, displayOrder: 2 });
  });

  it("restringe escrita por RBAC e anuncia a capacidade administrativa", async () => {
    const a = await create("Banner A");
    const noAuth = await app.inject({ method: "PUT", url: `/api/admin/institutional-banners/${a.id}`, payload: { isPrimary: true } });
    expect(noAuth.statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/admin/auth/login", payload: { username: "admin", password: "development-admin-password" } });
    expect(login.statusCode).toBe(200);
    const token = login.json().accessToken;
    const response = await app.inject({ method: "GET", url: "/api/admin/institutional-banners", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().capabilities.primaryBanner).toBe(true);
  });

  it("publica formato legado ou novo conforme flag e registra auditoria", async () => {
    const a = await create("Banner A", true);
    const { S3Client } = await import("@aws-sdk/client-s3");
    const { publishPublicConfigSnapshot, parseSnapshot } = await import("../../src/services/public-config-snapshot.js");
    const saved = { write: env.PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED, namespace: env.PUBLIC_CONFIG_NAMESPACE };
    env.PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED = true;
    env.PUBLIC_CONFIG_NAMESPACE = "test/radio-88";
    env.R2_ACCOUNT_ID = "test-account";
    env.R2_ACCESS_KEY_ID = "test-access";
    env.R2_SECRET_ACCESS_KEY = "test-secret";
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    try {
      await publishPublicConfigSnapshot();
      const first = JSON.parse(String((send.mock.calls[0]![0] as { input: { Body: Buffer } }).input.Body));
      expect(parseSnapshot(first).banners[0]).toMatchObject({ id: a.id, isPrimary: true });
      env.INSTITUTIONAL_PRIMARY_BANNER_ENABLED = false;
      await publishPublicConfigSnapshot();
      const legacy = JSON.parse(String((send.mock.calls[1]![0] as { input: { Body: Buffer } }).input.Body));
      expect(parseSnapshot(legacy).banners[0]).not.toHaveProperty("isPrimary");
      expect(first.revision).not.toBe(legacy.revision);
      const audit = await db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM admin_audit_log WHERE action = 'primary.change'`);
      expect(Number(audit.rows[0]!.count)).toBeGreaterThan(0);
    } finally {
      send.mockRestore();
      env.PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED = saved.write;
      env.PUBLIC_CONFIG_NAMESPACE = saved.namespace;
    }
  });
});
