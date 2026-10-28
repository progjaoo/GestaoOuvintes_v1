import { createHash, createHmac, randomUUID } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { env } from "../../config/env.js";
import { pool } from "../../database/client.js";
import { AppError } from "../../lib/errors.js";
import { inspectEditorialMp4 } from "./video-validation.js";
import { withEditorialLock } from "./operation-lock.js";
const acceptedMime = {
    image: new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]),
    gif: new Set(["image/gif"]),
    video: new Set(["video/mp4"]),
};
const maxBytes = { image: 10 * 1024 * 1024, gif: 10 * 1024 * 1024, video: 50 * 1024 * 1024 };
function toEditorialMediaAsset(row) {
    return {
        id: row.id,
        mediaType: row.media_type,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size),
        originalName: row.original_name,
        width: row.width == null ? null : Number(row.width),
        height: row.height == null ? null : Number(row.height),
        durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
        frameCount: row.frame_count == null ? null : Number(row.frame_count),
        status: row.status,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    };
}
function client() {
    if (!env.FEED_PRIVATE_BUCKET_NAME || !env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
        throw new AppError(503, "FEED_STORAGE_NOT_CONFIGURED", "O armazenamento editorial privado nao esta configurado.");
    }
    return new S3Client({
        region: "auto",
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });
}
function awsEncode(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function sign(key, value) { return createHmac("sha256", key).update(value).digest(); }
function createPresignedUrl(method, bucket, objectKey, contentType) {
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
        throw new AppError(503, "FEED_STORAGE_NOT_CONFIGURED", "O armazenamento editorial nao esta configurado.");
    }
    const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const path = `/${[bucket, ...objectKey.split("/")].map(awsEncode).join("/")}`;
    const now = new Date();
    const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = date.slice(0, 8);
    const scope = `${day}/auto/s3/aws4_request`;
    const signedHeaders = contentType ? "content-type;host" : "host";
    const query = new URLSearchParams({
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": `${env.R2_ACCESS_KEY_ID}/${scope}`,
        "X-Amz-Date": date,
        "X-Amz-Expires": "300",
        "X-Amz-SignedHeaders": signedHeaders,
    });
    const canonicalQuery = [...query.entries()]
        .map(([key, value]) => [awsEncode(key), awsEncode(value)])
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`).join("&");
    const canonicalRequest = [
        method, path, canonicalQuery,
        contentType ? `content-type:${contentType.trim()}\nhost:${host}\n` : `host:${host}\n`,
        signedHeaders, "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${createHash("sha256").update(canonicalRequest).digest("hex")}`;
    const dateKey = sign(Buffer.from(`AWS4${env.R2_SECRET_ACCESS_KEY}`), day);
    const regionKey = sign(dateKey, "auto");
    const serviceKey = sign(regionKey, "s3");
    const signingKey = sign(serviceKey, "aws4_request");
    query.set("X-Amz-Signature", createHmac("sha256", signingKey).update(stringToSign).digest("hex"));
    return `https://${host}${path}?${query.toString()}`;
}
export async function createEditorialUpload(input) {
    if (!env.FEED_ENABLED)
        throw new AppError(404, "FEED_DISABLED", "O modulo Feed esta desativado.");
    if (!env.FEED_PRIVATE_BUCKET_NAME)
        throw new AppError(503, "FEED_STORAGE_NOT_CONFIGURED", "O bucket privado do Feed nao esta configurado.");
    if (!acceptedMime[input.mediaType].has(input.mimeType) || !Number.isSafeInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > Math.min(maxBytes[input.mediaType], env.FEED_MAX_UPLOAD_BYTES)) {
        throw new AppError(422, "FEED_MEDIA_REJECTED", "Formato ou tamanho de midia nao permitido.");
    }
    const assetId = randomUUID();
    const safeName = input.filename.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) || "media";
    const key = `feed-private/${env.FEED_NAMESPACE}/${assetId}/${safeName}`;
    const uploadUrl = createPresignedUrl("PUT", env.FEED_PRIVATE_BUCKET_NAME, key, input.mimeType);
    const saved = await pool.query(`INSERT INTO editorial_media_asset (id, media_type, private_object_key, mime_type, byte_size, checksum_sha256, original_name, created_by_admin_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, status, media_type, mime_type, byte_size, original_name, created_at`, [assetId, input.mediaType, key, input.mimeType, input.byteSize, input.checksumSha256 ?? null, input.filename.slice(0, 255), input.adminUserId]);
    return { asset: toEditorialMediaAsset(saved.rows[0]), uploadUrl, expiresInSeconds: 300, requiredHeaders: { "Content-Type": input.mimeType } };
}
export async function completeEditorialUpload(id, adminUserId) {
    return withEditorialLock(`feed-upload:${id}`, async (db) => {
        const result = await db.query(`SELECT id, media_type, private_object_key, mime_type, byte_size, checksum_sha256
       FROM editorial_media_asset WHERE id = $1 AND created_by_admin_user_id = $2 AND status = 'uploading'`, [id, adminUserId]);
        if (!result.rowCount)
            throw new AppError(404, "FEED_UPLOAD_NOT_FOUND", "Upload pendente nao encontrado.");
        const asset = result.rows[0];
        if (!asset.private_object_key.startsWith(`feed-private/${env.FEED_NAMESPACE}/${id}/`)) {
            throw new AppError(422, "FEED_ASSET_NAMESPACE_INVALID", "Midia de outro ambiente.");
        }
        const s3 = client();
        try {
            const head = await s3.send(new HeadObjectCommand({ Bucket: env.FEED_PRIVATE_BUCKET_NAME, Key: asset.private_object_key }));
            const expectedSize = Number(asset.byte_size);
            if (!head.ETag || !Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > Math.min(maxBytes[asset.media_type], env.FEED_MAX_UPLOAD_BYTES) || head.ContentLength !== expectedSize || head.ContentType !== asset.mime_type) {
                throw new AppError(422, "FEED_UPLOAD_MISMATCH", "O arquivo enviado nao corresponde ao tamanho e tipo reservados.");
            }
            const object = await s3.send(new GetObjectCommand({ Bucket: env.FEED_PRIVATE_BUCKET_NAME, Key: asset.private_object_key, IfMatch: head.ETag }));
            if (!object.Body)
                throw new AppError(422, "FEED_UPLOAD_EMPTY", "O arquivo enviado esta vazio.");
            const chunks = [];
            let actualSize = 0;
            for await (const chunk of object.Body) {
                actualSize += chunk.byteLength;
                if (actualSize > expectedSize)
                    throw new AppError(422, "FEED_UPLOAD_MISMATCH", "O tamanho real excede o tamanho reservado.");
                chunks.push(Buffer.from(chunk));
            }
            if (actualSize !== expectedSize || object.ContentType !== asset.mime_type || object.ETag !== head.ETag) {
                throw new AppError(422, "FEED_UPLOAD_MISMATCH", "O arquivo mudou durante a validacao.");
            }
            const bytes = Buffer.concat(chunks, actualSize);
            const detected = await fileTypeFromBuffer(bytes.subarray(0, 4100));
            const matched = asset.media_type === "gif" ? detected?.mime === "image/gif"
                : asset.media_type === "image" ? detected?.mime === asset.mime_type
                    : detected?.mime === "video/mp4";
            const checksum = createHash("sha256").update(bytes).digest("hex");
            if (!matched || (asset.checksum_sha256 && checksum !== asset.checksum_sha256.toLowerCase())) {
                throw new AppError(422, "FEED_UPLOAD_INVALID", "A assinatura do arquivo nao corresponde ao formato aprovado.");
            }
            let durationMs = null;
            let metadata = {};
            if (asset.media_type === "video") {
                try {
                    const video = inspectEditorialMp4(bytes);
                    durationMs = video.durationMs;
                    metadata = { width: video.width, height: video.height };
                }
                catch (cause) {
                    throw new AppError(422, "FEED_VIDEO_INVALID", "Envie MP4 progressivo H.264/AAC com duracao entre 1 segundo e 2 minutos.", undefined, { cause });
                }
            }
            // This key is never signed for PUT. Replaying the upload URL cannot change it.
            const validatedKey = `feed-private/${env.FEED_NAMESPACE}/${id}/validated-${randomUUID()}/source`;
            let posterObjectKey = null;
            const privateVariants = [];
            if (asset.media_type !== "video") {
                const image = await sharp(bytes, { animated: asset.media_type === "gif", limitInputPixels: 40_000_000 }).metadata().catch((cause) => {
                    throw new AppError(422, "FEED_IMAGE_INVALID", "Imagem corrompida ou excedeu os limites.", undefined, { cause });
                });
                if (!image.width || !image.height || image.width * image.height > 40_000_000 || (asset.media_type === "image" && (image.pages ?? 1) > 1)) {
                    throw new AppError(422, "FEED_IMAGE_DIMENSIONS_INVALID", "As dimensoes da imagem nao sao permitidas.");
                }
                metadata = { width: image.width, height: image.height, frameCount: image.pages };
                if (asset.media_type === "gif") {
                    const frames = image.pages ?? 1;
                    const duration = (image.delay ?? []).reduce((sum, delay) => sum + Math.max(delay, 10), 0);
                    if (frames > 300 || !duration || duration > 15_000 || image.width * (image.pageHeight ?? image.height) * frames > 40_000_000) {
                        throw new AppError(422, "FEED_GIF_LIMIT_EXCEEDED", "GIF excede o limite de duracao, frames ou pixels.");
                    }
                    durationMs = duration;
                    metadata.height = image.pageHeight ?? image.height;
                    const poster = await sharp(bytes, { page: 0, limitInputPixels: 40_000_000 }).webp({ quality: 82 }).toBuffer();
                    posterObjectKey = `${validatedKey}.poster.webp`;
                    await s3.send(new PutObjectCommand({ Bucket: env.FEED_PRIVATE_BUCKET_NAME, Key: posterObjectKey, Body: poster, ContentType: "image/webp", CacheControl: "private, max-age=0" }));
                }
                else {
                    const widths = [...new Set([640, 1280, 1920].filter((width) => width < image.width).concat(image.width <= 640 ? [image.width] : []))].sort((a, b) => a - b);
                    for (const width of widths) {
                        const optimized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toBuffer();
                        const key = `${validatedKey}.w${width}.webp`;
                        await s3.send(new PutObjectCommand({ Bucket: env.FEED_PRIVATE_BUCKET_NAME, Key: key, Body: optimized, ContentType: "image/webp", CacheControl: "private, max-age=0" }));
                        privateVariants.push({ width, key, byteSize: optimized.length });
                    }
                }
            }
            await s3.send(new PutObjectCommand({ Bucket: env.FEED_PRIVATE_BUCKET_NAME, Key: validatedKey, Body: bytes, ContentType: asset.mime_type, CacheControl: "private, no-store", IfNoneMatch: "*" }));
            if (asset.media_type === "video") {
                const range = await s3.send(new GetObjectCommand({ Bucket: env.FEED_PRIVATE_BUCKET_NAME, Key: validatedKey, Range: "bytes=0-31" }));
                const rangeBytes = range.Body ? Buffer.from(await range.Body.transformToByteArray()) : Buffer.alloc(0);
                if (range.$metadata.httpStatusCode !== 206 || range.ContentRange !== `bytes 0-31/${bytes.length}` || !rangeBytes.equals(bytes.subarray(0, 32))) {
                    throw new AppError(422, "FEED_VIDEO_RANGE_UNSUPPORTED", "O armazenamento nao confirmou leitura parcial do video.");
                }
            }
            const ready = await db.query(`UPDATE editorial_media_asset SET status='ready', width=$2, height=$3, duration_ms=$4, frame_count=$5, checksum_sha256=$6, poster_object_key=$7, private_variants=$8::jsonb, updated_at=now()
         , private_object_key=$9 WHERE id=$1 AND status='uploading' RETURNING id, status, media_type, mime_type, byte_size, width, height, duration_ms, frame_count, original_name, created_at`, [id, metadata.width ?? null, metadata.height ?? null, durationMs, metadata.frameCount ?? null, checksum, posterObjectKey, JSON.stringify(privateVariants), validatedKey]);
            if (!ready.rowCount)
                throw new AppError(409, "FEED_UPLOAD_CONFLICT", "O upload ja foi finalizado.");
            return toEditorialMediaAsset(ready.rows[0]);
        }
        catch (error) {
            if (error instanceof AppError && error.statusCode === 422) {
                await db.query("UPDATE editorial_media_asset SET status='rejected', updated_at=now() WHERE id=$1 AND status='uploading'", [id]);
            }
            throw error;
        }
    });
}
export async function listEditorialMedia(adminUserId, page, pageSize) {
    const offset = (page - 1) * pageSize;
    const result = await pool.query(`SELECT id, media_type, status, mime_type, byte_size, width, height, duration_ms, frame_count, original_name, private_object_key, created_at
     FROM editorial_media_asset WHERE created_by_admin_user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, [adminUserId, pageSize, offset]);
    const items = result.rows.map((asset) => ({
        ...toEditorialMediaAsset(asset),
        previewUrl: asset.status === "ready" ? createPresignedUrl("GET", env.FEED_PRIVATE_BUCKET_NAME, asset.private_object_key) : null,
    }));
    return { items, page, pageSize };
}
export async function getEditorialMediaPreview(id, adminUserId) {
    if (!env.FEED_PRIVATE_BUCKET_NAME)
        throw new AppError(503, "FEED_STORAGE_NOT_CONFIGURED", "O armazenamento editorial privado nao esta configurado.");
    const result = await pool.query("SELECT media_type, mime_type, private_object_key, poster_object_key FROM editorial_media_asset WHERE id=$1 AND created_by_admin_user_id=$2 AND status='ready'", [id, adminUserId]);
    if (!result.rowCount)
        throw new AppError(404, "FEED_MEDIA_NOT_FOUND", "Midia pronta nao encontrada.");
    if (!result.rows[0].private_object_key.startsWith(`feed-private/${env.FEED_NAMESPACE}/${id}/validated-`)) {
        throw new AppError(422, "FEED_ASSET_NAMESPACE_INVALID", "Midia de outro ambiente ou ainda nao consolidada.");
    }
    const asset = result.rows[0];
    return {
        url: createPresignedUrl("GET", env.FEED_PRIVATE_BUCKET_NAME, asset.private_object_key),
        posterUrl: asset.poster_object_key ? createPresignedUrl("GET", env.FEED_PRIVATE_BUCKET_NAME, asset.poster_object_key) : null,
        mediaType: asset.media_type,
        mimeType: asset.mime_type,
        expiresInSeconds: 300,
    };
}
