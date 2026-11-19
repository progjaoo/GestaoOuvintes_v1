import type { PoolClient } from 'pg';
import { pool } from '../database/client.js';
import { AppError } from '../lib/errors.js';
import type { AuthorizationContext } from './authorization-service.js';
import type { ParticipationFilters, ParticipationModeration } from '../schemas/participation.js';

const RADIO = 'radio-88';
const missing = () => new AppError(404, 'PARTICIPATION_NOT_FOUND', 'Participacao indisponivel.');
const identityArgs = (ctx: AuthorizationContext) => [RADIO, ctx.adminUserId, ctx.sessionId, ctx.authzVersion];
const validSession = `EXISTS (
  SELECT 1 FROM admin_user u JOIN admin_session s ON s.admin_user_id=u.id
  WHERE u.id=$2 AND u.active AND u.authz_version=$4 AND s.id=$3
    AND s.authz_version=u.authz_version AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
)`;

// Parameter numbers are internal constants. All user values remain bound SQL parameters.
function permissionSql(parameter: 5 | 6) {
  return `NOT EXISTS (
    SELECT 1 FROM admin_permission_override d JOIN permission dp ON dp.id=d.permission_id
    WHERE d.admin_user_id=$2 AND dp.key=$${parameter} AND d.effect='DENY'
  ) AND EXISTS (
    SELECT 1 FROM (
      SELECT rs.scope_type FROM admin_user_role ur JOIN role_permission rp ON rp.role_id=ur.role_id
      JOIN permission perm ON perm.id=rp.permission_id
      JOIN role_permission_scope rs ON rs.role_id=rp.role_id AND rs.permission_id=rp.permission_id
      WHERE ur.admin_user_id=$2 AND perm.key=$${parameter}
      UNION ALL
      SELECT o.scope_type FROM admin_permission_override o JOIN permission perm ON perm.id=o.permission_id
      WHERE o.admin_user_id=$2 AND perm.key=$${parameter} AND o.effect='ALLOW'
    ) grants WHERE grants.scope_type='global' OR (grants.scope_type='participation' AND EXISTS (
      SELECT 1 FROM radio_program_host h WHERE h.radio_key=p.radio_key AND h.program_id=p.program_id
        AND h.admin_user_id=$2 AND h.active AND h.valid_from<=clock_timestamp()
        AND (h.valid_until IS NULL OR h.valid_until>clock_timestamp())
    ))
  )`;
}
const readable = `${validSession} AND ${permissionSql(5)}`;
const moderatable = `${readable} AND ${permissionSql(6)}`;
const selectParticipation = `SELECT p.id,p.program_id,pr.name AS program_name,p.poll_id,
  poll.question AS poll_question,e.starts_at AS edition_starts_at,e.ends_at AS edition_ends_at,
  p.created_at,p.state,p.version,p.display_name,p.neighborhood,p.message,p.moderated_at,p.moderation_note,p.edition_id
  FROM radio_program_participation p
  JOIN radio_program pr ON (pr.radio_key,pr.id)=(p.radio_key,p.program_id)
  JOIN radio_program_edition e ON (e.radio_key,e.program_id,e.id)=(p.radio_key,p.program_id,p.edition_id)
  JOIN radio_poll poll ON (poll.radio_key,poll.program_id,poll.edition_id,poll.id)=(p.radio_key,p.program_id,p.edition_id,p.poll_id)`;

interface ParticipationRow {
  id: string; program_id: string; program_name: string; poll_id: string; poll_question: string;
  edition_id: string; edition_starts_at: Date; edition_ends_at: Date; created_at: Date;
  state: 'received' | 'reviewed' | 'selected' | 'rejected'; version: number;
  display_name: string | null; neighborhood?: string | null; message: string; moderated_at: Date | null; moderation_note: string | null;
}
function dto(p: ParticipationRow) {
  return {
    id: p.id, programId: p.program_id, programName: p.program_name, pollId: p.poll_id,
    pollQuestion: p.poll_question, editionStartsAt: p.edition_starts_at.toISOString(),
    editionEndsAt: p.edition_ends_at.toISOString(), receivedAt: p.created_at.toISOString(),
    state: p.state, version: p.version, displayName: p.display_name, ...(p.neighborhood ? {neighborhood:p.neighborhood} : {}), message: p.message,
    moderatedAt: p.moderated_at?.toISOString() ?? null, moderationNote: p.moderation_note,
  };
}
export async function listParticipations(ctx: AuthorizationContext, filter: ParticipationFilters) {
  const result = await pool.query<ParticipationRow>(`${selectParticipation}
    WHERE p.radio_key=$1 AND ${readable}
      AND ($6::uuid IS NULL OR p.program_id=$6) AND ($7::uuid IS NULL OR p.poll_id=$7)
      AND ($8::text IS NULL OR p.state=$8) AND ($9::uuid IS NULL OR p.id>$9)
    ORDER BY p.id LIMIT 101`, [...identityArgs(ctx), 'participation.read',
    filter.programId ?? null, filter.pollId ?? null, filter.state ?? null, filter.after ?? null]);
  return {items: result.rows.slice(0, 100).map(dto), nextCursor: result.rows.length > 100 ? result.rows[99]!.id : null};
}
export async function getParticipation(ctx: AuthorizationContext, id: string) {
  const result = await pool.query<ParticipationRow>(`${selectParticipation}
    WHERE p.radio_key=$1 AND ${readable} AND p.id=$6`, [...identityArgs(ctx), 'participation.read', id]);
  if (!result.rows[0]) throw missing();
  return dto(result.rows[0]);
}
async function assertSession(c: PoolClient, ctx: AuthorizationContext) {
  const result = await c.query(`SELECT u.id FROM admin_user u JOIN admin_session s ON s.admin_user_id=u.id
    WHERE u.id=$1 AND s.id=$2 AND u.active AND u.authz_version=$3 AND s.authz_version=u.authz_version
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() FOR SHARE OF u,s`,
  [ctx.adminUserId, ctx.sessionId, ctx.authzVersion]);
  if (!result.rowCount) throw new AppError(401, 'ADMIN_SESSION_INVALID', 'Sessao revogada.');
}
export async function moderateParticipation(ctx: AuthorizationContext, id: string, input: ParticipationModeration) {
  const c = await pool.connect();
  const args = [...identityArgs(ctx), 'participation.read', 'participation.moderate', id];
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock_shared(881188,12)');
    await c.query('SELECT key FROM radio_programming_scope WHERE key=$1 FOR SHARE', [RADIO]);
    await assertSession(c, ctx);
    const locked = await c.query(`SELECT p.id FROM radio_program_participation p
      WHERE p.radio_key=$1 AND ${moderatable} AND p.id=$7 FOR UPDATE OF p`, args);
    if (!locked.rowCount) throw missing();
    // A lock wait can outlive a session/link. Re-read authorization in a fresh statement.
    await assertSession(c, ctx);
    const current = await c.query<ParticipationRow>(`${selectParticipation}
      WHERE p.radio_key=$1 AND ${moderatable} AND p.id=$7`, args);
    if (!current.rows[0]) throw missing();
    if (current.rows[0].version !== input.version) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Participacao alterada. Atualize a tela.');
    }
    const changed = await c.query(`UPDATE radio_program_participation p
      SET state=$9,moderation_note=$10,moderated_at=clock_timestamp(),version=version+1
      WHERE p.radio_key=$1 AND ${moderatable} AND p.id=$7 AND p.version=$8 RETURNING p.id`,
    [...args, input.version, input.state, input.note === undefined ? current.rows[0].moderation_note : input.note.trim() || null]);
    if (!changed.rowCount) throw missing();
    const result = await c.query<ParticipationRow>(`${selectParticipation}
      WHERE p.radio_key=$1 AND ${moderatable} AND p.id=$7`, args);
    const row = result.rows[0];
    if (!row) throw missing();
    await c.query(`INSERT INTO admin_audit_log(admin_user_id,action,resource_type,resource_id,metadata)
      VALUES($1,'participation.moderated','radio_program_participation',$2,$3::jsonb)`,
    [ctx.adminUserId, id, JSON.stringify({radioKey: RADIO, programId: row.program_id, editionId: row.edition_id,
      pollId: row.poll_id, state: row.state, version: row.version})]);
    await c.query('COMMIT');
    return dto(row);
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
