import type { FastifyPluginAsync } from 'fastify';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { isCronRequestAuthorized } from '../lib/cron-auth.js';
import { runCalendarPollAutomationOnce } from '../services/calendar-poll-automation.js';

export const calendarCronRoutes: FastifyPluginAsync = async (app) => {
  app.get('/calendar-polls', async (request, reply) => {
    if (!env.GOOGLE_CALENDAR_CRON_ENABLED || !env.CRON_SECRET) {
      throw new AppError(404, 'NOT_FOUND', 'Rota indisponivel.');
    }
    if (!isCronRequestAuthorized(request.headers.authorization, env.CRON_SECRET)) {
      throw new AppError(401, 'CRON_UNAUTHORIZED', 'Acesso nao autorizado.');
    }

    reply.header('Cache-Control', 'no-store');
    return { readOnly: true, ...(await runCalendarPollAutomationOnce()) };
  });
};
