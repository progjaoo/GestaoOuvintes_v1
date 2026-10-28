import { createHash, randomUUID } from "node:crypto";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, } from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";
import { pool } from "../../database/client.js";
import { AppError } from "../../lib/errors.js";
import { editorialBlockSchema, extractEditorialAssetIds } from "../../schemas/editorial.js";
import { assertEditorialAssetUsage } from "./asset-validation.js";
import { withEditorialLock } from "./operation-lock.js";
function s3() {
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.FEED_PRIVATE_BUCKET_NAME) {
        throw new AppError(503, "FEED_STORAGE_NOT_CONFIGURED", "O armazenamento editorial nao esta configurado.");
    }
    return new S3Client({
        region: "auto",
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });
}
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function sourcePath(bucket, key) { return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`; }
async function readReleaseMarker() {
    const headers = { "Cache-Control": "no-cache" };
    if (env.FEED_SITE_PROTECTION_BYPASS_SECRET)
        headers["x-vercel-protection-bypass"] = env.FEED_SITE_PROTECTION_BYPASS_SECRET;
    const response = await fetch(`${env.FEED_SITE_BASE_URL.replace(/\/+$/, "")}/feed/release.json?check=${randomUUID()}`, { cache: "no-store", redirect: "error", headers, signal: AbortSignal.timeout(8_000) });
    if (response.status === 404)
        return null;
    if (!response.ok)
        throw new Error("Release marker unavailable");
    const marker = await response.json();
    if (marker?.schemaVersion !== 1 || !marker.namespace || !marker.releaseId || !marker.manifestSha256)
        throw new Error("Invalid release marker");
    return marker;
}
function matchesReleaseMarker(marker, release) {
    return marker?.schemaVersion === 1 && marker.namespace === (release.namespace ?? env.FEED_NAMESPACE) && marker.releaseId === release.id && marker.manifestSha256 === release.manifest_sha256;
}
async function startEditorialDeploy(db, releaseId) {
    const hook = await fetch(env.FEED_DEPLOY_HOOK_URL, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!hook.ok) {
        if (hook.status >= 400 && hook.status <= 599)
            throw new AppError(502, "FEED_DEPLOY_HOOK_REJECTED", "O deploy rejeitou a solicitacao de publicacao do Feed.");
        throw new Error("Deploy Hook outcome uncertain");
    }
    const hookBody = await hook.json().catch(() => ({}));
    const jobId = hookBody.job?.id ?? hookBody.id ?? null;
    await db.query("UPDATE editorial_release SET status='awaiting_confirmation', deploy_job_id=$2, error_code=NULL, updated_at=now() WHERE id=$1", [releaseId, jobId]);
    return { releaseId, status: "awaiting_confirmation", deployJobId: jobId, duplicate: false };
}
async function objectBuffer(client, bucket, key) {
    try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!object.Body)
            return null;
        return Buffer.from(await object.Body.transformToByteArray());
    }
    catch (error) {
        const status = error.$metadata?.httpStatusCode;
        if (status === 404 || (error instanceof Error && error.name === "NoSuchKey"))
            return null;
        throw error;
    }
}
export async function requestEditorialRelease(input) {
    const operation = input.operation ?? "publish";
    if (!env.FEED_PUBLICATION_ENABLED || !env.FEED_NAMESPACE || !env.FEED_DEPLOY_HOOK_URL || !env.FEED_SITE_BASE_URL) {
        throw new AppError(503, "FEED_PUBLICATION_NOT_CONFIGURED", "A publicacao editorial ainda nao esta configurada neste ambiente.");
    }
    const client = s3();
    return withEditorialLock(`feed-release:${env.FEED_NAMESPACE}`, async (db) => {
        let releaseId = "";
        let revisionIds = [];
        let generatedAt = "";
        let previousCandidate = null;
        let candidateWasReplaced = false;
        let hookMayHaveStarted = false;
        let priorHookMayHaveStarted = false;
        let transactionOpen = false;
        let recoveryUncertain = false;
        try {
            await db.query("BEGIN");
            transactionOpen = true;
            const prior = await db.query("SELECT id, status, deploy_job_id, manifest_sha256, revision_ids, created_at, sequence FROM editorial_release WHERE namespace=$1 AND idempotency_key=$2", [env.FEED_NAMESPACE, input.idempotencyKey]);
            if (prior.rowCount) {
                const previous = prior.rows[0];
                const target = previous.revision_ids.find((ref) => ref.operation !== "retain");
                if (!target || target.postId !== input.postId || target.revisionId !== input.revisionId || (target.operation ?? "publish") !== operation) {
                    throw new AppError(409, "FEED_IDEMPOTENCY_CONFLICT", "A chave de idempotencia pertence a outra operacao.");
                }
                const retryUncertain = input.retry === true && ["building", "awaiting_confirmation"].includes(previous.status);
                if (previous.status !== "failed" && previous.status !== "preparing" && !retryUncertain) {
                    await db.query("COMMIT");
                    transactionOpen = false;
                    return { releaseId: prior.rows[0].id, status: prior.rows[0].status, deployJobId: prior.rows[0].deploy_job_id, duplicate: true };
                }
                if (target.snapshotVersion !== 1)
                    throw new AppError(409, "FEED_RELEASE_SNAPSHOT_MISSING", "Esta release antiga nao possui snapshot seguro para retentativa.");
                const newer = await db.query("SELECT id FROM editorial_release WHERE namespace=$1 AND sequence > $2 LIMIT 1", [env.FEED_NAMESPACE, previous.sequence]);
                if (newer.rowCount)
                    throw new AppError(409, "FEED_RELEASE_SUPERSEDED", "Uma release posterior impede esta retentativa.");
                if (retryUncertain) {
                    await db.query("COMMIT");
                    transactionOpen = false;
                    let marker;
                    try {
                        marker = await readReleaseMarker();
                    }
                    catch {
                        throw new AppError(409, "FEED_LIVE_RELEASE_UNAVAILABLE", "Nao foi possivel verificar o site antes da retentativa.");
                    }
                    if (matchesReleaseMarker(marker, previous)) {
                        const confirmed = await confirmEditorialRelease(db, previous);
                        if (!confirmed.live)
                            throw new AppError(409, "FEED_RELEASE_INVALID", "Nao foi possivel reconciliar esta release.");
                        return { releaseId: previous.id, status: "live", deployJobId: previous.deploy_job_id, duplicate: true };
                    }
                    const live = await db.query("SELECT id, manifest_sha256 FROM editorial_release WHERE namespace=$1 AND status='live' ORDER BY sequence DESC LIMIT 1", [env.FEED_NAMESPACE]);
                    if (live.rowCount ? !matchesReleaseMarker(marker, live.rows[0]) : marker !== null)
                        throw new AppError(409, "FEED_LIVE_RELEASE_MISMATCH", "O site nao corresponde a ultima release confirmada. Reconcilie o rollback antes de publicar.");
                    const candidateBytes = await objectBuffer(client, env.R2_BUCKET_NAME, `feed/${env.FEED_NAMESPACE}/candidate.json`);
                    const candidate = candidateBytes ? JSON.parse(candidateBytes.toString()) : null;
                    if (!previous.manifest_sha256 || !matchesReleaseMarker(candidate, previous) || candidate.manifestKey !== `feed/${env.FEED_NAMESPACE}/releases/${previous.id}/manifest.json`)
                        throw new AppError(409, "FEED_CANDIDATE_MISMATCH", "O candidato atual nao corresponde a release solicitada.");
                    // Reuse the immutable snapshot; an older uncertain deploy may still read it.
                    releaseId = previous.id;
                    priorHookMayHaveStarted = true;
                    hookMayHaveStarted = true;
                    return await startEditorialDeploy(db, releaseId);
                }
                releaseId = previous.id;
                revisionIds = previous.revision_ids;
                generatedAt = new Date(previous.created_at).toISOString();
                await db.query("UPDATE editorial_release SET status='preparing', error_code=NULL, updated_at=now() WHERE id=$1", [releaseId]);
            }
            else {
                const selected = await db.query(`SELECT p.id AS post_id, r.id AS revision_id, p.slug, p.published_revision_id, r.revision_number, r.title, r.excerpt,
            r.cover_asset_id, r.cover_alt, r.cover_focus_x, r.cover_focus_y, r.blocks,
            r.category_snapshot, r.seo_title, r.seo_description, r.event_date, r.public_credits,
            COALESCE(p.first_published_at, now()) AS published_at
           FROM editorial_post p JOIN editorial_revision r ON r.id = $2 AND r.post_id=p.id
           WHERE p.id=$1 AND (p.draft_revision_id=$2 OR p.published_revision_id=$2) AND p.status <> 'archived'
             AND ($3 <> 'archive' OR (p.published_revision_id=$2 AND p.status='published'))
           FOR UPDATE OF p`, [input.postId, input.revisionId, operation]);
                if (!selected.rowCount)
                    throw new AppError(404, "FEED_REVISION_NOT_FOUND", "A revisao selecionada nao pertence a publicacao.");
                if (operation === "archive" && (selected.rows[0].revision_id !== input.revisionId || selected.rows[0].published_revision_id === null)) {
                    throw new AppError(409, "FEED_POST_NOT_PUBLISHED", "Somente uma publicacao efetivamente ativa pode ser retirada do Feed.");
                }
                const ongoing = await db.query("SELECT id FROM editorial_release WHERE namespace=$1 AND status IN ('preparing','building','awaiting_confirmation') FOR UPDATE", [env.FEED_NAMESPACE]);
                if (ongoing.rowCount)
                    throw new AppError(409, "FEED_RELEASE_IN_PROGRESS", "Ja existe uma publicacao editorial em andamento.");
                releaseId = randomUUID();
                const current = await db.query(`SELECT p.id AS post_id, p.slug, p.published_revision_id AS revision_id, p.first_published_at
         FROM editorial_post p WHERE p.status='published' AND p.archived_at IS NULL AND p.id<>$1`, [input.postId]);
                generatedAt = new Date().toISOString();
                revisionIds = current.rows.map((post) => ({ postId: post.post_id, revisionId: post.revision_id, operation: "retain", slug: post.slug, publishedAt: new Date(post.first_published_at).toISOString() }));
                revisionIds.push({ postId: input.postId, revisionId: input.revisionId, operation, slug: selected.rows[0].slug, publishedAt: new Date(selected.rows[0].published_at).toISOString(), snapshotVersion: 1 });
                await db.query(`INSERT INTO editorial_release (id, namespace, status, revision_ids, idempotency_key, created_by_admin_user_id, created_at)
         VALUES ($1,$2,'preparing',$3::jsonb,$4,$5,$6)`, [releaseId, env.FEED_NAMESPACE, JSON.stringify(revisionIds), input.idempotencyKey, input.adminUserId, generatedAt]);
            }
            await db.query("COMMIT");
            transactionOpen = false;
            const live = await db.query("SELECT id, manifest_sha256 FROM editorial_release WHERE namespace=$1 AND status='live' ORDER BY sequence DESC LIMIT 1", [env.FEED_NAMESPACE]);
            if (live.rowCount) {
                let matches = false;
                try {
                    matches = matchesReleaseMarker(await readReleaseMarker(), live.rows[0]);
                }
                catch { /* An unavailable marker cannot authorize a new public snapshot. */ }
                if (!matches)
                    throw new AppError(409, "FEED_LIVE_RELEASE_MISMATCH", "O site nao corresponde a ultima release confirmada. Reconcilie o rollback antes de publicar.");
            }
            const current = await db.query(`SELECT p.id AS post_id, p.slug, p.first_published_at, r.id AS revision_id, r.revision_number,
          r.title, r.excerpt, r.cover_asset_id, r.cover_alt, r.cover_focus_x, r.cover_focus_y,
          r.opening_asset_id, r.opening_alt, r.opening_focus_x, r.opening_focus_y,
          r.blocks, r.category_snapshot, r.seo_title, r.seo_description,
          to_char(r.event_date, 'YYYY-MM-DD') AS event_date,
          r.public_credits, r.created_at AS revision_created_at
         FROM editorial_post p JOIN editorial_revision r ON r.post_id=p.id
         WHERE r.id=ANY($1::uuid[])`, [revisionIds.filter((ref) => ref.operation !== "archive").map((ref) => ref.revisionId)]);
            const posts = current.rows.map((post) => {
                const ref = revisionIds.find((entry) => entry.postId === post.post_id && entry.revisionId === post.revision_id);
                return { ...post, slug: ref.slug ?? post.slug, first_published_at: ref.publishedAt ?? post.first_published_at, blocks: editorialBlockSchema.array().max(50).parse(post.blocks) };
            }).sort((a, b) => Date.parse(b.first_published_at) - Date.parse(a.first_published_at) || String(b.post_id).localeCompare(String(a.post_id)));
            if (posts.length !== revisionIds.filter((ref) => ref.operation !== "archive").length)
                throw new AppError(422, "FEED_REVISION_MISSING", "Uma revisao da release nao esta disponivel.");
            const allAssetIds = [...new Set(posts.flatMap((post) => extractEditorialAssetIds({
                coverAssetId: post.cover_asset_id,
                openingAssetId: post.opening_asset_id,
                blocks: post.blocks,
            })))];
            const mediaResult = await db.query(`SELECT id, media_type, private_object_key, public_object_key, poster_object_key, private_variants, mime_type, byte_size, status
         FROM editorial_media_asset WHERE id=ANY($1::uuid[]) AND status='ready'`, [allAssetIds]);
            const mediaMap = new Map(mediaResult.rows.map((row) => [row.id, row]));
            for (const post of posts)
                assertEditorialAssetUsage({ coverAssetId: post.cover_asset_id, openingAssetId: post.opening_asset_id, blocks: post.blocks }, mediaMap);
            for (const asset of mediaMap.values()) {
                const prefix = asset.private_object_key;
                if ((asset.poster_object_key && asset.poster_object_key !== `${prefix}.poster.webp`) ||
                    asset.private_variants.some((variant) => !Number.isInteger(variant.width) || variant.width <= 0 || variant.key !== `${prefix}.w${variant.width}.webp`)) {
                    throw new AppError(422, "FEED_ASSET_NAMESPACE_INVALID", "Uma variante pertence a outra midia ou ambiente.");
                }
            }
            const publicMedia = new Map();
            for (const assetId of allAssetIds) {
                const asset = mediaMap.get(assetId);
                if (!asset || asset.status !== "ready")
                    throw new AppError(422, "FEED_ASSET_NOT_READY", "Uma midia da publicacao nao esta pronta.");
                const key = `feed-media/${env.FEED_NAMESPACE}/${releaseId}/${asset.id}/${asset.private_object_key.split("/").at(-1)}`;
                const variants = Array.isArray(asset.private_variants) ? asset.private_variants : [];
                const publicUrl = (objectKey) => `${env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
                let url = publicUrl(key);
                let srcSet;
                let mimeType = asset.mime_type;
                let byteSize = Number(asset.byte_size);
                if (variants.length) {
                    const publishedVariants = [];
                    for (const variant of variants) {
                        const variantKey = `${key}.w${variant.width}.webp`;
                        await client.send(new CopyObjectCommand({
                            Bucket: env.R2_BUCKET_NAME,
                            Key: variantKey,
                            CopySource: sourcePath(env.FEED_PRIVATE_BUCKET_NAME, variant.key),
                            ContentType: "image/webp",
                            CacheControl: "public, max-age=31536000, immutable",
                            MetadataDirective: "REPLACE",
                        }));
                        publishedVariants.push({ width: variant.width, url: publicUrl(variantKey) });
                    }
                    publishedVariants.sort((a, b) => a.width - b.width);
                    const largest = publishedVariants.at(-1);
                    if (largest) {
                        url = largest.url;
                        srcSet = publishedVariants.map((variant) => `${variant.url} ${variant.width}w`).join(", ");
                        mimeType = "image/webp";
                        byteSize = variants.find((variant) => variant.width === largest.width)?.byteSize ?? byteSize;
                    }
                }
                else {
                    await client.send(new CopyObjectCommand({
                        Bucket: env.R2_BUCKET_NAME,
                        Key: key,
                        CopySource: sourcePath(env.FEED_PRIVATE_BUCKET_NAME, asset.private_object_key),
                        ContentType: asset.mime_type,
                        CacheControl: "public, max-age=31536000, immutable",
                        MetadataDirective: "REPLACE",
                    }));
                }
                let posterUrl;
                if (asset.poster_object_key) {
                    const posterKey = `${key}.poster.webp`;
                    await client.send(new CopyObjectCommand({
                        Bucket: env.R2_BUCKET_NAME,
                        Key: posterKey,
                        CopySource: sourcePath(env.FEED_PRIVATE_BUCKET_NAME, asset.poster_object_key),
                        ContentType: "image/webp",
                        CacheControl: "public, max-age=31536000, immutable",
                        MetadataDirective: "REPLACE",
                    }));
                    posterUrl = `${env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${posterKey.split("/").map(encodeURIComponent).join("/")}`;
                }
                publicMedia.set(asset.id, { url, srcSet, posterUrl, mimeType, byteSize });
            }
            const publicPosts = posts.map((post) => ({
                id: post.post_id,
                slug: post.slug,
                revisionId: post.revision_id,
                revisionNumber: post.revision_number,
                title: post.title,
                excerpt: post.excerpt,
                cover: { ...publicMedia.get(String(post.cover_asset_id)), alt: post.cover_alt, focusX: Number(post.cover_focus_x), focusY: Number(post.cover_focus_y) },
                blocks: post.blocks,
                media: Object.fromEntries(extractEditorialAssetIds({
                    coverAssetId: post.cover_asset_id,
                    openingAssetId: post.opening_asset_id,
                    blocks: post.blocks,
                }).map((assetId) => [assetId, publicMedia.get(assetId)])),
                category: post.category_snapshot,
                seoTitle: post.seo_title,
                seoDescription: post.seo_description,
                eventDate: post.event_date ?? null,
                publicCredits: post.public_credits,
                opening: {
                    ...publicMedia.get(String(post.opening_asset_id ?? post.cover_asset_id)),
                    alt: post.opening_alt ?? post.cover_alt,
                    focusX: Number(post.opening_focus_x ?? post.cover_focus_x ?? 50),
                    focusY: Number(post.opening_focus_y ?? post.cover_focus_y ?? 50),
                },
                publishedAt: post.first_published_at,
                updatedAt: post.revision_created_at,
            }));
            const publicPostEntries = [];
            for (const post of publicPosts) {
                const postBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, namespace: env.FEED_NAMESPACE, releaseId, post }));
                const postKey = `feed/${env.FEED_NAMESPACE}/releases/${releaseId}/posts/${post.slug}.json`;
                await client.send(new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: postKey, Body: postBytes, ContentType: "application/json; charset=utf-8", CacheControl: "public, max-age=31536000, immutable" }));
                publicPostEntries.push({
                    id: post.id, slug: post.slug, title: post.title, excerpt: post.excerpt,
                    cover: post.cover, category: post.category, publishedAt: post.publishedAt,
                    eventDate: post.eventDate,
                    postKey, postSha256: sha256(postBytes),
                });
            }
            const manifest = { schemaVersion: 1, namespace: env.FEED_NAMESPACE, releaseId, generatedAt, posts: publicPostEntries };
            const manifestBytes = Buffer.from(JSON.stringify(manifest));
            const manifestKey = `feed/${env.FEED_NAMESPACE}/releases/${releaseId}/manifest.json`;
            await client.send(new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: manifestKey, Body: manifestBytes, ContentType: "application/json; charset=utf-8", CacheControl: "public, max-age=31536000, immutable" }));
            await db.query("UPDATE editorial_release SET manifest_key=$2, manifest_sha256=$3, updated_at=now() WHERE id=$1", [releaseId, manifestKey, sha256(manifestBytes)]);
            const candidateKey = `feed/${env.FEED_NAMESPACE}/candidate.json`;
            previousCandidate = await objectBuffer(client, env.R2_BUCKET_NAME, candidateKey);
            const candidate = { schemaVersion: 1, namespace: env.FEED_NAMESPACE, releaseId, manifestKey, manifestSha256: sha256(manifestBytes) };
            candidateWasReplaced = true;
            await client.send(new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: candidateKey, Body: JSON.stringify(candidate), ContentType: "application/json; charset=utf-8", CacheControl: "no-store, max-age=0" }));
            await db.query("UPDATE editorial_release SET status='building', manifest_key=$2, manifest_sha256=$3, updated_at=now() WHERE id=$1", [releaseId, manifestKey, candidate.manifestSha256]);
            hookMayHaveStarted = true;
            return await startEditorialDeploy(db, releaseId);
        }
        catch (error) {
            const hookRejected = error instanceof AppError && error.code === "FEED_DEPLOY_HOOK_REJECTED";
            if (hookRejected && !priorHookMayHaveStarted)
                hookMayHaveStarted = false;
            if (transactionOpen)
                await db.query("ROLLBACK").catch(() => undefined);
            if (candidateWasReplaced && !hookMayHaveStarted && env.R2_BUCKET_NAME) {
                const candidateKey = `feed/${env.FEED_NAMESPACE}/candidate.json`;
                try {
                    if (previousCandidate)
                        await client.send(new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: candidateKey, Body: previousCandidate, ContentType: "application/json", CacheControl: "no-store" }));
                    else
                        await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: candidateKey }));
                }
                catch {
                    recoveryUncertain = true;
                }
            }
            if (releaseId)
                await db.query("UPDATE editorial_release SET status=$2, error_code=$3, updated_at=now() WHERE id=$1", [releaseId, hookMayHaveStarted || recoveryUncertain ? "awaiting_confirmation" : "failed", hookMayHaveStarted ? "DEPLOY_HOOK_UNCERTAIN" : recoveryUncertain ? "CANDIDATE_RESTORE_UNCERTAIN" : hookRejected ? "DEPLOY_HOOK_REJECTED" : "RELEASE_FAILED"]).catch(() => undefined);
            throw error instanceof AppError ? error : new AppError(502, "FEED_RELEASE_FAILED", "Nao foi possivel iniciar a publicacao do Feed.", undefined, { cause: error });
        }
    });
}
async function confirmEditorialRelease(client, release) {
    const notLive = { id: release.id, status: release.status, live: false };
    // A rollback is reported by the marker but never silently rewrites DB pointers.
    if (release.status === "live")
        return { id: release.id, status: release.status, live: true };
    const newer = await client.query("SELECT id FROM editorial_release WHERE namespace=$1 AND sequence>$2 LIMIT 1", [release.namespace ?? env.FEED_NAMESPACE, release.sequence]);
    if (newer.rowCount)
        return notLive;
    const revisionRefs = release.revision_ids;
    if (!revisionRefs.length || revisionRefs.some((entry) => !entry.postId || !entry.revisionId))
        return notLive;
    try {
        await client.query("BEGIN");
        for (const entry of revisionRefs) {
            if (entry.operation === "retain")
                continue;
            if (entry.operation === "archive") {
                await client.query("UPDATE editorial_post SET status='archived', archived_at=now(), updated_at=now() WHERE id=$1", [entry.postId]);
                continue;
            }
            await client.query(`UPDATE editorial_post SET published_revision_id=$2, status='published',
            first_published_at=COALESCE(first_published_at, $3::timestamptz), updated_at=now()
           WHERE id=$1 AND EXISTS (SELECT 1 FROM editorial_revision WHERE id=$2 AND post_id=$1)`, [entry.postId, entry.revisionId, entry.publishedAt ?? release.created_at]);
        }
        await client.query("UPDATE editorial_release SET status='live', completed_at=now(), error_code=NULL, updated_at=now() WHERE id=$1", [release.id]);
        await client.query("COMMIT");
        return { id: release.id, status: "live", live: true };
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}
export async function checkEditorialRelease(id) {
    if (!env.FEED_SITE_BASE_URL || !env.FEED_NAMESPACE)
        throw new AppError(503, "FEED_PUBLICATION_NOT_CONFIGURED", "O site editorial nao esta configurado.");
    return withEditorialLock(`feed-release:${env.FEED_NAMESPACE}`, async (client) => {
        const result = await client.query("SELECT id, namespace, status, manifest_sha256, revision_ids, created_at, sequence FROM editorial_release WHERE id=$1 AND namespace=$2", [id, env.FEED_NAMESPACE]);
        if (!result.rowCount)
            throw new AppError(404, "FEED_RELEASE_NOT_FOUND", "Release nao encontrada.");
        const release = result.rows[0];
        const notLive = { id: release.id, status: release.status, live: false };
        if (!["building", "awaiting_confirmation", "live"].includes(release.status) || !release.manifest_sha256)
            return notLive;
        try {
            if (!matchesReleaseMarker(await readReleaseMarker(), release))
                return notLive;
        }
        catch {
            return notLive;
        }
        return confirmEditorialRelease(client, release);
    });
}
export async function retryEditorialRelease(id, adminUserId) {
    const result = await pool.query("SELECT revision_ids, idempotency_key FROM editorial_release WHERE id=$1 AND namespace=$2", [id, env.FEED_NAMESPACE]);
    if (!result.rowCount)
        throw new AppError(404, "FEED_RELEASE_NOT_FOUND", "Release nao encontrada.");
    const target = result.rows[0].revision_ids.find((ref) => ref.operation !== "retain");
    if (!target || target.operation === "retain")
        throw new AppError(409, "FEED_RELEASE_INVALID", "Release sem operacao editorial.");
    return requestEditorialRelease({ postId: target.postId, revisionId: target.revisionId, operation: target.operation ?? "publish", idempotencyKey: result.rows[0].idempotency_key, adminUserId, retry: true });
}
export async function getEditorialRelease(id) {
    const result = await pool.query("SELECT id, namespace, sequence, status, manifest_sha256, deploy_job_id, error_code, created_at, updated_at, completed_at FROM editorial_release WHERE id=$1 AND namespace=$2", [id, env.FEED_NAMESPACE]);
    if (!result.rowCount)
        throw new AppError(404, "FEED_RELEASE_NOT_FOUND", "Release nao encontrada.");
    return result.rows[0];
}
