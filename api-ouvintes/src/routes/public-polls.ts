import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {AppError} from '../lib/errors.js';
import {pollIdentityInput,pollSubmissionInput} from '../schemas/public-poll.js';
import {requireDeviceToken} from '../services/public-session-service.js';
import {activePublicPoll,publicPollBySlug,pollIdentity,submitPoll} from '../services/public-poll-service.js';
const params=z.object({id:z.uuid()});
export const publicPollRoutes:FastifyPluginAsync=async app=>{
 app.addHook('onSend',async(req,reply)=>{reply.header('Cache-Control',req.method==='GET'?'public,max-age=0,s-maxage=5,must-revalidate':'no-store');});
 const limited={config:{rateLimit:{max:10,timeWindow:'1 minute'}},bodyLimit:24*1024};
 app.get('/active',async req=>{const {programId}=z.object({programId:z.uuid()}).strict().parse(req.query);return {poll:await activePublicPoll(programId)};});
 app.get('/:slug',async req=>{const {slug}=z.object({slug:z.string().max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)}).parse(req.params);const poll=await publicPollBySlug(slug);if(!poll)throw new AppError(404,'POLL_NOT_FOUND','Enquete indisponivel.');return poll;});
 app.post('/:id/identity',limited,req=>pollIdentity(params.parse(req.params).id,requireDeviceToken(req.headers['x-device-token']),pollIdentityInput.parse(req.body)));
 app.post('/:id/submit',limited,req=>submitPoll(params.parse(req.params).id,requireDeviceToken(req.headers['x-device-token']),pollSubmissionInput.parse(req.body)));
};
