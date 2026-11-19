import { env } from '../config/env.js';
import { pool } from '../database/client.js';
import {
  createAdminAutomationSession,
  hasGlobalPermission,
  loadAuthorizationContext,
  revokeAdminSession,
} from './authorization-service.js';
import { createCalendarPollSync } from './calendar-poll-sync.js';

const RADIO = 'radio-88';
const LOCK_NAMESPACE = 881188;
const LOCK_ID = 13;

export type CalendarAutomationResult = {
  status: 'completed' | 'already_running' | 'not_connected' | 'operator_ineligible';
  sources: number;
  scanned: number;
  changed: number;
  failures: number;
};

export async function runCalendarPollAutomationOnce(): Promise<CalendarAutomationResult> {
  const lockClient = await pool.connect();
  let lockHeld = false;
  let automationSession: { id: string; authz_version: number } | null = null;
  let automationUserId: string | null = null;

  try {
    const lockResult = await lockClient.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [LOCK_NAMESPACE, LOCK_ID],
    );
    lockHeld = lockResult.rows[0]?.locked === true;
    if (!lockHeld) return { status: 'already_running', sources: 0, scanned: 0, changed: 0, failures: 0 };

    const connection = await pool.query(
      'SELECT connected_by FROM radio_calendar_oauth_connection WHERE radio_key=$1',
      [RADIO],
    );
    if (!connection.rowCount) return { status: 'not_connected', sources: 0, scanned: 0, changed: 0, failures: 0 };

    const connectedUserId = String(connection.rows[0].connected_by ?? '');
    if (!connectedUserId) return { status: 'not_connected', sources: 0, scanned: 0, changed: 0, failures: 0 };

    automationUserId = connectedUserId;
    automationSession = await createAdminAutomationSession(
      connectedUserId,
      new Date(Date.now() + Math.max(env.GOOGLE_CALENDAR_AUTO_SYNC_INTERVAL_SECONDS * 3, 3600) * 1000),
    );
    if (!automationSession) return { status: 'operator_ineligible', sources: 0, scanned: 0, changed: 0, failures: 0 };

    const ctx = await loadAuthorizationContext({
      adminUserId: connectedUserId,
      sessionId: automationSession.id,
      authzVersion: automationSession.authz_version,
      sessionType: 'automation',
    });
    if (!ctx || !hasGlobalPermission(ctx, 'calendar_integration.sync')) {
      console.warn('Calendar auto-sync skipped: connected operator is inactive or lacks current sync permission.');
      return { status: 'operator_ineligible', sources: 0, scanned: 0, changed: 0, failures: 0 };
    }

    const sources = await pool.query(
      'SELECT id FROM radio_calendar_source WHERE radio_key=$1 AND active ORDER BY created_at',
      [RADIO],
    );
    const sync = createCalendarPollSync(pool, {
      clientId: env.GOOGLE_CALENDAR_CLIENT_ID!,
      clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      redirectUri: env.GOOGLE_CALENDAR_REDIRECT_URI!,
      encryptionKey: env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY!,
    }, env.GOOGLE_CALENDAR_ALLOWED_ID!);

    let scanned = 0;
    let changed = 0;
    let failures = 0;
    for (const row of sources.rows) {
      try {
        const result = await sync.sync(ctx, row.id);
        scanned += result.scanned;
        changed += result.changed;
        console.info('Calendar auto-sync completed.', {
          sourceId: row.id,
          scanned: result.scanned,
          changed: result.changed,
          readOnly: result.readOnly,
        });
      } catch (error) {
        failures += 1;
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'SYNC_FAILED';
        console.warn('Calendar auto-sync deferred.', { sourceId: row.id, code });
      }
    }

    return { status: 'completed', sources: sources.rowCount ?? 0, scanned, changed, failures };
  } finally {
    if (automationSession && automationUserId) {
      await revokeAdminSession(automationSession.id, automationUserId).catch(() => undefined);
    }
    if (lockHeld) {
      await lockClient.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_NAMESPACE, LOCK_ID]).catch(() => undefined);
    }
    lockClient.release();
  }
}

export function startCalendarPollAutomation() {
  const intervalSeconds = env.GOOGLE_CALENDAR_AUTO_SYNC_INTERVAL_SECONDS;
  if (!intervalSeconds || !env.GOOGLE_CALENDAR_ENABLED || env.NODE_ENV === 'production' || env.VERCEL_ENV) {
    return { stop: async () => undefined };
  }

  let inFlight: Promise<void> | null = null;
  let stopped = false;
  const run = () => {
    if (stopped || inFlight) return inFlight ?? Promise.resolve();
    inFlight = runCalendarPollAutomationOnce()
      .then((result) => {
        console.info('Calendar auto-sync cycle finished.', result);
      })
      .catch((error) => {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'AUTOMATION_FAILED';
        console.warn('Calendar automation unavailable.', { code });
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };

  const timer = setInterval(() => { void run(); }, intervalSeconds * 1000);
  timer.unref();
  void run();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
