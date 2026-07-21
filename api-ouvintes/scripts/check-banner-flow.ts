import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import { pool } from "../src/database/client.js";
import { R2MediaStorage } from "../src/services/media-storage/r2-media-storage.js";

const app = await buildApp();
const storage = new R2MediaStorage();
let assetId: string | undefined;
let bannerId: string | undefined;
let objectKey: string | undefined;

try {
  const admin = await pool.query<{
    id: string;
    name: string;
    username: string;
  }>(
    `SELECT DISTINCT au.id, au.name, au.username
     FROM admin_user au
     JOIN admin_user_role aur ON aur.admin_user_id = au.id
     JOIN role_permission rp ON rp.role_id = aur.role_id
     JOIN permission p ON p.id = rp.permission_id
     WHERE au.active = true
       AND p.key IN ('institutional_banner.manage', 'media.upload')
     GROUP BY au.id, au.name, au.username
     HAVING count(DISTINCT p.key) = 2
     LIMIT 1`,
  );
  const user = admin.rows[0];
  if (!user) {
    throw new Error("Nenhum administrador com permissoes de banner e upload foi encontrado.");
  }

  const accessToken = app.jwt.sign({
    sub: user.id,
    role: "admin",
    name: user.name,
    username: user.username,
  });

  const before = await pool.query<{ max: number | null }>(
    `SELECT max(display_order)::int AS max
     FROM institutional_banner
     WHERE placement_key = 'home_hero' AND deleted_at IS NULL`,
  );
  const expectedOrder = (before.rows[0]?.max ?? 0) + 1;

  const image = await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 4,
      background: { r: 19, g: 96, b: 232, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const boundary = "radio88-qa-" + randomUUID();
  const multipart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="banner-qa.png"\r\n' +
        "Content-Type: image/png\r\n\r\n",
    ),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const upload = await app.inject({
    method: "POST",
    url: "/api/admin/institutional-banners/assets",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: multipart,
  });
  if (upload.statusCode !== 201) {
    throw new Error(
      `Upload retornou ${upload.statusCode}: ${upload.body.slice(0, 500)}`,
    );
  }

  const asset = upload.json<{
    id: string;
    objectKey: string;
    imageUrl: string;
    mimeType: string;
  }>();
  assetId = asset.id;
  objectKey = asset.objectKey;
  if (asset.mimeType !== "image/webp") {
    throw new Error("O asset criado nao foi normalizado para WebP.");
  }

  const create = await app.inject({
    method: "POST",
    url: "/api/admin/institutional-banners",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    payload: {
      title: "Banner QA " + randomUUID(),
      altText: "Banner temporario do teste ponta a ponta",
      placementKey: "home_hero",
      mediaAssetId: asset.id,
      destinationUrl: null,
      openInNewTab: false,
      active: false,
    },
  });
  if (create.statusCode !== 201) {
    throw new Error(
      `Criacao retornou ${create.statusCode}: ${create.body.slice(0, 500)}`,
    );
  }

  const banner = create.json<{ id: string; displayOrder: number }>();
  bannerId = banner.id;
  if (banner.displayOrder !== expectedOrder) {
    throw new Error(
      `Ordem esperada ${expectedOrder}, recebida ${banner.displayOrder}.`,
    );
  }

  console.log("Banner flow check completed", {
    uploadStatus: upload.statusCode,
    createStatus: create.statusCode,
    mimeType: asset.mimeType,
    displayOrder: banner.displayOrder,
  });
} finally {
  if (bannerId) {
    await pool.query("DELETE FROM institutional_banner WHERE id = $1", [bannerId]);
  }
  if (assetId) {
    await pool.query("DELETE FROM media_asset WHERE id = $1", [assetId]);
  }
  if (objectKey) {
    await storage.delete(objectKey);
  }
  await app.close();
  await pool.end();
}
