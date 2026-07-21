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

export const env = {
  ...result.data,
  DEVICE_TOKEN_SECRET: result.data.DEVICE_TOKEN_SECRET ?? result.data.JWT_SECRET,
  corsAllowedOrigins: result.data.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export type AppEnv = typeof env;
