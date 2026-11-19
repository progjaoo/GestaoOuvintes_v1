import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { requireAuthentication, requirePermission } from '../plugins/auth.js';
import { pool } from '../database/client.js';
import { createGoogleCalendarOAuth } from '../services/google-calendar-oauth.js';
import { createCalendarPollSync } from '../services/calendar-poll-sync.js';
import { calendarOAuthCallbackSchema } from '../schemas/calendar-oauth.js';
import { pollCalendarQuery } from '../schemas/poll-calendar.js';

const auth = (req: FastifyRequest) => {
  if (!req.authz) throw new AppError(401,'ADMIN_SESSION_INVALID','Sessao invalida.');
  return req.authz;
};
export const adminCalendarOAuthRoutes: FastifyPluginAsync = async app => {
  const oauth = createGoogleCalendarOAuth(pool, {
    clientId: env.GOOGLE_CALENDAR_CLIENT_ID!, clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET!,
    redirectUri: env.GOOGLE_CALENDAR_REDIRECT_URI!, encryptionKey: env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY!,
  });
  const sync = createCalendarPollSync(pool, {
    clientId: env.GOOGLE_CALENDAR_CLIENT_ID!, clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET!,
    redirectUri: env.GOOGLE_CALENDAR_REDIRECT_URI!, encryptionKey: env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY!,
  }, env.GOOGLE_CALENDAR_ALLOWED_ID!);
  const sourceParams = z.object({ sourceId: z.uuid() }).strict();
  app.addHook('onSend', async (_req, reply) => { reply.header('Cache-Control','no-store'); });
  app.get('/status',{preHandler:[requireAuthentication,requirePermission('calendar_integration.manage')]},req=>oauth.status(auth(req)));
  app.post('/oauth/start',{preHandler:[requireAuthentication,requirePermission('calendar_integration.manage')]},req=>oauth.start(auth(req)));
  app.get('/programs',{preHandler:[requireAuthentication,requirePermission('calendar_integration.manage')]},req=>sync.listPrograms(auth(req)));
  app.get('/sources',{preHandler:[requireAuthentication,requirePermission('calendar_integration.read')]},req=>sync.listSources(auth(req)));
  app.post('/sources',{preHandler:[requireAuthentication,requirePermission('calendar_integration.manage')]},async(req,reply)=>{
    const body=z.object({programId:z.uuid()}).strict().parse(req.body);
    return reply.code(201).send(await sync.createSource(auth(req),body.programId));
  });
  app.patch('/sources/:sourceId/programs',{preHandler:[requireAuthentication,requirePermission('calendar_integration.manage')]},req=>{
    const {sourceId}=sourceParams.parse(req.params),body=z.object({version:z.number().int().positive(),defaultProgramId:z.uuid(),allowedProgramIds:z.array(z.uuid()).min(1).max(100)}).strict().parse(req.body);
    return sync.configurePrograms(auth(req),sourceId,body.version,body.defaultProgramId,body.allowedProgramIds);
  });
  app.patch('/sources/:sourceId',{preHandler:[requireAuthentication,requirePermission('calendar_integration.manage')]},req=>{
    const {sourceId}=sourceParams.parse(req.params),body=z.object({version:z.number().int().positive(),active:z.boolean()}).strict().parse(req.body);
    return sync.setActive(auth(req),sourceId,body.version,body.active);
  });
  app.get('/sources/:sourceId/events',{preHandler:[requireAuthentication,requirePermission('calendar_integration.read')]},req=>{
    const {sourceId}=sourceParams.parse(req.params),query=z.object({after:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict().parse(req.query);
    return sync.stagedEvents(auth(req),sourceId,query.after,query.limit);
  });
  app.get('/calendar',{preHandler:[requireAuthentication,requirePermission('calendar_integration.read')]},req=>{
    const query=pollCalendarQuery.parse(req.query);
    return sync.calendar(auth(req),query);
  });
  app.post('/sources/:sourceId/sync',{config:{rateLimit:{max:3,timeWindow:'1 minute'}},preHandler:[requireAuthentication,requirePermission('calendar_integration.sync')]},req=>{
    const {sourceId}=sourceParams.parse(req.params);
    return sync.sync(auth(req),sourceId);
  });
  app.get('/oauth/callback',{logLevel:'silent'},async req=>{
    const query=calendarOAuthCallbackSchema.parse(req.query);
    if(query.error || !query.code || !query.state) throw new AppError(400,'CALENDAR_OAUTH_DENIED','Autorizacao cancelada ou invalida. Nenhum dado foi alterado na agenda.');
    return oauth.callback({code:query.code,state:query.state});
  });
};
