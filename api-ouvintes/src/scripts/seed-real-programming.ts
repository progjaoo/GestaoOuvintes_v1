import pg from 'pg';
import { seedRealProgramming } from '../database/seeds/programming-real.js';

// Intentionally does not load .env or the legacy seed (which provisions accounts).
const args = process.argv.slice(2);
let client: pg.Client | undefined;
try {
  if (args.some(a => !['--apply', '--confirm-remote'].includes(a))) throw new Error('Opcoes: --apply --confirm-remote');
  const url = process.env.PROGRAMMING_SEED_DATABASE_URL;
  if (!url) throw new Error('Defina PROGRAMMING_SEED_DATABASE_URL explicitamente.');
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(host) && !args.includes('--confirm-remote')) {
    throw new Error('Banco remoto exige --confirm-remote, inclusive na simulacao.');
  }
  client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await client.connect();
  console.info(JSON.stringify(await seedRealProgramming(client, args.includes('--apply'))));
} catch (error) {
  // Do not print driver errors or connection strings containing credentials.
  console.error(error instanceof Error && !('code' in error) ? error.message : 'Falha no banco; nenhuma transacao parcial foi aplicada.');
  process.exitCode = 1;
} finally {
  await client?.end();
}
