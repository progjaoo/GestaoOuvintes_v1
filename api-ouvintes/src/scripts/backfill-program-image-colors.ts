import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { pool } from '../database/client.js';
import { programImageEdgeColor } from '../services/program-image-color.js';
import { programmingNamespace } from '../services/programming-public-snapshot.js';
import { enqueueProgramming } from '../services/programming-publication-service.js';

const apply = process.argv.includes('--apply');
const actor = process.argv.find(arg => arg.startsWith('--actor='))?.slice(8);
async function main() {
  if (apply && (!actor || !/^[0-9a-f-]{36}$/i.test(actor))) throw new Error('Use --actor=<admin UUID> with --apply.');
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw new Error('R2 not configured.');
  const client = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
  const namespace = programmingNamespace();
  const rows = (await pool.query(`SELECT DISTINCT m.id,m.object_key FROM media_asset m JOIN radio_program p ON p.image_asset_id=m.id
    WHERE p.radio_key='radio-88' AND m.status='ready' AND m.program_edge_color IS NULL AND starts_with(m.object_key,$1)`, [`programs/${namespace}/`])).rows;
  const colors: { id: string; key: string; color: string }[] = [];
  for (const row of rows) {
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: row.object_key }), { abortSignal: AbortSignal.timeout(8000) });
      if (!object.Body || !object.ContentLength || object.ContentLength > 10 * 1024 * 1024) throw new Error('Image size unavailable or above limit.');
      const bytes = Buffer.from(await object.Body.transformToByteArray());
      if (bytes.length > 10 * 1024 * 1024) throw new Error('Image above limit.');
      const color = await programImageEdgeColor(bytes);
      if (color) colors.push({ id: row.id, key: row.object_key, color });
    } catch { console.warn('Unable to sample program image', row.id); }
  }
  if (!apply) { console.info(JSON.stringify({ mode: 'dry-run', namespace, found: rows.length, sampled: colors.length, colors: colors.map(item => ({ id: item.id, color: item.color })) })); return; }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(881188,12)');
    if (!(await c.query('SELECT id FROM admin_user WHERE id=$1 AND active', [actor])).rowCount) throw new Error('Active actor required.');
    let updated = 0;
    for (const item of colors) updated += (await c.query(`UPDATE media_asset m SET program_edge_color=$2 WHERE id=$1 AND object_key=$3 AND program_edge_color IS NULL AND status='ready'
      AND EXISTS(SELECT 1 FROM radio_program p WHERE p.image_asset_id=m.id AND p.radio_key='radio-88')`, [item.id, item.color, item.key])).rowCount ?? 0;
    if (updated) {
      await c.query(`INSERT INTO admin_audit_log(admin_user_id,action,resource_type,metadata) VALUES($1,'program.image.colors.backfilled','media_asset',$2::jsonb)`, [actor, JSON.stringify({ count: updated, namespace })]);
      await enqueueProgramming(c);
    }
    await c.query('COMMIT');
    console.info(JSON.stringify({ mode: 'applied', namespace, updated, publication: 'Publish the grade through the authorized admin flow.' }));
  } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
