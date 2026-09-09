import { createHash, randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../database/client.js";
import { AppError } from "../lib/errors.js";
import { DEFAULT_TENANT_ID } from "./tenant-service.js";

const DRAW_ALGORITHM = "node_crypto_random_int_v1";
const REDRAW_REASON = "manual_redraw_from_result_modal";

export interface SweepstakeCandidate {
  participationId: string;
  name: string;
  city: string;
  neighborhood: string;
  phone: string | null;
}

export interface SweepstakeDrawResponse {
  drawId: string;
  campaignId: string;
  sequence: number;
  eligibleCount: number;
  drawnAt: string;
  animationNames: string[];
  winner: SweepstakeCandidate;
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  type: string;
}

interface DrawRow {
  id: string;
  tenant_id: string;
  campaign_id: string;
  sequence: number;
  eligible_count: number;
  winner_participation_id: string;
  root_draw_id: string | null;
  previous_draw_id: string | null;
  created_at: Date;
}

interface DrawResult {
  replayed: boolean;
  draw: SweepstakeDrawResponse;
}

type RandomIndex = (maxExclusive: number) => number;

export function buildEntriesHash(participationIds: string[]): string {
  return createHash("sha256")
    .update([...participationIds].sort().join("\n"))
    .digest("hex");
}

export function selectWinner(
  candidates: SweepstakeCandidate[],
  randomIndex: RandomIndex = randomInt,
): SweepstakeCandidate {
  if (candidates.length === 0) {
    throw new Error("NO_ELIGIBLE_PARTICIPANTS");
  }

  return candidates[randomIndex(candidates.length)]!;
}

export function buildAnimationNames(
  candidates: SweepstakeCandidate[],
  winner: SweepstakeCandidate,
  limit = 30,
  randomIndex: RandomIndex = randomInt,
): string[] {
  const safeLimit = Math.max(1, Math.min(limit, candidates.length));
  const others = candidates.filter(
    (candidate) => candidate.participationId !== winner.participationId,
  );

  for (let index = others.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1);
    [others[index], others[target]] = [others[target]!, others[index]!];
  }

  return [
    ...others.slice(0, Math.max(0, safeLimit - 1)).map((candidate) => candidate.name),
    winner.name,
  ];
}

function campaignNotFound(): AppError {
  return new AppError(404, "CAMPAIGN_NOT_FOUND", "Campanha nao encontrada.");
}

function assertCampaignCanDraw(campaign: CampaignRow): void {
  if (campaign.type !== "sweepstake") {
    throw new AppError(
      409,
      "CAMPAIGN_NOT_SWEEPSTAKE",
      "A campanha selecionada nao e do tipo sorteio.",
    );
  }
  if (campaign.status !== "closed") {
    throw new AppError(
      409,
      "CAMPAIGN_NOT_CLOSED",
      "Encerre a campanha antes de realizar o sorteio.",
    );
  }
}

async function getCampaign(
  client: Pick<PoolClient, "query">,
  campaignId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<CampaignRow> {
  const result = await client.query<CampaignRow>(
    "SELECT id, name, status, type FROM campaign WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL",
    [campaignId, tenantId],
  );
  const campaign = result.rows[0];
  if (!campaign) throw campaignNotFound();
  return campaign;
}

async function countLegacyUnlinked(
  client: Pick<PoolClient, "query">,
  campaignId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<number> {
  const result = await client.query<{ total: string }>(
    "SELECT count(*)::text AS total " +
      "FROM listener_registration lr " +
      "WHERE lr.tenant_id = $2 AND lr.campaign_id = $1 AND lr.deleted_at IS NULL " +
      "AND NOT EXISTS (" +
      "  SELECT 1 FROM campaign_participation cp " +
      "  JOIN listener_profile lp ON lp.id = cp.listener_profile_id " +
      "  WHERE cp.tenant_id = $2 AND cp.campaign_id = lr.campaign_id " +
      "  AND (" +
      "    (lr.phone_normalized IS NOT NULL AND lp.phone_normalized = lr.phone_normalized) " +
      "    OR (lr.phone_normalized IS NULL " +
      "      AND lower(lp.name) = lower(lr.name) " +
      "      AND lower(lp.city) = lower(lr.city) " +
      "      AND lower(lp.neighborhood) = lower(lr.neighborhood))" +
      "  )" +
      ")",
    [campaignId, tenantId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function listCurrentCandidates(
  client: Pick<PoolClient, "query">,
  campaignId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<SweepstakeCandidate[]> {
  const result = await client.query<{
    participation_id: string;
    name: string;
    city: string;
    neighborhood: string;
    phone: string | null;
  }>(
    "SELECT cp.id AS participation_id, lp.name, lp.city, lp.neighborhood, lp.phone " +
      "FROM campaign_participation cp " +
      "JOIN listener_profile lp ON lp.id = cp.listener_profile_id " +
      "WHERE cp.tenant_id = $2 AND cp.campaign_id = $1 " +
      "AND lp.tenant_id = $2 AND cp.status IN ('eligible', 'entered') " +
      "AND lp.status = 'active' AND lp.deleted_at IS NULL " +
      "ORDER BY cp.id",
    [campaignId, tenantId],
  );
  return result.rows.map((row) => ({
    participationId: row.participation_id,
    name: row.name,
    city: row.city,
    neighborhood: row.neighborhood,
    phone: row.phone,
  }));
}

async function listRedrawCandidates(
  client: Pick<PoolClient, "query">,
  campaignId: string,
  rootDrawId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<SweepstakeCandidate[]> {
  const result = await client.query<{
    participation_id: string;
    name: string;
    city: string;
    neighborhood: string;
    phone: string | null;
  }>(
    "SELECT cp.id AS participation_id, lp.name, lp.city, lp.neighborhood, lp.phone " +
      "FROM sweepstake_draw_entry sde " +
      "JOIN campaign_participation cp ON cp.id = sde.participation_id " +
      "JOIN listener_profile lp ON lp.id = cp.listener_profile_id " +
      "WHERE sde.tenant_id = $3 AND sde.draw_id = $2 AND cp.tenant_id = $3 AND cp.campaign_id = $1 " +
      "AND cp.status IN ('eligible', 'entered') " +
      "AND lp.status = 'active' AND lp.deleted_at IS NULL " +
      "AND NOT EXISTS (" +
      "  SELECT 1 FROM sweepstake_draw sd " +
      "  WHERE sd.tenant_id = $3 AND sd.campaign_id = $1 " +
      "  AND sd.status IN ('selected', 'superseded') " +
      "  AND sd.winner_participation_id = cp.id" +
      ") ORDER BY cp.id",
    [campaignId, rootDrawId, tenantId],
  );
  return result.rows.map((row) => ({
    participationId: row.participation_id,
    name: row.name,
    city: row.city,
    neighborhood: row.neighborhood,
    phone: row.phone,
  }));
}

async function insertEntries(
  client: Pick<PoolClient, "query">,
  drawId: string,
  candidates: SweepstakeCandidate[],
  tenantId = DEFAULT_TENANT_ID,
): Promise<void> {
  const entries = candidates.map((candidate, ordinal) => ({
    participation_id: candidate.participationId,
    ordinal,
  }));
  await client.query(
    "INSERT INTO sweepstake_draw_entry (tenant_id, draw_id, participation_id, ordinal) " +
      "SELECT $1, $2, item.participation_id::uuid, item.ordinal " +
      "FROM jsonb_to_recordset($3::jsonb) AS item(participation_id text, ordinal integer)",
    [tenantId, drawId, JSON.stringify(entries)],
  );
}

async function getDrawCandidates(
  client: Pick<PoolClient, "query">,
  drawId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<SweepstakeCandidate[]> {
  const result = await client.query<{
    participation_id: string;
    name: string;
    city: string;
    neighborhood: string;
    phone: string | null;
  }>(
    "SELECT cp.id AS participation_id, lp.name, lp.city, lp.neighborhood, lp.phone " +
      "FROM sweepstake_draw_entry sde " +
      "JOIN campaign_participation cp ON cp.id = sde.participation_id " +
      "JOIN listener_profile lp ON lp.id = cp.listener_profile_id " +
      "WHERE sde.tenant_id = $2 AND sde.draw_id = $1 AND cp.tenant_id = $2 AND lp.tenant_id = $2 ORDER BY sde.ordinal",
    [drawId, tenantId],
  );
  return result.rows.map((row) => ({
    participationId: row.participation_id,
    name: row.name,
    city: row.city,
    neighborhood: row.neighborhood,
    phone: row.phone,
  }));
}

async function getWinner(
  client: Pick<PoolClient, "query">,
  participationId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<SweepstakeCandidate> {
  const result = await client.query<{
    participation_id: string;
    name: string;
    city: string;
    neighborhood: string;
    phone: string | null;
  }>(
    "SELECT cp.id AS participation_id, lp.name, lp.city, lp.neighborhood, lp.phone " +
      "FROM campaign_participation cp " +
      "JOIN listener_profile lp ON lp.id = cp.listener_profile_id " +
      "WHERE cp.id = $1 AND cp.tenant_id = $2 AND lp.tenant_id = $2",
    [participationId, tenantId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(500, "DRAW_WINNER_NOT_FOUND", "Vencedor do sorteio nao encontrado.");
  }
  return {
    participationId: row.participation_id,
    name: row.name,
    city: row.city,
    neighborhood: row.neighborhood,
    phone: row.phone,
  };
}

async function hydrateDraw(
  client: Pick<PoolClient, "query">,
  draw: DrawRow,
  tenantId = DEFAULT_TENANT_ID,
): Promise<SweepstakeDrawResponse> {
  const winner = await getWinner(client, draw.winner_participation_id, tenantId);
  const candidates = await getDrawCandidates(client, draw.id, tenantId);
  return {
    drawId: draw.id,
    campaignId: draw.campaign_id,
    sequence: draw.sequence,
    eligibleCount: draw.eligible_count,
    drawnAt: draw.created_at.toISOString(),
    animationNames: buildAnimationNames(candidates, winner),
    winner,
  };
}

async function findDrawByRequestToken(
  client: Pick<PoolClient, "query">,
  requestToken: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<DrawRow | null> {
  const result = await client.query<DrawRow>(
    "SELECT id, tenant_id, campaign_id, sequence, eligible_count, winner_participation_id, " +
      "root_draw_id, previous_draw_id, created_at " +
      "FROM sweepstake_draw WHERE request_token = $1 AND tenant_id = $2",
    [requestToken, tenantId],
  );
  return result.rows[0] ?? null;
}

async function findCurrentDraw(
  client: Pick<PoolClient, "query">,
  campaignId: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<DrawRow | null> {
  const result = await client.query<DrawRow>(
    "SELECT id, tenant_id, campaign_id, sequence, eligible_count, winner_participation_id, " +
      "root_draw_id, previous_draw_id, created_at " +
      "FROM sweepstake_draw WHERE tenant_id = $2 AND campaign_id = $1 AND status = 'selected' LIMIT 1",
    [campaignId, tenantId],
  );
  return result.rows[0] ?? null;
}


async function addAudit(
  client: Pick<PoolClient, "query">,
  input: {
    tenantId: string;
    adminUserId: string;
    action: string;
    drawId: string;
    campaignId: string;
    sequence: number;
    eligibleCount: number;
    entriesHash: string;
  },
): Promise<void> {
  await client.query(
    "INSERT INTO admin_audit_log " +
      "(tenant_id, admin_user_id, action, resource_type, resource_id, metadata) " +
      "VALUES ($1, $2, $3, 'sweepstake_draw', $4, $5::jsonb)",
    [
      input.tenantId,
      input.adminUserId,
      input.action,
      input.drawId,
      JSON.stringify({
        campaignId: input.campaignId,
        sequence: input.sequence,
        eligibleCount: input.eligibleCount,
        entriesHash: input.entriesHash,
        algorithm: DRAW_ALGORITHM,
      }),
    ],
  );
}

export async function getSweepstakeStatus(
  campaignId: string,
  tenantId = DEFAULT_TENANT_ID,
) {
  const client = await pool.connect();
  try {
    const campaign = await getCampaign(client, campaignId, tenantId);
    const candidates = await listCurrentCandidates(client, campaignId, tenantId);
    const legacyUnlinkedCount = await countLegacyUnlinked(client, campaignId, tenantId);
    const current = await findCurrentDraw(client, campaignId, tenantId);
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignStatus: campaign.status,
      campaignType: campaign.type,
      eligibleCount: candidates.length,
      legacyUnlinkedCount,
      canDraw:
        campaign.type === "sweepstake" &&
        campaign.status === "closed" &&
        candidates.length > 0 &&
        legacyUnlinkedCount === 0 &&
        current === null,
      currentDraw: current ? await hydrateDraw(client, current, tenantId) : null,
    };
  } finally {
    client.release();
  }
}

export async function drawSweepstake(input: {
  campaignId: string;
  adminUserId: string;
  requestToken: string;
  tenantId?: string;
}): Promise<DrawResult> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `sweepstake:${tenantId}:${input.campaignId}`,
    ]);

    const repeated = await findDrawByRequestToken(client, input.requestToken, tenantId);
    if (repeated) {
      if (repeated.campaign_id !== input.campaignId) {
        throw new AppError(409, "DRAW_CONFLICT", "A chave de idempotencia pertence a outra campanha.");
      }
      const draw = await hydrateDraw(client, repeated, tenantId);
      await client.query("COMMIT");
      return { replayed: true, draw };
    }

    const campaign = await getCampaign(client, input.campaignId, tenantId);
    assertCampaignCanDraw(campaign);

    if (await findCurrentDraw(client, input.campaignId, tenantId)) {
      throw new AppError(
        409,
        "DRAW_ALREADY_EXISTS",
        "Esta campanha ja possui um resultado. Use Sortear novamente.",
      );
    }

    const legacyUnlinkedCount = await countLegacyUnlinked(client, input.campaignId, tenantId);
    if (legacyUnlinkedCount > 0) {
      throw new AppError(
        409,
        "LEGACY_PARTICIPATIONS_PENDING",
        "Existem cadastros antigos ainda nao vinculados ao sorteio.",
        { legacyUnlinkedCount },
      );
    }

    const candidates = await listCurrentCandidates(client, input.campaignId, tenantId);
    if (candidates.length === 0) {
      throw new AppError(
        409,
        "NO_ELIGIBLE_PARTICIPANTS",
        "Nao existem participantes elegiveis para este sorteio.",
      );
    }

    const winner = selectWinner(candidates);
    const entriesHash = buildEntriesHash(
      candidates.map((candidate) => candidate.participationId),
    );
    const inserted = await client.query<DrawRow>(
      "INSERT INTO sweepstake_draw " +
        "(tenant_id, campaign_id, sequence, status, winner_participation_id, " +
        "executed_by_admin_user_id, algorithm, eligible_count, entries_hash, request_token) " +
        "VALUES ($1, $2, 1, 'selected', $3, $4, $5, $6, $7, $8) " +
        "RETURNING id, tenant_id, campaign_id, sequence, eligible_count, winner_participation_id, " +
        "root_draw_id, previous_draw_id, created_at",
      [
        tenantId,
        input.campaignId,
        winner.participationId,
        input.adminUserId,
        DRAW_ALGORITHM,
        candidates.length,
        entriesHash,
        input.requestToken,
      ],
    );
    const drawRow = inserted.rows[0]!;
    await insertEntries(client, drawRow.id, candidates, tenantId);
    await addAudit(client, {
      tenantId,
      adminUserId: input.adminUserId,
      action: "sweepstake.draw",
      drawId: drawRow.id,
      campaignId: input.campaignId,
      sequence: 1,
      eligibleCount: candidates.length,
      entriesHash,
    });
    await client.query("COMMIT");

    return {
      replayed: false,
      draw: {
        drawId: drawRow.id,
        campaignId: input.campaignId,
        sequence: 1,
        eligibleCount: candidates.length,
        drawnAt: drawRow.created_at.toISOString(),
        animationNames: buildAnimationNames(candidates, winner),
        winner,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function redrawSweepstake(input: {
  campaignId: string;
  adminUserId: string;
  requestToken: string;
  previousDrawId: string;
  tenantId?: string;
}): Promise<DrawResult> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `sweepstake:${tenantId}:${input.campaignId}`,
    ]);

    const repeated = await findDrawByRequestToken(client, input.requestToken, tenantId);
    if (repeated) {
      if (repeated.campaign_id !== input.campaignId) {
        throw new AppError(409, "DRAW_CONFLICT", "A chave de idempotencia pertence a outra campanha.");
      }
      const draw = await hydrateDraw(client, repeated, tenantId);
      await client.query("COMMIT");
      return { replayed: true, draw };
    }

    const campaign = await getCampaign(client, input.campaignId, tenantId);
    assertCampaignCanDraw(campaign);

    const current = await findCurrentDraw(client, input.campaignId, tenantId);
    if (!current || current.id !== input.previousDrawId) {
      throw new AppError(
        409,
        "DRAW_CONFLICT",
        "O resultado informado nao e mais o resultado atual da campanha.",
      );
    }

    const rootDrawId = current.root_draw_id ?? current.id;
    const candidates = await listRedrawCandidates(
      client,
      input.campaignId,
      rootDrawId,
      tenantId,
    );
    if (candidates.length === 0) {
      throw new AppError(
        409,
        "NO_REMAINING_ELIGIBLE_PARTICIPANTS",
        "Nao restam outros participantes elegiveis para sortear.",
      );
    }

    const winner = selectWinner(candidates);
    const entriesHash = buildEntriesHash(
      candidates.map((candidate) => candidate.participationId),
    );
    const sequence = current.sequence + 1;

    await client.query(
      "UPDATE sweepstake_draw SET status = 'superseded', superseded_at = now() " +
        "WHERE id = $1 AND tenant_id = $2 AND status = 'selected'",
      [current.id, tenantId],
    );

    const inserted = await client.query<DrawRow>(
      "INSERT INTO sweepstake_draw " +
        "(tenant_id, campaign_id, sequence, status, winner_participation_id, root_draw_id, " +
        "previous_draw_id, executed_by_admin_user_id, algorithm, eligible_count, " +
        "entries_hash, reason_code, request_token) " +
        "VALUES ($1, $2, $3, 'selected', $4, $5, $6, $7, $8, $9, $10, $11, $12) " +
        "RETURNING id, tenant_id, campaign_id, sequence, eligible_count, winner_participation_id, " +
        "root_draw_id, previous_draw_id, created_at",
      [
        tenantId,
        input.campaignId,
        sequence,
        winner.participationId,
        rootDrawId,
        current.id,
        input.adminUserId,
        DRAW_ALGORITHM,
        candidates.length,
        entriesHash,
        REDRAW_REASON,
        input.requestToken,
      ],
    );
    const drawRow = inserted.rows[0]!;
    await insertEntries(client, drawRow.id, candidates, tenantId);
    await addAudit(client, {
      tenantId,
      adminUserId: input.adminUserId,
      action: "sweepstake.redraw",
      drawId: drawRow.id,
      campaignId: input.campaignId,
      sequence,
      eligibleCount: candidates.length,
      entriesHash,
    });
    await client.query("COMMIT");

    return {
      replayed: false,
      draw: {
        drawId: drawRow.id,
        campaignId: input.campaignId,
        sequence,
        eligibleCount: candidates.length,
        drawnAt: drawRow.created_at.toISOString(),
        animationNames: buildAnimationNames(candidates, winner),
        winner,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
