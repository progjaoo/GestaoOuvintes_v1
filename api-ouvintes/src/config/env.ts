import "dotenv/config";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().url().optional(),
);

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3010),
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: booleanFromString,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("2h"),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:8080"),
  REGISTRATION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(5),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(5),
  IP_HASH_SECRET: z.string().min(16),
  DEVICE_TOKEN_SECRET: z.string().min(32).optional(),
  EXPORT_MAX_ROWS: z.coerce.number().int().min(1).max(200_000).default(50_000),
  ADMIN_INITIAL_NAME: z.string().min(2).default("Administrador Radio 88"),
  ADMIN_INITIAL_USERNAME: z.string().min(3).default("admin"),
  ADMIN_INITIAL_PASSWORD: z.string().min(12),
  CAMPAIGN_SLUG: z.string().min(3).default("lancamento-institucional-2026"),
  CAMPAIGN_NAME: z
    .string()
    .min(3)
    .default("Lancamento do Site Institucional - 1 de Agosto"),
  CAMPAIGN_STARTS_AT: z.iso.datetime({ offset: true }),
  CAMPAIGN_ENDS_AT: z.iso.datetime({ offset: true }).optional(),
  PRIVACY_NOTICE_VERSION: z.string().min(1).default("2026-08-01"),
  PRIVACY_NOTICE_URL: z.string().min(1).default("/privacidade"),
  MEDIA_STORAGE_DRIVER: z.enum(["disabled", "r2"]).default("disabled"),
  R2_ACCOUNT_ID: optionalNonEmptyString,
  R2_ACCESS_KEY_ID: optionalNonEmptyString,
  R2_SECRET_ACCESS_KEY: optionalNonEmptyString,
  R2_BUCKET_NAME: z.string().default("site-institucional"),
  R2_PUBLIC_BASE_URL: optionalUrl,
  R2_OBJECT_PREFIX: z.string().default("banners-institucional"),
  INSTITUTIONAL_BANNER_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),
  INSTITUTIONAL_PRIMARY_BANNER_ENABLED: booleanFromString,
  PUBLIC_CONFIG_READ_MODE: z.enum(["database", "r2"]).default("database"),
  PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED: booleanFromString,
  PUBLIC_CONFIG_NAMESPACE: optionalNonEmptyString,
  PUBLIC_CONFIG_R2_TIMEOUT_MS: z.coerce.number().int().min(500).max(10_000).default(4_000),
  FEED_ENABLED: booleanFromString,
  FEED_PUBLICATION_ENABLED: booleanFromString,
  FEED_NAMESPACE: optionalNonEmptyString,
  FEED_PRIVATE_BUCKET_NAME: optionalNonEmptyString,
  FEED_DEPLOY_HOOK_URL: optionalUrl,
  FEED_SITE_BASE_URL: optionalUrl,
  FEED_SITE_PROTECTION_BYPASS_SECRET: optionalNonEmptyString,
  FEED_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().max(50 * 1024 * 1024).default(50 * 1024 * 1024),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Variaveis de ambiente invalidas:", z.treeifyError(result.error));
  throw new Error("Configuracao de ambiente invalida.");
}

if (
  result.data.MEDIA_STORAGE_DRIVER === "r2" &&
  (!result.data.R2_ACCOUNT_ID ||
    !result.data.R2_ACCESS_KEY_ID ||
    !result.data.R2_SECRET_ACCESS_KEY ||
    !result.data.R2_PUBLIC_BASE_URL)
) {
  throw new Error(
    "MEDIA_STORAGE_DRIVER=r2 exige Account ID, credenciais R2 e URL publica.",
  );
}

const publicConfigEnabled =
  result.data.PUBLIC_CONFIG_READ_MODE === "r2" ||
  result.data.PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED;
if (
  result.data.PUBLIC_CONFIG_READ_MODE === "r2" &&
  !result.data.PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED
) {
  throw new Error(
    "PUBLIC_CONFIG_READ_MODE=r2 exige PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED=true para manter o snapshot sincronizado.",
  );
}

if (publicConfigEnabled) {
  const namespace = result.data.PUBLIC_CONFIG_NAMESPACE;
  if (!namespace || !/^(development|test|preview|production)\/radio-88$/.test(namespace)) {
    throw new Error(
      "PUBLIC_CONFIG_NAMESPACE deve identificar explicitamente o ambiente e radio-88.",
    );
  }

  const expectedPrefix = result.data.VERCEL_ENV;
  if (expectedPrefix && !namespace.startsWith(`${expectedPrefix}/`)) {
    throw new Error("PUBLIC_CONFIG_NAMESPACE nao corresponde ao ambiente Vercel.");
  }
  if (namespace.startsWith("production/") && expectedPrefix !== "production") {
    throw new Error("O namespace de producao exige VERCEL_ENV=production.");
  }

  if (
    !result.data.R2_ACCOUNT_ID ||
    !result.data.R2_ACCESS_KEY_ID ||
    !result.data.R2_SECRET_ACCESS_KEY ||
    !result.data.R2_BUCKET_NAME ||
    !result.data.R2_PUBLIC_BASE_URL
  ) {
    throw new Error(
      "A leitura/publicacao da configuracao publica exige credenciais R2 e URL publica.",
    );
  }
}

if (
  result.data.FEED_PUBLICATION_ENABLED &&
  (!result.data.FEED_ENABLED || !result.data.FEED_NAMESPACE ||
    !result.data.FEED_PRIVATE_BUCKET_NAME || !result.data.FEED_DEPLOY_HOOK_URL ||
    !result.data.FEED_SITE_BASE_URL || !result.data.R2_ACCOUNT_ID ||
    !result.data.R2_ACCESS_KEY_ID || !result.data.R2_SECRET_ACCESS_KEY ||
    !result.data.R2_PUBLIC_BASE_URL)
) {
  throw new Error("FEED_PUBLICATION_ENABLED exige configuracao editorial completa por ambiente.");
}

if (result.data.FEED_NAMESPACE && !/^(development|test|preview|production)\/radio-88$/.test(result.data.FEED_NAMESPACE)) {
  throw new Error("FEED_NAMESPACE deve identificar explicitamente o ambiente e radio-88.");
}
if (result.data.FEED_ENABLED && (!result.data.FEED_NAMESPACE || !result.data.FEED_PRIVATE_BUCKET_NAME ||
  !result.data.R2_ACCOUNT_ID || !result.data.R2_ACCESS_KEY_ID || !result.data.R2_SECRET_ACCESS_KEY)) {
  throw new Error("FEED_ENABLED exige namespace isolado, bucket privado e credenciais R2 para upload direto.");
}
if (result.data.FEED_ENABLED && result.data.FEED_PRIVATE_BUCKET_NAME === result.data.R2_BUCKET_NAME) {
  throw new Error("O bucket editorial privado deve ser diferente do bucket publico usado pelo site e banners.");
}
if (
  result.data.FEED_ENABLED && result.data.VERCEL_ENV === "preview" &&
  (result.data.FEED_PRIVATE_BUCKET_NAME !== "radio88-feed-preview-private" ||
    result.data.R2_BUCKET_NAME !== "radio88-feed-preview-public")
) {
  throw new Error("Feed no Vercel Preview exige os buckets isolados radio88-feed-preview-private e radio88-feed-preview-public explicitamente configurados.");
}
if (result.data.FEED_ENABLED && result.data.VERCEL_ENV && !result.data.FEED_NAMESPACE?.startsWith(`${result.data.VERCEL_ENV}/`)) {
  throw new Error("FEED_NAMESPACE nao corresponde ao ambiente Vercel.");
}
if (result.data.FEED_NAMESPACE?.startsWith("production/") && result.data.VERCEL_ENV !== "production") {
  throw new Error("O namespace editorial de producao exige VERCEL_ENV=production.");
}

export const env = {
  ...result.data,
  PUBLIC_CONFIG_NAMESPACE: result.data.PUBLIC_CONFIG_NAMESPACE ?? "",
  FEED_NAMESPACE: result.data.FEED_NAMESPACE ?? "",
  DEVICE_TOKEN_SECRET: result.data.DEVICE_TOKEN_SECRET ?? result.data.JWT_SECRET,
  corsAllowedOrigins: result.data.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export type AppEnv = typeof env;
