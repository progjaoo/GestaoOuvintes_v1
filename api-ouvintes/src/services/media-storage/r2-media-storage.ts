import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { MediaStorage } from "./media-storage.js";

function normalizeR2Cause(cause: unknown) {
  if (!(cause instanceof Error)) {
    return { provider: "r2", errorMessage: String(cause) };
  }

  const metadata = (cause as { $metadata?: Record<string, unknown> }).$metadata;
  const code = (cause as { Code?: unknown; code?: unknown }).Code ??
    (cause as { code?: unknown }).code;

  return {
    provider: "r2",
    errorName: cause.name,
    errorMessage: cause.message,
    providerCode: typeof code === "string" ? code : undefined,
    httpStatusCode: typeof metadata?.httpStatusCode === "number"
      ? metadata.httpStatusCode
      : undefined,
    requestId: typeof metadata?.requestId === "string" ? metadata.requestId : undefined,
  };
}

export function normalizeR2StorageError(
  operation: "put" | "delete",
  cause: unknown,
): AppError {
  const isUpload = operation === "put";
  return new AppError(
    502,
    isUpload ? "R2_UPLOAD_FAILED" : "R2_DELETE_FAILED",
    isUpload
      ? "Nao foi possivel armazenar a imagem."
      : "Nao foi possivel remover a imagem do armazenamento.",
    { operation, ...normalizeR2Cause(cause) },
    { cause },
  );
}

function safeEnvFingerprint(value: string | undefined) {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function safeTail(value: string | undefined) {
  if (!value) return null;
  return value.slice(-6);
}

function getPublicBaseUrlHost(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return "URL_INVALIDA";
  }
}

export function getMediaStorageStatus() {
  const sanitizedPrefix = env.R2_OBJECT_PREFIX.replace(/^\/+|\/+$/g, "");

  return {
    driver: env.MEDIA_STORAGE_DRIVER,
    bucketName: env.R2_BUCKET_NAME,
    objectPrefix: sanitizedPrefix,
    accountIdConfigured: Boolean(env.R2_ACCOUNT_ID),
    accessKeyConfigured: Boolean(env.R2_ACCESS_KEY_ID),
    secretKeyConfigured: Boolean(env.R2_SECRET_ACCESS_KEY),
    publicBaseUrlConfigured: Boolean(env.R2_PUBLIC_BASE_URL),
    credentialsConfigured: Boolean(
      env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY,
    ),
    diagnostics: {
      accountIdTail: safeTail(env.R2_ACCOUNT_ID),
      accessKeyIdTail: safeTail(env.R2_ACCESS_KEY_ID),
      secretKeyFingerprint: safeEnvFingerprint(env.R2_SECRET_ACCESS_KEY),
      publicBaseUrlHost: getPublicBaseUrlHost(env.R2_PUBLIC_BASE_URL),
      bucketNameFingerprint: safeEnvFingerprint(env.R2_BUCKET_NAME),
      objectPrefixFingerprint: safeEnvFingerprint(sanitizedPrefix),
    },
    ready: Boolean(
      env.MEDIA_STORAGE_DRIVER === "r2" &&
        env.R2_ACCOUNT_ID &&
        env.R2_ACCESS_KEY_ID &&
        env.R2_SECRET_ACCESS_KEY &&
        env.R2_PUBLIC_BASE_URL &&
        env.R2_BUCKET_NAME,
    ),
  };
}

export async function verifyR2WriteAccess() {
  const storage = createMediaStorage();
  const prefix = env.R2_OBJECT_PREFIX.replace(/^\/+|\/+$/g, "");
  const key = [prefix, "health", `vercel-write-check-${randomUUID()}.txt`]
    .filter(Boolean)
    .join("/");

  const uploaded = await storage.put({
    key,
    body: Buffer.from("radio88-r2-write-check", "utf8"),
    contentType: "text/plain; charset=utf-8",
    cacheControl: "no-store",
  });

  await storage.delete(key);

  return {
    bucketName: env.R2_BUCKET_NAME,
    objectPrefix: prefix,
    key,
    etag: uploaded.etag,
  };
}

export class R2MediaStorage implements MediaStorage {
  private readonly client: S3Client;

  constructor() {
    if (
      !env.R2_ACCOUNT_ID ||
      !env.R2_ACCESS_KEY_ID ||
      !env.R2_SECRET_ACCESS_KEY ||
      !env.R2_PUBLIC_BASE_URL
    ) {
      throw new AppError(
        503,
        "MEDIA_STORAGE_NOT_CONFIGURED",
        "O armazenamento de midias ainda nao foi configurado.",
      );
    }

    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  async put(input: {
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl: string;
  }) {
    try {
      const result = await this.client.send(
        new PutObjectCommand({
          Bucket: env.R2_BUCKET_NAME,
          Key: input.key,
          Body: input.body,
          ContentLength: input.body.length,
          ContentType: input.contentType,
          CacheControl: input.cacheControl,
        }),
      );
      return { etag: result.ETag?.replaceAll('"', "") ?? null };
    } catch (cause) {
      throw normalizeR2StorageError("put", cause);
    }
  }

  async delete(key: string) {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
      );
    } catch (cause) {
      throw normalizeR2StorageError("delete", cause);
    }
  }

  publicUrl(key: string) {
    if (!env.R2_PUBLIC_BASE_URL) {
      throw new AppError(
        503,
        "MEDIA_PUBLIC_URL_NOT_CONFIGURED",
        "A URL publica do armazenamento nao foi configurada.",
      );
    }
    return `${env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }
}

export function createMediaStorage(): MediaStorage {
  if (env.MEDIA_STORAGE_DRIVER !== "r2") {
    throw new AppError(
      503,
      "MEDIA_STORAGE_NOT_CONFIGURED",
      "Configure MEDIA_STORAGE_DRIVER=r2 para enviar banners.",
    );
  }
  return new R2MediaStorage();
}
