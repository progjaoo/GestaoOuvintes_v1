import type {FastifyPluginAsync} from 'fastify';
import {readProgrammingSnapshot} from '../services/programming-public-snapshot.js';
export const publicProgrammingRoutes:FastifyPluginAsync=async app=>{
 app.get('/config',async(req,reply)=>{
  try{
   const value=await readProgrammingSnapshot(),etag=`"programming-${value.revision}"`;
   reply.header('Cache-Control','public,max-age=30').header('ETag',etag);
   if(req.headers['if-none-match']===etag)return reply.code(304).send();
   return value;
  }catch{reply.header('Cache-Control','public,max-age=5');return reply.code(503).send({code:'PROGRAMMING_PUBLIC_UNAVAILABLE',message:'Programacao temporariamente indisponivel.'});}
 });
};
