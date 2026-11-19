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

export function startCalendarPollAutomation() {
  const intervalSeconds = env.GOOGLE_CALENDAR_AUTO_SYNC_INTERVAL_SECONDS;
  if (!intervalSeconds || !env.GOOGLE_CALENDAR_ENABLED || env.NODE_ENV === 'production' || env.VERCEL_ENV) {
    return { stop: async () => undefined };
  }

  const sync = createCalendarPollSync(pool, {
    clientId: env.GOOGLE_CALENDAR_CLIENT_ID!,
    clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET!,
    redirectUri: env.GOOGLE_CALENDAR_REDIRECT_URI!,
    encryptionKey: env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY!,
  }, env.GOOGLE_CALENDAR_ALLOWED_ID!);

  let inFlight: Promise<void> | null = null;
  let stopped = false;
  const run = () => {
    if (stopped || inFlight) return inFlight ?? Promise.resolve();
    inFlight = (async () => {
      let automationSession: { id: string; authz_version: number } | null = null;
      let automationUserId: string | null = null;
      try {
        const connection = await pool.query(`SELECT connected_by FROM radio_calendar_oauth_connection WHERE radio_key=$1`, [RADIO]);
        if (!connection.rowCount) return;
        const connectedUserId = String(connection.rows[0].connected_by ?? '');
        if (!connectedUserId) return;
        automationUserId = connectedUserId;
        automationSession = await createAdminAutomationSession(connectedUserId,
          new Date(Date.now() + Math.max(intervalSeconds * 3, 3600) * 1000));
        if (!automationSession) return;
        const ctx = await loadAuthorizationContext({
          adminUserId: connectedUserId,
          sessionId: automationSession.id,
          authzVersion: automationSession.authz_version,
          sessionType: 'automation',
        });
        if (!ctx || !hasGlobalPermission(ctx, 'calendar_integration.sync')) {
          console.warn('Calendar auto-sync skipped: connected operator is inactive or lacks current sync permission.');
          return;
        }
        const sources = await pool.query(`SELECT id FROM radio_calendar_source WHERE radio_key=$1 AND active ORDER BY created_at`, [RADIO]);
        for (const row of sources.rows) {
          if (stopped) break;
          try {
            const result = await sync.sync(ctx, row.id);
            console.info('Calendar auto-sync completed.', {
              sourceId: row.id,
              scanned: result.scanned,
              changed: result.changed,
              publication: 'publication' in result ? result.publication : null,
              readOnly: result.readOnly,
            });
          } catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'SYNC_FAILED';
            console.warn('Calendar auto-sync deferred.', { sourceId: row.id, code });
          }
        }
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'AUTOMATION_FAILED';
        console.warn('Calendar automation unavailable.', { code });
      } finally {
        if (automationSession) {
          if (automationUserId) await revokeAdminSession(automationSession.id, automationUserId).catch(() => undefined);
        }
      }
    })().finally(() => { inFlight = null; });
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
