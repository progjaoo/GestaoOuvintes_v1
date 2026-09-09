import { createHmac } from "node:crypto";
import { pool } from "../src/database/client.js";
import { env } from "../src/config/env.js";

const apply = process.argv.includes("--apply");
const campaignArgument = process.argv.find((value) => value.startsWith("--campaign="));
const campaignId = campaignArgument?.slice("--campaign=".length) || null;

const missingQuery = `
  SELECT lr.id, lr.tenant_id, lr.campaign_id, lr.name, lr.neighborhood, lr.city,
         lr.phone, lr.phone_normalized, lr.source, lr.marketing_opt_in
  FROM listener_registration lr
  WHERE lr.deleted_at IS NULL
    AND ($1::uuid IS NULL OR lr.campaign_id = $1)
    AND NOT EXISTS (
      SELECT 1
      FROM campaign_participation cp
      JOIN listener_profile lp ON lp.id = cp.listener_profile_id
      WHERE cp.tenant_id = lr.tenant_id
        AND cp.campaign_id = lr.campaign_id
        AND lp.tenant_id = lr.tenant_id
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

const profileHashQuery = `
  SELECT id, phone_normalized
  FROM listener_profile
  WHERE deleted_at IS NULL
    AND phone_normalized IS NOT NULL
    AND phone_hash IS NULL
`;

const client = await pool.connect();
try {
  const missing = await client.query<{
    id: string;
    tenant_id: string;
    campaign_id: string;
    name: string;
    neighborhood: string;
    city: string;
    phone: string | null;
    phone_normalized: string | null;
    source: string;
    marketing_opt_in: boolean;
  }>(missingQuery, [campaignId]);
  const profilesMissingPhoneHash = await client.query<{
    id: string;
    phone_normalized: string;
  }>(profileHashQuery);

  const byCampaign = Object.entries(
    missing.rows.reduce<Record<string, number>>((totals, row) => {
      totals[row.campaign_id] = (totals[row.campaign_id] ?? 0) + 1;
      return totals;
    }, {}),
  ).map(([campaign, total]) => ({ campaignId: campaign, pending: total }));

  console.log("Backfill de participacoes", {
    mode: apply ? "apply" : "dry-run",
    pending: missing.rowCount,
    phoneHashesPending: profilesMissingPhoneHash.rowCount,
    campaigns: byCampaign,
  });

  if (!apply) process.exitCode = 0;
  else {
    await client.query("BEGIN");
    let linked = 0;
    let phoneHashes = 0;

    for (const profile of profilesMissingPhoneHash.rows) {
      await client.query(
        `UPDATE listener_profile
            SET phone_hash = $1
          WHERE id = $2
            AND deleted_at IS NULL
            AND phone_hash IS NULL`,
        [
          createHmac("sha256", env.PHONE_HASH_SECRET)
            .update(profile.phone_normalized)
            .digest("hex"),
          profile.id,
        ],
      );
      phoneHashes += 1;
    }

    for (const row of missing.rows) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM listener_profile
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND (
             ($2::text IS NOT NULL AND phone_normalized = $2)
             OR ($2::text IS NULL AND lower(name) = lower($3)
               AND lower(city) = lower($4) AND lower(neighborhood) = lower($5))
           )
         ORDER BY created_at
         LIMIT 1`,
        [row.tenant_id, row.phone_normalized, row.name, row.city, row.neighborhood],
      );

      let profileId = existing.rows[0]?.id;
      if (!profileId) {
        const identity = await client.query<{ id: string }>(
          `INSERT INTO listener_identity
             (tenant_id, provider, provider_subject, status)
           VALUES ($1, 'anonymous', $2, 'unclaimed')
           RETURNING id`,
          [row.tenant_id, `backfill-registration:${row.id}`],
        );
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO listener_profile
             (tenant_id, listener_identity_id, name, neighborhood, city,
              phone, phone_normalized, phone_hash, status, marketing_opt_in)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
           RETURNING id`,
          [
            row.tenant_id,
            identity.rows[0]!.id,
            row.name,
            row.neighborhood,
            row.city,
            row.phone,
            row.phone_normalized,
            row.phone_normalized
              ? createHmac("sha256", env.PHONE_HASH_SECRET)
                  .update(row.phone_normalized)
                  .digest("hex")
              : null,
            row.marketing_opt_in,
          ],
        );
        profileId = inserted.rows[0]!.id;
      } else if (row.phone_normalized) {
        await client.query(
          `UPDATE listener_profile
              SET phone_hash = COALESCE(phone_hash, $1)
            WHERE tenant_id = $2 AND id = $3`,
          [
            createHmac("sha256", env.PHONE_HASH_SECRET)
              .update(row.phone_normalized)
              .digest("hex"),
            row.tenant_id,
            profileId,
          ],
        );
      }

      const participation = await client.query(
        `INSERT INTO campaign_participation
           (tenant_id, campaign_id, listener_profile_id, source, status)
         VALUES ($1, $2, $3, 'import', 'eligible')
         ON CONFLICT (tenant_id, campaign_id, listener_profile_id) DO NOTHING
         RETURNING id`,
        [row.tenant_id, row.campaign_id, profileId],
      );
      linked += participation.rowCount ?? 0;

      await client.query(
        `INSERT INTO listener_communication_preference
           (tenant_id, listener_profile_id)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id, listener_profile_id) DO NOTHING`,
        [row.tenant_id, profileId],
      );
    }

    await client.query("COMMIT");
    console.log("Backfill concluido", {
      linked,
      phoneHashes,
      pendingBefore: missing.rowCount,
    });
  }
} catch (error) {
  if (apply) await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
