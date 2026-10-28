import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://radio88:test@127.0.0.1:1/radio88_test";
process.env.DATABASE_SSL = "false";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-characters";
process.env.IP_HASH_SECRET = "test-ip-hash-secret-value";
process.env.ADMIN_INITIAL_PASSWORD = "test-password-12345";
process.env.CAMPAIGN_STARTS_AT = "2026-01-01T00:00:00Z";
process.env.PUBLIC_CONFIG_READ_MODE = "r2";
process.env.PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED = "true";
process.env.PUBLIC_CONFIG_NAMESPACE = "test/radio-88";
process.env.INSTITUTIONAL_PRIMARY_BANNER_ENABLED = "true";
process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-access-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";
process.env.R2_BUCKET_NAME = "test-bucket";
process.env.R2_PUBLIC_BASE_URL = "https://media.example.test";

const content = {
  schemaVersion: 1 as const,
  namespace: "test/radio-88",
  campaigns: [],
  placements: [],
  banners: [{
    id: "fd0052c2-1303-45df-819b-fabfdcd1775c", title: "Festa", altText: "Festa da radio",
    placementKey: "home_hero", imageUrl: "https://media.example.test/festa.webp", actionType: "none",
    destinationUrl: null, openInNewTab: false, order: 2, isPrimary: true,
  }],
};
const revision = createHash("sha256").update(JSON.stringify(content)).digest("hex");
const serializedSnapshot = JSON.stringify({
  ...content,
  revision,
  generatedAt: "2026-10-16T12:00:00.000Z",
});

describe("public config R2 routes", () => {
  let app: Awaited<ReturnType<(typeof import("../src/app.js"))["buildApp"]>>;
  let pool: (typeof import("../src/database/client.js"))["pool"];
  let snapshotModule: typeof import("../src/services/public-config-snapshot.js");
  let send: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    await import("dotenv/config");
    delete process.env.VERCEL_ENV;
    const { S3Client } = await import("@aws-sdk/client-s3");
    send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => ({
      Body: { transformToString: async () => serializedSnapshot },
    }) as never);
    snapshotModule = await import("../src/services/public-config-snapshot.js");
    const application = await import("../src/app.js");
    const database = await import("../src/database/client.js");
    app = await application.buildApp();
    pool = database.pool;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    vi.restoreAllMocks();
  });

  it("serve config e sessão indisponível sem consultar o PostgreSQL", async () => {
    const placement = await app.inject({
      method: "GET",
      url: "/api/public/placements/institutional_modal/campaign",
    });
    const banners = await app.inject({
      method: "GET",
      url: "/api/public/institutional-banners?placement=home_hero",
    });
    const session = await app.inject({
      method: "POST",
      url: "/api/public/session/resolve",
      headers: { "x-device-token": "test-device-token-with-at-least-32-characters" },
      payload: { placement: "institutional_modal", platform: "web_desktop" },
    });

    expect(placement.statusCode).toBe(200);
    expect(placement.json()).toMatchObject({ campaign: null, version: 0 });
    expect(placement.headers["cache-control"]).toContain("s-maxage=60");
    expect(banners.statusCode).toBe(200);
    expect(banners.json()).toEqual({ version: Number.parseInt(revision.slice(0, 12), 16), items: content.banners });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      campaign: null,
      listenerState: "anonymous",
      experience: "campaign_unavailable",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("falha fechado quando o snapshot não pode ser lido", async () => {
    snapshotModule.resetPublicConfigSnapshotCacheForTests();
    send.mockRejectedValueOnce(new Error("R2 unavailable"));

    const response = await app.inject({
      method: "GET",
      url: "/api/public/placements/institutional_modal/campaign",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("PUBLIC_CONFIG_SNAPSHOT_UNAVAILABLE");
  });
});
