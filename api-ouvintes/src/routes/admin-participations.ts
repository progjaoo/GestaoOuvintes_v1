import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuthentication } from '../plugins/auth.js';
import { AppError } from '../lib/errors.js';
import { participationFilters, participationModeration } from '../schemas/participation.js';
import { getParticipation, listParticipations, moderateParticipation } from '../services/participation-service.js';

const id = (req: FastifyRequest) => z.object({id: z.uuid()}).parse(req.params).id;
function auth(req: FastifyRequest) {
  if (!req.authz) throw new AppError(401, 'ADMIN_SESSION_INVALID', 'Sessao invalida.');
  return req.authz;
}
export const adminParticipationRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuthentication);
  app.addHook('onSend', async (_req, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.get('/participations', req => listParticipations(auth(req), participationFilters.parse(req.query)));
  app.get('/participations/:id', req => getParticipation(auth(req), id(req)));
  app.patch('/participations/:id/moderation', req => moderateParticipation(auth(req), id(req), participationModeration.parse(req.body)));
};
