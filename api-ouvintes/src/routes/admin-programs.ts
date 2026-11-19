import {uploadProgramImage} from '../services/programming-media-service.js';
import {programmingPublicationStatus,publishProgramming} from '../services/programming-publication-service.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuthentication, requirePermission } from '../plugins/auth.js';
import { programInput, programUpdate, slotInput, slotUpdate, hostInput, slotBatchInput, overrideInput, overrideUpdate } from '../schemas/programming.js';
import { listPrograms, getProgram, saveProgram, saveSlot, saveHost, simulateProgramming, eligibleProgramHosts, saveSlotBatch, programmingExceptions, saveProgrammingOverride, programmingWeek } from '../services/programming-service.js';
import { AppError } from '../lib/errors.js';
import type { FastifyRequest } from 'fastify';
const ids = z.object({ id: z.uuid(), slotId: z.uuid().optional(), userId: z.uuid().optional() });
function auth(req: FastifyRequest) { if (!req.authz)
    throw new AppError(401, 'ADMIN_SESSION_INVALID', 'Sessao invalida.'); return req.authz; }
export const adminProgramRoutes: FastifyPluginAsync = async (app) => {
    app.addHook('preHandler', requireAuthentication);
    app.addHook('onSend', async (_r, reply) => { reply.header('Cache-Control', 'no-store'); });
    app.get('/programming/weekly',{preHandler:requirePermission('schedule.manage')},async req=>programmingWeek(auth(req)));
    app.get('/programs', async (req) => listPrograms(auth(req), z.object({ after: z.uuid().optional() }).parse(req.query).after));
    app.get('/programs/:id', async (req) => getProgram(auth(req), ids.parse(req.params).id));
    app.get("/programs/:id/eligible-hosts", { preHandler: requirePermission("program.host.manage") }, async (req) => eligibleProgramHosts(auth(req), ids.parse(req.params).id));
    app.post('/programs', { preHandler: requirePermission('program.manage') }, async (req, reply) => reply.code(201).send(await saveProgram(auth(req), programInput.parse(req.body))));
    app.patch('/programs/:id', { preHandler: requirePermission('program.manage') }, async (req) => saveProgram(auth(req), programUpdate.parse(req.body), ids.parse(req.params).id));
    app.post('/programs/:id/slots', { preHandler: requirePermission('schedule.manage') }, async (req, reply) => reply.code(201).send(await saveSlot(auth(req), ids.parse(req.params).id, slotInput.parse(req.body))));
    app.patch('/programs/:id/slots/:slotId', { preHandler: requirePermission('schedule.manage') }, async (req) => { const p = ids.parse(req.params); return saveSlot(auth(req), p.id, slotUpdate.parse(req.body), p.slotId); });
    app.put('/programs/:id/hosts/:userId', { preHandler: requirePermission('program.host.manage') }, async (req) => { const p = ids.parse(req.params); return saveHost(auth(req), p.id, p.userId!, hostInput.parse(req.body)); });
    app.get('/programming/simulate', { preHandler: requirePermission('schedule.manage') }, async (req) => simulateProgramming(auth(req), new Date(z.object({ at: z.iso.datetime({ offset: true }) }).parse(req.query).at)));

 app.post('/programs/assets',{bodyLimit:10*1024*1024+65536,config:{rateLimit:{max:10,timeWindow:'1 minute'}},preHandler:[requirePermission('program.manage'),requirePermission('media.upload')]},async(req,reply)=>{
  const file=await req.file({limits:{files:1,fileSize:10*1024*1024}});if(!file)throw new AppError(400,'FILE_REQUIRED','Selecione uma imagem.');
  return reply.code(201).send(await uploadProgramImage(await file.toBuffer(),file.filename,req.user.sub));
 });
 app.post('/programs/:id/slots/batch',{preHandler:requirePermission('schedule.manage')},async(req,reply)=>reply.code(201).send(await saveSlotBatch(auth(req),ids.parse(req.params).id,slotBatchInput.parse(req.body))));
 app.get('/programming/overrides',{preHandler:requirePermission('schedule.manage')},async()=>({items:await programmingExceptions()}));
 app.post('/programming/overrides',{preHandler:requirePermission('schedule.manage')},async(req,reply)=>reply.code(201).send(await saveProgrammingOverride(auth(req),overrideInput.parse(req.body))));
 app.patch('/programming/overrides/:id',{preHandler:requirePermission('schedule.manage')},async req=>saveProgrammingOverride(auth(req),overrideUpdate.parse(req.body),ids.parse(req.params).id));
 app.get('/programming/publication',{preHandler:requirePermission('programming.publish')},programmingPublicationStatus);
 app.post('/programming/publish',{preHandler:requirePermission('programming.publish')},async req=>publishProgramming(auth(req),true));
 app.post('/programming/publications/retry',{preHandler:requirePermission('programming.publish')},async req=>publishProgramming(auth(req),false));
};
