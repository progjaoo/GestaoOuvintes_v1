import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {describe,it,expect} from 'vitest';
const exec=promisify(execFile);
const base:NodeJS.ProcessEnv={...process.env,DOTENV_CONFIG_PATH:'/dev/null',NODE_ENV:'development',VERCEL_ENV:undefined,
 DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1/public_poll_test',DATABASE_SSL:'false',
 JWT_SECRET:'synthetic-test-secret-at-least-32-characters',DEVICE_TOKEN_SECRET:'synthetic-device-secret-at-least-32-characters',
 IP_HASH_SECRET:'synthetic-ip-secret',ADMIN_INITIAL_PASSWORD:'synthetic-test-password',CAMPAIGN_STARTS_AT:'2026-01-01T00:00:00Z',
 POLLS_ENABLED:'true',POLLS_PUBLIC_LOCAL_ENABLED:'true',POLLS_PUBLIC_LOCAL_SNAPSHOT_FILE:undefined,
 PROGRAMMING_ENABLED:'false',PROGRAMMING_PUBLICATION_ENABLED:'false',FEED_ENABLED:'false',FEED_PUBLICATION_ENABLED:'false',
 PUBLIC_CONFIG_READ_MODE:'database',PUBLIC_CONFIG_SNAPSHOT_WRITE_ENABLED:'false',MEDIA_STORAGE_DRIVER:'disabled'};
const run=(script:string,env=base)=>exec(process.execPath,['--import','tsx','--input-type=module','-e',script],{env,timeout:10000});
describe('public poll local runtime guard and privacy',()=>{
 it.each([{NODE_ENV:'production'},{VERCEL_ENV:'preview'},{DATABASE_URL:'postgresql://synthetic:synthetic@remote.example/public_poll_test'},{POLLS_ENABLED:'false'}])('refuses nonlocal configuration %j',async override=>{
  await expect(run("await import('./src/config/env.ts')",{...base,...override})).rejects.toThrow('POLLS_PUBLIC_LOCAL_ENABLED exige');
 });
 it('keeps token, PII and database error details out of development logs',async()=>{
  const {stdout,stderr}=await run(`
   const {buildApp}=await import('./src/app.ts');const {pool}=await import('./src/database/client.ts');
   pool.connect=async()=>{throw new Error('PRIVATE_DATABASE_SENTINEL');};
   const app=await buildApp();await app.ready();
   app.log.info({req:{headers:{'x-device-token':'TOKEN_SENTINEL'},body:{name:'NAME_SENTINEL',phone:'PHONE_SENTINEL',message:'MESSAGE_SENTINEL',city:'CITY_SENTINEL',neighborhood:'DISTRICT_SENTINEL'}},res:{body:{displayName:'DISPLAY_SENTINEL',neighborhood:'RESPONSE_DISTRICT_SENTINEL'}}},'redaction probe');
   const result=await app.inject({method:'POST',url:'/api/public/polls/00000000-0000-4000-8000-000000000001/submit',headers:{'x-device-token':'a'.repeat(64)},payload:{submissionId:'00000000-0000-4000-8000-000000000002',identified:false,message:'MESSAGE_SENTINEL',privacyAccepted:true}});
   if(result.statusCode!==500)throw new Error('Expected synthetic failure');await app.close();await pool.end();
  `);
  expect(stdout).toContain('redaction probe');expect(stdout).toContain('Public poll request failed.');
  const probe=stdout.trim().split('\n').map(line=>JSON.parse(line)).find(entry=>entry.msg==='redaction probe');
  expect(probe.req).toEqual({});expect(probe.res).toEqual({});
  for(const value of ['TOKEN_SENTINEL','NAME_SENTINEL','PHONE_SENTINEL','MESSAGE_SENTINEL','CITY_SENTINEL','DISTRICT_SENTINEL','DISPLAY_SENTINEL','RESPONSE_DISTRICT_SENTINEL','PRIVATE_DATABASE_SENTINEL','a'.repeat(64)])expect(stdout+stderr).not.toContain(value);
 });
});
