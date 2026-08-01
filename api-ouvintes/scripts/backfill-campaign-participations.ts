import { pool } from "../src/database/client.js";

const apply = process.argv.includes("--apply");
const campaignArgument = process.argv.find((value) => value.startsWith("--campaign="));
const campaignId = campaignArgument?.slice("--campaign=".length) || null;

const missingQuery = `
  SELECT lr.id, lr.campaign_id, lr.name, lr.neighborhood, lr.city,
         lr.phone, lr.phone_normalized, lr.source, lr.marketing_opt_in
  FROM listener_registration lr
  WHERE lr.deleted_at IS NULL
    AND ($1::uuid IS NULL OR lr.campaign_id = $1)
    AND NOT EXISTS (
      SELECT 1
      FROM campaign_participation cp
      JOIN listener_profile lp ON lp.id = cp.listener_profile_id
      WHERE cp.campaign_id = lr.campaign_id
        AND (
          (lr.phone_normalized IS NOT NULL AND lp.phone_normalized = lr.phone_normalized)
          OR (
            lr.phone_normalized IS NULL
            AND lower(lp.name) = lower(lr.name)
            AND lower(lp.city) = lower(lr.city)
            AND lower(lp.neighborhood) = lower(lr.neighborhood)
          )
        )
    )
  ORDER BY lr.campaign_id, lr.created_at, lr.id
`;

const client = await pool.connect();
try {
  const missing = await client.query<{
    id: string;
    campaign_id: string;
    name: string;
    neighborhood: string;
    city: string;
    phone: string | null;
    phone_normalized: string | null;
    source: string;
    marketing_opt_in: boolean;
  }>(missingQuery, [campaignId]);

  const byCampaign = Object.entries(
    missing.rows.reduce<Record<string, number>>((totals, row) => {
      totals[row.campaign_id] = (totals[row.campaign_id] ?? 0) + 1;
      return totals;
    }, {}),
  ).map(([campaign, total]) => ({ campaignId: campaign, pending: total }));

  console.log("Backfill de participacoes", {
    mode: apply ? "apply" : "dry-run",
    pending: missing.rowCount,
    campaigns: byCampaign,
  });

  if (!apply || missing.rows.length === 0) process.exitCode = 0;
  else {
    await client.query("BEGIN");
    let linked = 0;

    for (const row of missing.rows) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM listener_profile
         WHERE deleted_at IS NULL
           AND (
             ($1::text IS NOT NULL AND phone_normalized = $1)
             OR ($1::text IS NULL AND lower(name) = lower($2)
               AND lower(city) = lower($3) AND lower(neighborhood) = lower($4))
           )
         ORDER BY created_at
         LIMIT 1`,
        [row.phone_normalized, row.name, row.city, row.neighborhood],
      );

      let profileId = existing.rows[0]?.id;
      if (!profileId) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO listener_profile
             (name, neighborhood, city, phone, phone_normalized, status, marketing_opt_in)
           VALUES ($1, $2, $3, $4, $5, 'active', $6)
           RETURNING id`,
          [
            row.name,
            row.neighborhood,
            row.city,
            row.phone,
            row.phone_normalized,
            row.marketing_opt_in,
          ],
        );
        profileId = inserted.rows[0]!.id;
      }

      const participation = await client.query(
        `INSERT INTO campaign_participation
           (campaign_id, listener_profile_id, source, status)
         VALUES ($1, $2, 'import', 'eligible')
         ON CONFLICT (campaign_id, listener_profile_id) DO NOTHING
         RETURNING id`,
        [row.campaign_id, profileId],
      );
      linked += participation.rowCount ?? 0;
    }

    await client.query("COMMIT");
    console.log("Backfill concluido", { linked, pendingBefore: missing.rowCount });
  }
} catch (error) {
  if (apply) await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
