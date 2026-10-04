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
