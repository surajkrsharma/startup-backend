/**
 * PGlite-backed PostgreSQL for local development and integration tests.
 *
 * PGlite is real PostgreSQL (17) compiled to WASM. `pglite-socket` exposes it over
 * a TCP socket speaking the Postgres wire protocol, so Prisma and any standard
 * client connect to it exactly like a real server.
 *
 * Why not a normal Postgres? On machines where antivirus blocks child-process
 * creation (every backend dies with STATUS_DLL_INIT_FAILED / 0xC0000142) the
 * forked server mode is unusable. PGlite runs in-process, so it sidesteps that
 * while still exercising real SQL, real migrations and real constraints.
 *
 * Usage:
 *   npx tsx scripts/pglite-server.ts          # listens on 5432
 *   PORT=5544 npx tsx scripts/pglite-server.ts
 *
 * Then point DATABASE_URL at postgresql://postgres:postgres@127.0.0.1:5432/projectname
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PORT = Number(process.env.PGLITE_PORT ?? process.env.PORT ?? 5432);
const HOST = process.env.PGLITE_HOST ?? '127.0.0.1';
const DATA_DIR = process.env.PGLITE_DATA_DIR ?? 'pglite-data';

async function main(): Promise<void> {
  const db = await PGlite.create({ dataDir: DATA_DIR });

  const server = new PGLiteSocketServer({ db, port: PORT, host: HOST });
  await server.start();

  // eslint-disable-next-line no-console
  console.log(`[pglite] PostgreSQL (WASM) listening on ${HOST}:${PORT} — dataDir=${DATA_DIR}`);

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[pglite] ${signal} received, shutting down`);
    try {
      await server.stop();
      await db.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[pglite] failed to start:', err);
  process.exit(1);
});
