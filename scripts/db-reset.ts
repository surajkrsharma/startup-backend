import { execFileSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const ADMIN_URL =
  process.env.PGLITE_ADMIN_URL ??
  'postgresql://postgres:postgres@localhost:5432/postgres?schema=public';

const DB_NAME = process.env.PGLITE_RESET_DB ?? 'projectname_test';

const assertSafe = (): void => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset: NODE_ENV=production.');
  }

  const url = process.env.DATABASE_URL ?? '';
  if (!url) {
    throw new Error('DATABASE_URL is empty — nothing to reset.');
  }

  const remote =
    /@[^/]*\.(supabase|neon|planetscale|render\.com|amazonaws\.com|azure|supabase\.com)/i.test(url);
  if (remote) {
    throw new Error(`Refusing to reset a remote host: ${url.replace(/:[^:@/]+@/, ':***@')}`);
  }

  if (/^postgresql?:\/\/[^@/]*@dpg-/i.test(url)) {
    throw new Error(
      `Refusing to reset Render's internal database: ${url.replace(/:[^:@/]+@/, ':***@')}`,
    );
  }

  const isLocal = /@?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])[:/]/i.test(url);
  if (!isLocal) {
    throw new Error(`Refusing to reset a non-local host: ${url.replace(/:[^:@/]+@/, ':***@')}`);
  }
};

const run = (command: string, args: string[], input?: string): void => {
  execFileSync(command, args, {
    stdio: input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    shell: process.platform === 'win32',
    input,
  });
};

const main = (): void => {
  assertSafe();

  // eslint-disable-next-line no-console
  console.log(`[db:reset] dropping and recreating "${DB_NAME}"`);

  const drop = `DROP DATABASE IF EXISTS "${DB_NAME}";`;
  const create = `CREATE DATABASE "${DB_NAME}";`;

  run('npx', ['prisma', 'db', 'execute', '--stdin', '--url', ADMIN_URL], drop);
  run('npx', ['prisma', 'db', 'execute', '--stdin', '--url', ADMIN_URL], create);

  // eslint-disable-next-line no-console
  console.log('[db:reset] applying the initial migration');
  run('npx', ['prisma', 'migrate', 'deploy']);

  // eslint-disable-next-line no-console
  console.log('[db:reset] seeding');
  run('npx', ['tsx', 'prisma/seed.ts']);

  // eslint-disable-next-line no-console
  console.log('[db:reset] done — schema and seed data are back to a known state');
};

try {
  main();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[db:reset] failed:', (err as Error)?.message ?? err);
  process.exit(1);
}
