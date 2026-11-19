import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { pool } from '../../src/database/client.js';
import { env } from '../../src/config/env.js';

const suite = process.env.RUN_PARTICIPATION_TESTS === 'true' ? describe : describe.skip;
interface Actor { id: string; token: string; sessionId: string }
interface Fixture { programId: string; editionId: string; pollId: string; id: string }
const privateMessage = 'PRIVATE_MESSAGE_SENTINEL: texto literal <nao-renderizar-como-html>.';
const privateName = 'PRIVATE_NAME_SENTINEL';
const privateNote = 'PRIVATE_NOTE_SENTINEL';
suite('participation admin disposable PostgreSQL', () => {
  let app: FastifyInstance, admin: Actor, hostA: Actor, hostB: Actor, a: Fixture, b: Fixture, foreign: Fixture;
  let queueBefore: string;
  const storageSend = vi.spyOn(S3Client.prototype, 'send').mockImplementation(() => { throw Error('Storage IO forbidden in admin moderation tests'); });
  async function actor(role = 'viewer'): Promise<Actor> {
    const id = randomUUID();
    await pool.query(`INSERT INTO admin_user(id,name,username,password_hash,role,active)
      VALUES($1,'Synthetic participation actor',$2,'unused','viewer',true)`, [id, id]);
    await pool.query('INSERT INTO admin_user_role(admin_user_id,role_id) SELECT $1,id FROM role WHERE key=$2', [id, role]);
    const s = await pool.query<{id: string}>(`INSERT INTO admin_session(admin_user_id,authz_version,expires_at)
      VALUES($1,1,now()+interval '1 hour') RETURNING id`, [id]);
    const sessionId = s.rows[0]!.id;
    return {id, sessionId, token: app.jwt.sign({sub: id, sid: sessionId, authzVersion: 1, name: 'Synthetic', username: id, role: 'viewer'})};
  }
  async function grant(user: Actor, key: string, scope: 'global' | 'participation' | null, effect = 'ALLOW') {
    await pool.query(`INSERT INTO admin_permission_override(admin_user_id,permission_id,effect,scope_type,reason,created_by_admin_user_id)
      SELECT $1,id,$3,$4,'Synthetic test permission',$1 FROM permission WHERE key=$2
      ON CONFLICT(admin_user_id,permission_id) DO UPDATE SET effect=EXCLUDED.effect,scope_type=EXCLUDED.scope_type`,
    [user.id, key, effect, scope]);
  }
  async function link(user: Actor, programId: string, expired = false) {
    await pool.query(`INSERT INTO radio_program_host(radio_key,program_id,admin_user_id,valid_from,valid_until)
      VALUES('radio-88',$1,$2,now()-interval '1 day',CASE WHEN $3 THEN now()-interval '1 minute' ELSE NULL END)
      ON CONFLICT(radio_key,program_id,admin_user_id) DO UPDATE SET active=true,valid_until=EXCLUDED.valid_until`, [programId, user.id, expired]);
  }
  async function fixture(radio = 'radio-88'): Promise<Fixture> {
    const suffix = randomUUID();
    const programId = (await pool.query<{id: string}>(`INSERT INTO radio_program(radio_key,name,slug)
      VALUES($1,'Synthetic program',$2) RETURNING id`, [radio, suffix])).rows[0]!.id;
    const editionId = (await pool.query<{id: string}>(`INSERT INTO radio_program_edition(radio_key,program_id,starts_at,ends_at)
      VALUES($1,$2,'2026-11-11T08:00:00Z','2026-11-11T12:00:00Z') RETURNING id`, [radio, programId])).rows[0]!.id;
    const pollId = (await pool.query<{id: string}>(`INSERT INTO radio_poll(radio_key,program_id,edition_id,slug,question,identification_policy,starts_at,ends_at)
      VALUES($1,$2,$3,$4,'Private poll question','optional','2026-11-11T08:00:00Z','2026-11-11T12:00:00Z') RETURNING id`, [radio, programId, editionId, suffix])).rows[0]!.id;
    const id = (await pool.query<{id: string}>(`INSERT INTO radio_program_participation(radio_key,program_id,edition_id,poll_id,message,display_name)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [radio, programId, editionId, pollId, privateMessage, privateName])).rows[0]!.id;
    return {programId, editionId, pollId, id};
  }
  const call = (method: "GET" | "PATCH" | "POST" | "DELETE", path: string, user: Actor = admin, payload?: object) => app.inject({
    method, url: '/api/admin/participations' + path, headers: {authorization: 'Bearer ' + user.token}, payload,
  });
  const moderate = (id: string, user = admin, version = 1, state = 'reviewed', note?: string) =>
    call('PATCH', '/' + id + '/moderation', user, {version, state, ...(note === undefined ? {} : {note})});
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.includes('_test')) {
      throw Error('Local disposable _test database required');
    }
    if (!env.POLLS_ENABLED) throw Error('POLLS_ENABLED=true required for this suite');
    app = await buildApp(); await app.ready();
    admin = await actor('admin'); hostA = await actor('announcer'); hostB = await actor('announcer');
    a = await fixture(); b = await fixture();
    await pool.query("INSERT INTO radio_programming_scope(key) VALUES('participation-other')");
    foreign = await fixture('participation-other');
    await link(hostA, a.programId); await link(hostB, b.programId);
    queueBefore = (await pool.query<{count: string}>('SELECT count(*) FROM radio_programming_publication')).rows[0]!.count;
  });
  afterAll(async () => { storageSend.mockRestore(); await app?.close(); await pool.end(); });

  it('returns exact DTO, filtered cursor lists, and never contacts or foreign radio data', async () => {
    const r = await call('GET', '/' + a.id); expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toEqual({id: a.id, programId: a.programId, programName: 'Synthetic program', pollId: a.pollId,
      pollQuestion: 'Private poll question', editionStartsAt: '2026-11-11T08:00:00.000Z', editionEndsAt: '2026-11-11T12:00:00.000Z',
      receivedAt: expect.any(String), state: 'received', version: 1, displayName: privateName, message: privateMessage,
      moderatedAt: null, moderationNote: null});
    for (const filter of ['programId=' + a.programId, 'pollId=' + a.pollId, 'programId=' + a.programId + '&state=received']) {
      expect((await call('GET', '?' + filter)).json().items.map((p: {id: string}) => p.id)).toEqual([a.id]);
    }
    const sorted = [a.id, b.id].sort();
    expect((await call('GET', '?after=' + sorted[0])).json().items.map((p: {id: string}) => p.id)).toEqual([sorted[1]]);
    expect((await call('GET', '/' + foreign.id)).statusCode).toBe(404);
    expect((await call('GET', '?programId=' + foreign.programId)).json()).toEqual({items: [], nextCursor: null});
  });
  it('separates two linked announcers and gives read-only no moderation', async () => {
    expect((await call('GET', '', hostA)).json().items.map((p: {id: string}) => p.id)).toEqual([a.id]);
    expect((await call('GET', '', hostB)).json().items.map((p: {id: string}) => p.id)).toEqual([b.id]);
    expect((await call('GET', '/' + b.id, hostA)).statusCode).toBe(404);
    const r = await moderate(a.id, hostA); expect(r.statusCode).toBe(404); expect(r.headers['cache-control']).toBe('no-store');
    expect((await call('GET', '/' + a.id)).json().state).toBe('received');
  });
  it('never substitutes poll.read or moderate-only for participation.read', async () => {
    const pollOnly = await actor(), moderateOnly = await actor();
    await grant(pollOnly, 'poll.read', 'global'); await grant(moderateOnly, 'participation.moderate', 'global');
    for (const user of [pollOnly, moderateOnly]) {
      expect((await call('GET', '', user)).json()).toEqual({items: [], nextCursor: null});
      expect((await call('GET', '/' + a.id, user)).statusCode).toBe(404);
      expect((await moderate(a.id, user)).statusCode).toBe(404);
    }
  });
  it('requires each permission to cover the same program with mixed scopes', async () => {
    const globalRead = await actor(), globalModerate = await actor();
    await grant(globalRead, 'participation.read', 'global'); await grant(globalRead, 'participation.moderate', 'participation');
    await grant(globalModerate, 'participation.read', 'participation'); await grant(globalModerate, 'participation.moderate', 'global');
    for (const user of [globalRead, globalModerate]) {
      await link(user, a.programId);
      const own = await fixture(); await link(user, own.programId);
      expect((await moderate(own.id, user)).statusCode).toBe(200);
      expect((await moderate(b.id, user)).statusCode).toBe(404);
      await link(user, a.programId, true);
      expect((await moderate(a.id, user)).statusCode).toBe(404);
    }
  });
  it('permits explicit linked moderation and remoderation but never content or received', async () => {
    await grant(hostA, 'participation.moderate', 'participation');
    let r = await moderate(a.id, hostA, 1, 'reviewed', privateNote); expect(r.statusCode, r.body).toBe(200);
    expect(r.json().moderationNote).toBe(privateNote); expect(r.json().moderatedAt).toEqual(expect.any(String));
    r = await moderate(a.id, hostA, 2, 'selected'); expect(r.statusCode).toBe(200);
    expect(r.json().moderationNote).toBe(privateNote);
    r = await moderate(a.id, hostA, 3, 'rejected', ''); expect(r.statusCode).toBe(200);
    expect(r.json().moderationNote).toBeNull();
    expect((await call('GET', '/' + a.id, hostA)).json().moderationNote).toBeNull();
    r = await moderate(a.id, hostA, 4, 'rejected', 'a'.repeat(500)); expect(r.json().version).toBe(5);
    for (const payload of [{version: 4, state: 'received'}, {version: 4, state: 'reviewed', message: 'changed'},
      {version: 4, state: 'reviewed', displayName: 'changed'}, {version: 4, state: 'selected', note: 'a'.repeat(501)}]) {
      const invalid = await call('PATCH', '/' + a.id + '/moderation', hostA, payload);
      expect(invalid.statusCode).toBe(400); expect(invalid.headers['cache-control']).toBe('no-store');
    }
    expect(r.json().message).toBe(privateMessage); expect(r.json().displayName).toBe(privateName);
  });
  it('serializes concurrent moderation to 200/409 with exactly one audit event', async () => {
    const f = await fixture();
    const results = await Promise.all([moderate(f.id, admin, 1, 'reviewed', privateNote), moderate(f.id, admin, 1, 'selected')]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find(r => r.statusCode === 409)!.headers['cache-control']).toBe('no-store');
    const count = await pool.query<{count: string}>('SELECT count(*) FROM admin_audit_log WHERE resource_id=$1', [f.id]);
    expect(count.rows[0]!.count).toBe('1');
  });
  it('DENY read or moderate defeats role/global access independently', async () => {
    for (const key of ['participation.read', 'participation.moderate']) {
      const user = await actor('admin'); await grant(user, key, null, 'DENY');
      expect((await moderate(b.id, user)).statusCode).toBe(404);
      if (key === 'participation.read') {
        expect((await call('GET', '', user)).json().items).toEqual([]);
        expect((await call('GET', '/' + b.id, user)).statusCode).toBe(404);
      } else expect((await call('GET', '/' + b.id, user)).statusCode).toBe(200);
    }
  });
  it('rechecks link after waiting for programming writer lock', async () => {
    const user = await actor('announcer'); await link(user, b.programId); await grant(user, 'participation.moderate', 'participation');
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); await c.query("SELECT key FROM radio_programming_scope WHERE key='radio-88' FOR UPDATE");
      let completed = false;
      const pending = Promise.resolve(moderate(b.id, user)).then(r => { completed = true; return r; });
      await new Promise(resolve => setTimeout(resolve, 80)); expect(completed).toBe(false);
      await c.query('UPDATE radio_program_host SET active=false WHERE admin_user_id=$1', [user.id]); await c.query('COMMIT');
      expect((await pending).statusCode).toBe(404);
    } finally { await c.query('ROLLBACK'); c.release(); }
  });
  it('rechecks session after waiting for identity writer lock and sends no-store 401', async () => {
    const user = await actor('admin'), c = await pool.connect();
    try {
      await c.query('BEGIN'); await c.query('SELECT pg_advisory_xact_lock(881188,12)');
      let completed = false;
      const pending = Promise.resolve(moderate(b.id, user)).then(r => { completed = true; return r; });
      await new Promise(resolve => setTimeout(resolve, 80)); expect(completed).toBe(false);
      await c.query("UPDATE admin_session SET revoked_at=now(),revoke_reason='Synthetic revocation' WHERE id=$1", [user.sessionId]); await c.query('COMMIT');
      const r = await pending; expect(r.statusCode).toBe(401); expect(r.headers['cache-control']).toBe('no-store');
    } finally { await c.query('ROLLBACK'); c.release(); }
  });
  it('rejects foreign program/radio/poll/edition FKs and preserves source content in direct SQL', async () => {
    const secondEdition = (await pool.query<{id: string}>(`INSERT INTO radio_program_edition(radio_key,program_id,starts_at,ends_at)
      VALUES('radio-88',$1,'2026-11-12T08:00:00Z','2026-11-12T12:00:00Z') RETURNING id`, [a.programId])).rows[0]!.id;
    for (const values of [ ['radio-88', b.programId, a.editionId, a.pollId],
      ['participation-other', a.programId, a.editionId, a.pollId], ['radio-88', a.programId, secondEdition, a.pollId],
      ['radio-88', a.programId, a.editionId, b.pollId] ]) {
      await expect(pool.query(`INSERT INTO radio_program_participation(radio_key,program_id,edition_id,poll_id,message)
        VALUES($1,$2,$3,$4,'Synthetic FK fixture')`, values)).rejects.toMatchObject({code: '23503'});
    }
    const f = await fixture();
    for (const change of ["message='changed'", "display_name='changed'", 'program_id=gen_random_uuid()',
      'poll_id=gen_random_uuid()', 'edition_id=gen_random_uuid()', "radio_key='changed'", 'id=gen_random_uuid()', "created_at=now()-interval '1 day'"]) {
      await expect(pool.query(`UPDATE radio_program_participation SET ${change},state='reviewed',version=version+1,moderated_at=now() WHERE id=$1`, [f.id])).rejects.toMatchObject({code: '23514'});
    }
    await moderate(f.id);
    await expect(pool.query("UPDATE radio_program_participation SET state='received',version=version+1,moderated_at=NULL WHERE id=$1", [f.id])).rejects.toMatchObject({code: '23514'});
    expect((await call('GET', '/' + f.id)).json().message).toBe(privateMessage);
  });
  it('paginates only authorized rows without leaking hidden counts or cursors', async () => {
    const f = await fixture();
    await pool.query(`INSERT INTO radio_program_participation(radio_key,program_id,edition_id,poll_id,message)
      SELECT 'radio-88',$1,$2,$3,'Synthetic pagination fixture' FROM generate_series(1,101)`, [f.programId,f.editionId,f.pollId]);
    const first = (await call('GET', '?pollId=' + f.pollId)).json();
    expect(first.items).toHaveLength(100); expect(first.nextCursor).toBe(first.items[99].id);
    const second = (await call('GET', '?pollId=' + f.pollId + '&after=' + first.nextCursor)).json();
    expect(second.items).toHaveLength(2); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items,...second.items].map((p: {id: string})=>p.id)).size).toBe(102);
    expect((await call('GET', '?pollId=' + f.pollId, hostB)).json()).toEqual({items:[],nextCursor:null});
  });
  it('has no content mutation/intake routes and feature disabled returns 404', async () => {
    expect((await call('PATCH', '/' + a.id, admin, {message: 'changed'})).statusCode).toBe(404);
    expect((await call('POST', '', admin, {message: 'fixture'})).statusCode).toBe(404);
    expect((await call('DELETE', '/' + a.id)).statusCode).toBe(404);
    const enabled = env.POLLS_ENABLED; env.POLLS_ENABLED = false;
    let disabled: FastifyInstance | undefined;
    try {
      disabled = await buildApp(); await disabled.ready();
      const r = await disabled.inject({url: '/api/admin/participations', headers: {authorization: 'Bearer ' + admin.token}});
      expect(r.statusCode).toBe(404);
    } finally { env.POLLS_ENABLED = enabled; await disabled?.close(); }
  });
  it('audit omits private message/name/note and moderation creates no programming publication', async () => {
    const audit = await pool.query<{metadata: unknown}>("SELECT metadata FROM admin_audit_log WHERE resource_type='radio_program_participation'");
    expect(audit.rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(audit.rows);
    for (const text of [privateMessage, privateName, privateNote, 'Private poll question']) expect(serialized).not.toContain(text);
    for (const row of audit.rows) expect(Object.keys(row.metadata as object).sort()).toEqual(['editionId','pollId','programId','radioKey','state','version']);
    expect((await pool.query<{count: string}>('SELECT count(*) FROM radio_programming_publication')).rows[0]!.count).toBe(queueBefore);
    expect(storageSend).not.toHaveBeenCalled();
    const contacts = await pool.query<{column_name: string}>("SELECT column_name FROM information_schema.columns WHERE table_name='radio_program_participation' AND column_name ~ 'phone|email|contact'");
    expect(contacts.rows).toEqual([]);
  });
});
