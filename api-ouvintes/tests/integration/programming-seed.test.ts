import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { REAL_PROGRAMS, seedRealProgramming } from '../../src/database/seeds/programming-real.js';

const suite = process.env.RUN_PROGRAMMING_SEED_TESTS === 'true' ? describe : describe.skip;
suite('real programming seed in disposable PostgreSQL', () => {
  let client: pg.PoolClient;
  const pool = new pg.Pool({ connectionString: process.env.PROGRAMMING_SEED_DATABASE_URL });
  beforeAll(async () => {
    if (!new URL(process.env.PROGRAMMING_SEED_DATABASE_URL!).pathname.endsWith('_test')) throw new Error('Disposable database required');
    client = await pool.connect();
  });
  afterAll(async () => { client?.release(); await pool.end(); });
  it('has exactly the approved catalog and 37 weekly slots', () => {
    expect(REAL_PROGRAMS).toHaveLength(11);
    expect(REAL_PROGRAMS.reduce((n,p) => n+p.days.length,0)).toBe(37);
    expect(REAL_PROGRAMS.flatMap(p=>p.presenters)).toContain('Miquéias Nechaeff');
  });
  it('rolls a dry run back and never provisions accounts', async () => {
    expect(await seedRealProgramming(client)).toMatchObject({ programsCreated: 11, slotsCreated: 37, applied: false });
    expect((await client.query('SELECT count(*)::int AS n FROM radio_program')).rows[0].n).toBe(0);
    expect((await client.query('SELECT count(*)::int AS n FROM admin_user')).rows[0].n).toBe(0);
  });
  it('applies twice without duplicating or changing IDs or user edits', async () => {
    expect(await seedRealProgramming(client,true)).toMatchObject({programsCreated:11,slotsCreated:37});
    await client.query("UPDATE radio_program SET description='Edicao preservada',presenters='[\"Nome editado\"]' WHERE slug='favorito'");
    const before = (await client.query('SELECT id FROM radio_program_slot ORDER BY id')).rows;
    expect(await seedRealProgramming(client,true)).toMatchObject({programsCreated:0,slotsCreated:0,programsPreserved:11,slotsPreserved:37});
    expect((await client.query('SELECT id FROM radio_program_slot ORDER BY id')).rows).toEqual(before);
    expect((await client.query("SELECT description,presenters FROM radio_program WHERE slug='favorito'")).rows[0]).toEqual({description:'Edicao preservada',presenters:['Nome editado']});
    expect((await client.query('SELECT count(*)::int AS n FROM radio_program_host')).rows[0].n).toBe(0);
    expect((await client.query('SELECT count(*)::int AS n FROM radio_poll')).rows[0].n).toBe(0);
  });
  it('handles Cristo Vive at midnight without creating accounts', async () => {
    const r=await client.query("SELECT end_minute FROM radio_program_slot s JOIN radio_program p ON p.id=s.program_id WHERE p.slug='cristo-vive'");
    expect(r.rows).toEqual([{end_minute:0},{end_minute:0}]);
    expect((await client.query('SELECT count(*)::int AS n FROM admin_user')).rows[0].n).toBe(0);
  });
  it('rejects conflicting recurrences atomically', async () => {
    await client.query("UPDATE radio_program_slot SET start_minute=290 WHERE weekday=1 AND start_minute=300");
    await expect(seedRealProgramming(client,true)).rejects.toThrow('Conflito na grade');
    expect((await client.query('SELECT count(*)::int AS n FROM radio_program_slot')).rows[0].n).toBe(37);
  });
});
