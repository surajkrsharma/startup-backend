import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';

const DATA_DIR = process.env.PGLITE_DATA_DIR ?? 'pglite-data';
const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

interface Migration {
  name: string;
  sql: string;
}

const readMigrations = (): Migration[] => {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sqlPath = path.join(MIGRATIONS_DIR, entry.name, 'migration.sql');
      return {
        name: entry.name,
        sql: fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '',
      };
    })
    .filter((m) => m.sql.trim().length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
};

const ensureMigrationsTable = async (db: PGlite): Promise<void> => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      id            TEXT PRIMARY KEY,
      checksum      TEXT NOT NULL,
      finished_at   TIMESTAMPTZ,
      migration_name TEXT NOT NULL,
      logs          TEXT,
      rolled_back_at TIMESTAMPTZ,
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    );
  `);
};

const main = async (): Promise<void> => {
  const db = await PGlite.create({ dataDir: DATA_DIR });

  try {
    await ensureMigrationsTable(db);

    const applied = await db.query<{ migration_name: string }>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
    );
    const appliedNames = new Set((applied.rows ?? []).map((r) => r.migration_name));

    const migrations = readMigrations().filter((m) => !appliedNames.has(m.name));

    if (!migrations.length) {
      // eslint-disable-next-line no-console
      console.log('[migrate] nothing to apply — already up to date');
      return;
    }

    for (const migration of migrations) {
      // eslint-disable-next-line no-console
      console.log(`[migrate] applying ${migration.name} ...`);

      await db.transaction(async (tx) => {
        await tx.exec(migration.sql);
      });

      await db.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
         VALUES ($1, $2, now(), $3, 1)`,
        [crypto.randomUUID(), 'manual', migration.name],
      );

      // eslint-disable-next-line no-console
      console.log(`[migrate] applied ${migration.name}`);
    }

    // eslint-disable-next-line no-console
    console.log('[migrate] all migrations applied');
  } finally {
    await db.close();
  }
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[migrate] failed:', err?.message ?? err);
  process.exit(1);
});
