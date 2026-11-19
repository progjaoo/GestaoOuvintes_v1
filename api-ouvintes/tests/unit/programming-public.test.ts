import {beforeEach,describe,it,expect,vi} from 'vitest';
const {send}=vi.hoisted(()=>({send:vi.fn()}));
vi.mock('../../src/database/client.js',()=>{throw new Error('Public programming must not import PostgreSQL');});
vi.mock('../../src/config/env.js',()=>({env:{PROGRAMMING_PUBLICATION_ENABLED:true,PROGRAMMING_NAMESPACE:'test/radio-88',R2_BUCKET_NAME:'test-only',R2_ACCOUNT_ID:'test',R2_ACCESS_KEY_ID:'test',R2_SECRET_ACCESS_KEY:'test',R2_PUBLIC_BASE_URL:'https://media.example.test'}}));
vi.mock('@aws-sdk/client-s3',()=>({S3Client:class{send=send;},GetObjectCommand:class{constructor(public input:unknown){}},PutObjectCommand:class{constructor(public input:unknown){}}}));
const snapshot={schemaVersion:1,radioKey:'radio-88',namespace:'test/radio-88',revision:1,generatedAt:'2026-01-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',timezone:'America/Sao_Paulo',programs:[],slots:[],exceptions:[]};
beforeEach(()=>{vi.resetModules();send.mockReset();});
describe('public programming without PostgreSQL',()=>{
 it('writes immutable release before changing current',async()=>{
  send.mockResolvedValue({});const m=await import('../../src/services/programming-public-snapshot.js');await m.putProgrammingSnapshot(m.programmingSnapshotSchema.parse(snapshot));
  expect(send.mock.calls[0]?.[0].input.Key).toContain('/releases/1.json');expect(send.mock.calls[1]?.[0].input.Key).toContain('/current.json');
 });
 it('preserves pointer when immutable upload fails',async()=>{
  send.mockRejectedValue(new Error('R2 down'));const m=await import('../../src/services/programming-public-snapshot.js');await expect(m.putProgrammingSnapshot(m.programmingSnapshotSchema.parse(snapshot))).rejects.toThrow();expect(send).toHaveBeenCalledTimes(1);
 });
 it('reads and caches R2 without importing a pool',async()=>{
  send.mockResolvedValue({Body:{transformToString:async()=>JSON.stringify(snapshot)}});const m=await import('../../src/services/programming-public-snapshot.js');expect((await m.readProgrammingSnapshot()).revision).toBe(1);await m.readProgrammingSnapshot();expect(send).toHaveBeenCalledTimes(1);
 });
 it('rejects expired or foreign namespace data',async()=>{
  send.mockResolvedValue({Body:{transformToString:async()=>JSON.stringify({...snapshot,namespace:'production/radio-88'})}});const m=await import('../../src/services/programming-public-snapshot.js');await expect(m.readProgrammingSnapshot()).rejects.toMatchObject({statusCode:503});
 });
 it('serves ETag and a cached unavailable response without SQL fallback',async()=>{
  send.mockResolvedValue({Body:{transformToString:async()=>JSON.stringify(snapshot)}});const {default:Fastify}=await import('fastify');const {publicProgrammingRoutes}=await import('../../src/routes/public-programming.js');const app=Fastify();await app.register(publicProgrammingRoutes);
  const result=await app.inject({url:'/config'});expect(result.statusCode).toBe(200);expect(result.headers['cache-control']).toBe('public,max-age=30');expect((await app.inject({url:'/config',headers:{'if-none-match':'"programming-1"'}})).statusCode).toBe(304);await app.close();
 });
 it('rejects internal fields in public content',async()=>{
  const {programmingSnapshotSchema}=await import('../../src/services/programming-public-snapshot.js');expect(programmingSnapshotSchema.safeParse({...snapshot,accounts:[{email:'private@example.com'}]}).success).toBe(false);
 });
});
