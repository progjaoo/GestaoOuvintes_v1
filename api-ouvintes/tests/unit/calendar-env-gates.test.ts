import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dotenv/config', () => ({}));

const callbackPath = '/api/admin/calendar-integrations/oauth/callback';
const localCalendar = {
  GOOGLE_CALENDAR_ENABLED: 'true',
  GOOGLE_CALENDAR_CLIENT_ID: 'synthetic-client-id',
  GOOGLE_CALENDAR_CLIENT_SECRET: 'synthetic-client-secret',
  GOOGLE_CALENDAR_REDIRECT_URI: `http://localhost:3012${callbackPath}`,
  GOOGLE_CALENDAR_ALLOWED_ID: 'production88fm@gmail.com',
  GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

function configure(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

async function loadEnv() {
  return (await import('../../src/config/env.js')).env;
}

beforeEach(() => {
  vi.resetModules();
  for (const key of Object.keys(process.env)) {
    if (/^(GOOGLE_CALENDAR_|CRON_SECRET$|VERCEL_ENV$)/.test(key)) vi.stubEnv(key, undefined);
  }
  configure({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://127.0.0.1:1/calendar_env_test',
    DATABASE_SSL: 'false',
    JWT_SECRET: 'synthetic-jwt-secret-at-least-32-characters',
    IP_HASH_SECRET: 'synthetic-ip-hash-secret',
    ADMIN_INITIAL_PASSWORD: 'synthetic-password-for-tests',
    CAMPAIGN_STARTS_AT: '2026-01-01T00:00:00Z',
    MEDIA_STORAGE_DRIVER: 'disabled',
    PUBLIC_CONFIG_READ_MODE: 'database',
    PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED: 'false',
  });
});

afterEach(() => vi.unstubAllEnvs());

describe('Google Calendar environment gates', () => {
  it('preserves the local Docker callback', async () => {
    configure(localCalendar);
    expect((await loadEnv()).GOOGLE_CALENDAR_ENABLED).toBe(true);
  });

  it('allows only the exact HTTPS callback for the stable Preview alias', async () => {
    configure({
      ...localCalendar,
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      GOOGLE_CALENDAR_REDIRECT_URI: `https://gestaoouvintes88fm-api-git-co-04a862-mosaicolabs-4518s-projects.vercel.app${callbackPath}`,
    });
    expect((await loadEnv()).VERCEL_ENV).toBe('preview');
  });

  it('allows only the exact HTTPS callback for Production', async () => {
    configure({
      ...localCalendar,
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      GOOGLE_CALENDAR_REDIRECT_URI: `https://gestaoouvintes88fm-api.vercel.app${callbackPath}`,
    });
    expect((await loadEnv()).GOOGLE_CALENDAR_ENABLED).toBe(true);
  });

  it.each([
    `http://gestaoouvintes88fm-api.vercel.app${callbackPath}`,
    `https://attacker.vercel.app${callbackPath}`,
    'https://gestaoouvintes88fm-api.vercel.app/other-path',
    `https://gestaoouvintes88fm-api.vercel.app${callbackPath}?next=https://attacker.example`,
  ])('rejects an unsafe Vercel callback: %s', async (redirectUri) => {
    configure({
      ...localCalendar,
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      GOOGLE_CALENDAR_REDIRECT_URI: redirectUri,
    });
    await expect(loadEnv()).rejects.toThrow('callback HTTPS exato do ambiente Vercel');
  });

  it('requires a cron secret when scheduled Calendar sync is enabled', async () => {
    configure({ ...localCalendar, GOOGLE_CALENDAR_CRON_ENABLED: 'true' });
    await expect(loadEnv()).rejects.toThrow('integracao habilitada e CRON_SECRET');
  });

  it('keeps Vercel interval polling disabled; scheduled execution is separate', async () => {
    configure({
      ...localCalendar,
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      GOOGLE_CALENDAR_REDIRECT_URI: `https://gestaoouvintes88fm-api.vercel.app${callbackPath}`,
      GOOGLE_CALENDAR_AUTO_SYNC_INTERVAL_SECONDS: '300',
    });
    await expect(loadEnv()).rejects.toThrow('runtime Docker nao-producao');
  });
});
