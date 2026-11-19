import type { PoolClient } from 'pg';
import { schedulesConflict } from '../../services/programming-conflicts.js';

// Public presenter labels are not login identities or RBAC host assignments.
export const REAL_PROGRAMS = [
  { name: 'Fato Popular', slug: 'fato-popular', presenters: ['Betinho Albertassi', 'Carlos Alberto Albertassi (Teko)', 'Johnata Amado', 'Leandro Batista', 'Marli Albertassi', 'Gilberto Vogel'], days: [1, 2, 3, 4, 5], start: 300, end: 570 },
  { name: 'Bom Dia 88', slug: 'bom-dia-88', presenters: ['Dário Ferreira', 'Letícia Dantas', 'Miquéias Nechaeff'], days: [1, 2, 3, 4, 5], start: 570, end: 720 },
  { name: 'Altar 88', slug: 'altar-88', presenters: ['Pr. Dário Ferreira'], days: [1, 2, 3, 4, 5], start: 720, end: 780 },
  { name: 'Temperatura Gospel', slug: 'temperatura-gospel', presenters: ['Luciana Alves'], days: [1, 2, 3, 4, 5], start: 780, end: 900 },
  { name: 'Favorito', slug: 'favorito', presenters: ['Régis Oliveira', 'Cíntia Miranda'], days: [1, 2, 3, 4, 5], start: 900, end: 1020 },
  { name: 'Ritmo 88', slug: 'ritmo-88', presenters: ['Lu Gomes'], days: [1, 2, 3, 4, 5], start: 1020, end: 1140 },
  { name: 'Raízes', slug: 'raizes', presenters: ['Geraldo', 'José'], days: [6, 0], start: 360, end: 480 },
  { name: 'Cristo em Nós', slug: 'cristo-em-nos', presenters: ['Uelisson Nogueira', 'Danilo Miranda'], days: [6], start: 780, end: 900 },
  { name: 'Passado de Presente', slug: 'passado-de-presente', presenters: ['André Luís'], days: [6], start: 1200, end: 1320 },
  { name: 'Cristo Vive', slug: 'cristo-vive', presenters: ['Pr. Geraldo Albertassi'], days: [6, 0], start: 1380, end: 0 },
  { name: 'Clamor das Nações', slug: 'clamor-das-nacoes', presenters: ['Pr. Geraldo Albertassi'], days: [0], start: 840, end: 900 },
] as const;

interface ExistingSlot {
  programId: string; weekday: number; startMinute: number; endMinute: number;
  validFrom: string; validUntil: string | null; active: boolean;
}

export async function seedRealProgramming(client: Pick<PoolClient, 'query'>, apply = false) {
  const report = { programsCreated: 0, programsPreserved: 0, slotsCreated: 0, slotsPreserved: 0, applied: apply };
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query('SELECT pg_advisory_xact_lock(881188,12)');
    const scope = await client.query("SELECT timezone FROM radio_programming_scope WHERE key='radio-88'");
    if (scope.rows[0]?.timezone !== 'America/Sao_Paulo') throw new Error('Aplique as migrations de programacao antes do seed.');
    const slots = await client.query<ExistingSlot>(`SELECT program_id AS "programId",weekday,start_minute AS "startMinute",
      end_minute AS "endMinute",valid_from::text AS "validFrom",valid_until::text AS "validUntil",active
      FROM radio_program_slot WHERE radio_key='radio-88'`);
    for (const program of REAL_PROGRAMS) {
      const found = await client.query<{ id: string; active: boolean }>(
        "SELECT id,active FROM radio_program WHERE radio_key='radio-88' AND slug=$1 FOR UPDATE", [program.slug]);
      let id = found.rows[0]?.id;
      if (id) {
        if (!found.rows[0]?.active) throw new Error(`Programa existente inativo: ${program.slug}. Revise antes de aplicar.`);
        report.programsPreserved++;
      } else {
        const created = await client.query<{ id: string }>(`INSERT INTO radio_program(radio_key,name,slug,presenters)
          VALUES('radio-88',$1,$2,$3::jsonb) RETURNING id`, [program.name, program.slug, JSON.stringify(program.presenters)]);
        id = created.rows[0]!.id;
        report.programsCreated++;
      }
      for (const weekday of program.days) {
        const wanted: ExistingSlot = { programId: id, weekday, startMinute: program.start, endMinute: program.end,
          validFrom: '2026-11-11', validUntil: null, active: true };
        // An existing identical recurrence covering the entire seed period is reused, including its ID.
        const matches = slots.rows.filter(s => s.active && s.programId === id && s.weekday === weekday &&
          s.startMinute === program.start && s.endMinute === program.end && s.validFrom <= wanted.validFrom && s.validUntil === null);
        if (matches.length > 1) throw new Error(`Grade duplicada existente: ${program.slug}, dia ${weekday}.`);
        const conflicts = slots.rows.filter(s => s.active && !matches.includes(s) && schedulesConflict(wanted, s));
        if (conflicts.length) throw new Error(`Conflito na grade: ${program.slug}, dia ${weekday}. Nenhuma alteracao aplicada.`);
        if (matches.length) { report.slotsPreserved++; continue; }
        await client.query(`INSERT INTO radio_program_slot(radio_key,program_id,weekday,start_minute,end_minute,valid_from)
          VALUES('radio-88',$1,$2,$3,$4,$5)`, [id, weekday, program.start, program.end, wanted.validFrom]);
        slots.rows.push(wanted);
        report.slotsCreated++;
      }
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
