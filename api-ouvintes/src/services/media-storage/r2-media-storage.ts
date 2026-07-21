import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { MediaStorage } from "./media-storage.js";

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
    { provider: "r2", operation },
    { cause },
  );
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
