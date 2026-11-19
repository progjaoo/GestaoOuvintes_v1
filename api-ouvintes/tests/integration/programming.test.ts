import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { pool } from '../../src/database/client.js';
import type { FastifyInstance } from 'fastify';
const suite = process.env.RUN_PROGRAMMING_TESTS === 'true' ? describe : describe.skip;
suite('programming PostgreSQL integration', () => {
    let app: FastifyInstance, adminToken: string, announcerToken: string, announcerId: string, programId: string;
    async function session(role: string) {
        const id = randomUUID();
        await pool.query("INSERT INTO admin_user(id,name,username,password_hash,role,active) VALUES($1,'Fixture',$2,'not-used','viewer',true)", [id, id]);
        await pool.query('INSERT INTO admin_user_role(admin_user_id,role_id) SELECT $1,id FROM role WHERE key=$2', [id, role]);
        const s = await pool.query("INSERT INTO admin_session(admin_user_id,authz_version,expires_at) VALUES($1,1,now()+interval '1 hour') RETURNING id", [id]);
        return { id, token: app.jwt.sign({ sub: id, name: 'Fixture', username: id, role: 'viewer', sid: s.rows[0].id, authzVersion: 1 }) };
    }
    const headers = (token: string) => ({ authorization: `Bearer ${token}` });
    beforeAll(async () => {
        if (!process.env.DATABASE_URL?.includes('_test'))
            throw Error('Disposable test database required');
        app = await buildApp();
        await app.ready();
        adminToken = (await session('admin')).token;
        const a = await session('announcer');
        announcerToken = a.token;
        announcerId = a.id;
    });
    afterAll(async () => { await app?.close(); await pool.end(); });
    it('creates programs and rejects duplicate slugs', async () => {
        const input = { name: 'Fato Fixture', slug: 'fato-fixture' };
        const r = await app.inject({ method: 'POST', url: '/api/admin/programs', headers: headers(adminToken), payload: input });
        expect(r.statusCode).toBe(201);
        programId = r.json().id;
        expect((await app.inject({ method: 'POST', url: '/api/admin/programs', headers: headers(adminToken), payload: input })).statusCode).toBe(409);
    });
    it('does not grant management or unlinked read access to announcers', async () => {
        expect((await app.inject({ method: 'POST', url: '/api/admin/programs', headers: headers(announcerToken), payload: { name: 'Bad', slug: 'bad' } })).statusCode).toBe(403);
        expect((await app.inject({ method: 'GET', url: '/api/admin/programs', headers: headers(announcerToken) })).json().items).toEqual([]);
        expect((await app.inject({ method: 'GET', url: `/api/admin/programs/${programId}`, headers: headers(announcerToken) })).statusCode).toBe(404);
    });
    it('supports current host links and immediate removal of access', async () => {
        const url = `/api/admin/programs/${programId}/hosts/${announcerId}`;
        const payload = { active: true, validFrom: '2026-01-01T00:00:00Z', validUntil: null };
        expect((await app.inject({ method: 'PUT', url, headers: headers(adminToken), payload })).statusCode).toBe(200);
        expect((await app.inject({ method: 'GET', url: `/api/admin/programs/${programId}`, headers: headers(announcerToken) })).statusCode).toBe(200);
        await app.inject({ method: 'PUT', url, headers: headers(adminToken), payload: { ...payload, active: false } });
        expect((await app.inject({ method: 'GET', url: `/api/admin/programs/${programId}`, headers: headers(announcerToken) })).statusCode).toBe(404);
    });
    it('isolates other radio ids even from deployment administrators', async () => {
        await pool.query("INSERT INTO radio_programming_scope(key) VALUES('other')");
        const other = await pool.query("INSERT INTO radio_program(radio_key,name,slug) VALUES('other','Secret','secret') RETURNING id");
        expect((await app.inject({ method: 'GET', url: `/api/admin/programs/${other.rows[0].id}`, headers: headers(adminToken) })).statusCode).toBe(404);
        expect((await app.inject({ method: 'GET', url: '/api/admin/programs', headers: headers(adminToken) })).json().items).toHaveLength(1);
    });
    it('rejects stale edits and serializes conflicting slot writes', async () => {
        const edit = { name: 'Fato Fixture', slug: 'fato-fixture', version: 1 };
        expect((await app.inject({ method: 'PATCH', url: `/api/admin/programs/${programId}`, headers: headers(adminToken), payload: edit })).statusCode).toBe(200);
        expect((await app.inject({ method: 'PATCH', url: `/api/admin/programs/${programId}`, headers: headers(adminToken), payload: edit })).statusCode).toBe(409);
        const input = { weekday: 1, startMinute: 300, endMinute: 570, validFrom: '2026-11-01' };
        const results = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `/api/admin/programs/${programId}/slots`, headers: headers(adminToken), payload: input })));
        expect(results.map(r => r.statusCode).sort()).toEqual([201, 409]);
        const sim = await app.inject({ method: 'GET', url: '/api/admin/programming/simulate?at=2026-11-09T08:00:00Z', headers: headers(adminToken) });
        expect(sim.statusCode).toBe(200);
        expect(sim.json().current.programId).toBe(programId);
    });

    it('keeps two announcers isolated and honors expired links and inactive accounts', async () => {
        const b = await session('announcer');
        const created = await app.inject({method:'POST',url:'/api/admin/programs',headers:headers(adminToken),payload:{name:'Outro Fixture',slug:'outro-fixture'}});
        expect(created.statusCode).toBe(201);
        const secondId=created.json().id;
        const live={active:true,validFrom:new Date(Date.now()-86400000).toISOString(),validUntil:null};
        for(const [id,userId] of [[programId,announcerId],[secondId,b.id]]) {
            expect((await app.inject({method:'PUT',url:'/api/admin/programs/'+id+'/hosts/'+userId,headers:headers(adminToken),payload:live})).statusCode).toBe(200);
        }
        const aList=await app.inject({method:'GET',url:'/api/admin/programs',headers:headers(announcerToken)});
        const bList=await app.inject({method:'GET',url:'/api/admin/programs',headers:headers(b.token)});
        expect(aList.json().items.map((p:{id:string})=>p.id)).toEqual([programId]);
        expect(bList.json().items.map((p:{id:string})=>p.id)).toEqual([secondId]);
        expect((await app.inject({method:'GET',url:'/api/admin/programs/'+secondId,headers:headers(announcerToken)})).statusCode).toBe(404);
        await app.inject({method:'PUT',url:'/api/admin/programs/'+programId+'/hosts/'+announcerId,headers:headers(adminToken),payload:{...live,validUntil:new Date(Date.now()-60000).toISOString()}});
        expect((await app.inject({method:'GET',url:'/api/admin/programs',headers:headers(announcerToken)})).json().items).toEqual([]);
        await pool.query('UPDATE admin_user SET active=false WHERE id=$1',[b.id]);
        expect((await app.inject({method:'GET',url:'/api/admin/programs',headers:headers(b.token)})).statusCode).toBe(401);
    });

 it('rolls back multi-day batches on conflict, and persists public presenter names',async()=>{
  const slot={weekday:1,startMinute:300,endMinute:570,validFrom:'2026-11-01',validUntil:null,active:true};
  expect((await app.inject({method:'POST',url:'/api/admin/programs/'+programId+'/slots/batch',headers:headers(adminToken),payload:{weekdays:[2,1],slot}})).statusCode).toBe(409);
  expect(Number((await pool.query('SELECT count(*) FROM radio_program_slot WHERE program_id=$1 AND weekday=2',[programId])).rows[0].count)).toBe(0);
  expect((await app.inject({method:'POST',url:'/api/admin/programs/'+programId+'/slots/batch',headers:headers(adminToken),payload:{weekdays:[2,3,4,5],slot}})).statusCode).toBe(201);
  const current=(await app.inject({url:'/api/admin/programs/'+programId,headers:headers(adminToken)})).json().program;
  const saved=await app.inject({method:'PATCH',url:'/api/admin/programs/'+programId,headers:headers(adminToken),payload:{name:current.name,slug:current.slug,version:current.version,presenters:['Public Host'],imageAssetId:null}});
  expect(saved.statusCode).toBe(200);expect(saved.json().presenters).toEqual(['Public Host']);
  const payload=(await pool.query("SELECT payload FROM radio_programming_publication ORDER BY revision DESC LIMIT 1")).rows[0].payload;
  expect(JSON.stringify(payload)).not.toContain(announcerId);expect(payload.programs.find((p:{id:string})=>p.id===programId).presenters).toEqual(['Public Host']);
 });
 it('prioritizes an interruption and rejects overlapping exceptions',async()=>{
  const input={programId:null,startsAt:'2026-11-09T08:00:00Z',endsAt:'2026-11-09T09:00:00Z',reason:'Private interruption reason',active:true};
  const r=await app.inject({method:'POST',url:'/api/admin/programming/overrides',headers:headers(adminToken),payload:input});expect(r.statusCode).toBe(201);
  expect((await app.inject({method:'POST',url:'/api/admin/programming/overrides',headers:headers(adminToken),payload:input})).statusCode).toBe(409);
  expect((await app.inject({url:'/api/admin/programming/simulate?at=2026-11-09T08:10:00Z',headers:headers(adminToken)})).json().current).toBeNull();
  expect((await app.inject({method:'PATCH',url:'/api/admin/programming/overrides/'+r.json().id,headers:headers(adminToken),payload:{...input,active:false,version:1}})).statusCode).toBe(200);
  expect((await app.inject({url:'/api/admin/programming/simulate?at=2026-11-09T08:10:00Z',headers:headers(adminToken)})).json().current.programId).toBe(programId);
 });
});
