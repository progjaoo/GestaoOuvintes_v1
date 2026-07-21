import { randomUUID } from "node:crypto";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { env } from "../src/config/env.js";
import { processBannerImage } from "../src/services/media-storage/media-image-processor.js";
import { R2MediaStorage } from "../src/services/media-storage/r2-media-storage.js";

if (
  env.MEDIA_STORAGE_DRIVER !== "r2" ||
  !env.R2_ACCOUNT_ID ||
  !env.R2_ACCESS_KEY_ID ||
  !env.R2_SECRET_ACCESS_KEY
) {
  throw new Error("Configure o driver e as credenciais R2 antes de executar o check.");
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});
const storage = new R2MediaStorage();
const prefix = env.R2_OBJECT_PREFIX.replace(/^\/+|\/+$/g, "");
const key = [prefix, "health", randomUUID() + ".webp"].filter(Boolean).join("/");
const source = await sharp({
  create: {
    width: 320,
    height: 180,
    channels: 4,
    background: { r: 19, g: 96, b: 232, alpha: 1 },
  },
})
  .png()
  .toBuffer();
const processed = await processBannerImage(source, "r2-health.png");

console.log("R2 banner check starting", {
  bucket: env.R2_BUCKET_NAME,
  prefix,
});

let uploaded = false;
try {
  await storage.put({
    key,
    body: processed.buffer,
    contentType: processed.mimeType,
    cacheControl: "no-store",
  });
  uploaded = true;

  const head = await client.send(new HeadObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
  }));
  if (head.ContentType !== "image/webp") {
    throw new Error("O objeto de teste nao foi gravado como WebP.");
  }

  const publicResponse = await fetch(storage.publicUrl(key), {
    method: "GET",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!publicResponse.ok) {
    throw new Error(`A URL publica do objeto respondeu ${publicResponse.status}.`);
  }

  console.log("R2 banner check completed", {
    bucket: env.R2_BUCKET_NAME,
    prefix,
    contentType: head.ContentType,
    publicStatus: publicResponse.status,
  });
} finally {
  if (uploaded) {
    await storage.delete(key);
  }
}
