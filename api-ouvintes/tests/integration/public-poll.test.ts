import {readFile,readdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {buildApp} from '../../src/app.js';
import {pool} from '../../src/database/client.js';
import {hashDeviceToken} from '../../src/services/public-session-service.js';
const suite=process.env.RUN_PUBLIC_POLL_TESTS==='true'?describe:describe.skip;
suite('local public polls disposable PostgreSQL',()=>{
 let app:FastifyInstance,admin:string,programId:string,startsAt:string,endsAt:string;
 let ip=0;
 const token=()=>randomBytes(32).toString('hex');
 const adminCall=(method:any,path:string,payload?:any,auth=admin)=>app.inject({method,url:'/api/admin'+path,headers:{authorization:'Bearer '+auth},payload});
 const post=(id:string,action:string,device:string,payload:any,address?:string)=>app.inject({method:'POST',url:`/api/public/polls/${id}/${action}`,headers:{'x-device-token':device},payload,remoteAddress:address??`10.0.${Math.floor(++ip/250)}.${ip%250+1}`});
 async function makePoll(mode='mixed',extra:Record<string,unknown>={}){
  const body={slug:'poll-'+randomUUID(),question:'Synthetic private question?',context:'Context',mode,identificationPolicy:'optional',allowMessage:mode!=='vote',options:mode==='message'?[]:['Alpha','Beta'],editionStartsAt:startsAt,editionEndsAt:endsAt,startsAt,endsAt,imageUrl:'http://127.0.0.1:8086/polls/enquete-doramas.png',...extra};
  const created=await adminCall('POST',`/programs/${programId}/polls`,body);expect(created.statusCode,created.body).toBe(201);
  const published=await adminCall('POST',`/polls/${created.json().id}/publish`,{version:1});expect(published.statusCode,published.body).toBe(200);return published.json();
 }
 async function counts(){return (await pool.query('SELECT (SELECT count(*)::int FROM radio_poll_vote) AS votes,(SELECT count(*)::int FROM radio_program_participation) AS messages,(SELECT count(*)::int FROM listener_profile) AS profiles')).rows[0];}
 beforeAll(async()=>{
  const u=new URL(process.env.DATABASE_URL!);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.endsWith('_test'))throw Error('Disposable local _test DB required');
  app=await buildApp();await app.ready();const id=randomUUID();
  await pool.query("INSERT INTO admin_user(id,name,username,password_hash,role,active) VALUES($1::uuid,'Public poll test',$1::text,'unused','viewer',true)",[id]);
  await pool.query("INSERT INTO admin_user_role(admin_user_id,role_id) SELECT $1,id FROM role WHERE key='admin'",[id]);
  const sid=(await pool.query("INSERT INTO admin_session(admin_user_id,authz_version,expires_at) VALUES($1,1,now()+interval '1 hour') RETURNING id",[id])).rows[0].id;
  admin=app.jwt.sign({sub:id,name:'Fixture',username:id,role:'viewer',sid,authzVersion:1});
  programId=(await pool.query("INSERT INTO radio_program(radio_key,name,slug) VALUES('radio-88','Public synthetic program','public-poll-fixture') RETURNING id")).rows[0].id;
  startsAt=new Date(Date.now()-60000).toISOString();endsAt=new Date(Date.now()+3600000).toISOString();
  await pool.query("INSERT INTO radio_program_override(radio_key,program_id,starts_at,ends_at,reason) VALUES('radio-88',$1,$2,$3,'Disposable public poll edition')",[programId,startsAt,endsAt]);
 });
 afterEach(async()=>{vi.restoreAllMocks();await pool.query("UPDATE radio_poll SET state='closed' WHERE program_id=$1",[programId]);await pool.query('UPDATE radio_program SET active=true WHERE id=$1',[programId]);await pool.query('UPDATE radio_program_override SET active=true WHERE program_id=$1',[programId]);});
 afterAll(async()=>{await app?.close();await pool.end();});
 it('migrates legacy message policy without enabling messages on false rows',async()=>{
  const c=await pool.connect(),schema='legacy_'+randomUUID().replaceAll('-','');
  try{await c.query('BEGIN');await c.query('CREATE SCHEMA '+schema);await c.query('SET LOCAL search_path TO '+schema);
   const files=(await readdir('database/migrations')).filter(f=>f.endsWith('.sql')&&f<'0023').sort();
   for(const file of files)await c.query(await readFile('database/migrations/'+file,'utf8'));
   const pr=(await c.query("INSERT INTO radio_program(radio_key,name,slug) VALUES('radio-88','Legacy fixture','legacy-fixture') RETURNING id")).rows[0].id;
   const ed=(await c.query("INSERT INTO radio_program_edition(radio_key,program_id,starts_at,ends_at) VALUES('radio-88',$1,now(),now()+interval '1 hour') RETURNING id",[pr])).rows[0].id;
   for(const allow of [false,true])await c.query("INSERT INTO radio_poll(radio_key,program_id,edition_id,slug,question,identification_policy,allow_message,starts_at,ends_at) VALUES('radio-88',$1,$2,$3,'Legacy question?','optional',$4,now(),now()+interval '1 hour')",[pr,ed,'legacy-'+allow,allow]);
   await c.query(await readFile('database/migrations/0023_public_poll_intake.sql','utf8'));
   expect((await c.query('SELECT mode,allow_message FROM radio_poll ORDER BY allow_message')).rows).toEqual([{mode:'vote',allow_message:false},{mode:'mixed',allow_message:true}]);
  }finally{await c.query('ROLLBACK');c.release();}
 });
 it('has strict identity, recognizes existing legacy HMAC profile, never looks up by phone',async()=>{
  const p=await makePoll(),a=token(),b=token();
  expect((await post(p.id,'identity',a,{})).json()).toEqual({known:false});
  expect((await post(p.id,'identity',a,{phone:'11999999999'})).statusCode).toBe(400);
  const input={name:'Synthetic listener',neighborhood:'Centro synthetic',city:'Test city',phone:'11999999999',privacyAccepted:true};
  expect((await post(p.id,'identity',a,input)).json()).toEqual({known:true,displayName:input.name,neighborhood:input.neighborhood});
  expect((await post(p.id,'identity',a,{})).json().known).toBe(true);
  expect((await post(p.id,'identity',b,{})).json()).toEqual({known:false});
  const before=await counts();await post(p.id,'identity',b,{...input,name:'Other synthetic listener'});expect((await counts()).profiles).toBe(before.profiles+1);
  const consent=(await pool.query('SELECT privacy_notice_version,accepted_at FROM radio_poll_identity_consent WHERE poll_id=$1',[p.id])).rows[0];expect(consent.privacy_notice_version).toBe('poll-privacy-v1');expect(consent.accepted_at).toBeInstanceOf(Date);
  expect((await pool.query('SELECT marketing_opt_in FROM listener_profile WHERE name=$1',[input.name])).rows[0].marketing_opt_in).toBe(false);
  const legacy=token(),profile=(await pool.query("INSERT INTO listener_profile(name,neighborhood,city) VALUES('Legacy test','Legacy district','Test city') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO listener_device(token_hash,platform,listener_profile_id) VALUES($1,'web_mobile',$2)",[hashDeviceToken(legacy),profile]);
  expect((await post(p.id,'identity',legacy,{})).json()).toEqual({known:true,displayName:'Legacy test',neighborhood:'Legacy district'});
 });
 it('rejects revoked devices and inactive profiles without autorelink',async()=>{
  const p=await makePoll(),d=token(),input={name:'Blocked fixture',neighborhood:'Centro',city:'Test city',phone:'11999999999',privacyAccepted:true};
  await post(p.id,'identity',d,input);await pool.query('UPDATE listener_device SET revoked_at=now() WHERE token_hash=$1',[hashDeviceToken(d)]);
  expect((await post(p.id,'identity',d,input)).statusCode).toBe(403);expect((await post(p.id,'submit',d,{submissionId:randomUUID(),optionId:p.options[0].id,identified:false})).statusCode).toBe(403);
  await pool.query('UPDATE listener_device SET revoked_at=NULL WHERE token_hash=$1',[hashDeviceToken(d)]);
  await pool.query("UPDATE listener_profile SET status='blocked' WHERE id=(SELECT listener_profile_id FROM listener_device WHERE token_hash=$1)",[hashDeviceToken(d)]);
  expect((await post(p.id,'identity',d,{})).json()).toEqual({known:false});expect((await post(p.id,'identity',d,input)).statusCode).toBe(403);
 });
 it('writes atomic anonymous vote/message, dedupes, and returns identical retry receipt',async()=>{
  const p=await makePoll(),d=token(),before=await counts(),body={submissionId:randomUUID(),optionId:p.options[0].id,message:'porra <script>literal</script>',identified:false,privacyAccepted:true};
  const responses=await Promise.all([post(p.id,'submit',d,body),post(p.id,'submit',d,body)]);
  expect(responses.map(r=>r.statusCode)).toEqual([200,200]);expect(responses[0].json()).toEqual(responses[1].json());expect(responses[0].headers['cache-control']).toBe('no-store');
  expect(await counts()).toEqual({...before,votes:before.votes+1,messages:before.messages+1});
  expect((await post(p.id,'submit',d,{...body,message:'changed'})).statusCode).toBe(409);
  expect((await post(p.id,'submit',d,{...body,submissionId:randomUUID()})).statusCode).toBe(409);
  expect((await post(p.id,'submit',token(),body)).statusCode).toBe(409);
  await pool.query("UPDATE radio_poll SET state='closed' WHERE id=$1",[p.id]);expect((await post(p.id,'submit',d,body)).json()).toEqual(responses[0].json());
  const row=(await pool.query('SELECT display_name,neighborhood,message FROM radio_program_participation WHERE id=$1',[responses[0].json().messageId])).rows[0];expect(row).toEqual({display_name:null,neighborhood:null,message:body.message});
  const receipt=(await pool.query('SELECT * FROM radio_poll_submission WHERE poll_id=$1',[p.id])).rows[0];expect(receipt.listener_profile_id).toBeNull();expect(receipt.privacy_notice_version).toBe('poll-privacy-v1');
 });
 it('requires privacy for anonymous messages and identifies with immutable private neighborhood snapshots',async()=>{
  const p=await makePoll(),d=token(),before=await counts(),body={submissionId:randomUUID(),optionId:p.options[0].id,message:'Private synthetic message',identified:false};
  expect((await post(p.id,'submit',d,body)).statusCode).toBe(400);expect(await counts()).toEqual(before);
  expect((await post(p.id,'submit',d,{...body,identified:true,privacyAccepted:true})).statusCode).toBe(409);
  await post(p.id,'identity',d,{name:'Synthetic name',neighborhood:'Synthetic district',city:'Test city',phone:'11999999999',privacyAccepted:true});
  const submitted=await post(p.id,'submit',d,{...body,identified:true,privacyAccepted:true});expect(submitted.statusCode,submitted.body).toBe(200);
  const messageId=submitted.json().messageId;
  await pool.query("UPDATE listener_profile SET neighborhood='Changed district' WHERE id=(SELECT listener_profile_id FROM listener_device WHERE token_hash=$1)",[hashDeviceToken(d)]);
  const detail=await adminCall('GET','/participations/'+messageId);expect(detail.json().neighborhood).toBe('Synthetic district');expect(detail.json().displayName).toBe('Synthetic name');expect(detail.body).not.toContain('11999999999');
  await expect(pool.query("UPDATE radio_program_participation SET neighborhood='tamper',state='reviewed',version=version+1,moderated_at=now() WHERE id=$1",[messageId])).rejects.toMatchObject({code:'23514'});
 });
 it('validates modes/options atomically and freezes structure after message-only participation',async()=>{
  const p=await makePoll('message');expect(p.options).toEqual([]);
  const d=token(),body={submissionId:randomUUID(),message:'Message-only synthetic',identified:false,privacyAccepted:true};
  expect((await post(p.id,'submit',d,{...body,optionId:randomUUID()})).statusCode).toBe(400);
  expect((await post(p.id,'submit',d,body)).statusCode).toBe(200);
  await pool.query("UPDATE radio_poll SET state='scheduled' WHERE id=$1",[p.id]);
  const update={slug:p.slug,question:'Changed after message?',context:p.context,mode:'message',identificationPolicy:p.identificationPolicy,allowMessage:true,options:[],editionStartsAt:p.editionStartsAt,editionEndsAt:p.editionEndsAt,startsAt:p.startsAt,endsAt:p.endsAt,version:p.version,imageUrl:p.imageUrl};
  expect((await adminCall('PATCH','/polls/'+p.id,update)).statusCode).toBe(409);
 });
 it('accepts scheduled polls only inside their window and refuses a current-grade mismatch without partial writes',async()=>{
  const p=await makePoll('vote');await pool.query("UPDATE radio_poll SET state='scheduled',starts_at=now()+interval '30 minutes' WHERE id=$1",[p.id]);
  const body={submissionId:randomUUID(),optionId:p.options[0].id,identified:false};expect((await post(p.id,'submit',token(),body)).statusCode).toBe(409);
  await pool.query("UPDATE radio_poll SET starts_at=$2 WHERE id=$1",[p.id,startsAt]);expect((await post(p.id,'submit',token(),body)).statusCode).toBe(200);
  const before=await counts();expect((await post(p.id,'submit',token(),{...body,submissionId:randomUUID(),optionId:randomUUID()})).statusCode).toBe(400);expect(await counts()).toEqual(before);
  await pool.query('UPDATE radio_program_override SET active=false WHERE program_id=$1',[programId]);expect((await post(p.id,'submit',token(),{...body,submissionId:randomUUID()})).statusCode).toBe(422);expect(await counts()).toEqual(before);
 });
 it('revalidates server state after waiting on the poll lock',async()=>{
  const p=await makePoll('vote'),c=await pool.connect();
  try{await c.query('BEGIN');await c.query('SELECT id FROM radio_poll WHERE id=$1 FOR UPDATE',[p.id]);
   const request=Promise.resolve(post(p.id,'submit',token(),{submissionId:randomUUID(),optionId:p.options[0].id,identified:false}));
   await new Promise(r=>setTimeout(r,60));await c.query("UPDATE radio_poll SET state='closed' WHERE id=$1",[p.id]);await c.query('COMMIT');expect((await request).statusCode).toBe(409);
  }finally{await c.query('ROLLBACK');c.release();}
 });
 it('serves active polls from PostgreSQL, omits PII, and removes them from the public view on close',async()=>{
  const p=await makePoll();expect(p.state).toBe('published');
  const query=vi.spyOn(pool,'query');
  const active=await app.inject('/api/public/polls/active?programId='+programId),slug=await app.inject('/api/public/polls/'+p.slug);
  expect(active.statusCode,active.body).toBe(200);expect(active.json().poll.id).toBe(p.id);expect(slug.json().id).toBe(p.id);expect(query).toHaveBeenCalled();query.mockRestore();
  for(const key of ['phone','neighborhood','displayName','state','totalVotes','message','listenerProfileId'])expect(slug.json()).not.toHaveProperty(key);
  expect((await adminCall('POST','/polls/'+p.id+'/close',{version:p.version})).statusCode).toBe(200);
  expect((await app.inject('/api/public/polls/active?programId='+programId)).json()).toEqual({poll:null});expect((await app.inject('/api/public/polls/'+p.slug)).statusCode).toBe(404);
 });
 it('requires poll.publish scope and live session for snapshot publication',async()=>{
  const p=await makePoll(),user=randomUUID();await pool.query("INSERT INTO admin_user(id,name,username,password_hash,role) VALUES($1::uuid,'Read only',$1::text,'unused','viewer')",[user]);
  await pool.query("INSERT INTO admin_user_role(admin_user_id,role_id) SELECT $1,id FROM role WHERE key='announcer'",[user]);
  const sid=(await pool.query("INSERT INTO admin_session(admin_user_id,authz_version,expires_at) VALUES($1,1,now()+interval '1 hour') RETURNING id",[user])).rows[0].id;
  const auth=app.jwt.sign({sub:user,name:'Fixture',username:user,role:'viewer',sid,authzVersion:1});
  expect((await adminCall('POST','/polls/'+p.id+'/publish-public',{},auth)).statusCode).toBe(404);
  await pool.query("INSERT INTO admin_permission_override(admin_user_id,permission_id,effect,scope_type,reason,created_by_admin_user_id) SELECT $1,id,'ALLOW','participation','Synthetic scoped publish',$1 FROM permission WHERE key='poll.publish'",[user]);
  await pool.query("INSERT INTO radio_program_host(radio_key,program_id,admin_user_id,valid_from) VALUES('radio-88',$1,$2,now()-interval '1 hour')",[programId,user]);
  expect((await adminCall('POST','/polls/'+p.id+'/publish-public',{},auth)).statusCode).toBe(200);
  await pool.query('UPDATE radio_program_host SET active=false WHERE admin_user_id=$1',[user]);expect((await adminCall('POST','/polls/'+p.id+'/publish-public',{},auth)).statusCode).toBe(404);
 });
 it('rate limits identity and submission abuse without writing profiles',async()=>{
  const p=await makePoll('vote'),before=await counts(),d=token();
  const identity=[];for(let i=0;i<11;i++)identity.push(await post(p.id,'identity',d,{},'10.88.0.1'));
  expect(identity.slice(0,10).every(r=>r.statusCode===200)).toBe(true);expect(identity[10]!.statusCode).toBe(429);expect(identity[10]!.headers['cache-control']).toBe('no-store');
  const submit=[];for(let i=0;i<11;i++)submit.push(await post(p.id,'submit',d,{submissionId:randomUUID(),identified:false},'10.88.0.2'));
  expect(submit[10]!.statusCode).toBe(429);expect(await counts()).toEqual(before);
 });
});
