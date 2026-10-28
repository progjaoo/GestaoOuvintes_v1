import { randomUUID } from "node:crypto";
import { pool } from "../../database/client.js";
import { AppError } from "../../lib/errors.js";
import { extractEditorialAssetIds } from "../../schemas/editorial.js";
import { env } from "../../config/env.js";
import { withEditorialLock } from "./operation-lock.js";
import { assertEditorialAssetUsage } from "./asset-validation.js";
function toPost(row) {
    const normalizeRevision = (value) => {
        if (!value || typeof value !== "object")
            return null;
        const revision = value;
        return {
            id: revision.id,
            revisionNumber: revision.revisionNumber ?? revision.revision_number,
            schemaVersion: revision.schemaVersion ?? revision.schema_version,
            title: revision.title,
            excerpt: revision.excerpt,
            coverAssetId: revision.coverAssetId ?? revision.cover_asset_id,
            coverAlt: revision.coverAlt ?? revision.cover_alt,
            coverFocusX: Number(revision.coverFocusX ?? revision.cover_focus_x ?? 50),
            coverFocusY: Number(revision.coverFocusY ?? revision.cover_focus_y ?? 50),
            openingAssetId: revision.openingAssetId ?? revision.opening_asset_id ?? revision.coverAssetId ?? revision.cover_asset_id,
            openingAlt: revision.openingAlt ?? revision.opening_alt ?? revision.coverAlt ?? revision.cover_alt,
            openingFocusX: Number(revision.openingFocusX ?? revision.opening_focus_x ?? revision.coverFocusX ?? revision.cover_focus_x ?? 50),
            openingFocusY: Number(revision.openingFocusY ?? revision.opening_focus_y ?? revision.coverFocusY ?? revision.cover_focus_y ?? 50),
            blocks: revision.blocks ?? [],
            categorySnapshot: revision.categorySnapshot ?? revision.category_snapshot,
            seoTitle: revision.seoTitle ?? revision.seo_title,
            seoDescription: revision.seoDescription ?? revision.seo_description,
            eventDate: revision.eventDate ?? revision.event_date ?? null,
            publicCredits: revision.publicCredits ?? revision.public_credits ?? "",
            createdAt: revision.createdAt ?? revision.created_at,
        };
    };
    return {
        id: row.id,
        slug: row.slug,
        status: row.status,
        category: row.category_snapshot ?? null,
        draftRevision: normalizeRevision(row.draft_revision),
        publishedRevision: normalizeRevision(row.published_revision),
        firstPublishedAt: row.first_published_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedAt: row.archived_at,
    };
}
const revisionSelect = `
  r.id, r.revision_number, r.schema_version, r.title, r.excerpt, r.cover_asset_id,
  r.cover_alt, r.cover_focus_x, r.cover_focus_y, r.opening_asset_id, r.opening_alt,
  r.opening_focus_x, r.opening_focus_y, r.blocks, r.category_snapshot,
  r.seo_title, r.seo_description, r.event_date, r.public_credits, r.created_at`;
export async function listEditorialCategories() {
    const result = await pool.query(`SELECT id, name, slug, active, created_at, updated_at
     FROM editorial_category ORDER BY name ASC, id ASC`);
    return result.rows;
}
export async function createEditorialCategory(input) {
    const result = await pool.query(`INSERT INTO editorial_category (name, slug) VALUES ($1, $2)
     RETURNING id, name, slug, active, created_at, updated_at`, [input.name, input.slug]);
    return result.rows[0];
}
export async function updateEditorialCategory(id, input) {
    const result = await pool.query(`UPDATE editorial_category SET
       name = COALESCE($2, name), slug = COALESCE($3, slug),
       active = COALESCE($4, active), updated_at = now()
     WHERE id = $1 RETURNING id, name, slug, active, created_at, updated_at`, [id, input.name ?? null, input.slug ?? null, input.active ?? null]);
    if (!result.rowCount)
        throw new AppError(404, "FEED_CATEGORY_NOT_FOUND", "Categoria nao encontrada.");
    return result.rows[0];
}
export async function listEditorialPosts(input) {
    const offset = (input.page - 1) * input.pageSize;
    const values = [];
    const filters = [];
    if (input.status !== "all") {
        values.push(input.status);
        filters.push(`p.status = $${values.length}`);
    }
    if (input.categoryId) {
        values.push(input.categoryId);
        filters.push(`p.category_id = $${values.length}`);
    }
    if (input.q) {
        values.push(`%${input.q}%`);
        filters.push(`(dr.title ILIKE $${values.length} OR p.slug ILIKE $${values.length})`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const count = await pool.query(`SELECT count(*)::int AS total FROM editorial_post p
     LEFT JOIN editorial_revision dr ON dr.id = p.draft_revision_id ${where}`, values);
    values.push(input.pageSize, offset);
    const rows = await pool.query(`SELECT p.id, p.slug, p.status, p.first_published_at, p.created_at, p.updated_at, p.archived_at,
       jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS category_snapshot,
       CASE WHEN dr.id IS NULL THEN NULL ELSE jsonb_build_object(
         'id', dr.id, 'revisionNumber', dr.revision_number, 'title', dr.title, 'excerpt', dr.excerpt,
         'coverAssetId', dr.cover_asset_id, 'updatedAt', dr.created_at
       ) END AS draft_revision,
       CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
         'id', pr.id, 'revisionNumber', pr.revision_number, 'title', pr.title, 'excerpt', pr.excerpt,
         'coverAssetId', pr.cover_asset_id, 'publishedAt', p.first_published_at
       ) END AS published_revision
     FROM editorial_post p
     JOIN editorial_category c ON c.id = p.category_id
     LEFT JOIN editorial_revision dr ON dr.id = p.draft_revision_id
     LEFT JOIN editorial_revision pr ON pr.id = p.published_revision_id
     ${where} ORDER BY p.updated_at DESC, p.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { items: rows.rows.map(toPost), page: input.page, pageSize: input.pageSize, total: count.rows[0]?.total ?? 0 };
}
export async function getEditorialPost(id) {
    const result = await pool.query(`SELECT p.id, p.slug, p.status, p.first_published_at, p.created_at, p.updated_at, p.archived_at,
       jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS category_snapshot,
       CASE WHEN dr.id IS NULL THEN NULL ELSE to_jsonb(dr) END AS draft_revision,
       CASE WHEN pr.id IS NULL THEN NULL ELSE to_jsonb(pr) END AS published_revision
     FROM editorial_post p JOIN editorial_category c ON c.id = p.category_id
     LEFT JOIN editorial_revision dr ON dr.id = p.draft_revision_id
     LEFT JOIN editorial_revision pr ON pr.id = p.published_revision_id
     WHERE p.id = $1`, [id]);
    if (!result.rowCount)
        throw new AppError(404, "FEED_POST_NOT_FOUND", "Publicacao nao encontrada.");
    return toPost(result.rows[0]);
}
async function assertReadyAssets(client, revision) {
    const ids = extractEditorialAssetIds(revision);
    const result = await client.query(`SELECT id, media_type, private_object_key, status FROM editorial_media_asset WHERE id = ANY($1::uuid[]) AND status = 'ready'`, [ids]);
    if (result.rowCount !== ids.length) {
        throw new AppError(422, "FEED_MEDIA_NOT_READY", "Uma ou mais midias ainda nao foram validadas.");
    }
    assertEditorialAssetUsage(revision, new Map(result.rows.map((asset) => [asset.id, asset])));
}
export async function saveEditorialDraft(input) {
    if (input.id && input.expectedVersion === undefined)
        throw new AppError(400, "EXPECTED_VERSION_REQUIRED", "Informe a versao atual antes de salvar.");
    return withEditorialLock(`feed-release:${env.FEED_NAMESPACE}`, async (client) => {
        try {
            await client.query("BEGIN");
            const category = await client.query("SELECT id, name, slug FROM editorial_category WHERE id = $1 AND active = true FOR SHARE", [input.revision.categoryId]);
            if (!category.rowCount)
                throw new AppError(422, "FEED_CATEGORY_INACTIVE", "Selecione uma categoria ativa.");
            await assertReadyAssets(client, input.revision);
            let postId = input.id;
            if (postId) {
                const current = await client.query(`SELECT p.draft_revision_id, r.revision_number, p.status, p.first_published_at, p.slug
           FROM editorial_post p LEFT JOIN editorial_revision r ON r.id = p.draft_revision_id
           WHERE p.id = $1 FOR UPDATE OF p`, [postId]);
                if (!current.rowCount)
                    throw new AppError(404, "FEED_POST_NOT_FOUND", "Publicacao nao encontrada.");
                const version = current.rows[0].revision_number ?? 0;
                if (input.expectedVersion !== undefined && version !== input.expectedVersion) {
                    throw new AppError(409, "FEED_REVISION_CONFLICT", "Esta publicacao mudou em outra sessao. Recarregue antes de salvar.");
                }
                if (current.rows[0].status === "archived")
                    throw new AppError(409, "FEED_POST_ARCHIVED", "Publicacao arquivada nao pode ser editada.");
                if (current.rows[0].first_published_at && current.rows[0].slug !== input.revision.slug) {
                    throw new AppError(409, "FEED_PUBLISHED_SLUG_IMMUTABLE", "O slug nao pode ser alterado apos a primeira publicacao.");
                }
                if (!current.rows[0].first_published_at && current.rows[0].slug !== input.revision.slug) {
                    const pending = await client.query(`SELECT id FROM editorial_release WHERE namespace=$1 AND status IN ('preparing','building','awaiting_confirmation')
             AND revision_ids @> $2::jsonb LIMIT 1`, [env.FEED_NAMESPACE, JSON.stringify([{ postId }])]);
                    if (pending.rowCount)
                        throw new AppError(409, "FEED_PENDING_SLUG_IMMUTABLE", "O slug nao pode mudar durante a publicacao.");
                }
            }
            else {
                const post = await client.query(`INSERT INTO editorial_post (slug, category_id, created_by_admin_user_id, updated_by_admin_user_id)
           VALUES ($1, $2, $3, $3) RETURNING id`, [input.revision.slug, input.revision.categoryId, input.adminUserId]);
                postId = post.rows[0].id;
            }
            const previous = await client.query("SELECT COALESCE(max(revision_number), 0)::int AS version FROM editorial_revision WHERE post_id = $1", [postId]);
            const revisionNumber = Number(previous.rows[0].version) + 1;
            const openingAssetId = input.revision.openingAssetId ?? input.revision.coverAssetId;
            const openingAlt = input.revision.openingAlt ?? input.revision.coverAlt;
            const inserted = await client.query(`INSERT INTO editorial_revision (
          post_id, revision_number, title, excerpt, cover_asset_id, cover_alt, cover_focus_x,
          cover_focus_y, opening_asset_id, opening_alt, opening_focus_x, opening_focus_y,
          blocks, category_snapshot, seo_title, seo_description, event_date,
          public_credits, created_by_admin_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19)
        RETURNING id`, [postId, revisionNumber, input.revision.title, input.revision.excerpt, input.revision.coverAssetId,
                input.revision.coverAlt, input.revision.coverFocusX, input.revision.coverFocusY,
                openingAssetId, openingAlt, input.revision.openingFocusX ?? 50, input.revision.openingFocusY ?? 50,
                JSON.stringify(input.revision.blocks), JSON.stringify({ id: category.rows[0].id, name: category.rows[0].name, slug: category.rows[0].slug }),
                input.revision.seoTitle, input.revision.seoDescription, input.revision.eventDate,
                input.revision.publicCredits || null, input.adminUserId]);
            const revisionId = inserted.rows[0].id;
            const assets = extractEditorialAssetIds(input.revision);
            for (const assetId of assets) {
                await client.query("INSERT INTO editorial_revision_asset (revision_id, asset_id) VALUES ($1,$2)", [revisionId, assetId]);
            }
            await client.query(`UPDATE editorial_post SET slug = $2, category_id = $3, draft_revision_id = $4,
         updated_by_admin_user_id = $5, updated_at = now() WHERE id = $1`, [postId, input.revision.slug, input.revision.categoryId, revisionId, input.adminUserId]);
            await client.query("COMMIT");
            return { id: postId, revisionId, revisionNumber };
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
    });
}
export function newEditorialPostId() { return randomUUID(); }
