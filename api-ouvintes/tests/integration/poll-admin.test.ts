import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {buildApp} from '../../src/app.js';
import {pool} from '../../src/database/client.js';
import type {FastifyInstance} from 'fastify';
const suite=process.env.RUN_POLL_TESTS==='true'?describe:describe.skip;
suite('poll admin disposable PostgreSQL',()=>{
 let app:FastifyInstance,admin:string,host:string,hostId:string,programId:string,poll:any;
 const input={slug:'fixture-poll',question:'Private fixture question?',context:'Private context',identificationPolicy:'optional',allowMessage:false,options:['Alpha','Beta'],editionStartsAt:'2099-11-09T08:00:00Z',editionEndsAt:'2099-11-09T12:30:00Z',startsAt:'2099-11-09T08:00:00Z',endsAt:'2099-11-09T12:30:00Z'};
 async function session(role:string){const id=randomUUID();await pool.query("INSERT INTO admin_user(id,name,username,password_hash,role,active) VALUES($1::uuid,'Poll fixture',$1::text,'unused','viewer',true)",[id]);await pool.query('INSERT INTO admin_user_role(admin_user_id,role_id) SELECT $1,id FROM role WHERE key=$2',[id,role]);const s=await pool.query("INSERT INTO admin_session(admin_user_id,authz_version,expires_at) VALUES($1,1,now()+interval '1 hour') RETURNING id",[id]);return {id,token:app.jwt.sign({sub:id,name:'Fixture',username:id,role:'viewer',sid:s.rows[0].id,authzVersion:1})};}
 const call=(method:any,url:string,token=admin,payload?:any)=>app.inject({method,url:'/api/admin'+url,headers:{authorization:'Bearer '+token},payload});
 beforeAll(async()=>{
 if(!process.env.DATABASE_URL?.includes('_test'))throw Error('Disposable _test database required');
 app=await buildApp();await app.ready();admin=(await session('admin')).token;const h=await session('announcer');host=h.token;hostId=h.id;
 programId=(await pool.query("INSERT INTO radio_program(radio_key,name,slug) VALUES('radio-88','Poll fixture','poll-fixture') RETURNING id")).rows[0].id;
 // 2099-11-09 is Monday, local 05:00-09:30.
 await pool.query("INSERT INTO radio_program_slot(radio_key,program_id,weekday,start_minute,end_minute,valid_from) VALUES('radio-88',$1,1,300,570,'2099-01-01')",[programId]);
 });
 afterAll(async()=>{await app?.close();await pool.end();});
 it('creates contract DTO and does not enqueue public programming',async()=>{
 const before=(await pool.query('SELECT count(*) FROM radio_programming_publication')).rows[0].count;
 const r=await call('POST','/programs/'+programId+'/polls',admin,input);expect(r.statusCode,r.body).toBe(201);poll=r.json();expect(poll.state).toBe('draft');expect(poll.totalVotes).toBe(0);expect(poll.programName).toBe('Poll fixture');expect(poll.context).toBe(input.context);expect(r.headers['cache-control']).toBe('no-store');
 expect((await pool.query('SELECT count(*) FROM radio_programming_publication')).rows[0].count).toBe(before);
 });
 it('filters by current link and respects DENY on independent action',async()=>{
 expect((await call('GET','/polls',host)).json().items).toEqual([]);expect((await call('GET','/polls/'+poll.id,host)).statusCode).toBe(404);
 await pool.query("INSERT INTO radio_program_host(radio_key,program_id,admin_user_id,valid_from) VALUES('radio-88',$1,$2,now()-interval '1 day')",[programId,hostId]);
 expect((await call('GET','/polls',host)).json().items).toHaveLength(1);
 expect((await call('GET','/polls/'+poll.id+'/results',host)).statusCode).toBe(200);
 await pool.query("INSERT INTO admin_permission_override(admin_user_id,permission_id,effect,scope_type,reason,created_by_admin_user_id) SELECT $1,id,'DENY',NULL,'T09 fixture deny',$1 FROM permission WHERE key='poll.results.read'",[hostId]);
 expect((await call('GET','/polls/'+poll.id+'/results',host)).statusCode).toBe(404);
 expect((await call('POST','/polls/'+poll.id+'/publish',host,{version:1})).statusCode).toBe(404);
 await pool.query('UPDATE radio_program_host SET active=false WHERE admin_user_id=$1',[hostId]);
 expect((await call('GET','/polls/'+poll.id,host)).statusCode).toBe(404);
 });
 it('serializes optimistic edits and rejects arbitrary edition',async()=>{
 const results=await Promise.all([1,2].map(()=>call('PATCH','/polls/'+poll.id,admin,{...input,version:1})));
 expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);poll=results.find(r=>r.statusCode===200)!.json();
 expect((await call('PATCH','/polls/'+poll.id,admin,{...input,editionStartsAt:'2099-11-09T08:01:00Z',startsAt:'2099-11-09T08:01:00Z',version:poll.version})).statusCode).toBe(422);
 });
 it('uses real vote aggregates, rejects cross-poll options, locks structure/history',async()=>{
 const other=await call('POST','/programs/'+programId+'/polls',admin,{...input,slug:'other-poll'});expect(other.statusCode,other.body).toBe(201);
 await expect(pool.query("INSERT INTO radio_poll_vote(radio_key,program_id,poll_id,option_id,voter_key) VALUES('radio-88',$1,$2,$3,$4)",[programId,poll.id,other.json().options[0].id,randomUUID()])).rejects.toMatchObject({code:'23503'});
 const voter=randomUUID();
 const vote=()=>pool.query("INSERT INTO radio_poll_vote(radio_key,program_id,poll_id,option_id,voter_key) VALUES('radio-88',$1,$2,$3,$4)",[programId,poll.id,poll.options[0].id,voter]);
 await vote();await expect(vote()).rejects.toMatchObject({code:'23505'});
 const result=(await call('GET','/polls/'+poll.id+'/results')).json();expect(result.totalVotes).toBe(1);expect(result.options.map((o:any)=>o.votes)).toEqual([1,0]);expect(result.options[0].percentage).toBe(100);
 expect((await call('GET','/polls/'+poll.id)).json().totalVotes).toBe(1);
 for(const change of [{question:'Changed question?'},{identificationPolicy:'required'},{options:['Beta','Alpha']},{startsAt:'2099-11-09T08:01:00Z'},{allowMessage:true}])expect((await call('PATCH','/polls/'+poll.id,admin,{...input,...change,version:poll.version})).statusCode).toBe(409);
 });
 it('schedules with exclusive main slot, closes archives and never reopens',async()=>{
 const r=await call('POST','/polls/'+poll.id+'/publish',admin,{version:poll.version});expect(r.statusCode,r.body).toBe(200);poll=r.json();expect(poll.state).toBe('scheduled');
 const other=(await call('GET','/polls')).json().items.find((p:any)=>p.slug==='other-poll');
 expect((await call('POST','/polls/'+other.id+'/publish',admin,{version:other.version})).statusCode).toBe(409);
 poll=(await call('POST','/polls/'+poll.id+'/close',admin,{version:poll.version})).json();expect(poll.state).toBe('closed');
 expect((await call('POST','/polls/'+poll.id+'/publish',admin,{version:poll.version})).statusCode).toBe(409);
 poll=(await call('POST','/polls/'+poll.id+'/archive',admin,{version:poll.version})).json();expect(poll.state).toBe('archived');
 const audit=await pool.query("SELECT metadata FROM admin_audit_log WHERE resource_type='radio_poll'");expect(JSON.stringify(audit.rows)).not.toContain(input.question);expect(JSON.stringify(audit.rows)).not.toContain(input.context);
 });
 it('supports explicit linked manage grant and revalidates link after programming lock',async()=>{
 await pool.query("UPDATE radio_program_host SET active=true,valid_until=NULL WHERE admin_user_id=$1",[hostId]);
 await pool.query("INSERT INTO admin_permission_override(admin_user_id,permission_id,effect,scope_type,reason,created_by_admin_user_id) SELECT $1,id,'ALLOW','participation','T09 scoped manage',$1 FROM permission WHERE key='poll.manage'",[hostId]);
 const r=await call('POST','/programs/'+programId+'/polls',host,{...input,slug:'linked-poll'});expect(r.statusCode,r.body).toBe(201);
 const c=await pool.connect();
 try{await c.query('BEGIN');await c.query("SELECT key FROM radio_programming_scope WHERE key='radio-88' FOR UPDATE");
 const request=call('PATCH','/polls/'+r.json().id,host,{...input,slug:'linked-poll',version:1});
 // Dispatch injection before releasing the programming writer lock.
 const pending=Promise.resolve(request);await new Promise(resolve=>setTimeout(resolve,50));
 await c.query("UPDATE radio_program_host SET active=false WHERE admin_user_id=$1",[hostId]);await c.query('COMMIT');
 expect((await pending).statusCode).toBe(404);
 }finally{await c.query('ROLLBACK');c.release();}
 });
 it('publishes now only for exact eligible edition and refuses stale/interrupted publication',async()=>{
 const now=Date.now();const starts=new Date(now-60000).toISOString(),ends=new Date(now+3600000).toISOString();
 const override=await pool.query("INSERT INTO radio_program_override(radio_key,program_id,starts_at,ends_at,reason) VALUES('radio-88',$1,$2,$3,'T09 synthetic edition') RETURNING id",[programId,starts,ends]);
 const body={...input,slug:'current-poll',editionStartsAt:starts,editionEndsAt:ends,startsAt:starts,endsAt:ends};
 const created=await call('POST','/programs/'+programId+'/polls',admin,body);expect(created.statusCode,created.body).toBe(201);
 const published=await call('POST','/polls/'+created.json().id+'/publish',admin,{version:1});expect(published.statusCode,published.body).toBe(200);expect(published.json().state).toBe('published');
 expect((await call('PATCH','/polls/'+created.json().id,admin,{...body,version:2})).statusCode).toBe(409);
 await call('POST','/polls/'+created.json().id+'/close',admin,{version:2});
 const second=await call('POST','/programs/'+programId+'/polls',admin,{...body,slug:'interrupted-poll'});expect(second.statusCode).toBe(201);
 await pool.query('UPDATE radio_program_override SET active=false WHERE id=$1',[override.rows[0].id]);
 expect((await call('POST','/polls/'+second.json().id+'/publish',admin,{version:1})).statusCode).toBe(422);
 });
 it('isolates radio FKs and direct IDs and rejects revoked session mutations',async()=>{
 await pool.query("INSERT INTO radio_programming_scope(key) VALUES('t09-other')");
 const other=(await pool.query("INSERT INTO radio_program(radio_key,name,slug) VALUES('t09-other','Secret','secret') RETURNING id")).rows[0].id;
 expect((await call('POST','/programs/'+other+'/polls',admin,{...input,slug:'foreign'})).statusCode).toBe(404);
 const ed=(await pool.query("SELECT id FROM radio_program_edition WHERE program_id=$1 LIMIT 1",[programId])).rows[0].id;
 await expect(pool.query("INSERT INTO radio_poll(radio_key,program_id,edition_id,slug,question,identification_policy,starts_at,ends_at) VALUES('t09-other',$1,$2,'bad','Bad foreign poll','anonymous',now(),now()+interval '1 hour')",[other,ed])).rejects.toMatchObject({code:'23503'});
 await pool.query("UPDATE admin_session SET revoked_at=now(),revoke_reason='T09 revoke' WHERE admin_user_id IN(SELECT id FROM admin_user WHERE username=$1)",[app.jwt.decode<{sub:string}>(admin)!.sub]);
 expect((await call('POST','/programs/'+programId+'/polls',admin,{...input,slug:'revoked'})).statusCode).toBe(401);
 });

});
