import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));

const previewFeed = {
  VERCEL_ENV: "preview",
  FEED_ENABLED: "true",
  FEED_NAMESPACE: "preview/radio-88",
  FEED_PRIVATE_BUCKET_NAME: "radio88-feed-preview-private",
  R2_BUCKET_NAME: "radio88-feed-preview-public",
  R2_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-access",
  R2_SECRET_ACCESS_KEY: "synthetic-test-secret",
};

function configure(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

async function loadEnv() {
  return (await import("../../src/config/env.js")).env;
}

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (/^(FEED_|R2_|PUBLIC_CONFIG_|VERCEL_ENV$)/.test(key)) vi.stubEnv(key, undefined);
  }
  configure({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://127.0.0.1:1/feed_gate_test",
    DATABASE_SSL: "false",
    JWT_SECRET: "synthetic-jwt-secret-at-least-32-characters",
    IP_HASH_SECRET: "synthetic-ip-hash-secret",
    ADMIN_INITIAL_PASSWORD: "synthetic-password-for-tests",
    CAMPAIGN_STARTS_AT: "2026-01-01T00:00:00Z",
    MEDIA_STORAGE_DRIVER: "disabled",
    FEED_ENABLED: "false",
    FEED_PUBLICATION_ENABLED: "false",
    PUBLIC_CONFIG_READ_MODE: "database",
    PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED: "false",
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("Feed environment gates", () => {
  it("accepts the explicitly configured isolated Preview bucket pair", async () => {
    configure(previewFeed);
    const env = await loadEnv();
    expect(env.FEED_ENABLED).toBe(true);
    expect(env.FEED_PRIVATE_BUCKET_NAME).toBe(previewFeed.FEED_PRIVATE_BUCKET_NAME);
    expect(env.R2_BUCKET_NAME).toBe(previewFeed.R2_BUCKET_NAME);
  });

  it.each([
    { label: "implicit public default", patch: { R2_BUCKET_NAME: undefined } },
    { label: "explicit production public bucket", patch: { R2_BUCKET_NAME: "site-institucional" } },
    { label: "non-Preview private bucket", patch: { FEED_PRIVATE_BUCKET_NAME: "radio88-feed-private" } },
    { label: "non-Preview public bucket", patch: { R2_BUCKET_NAME: "radio88-feed-public" } },
    { label: "unapproved Preview bucket", patch: { R2_BUCKET_NAME: "other-preview-public" } },
  ])("rejects $label even when publication is disabled", async ({ patch }) => {
    configure({ ...previewFeed, ...patch });
    await expect(loadEnv()).rejects.toThrow("Feed no Vercel Preview exige os buckets isolados");
  });

  it("still rejects a missing private bucket", async () => {
    configure({ ...previewFeed, FEED_PRIVATE_BUCKET_NAME: undefined });
    await expect(loadEnv()).rejects.toThrow("FEED_ENABLED exige namespace isolado");
  });

  it("keeps private and public buckets distinct", async () => {
    configure({ ...previewFeed, FEED_PRIVATE_BUCKET_NAME: previewFeed.R2_BUCKET_NAME });
    await expect(loadEnv()).rejects.toThrow("deve ser diferente do bucket publico");
  });

  it.each(["preview", "production"])("preserves existing R2 features with Feed off in %s", async (environment) => {
    configure({
      VERCEL_ENV: environment,
      MEDIA_STORAGE_DRIVER: "r2",
      R2_ACCOUNT_ID: "test-account",
      R2_ACCESS_KEY_ID: "test-access",
      R2_SECRET_ACCESS_KEY: "synthetic-test-secret",
      R2_PUBLIC_BASE_URL: "https://media.example.test",
      PUBLIC_CONFIG_READ_MODE: "r2",
      PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED: "true",
      PUBLIC_CONFIG_NAMESPACE: `${environment}/radio-88`,
    });
    const env = await loadEnv();
    expect(env.FEED_ENABLED).toBe(false);
    expect(env.R2_BUCKET_NAME).toBe("site-institucional");
    expect(env.PUBLIC_CONFIG_READ_MODE).toBe("r2");
  });

  it.each([undefined, "development", "production"])("preserves enabled non-Preview configurations in %s", async (environment) => {
    configure({
      ...previewFeed,
      VERCEL_ENV: environment,
      FEED_NAMESPACE: `${environment ?? "development"}/radio-88`,
      FEED_PRIVATE_BUCKET_NAME: "local-editorial-private",
      R2_BUCKET_NAME: undefined,
    });
    expect((await loadEnv()).FEED_ENABLED).toBe(true);
  });

  it("retains namespace isolation checks", async () => {
    configure({ ...previewFeed, FEED_NAMESPACE: "development/radio-88" });
    await expect(loadEnv()).rejects.toThrow("FEED_NAMESPACE nao corresponde");
  });

  it.each([undefined, ""])("treats an absent or empty protection bypass secret as optional", async (secret) => {
    configure({
      ...previewFeed,
      FEED_PUBLICATION_ENABLED: "true",
      FEED_DEPLOY_HOOK_URL: "https://deploy.example.test/hook",
      FEED_SITE_BASE_URL: "https://site.example.test",
      R2_PUBLIC_BASE_URL: "https://media.example.test",
      FEED_SITE_PROTECTION_BYPASS_SECRET: secret,
    });
    expect((await loadEnv()).FEED_SITE_PROTECTION_BYPASS_SECRET).toBeUndefined();
  });

  it("exports a configured server-side protection bypass secret", async () => {
    configure({ ...previewFeed, FEED_SITE_PROTECTION_BYPASS_SECRET: "synthetic-bypass-test-value" });
    expect((await loadEnv()).FEED_SITE_PROTECTION_BYPASS_SECRET).toBe("synthetic-bypass-test-value");
  });
});
