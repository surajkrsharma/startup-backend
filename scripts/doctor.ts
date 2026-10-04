import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  ENV,
  isCloudinaryConfigured,
  isEmailConfigured,
  isBrevoConfigured,
  isMsg91Configured,
} from '../src/config/env.config';
import { otpRequirement } from '../src/config/otp-policy';
import { prisma, isDatabaseHealthy } from '../src/services/prisma.service';
import { getRedis, isRedisHealthy } from '../src/services/redis.service';

const ROOT = path.join(__dirname, '..');

type Level = 'ok' | 'warn' | 'fail' | 'skip';
interface Line {
  level: Level;
  label: string;
  detail: string;
}

const lines: Line[] = [];
const say = (level: Level, label: string, detail: string) => lines.push({ level, label, detail });
const ICON: Record<Level, string> = { ok: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' };

const git = (args: string[]): string | null => {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

const mask = (value: string, keep = 4): string => {
  if (!value) return '(empty)';
  if (value.length <= keep) return '*'.repeat(value.length);
  return `${value.slice(0, keep)}…${value.slice(-2)} (${value.length} chars)`;
};

const checkDatabase = async (): Promise<void> => {
  let host = '(unparsed)';
  try {
    host = new URL(ENV.DATABASE_URL).hostname;
  } catch {
    /* keep placeholder */
  }

  const internal =
    !/\.render\.com/.test(host) &&
    /^\d+\.|\b[a-z0-9-]+\b$/.test(host) &&
    !host.includes('render.com');

  if (internal && ENV.NODE_ENV === 'production') {
    say(
      'warn',
      'DATABASE_URL',
      `looks like an internal Render hostname (${host}) — correct on Render, wrong locally.`,
    );
  } else {
    say('ok', 'DATABASE_URL', `${host} (masked)`);
  }

  if (!(await isDatabaseHealthy())) {
    say('fail', 'database', 'NOT reachable. The API would boot but 500 on every data route.');
    return;
  }
  say('ok', 'database', 'reachable');

  try {
    const [{ version }] = (await prisma.$queryRawUnsafe<any[]>('SELECT version()')) ?? [];
    const pg = String(version ?? '').split(' on ')[0];
    say('ok', 'postgres', pg);

    const [{ n }] = (await prisma.$queryRawUnsafe<any[]>(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
    )) ?? [{ n: 0 }];

    if (n <= 1) {
      say('fail', 'tables', `${n} found — the schema is empty. Run: npx prisma migrate deploy`);
    } else {
      say('ok', 'tables', `${n}`);
    }

    const applied = await prisma.$queryRawUnsafe<any[]>(
      'SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at',
    );
    const pending = await fs.promises
      .readdir(path.join(ROOT, 'prisma', 'migrations'), { withFileTypes: true })
      .then((entries) =>
        entries
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort(),
      );

    const known = new Set(applied.map((r) => r.migration_name));
    const missing = pending.filter((m) => !known.has(m));
    const extra = applied
      .filter((r) => !pending.includes(r.migration_name))
      .map((r) => r.migration_name);

    if (missing.length) say('fail', 'migrations', `not applied: ${missing.join(', ')}`);
    else say('ok', 'migrations', `${applied.length} applied, all present on disk`);

    if (extra.length) {
      say(
        'warn',
        'migrations',
        `recorded in the database but absent from prisma/migrations: ${extra.join(', ')}. ` +
          'Expected after squashing history on a database that was already migrated.',
      );
    }

    const [{ n: users }] = (await prisma.$queryRawUnsafe<any[]>(
      'SELECT count(*)::int AS n FROM "User"',
    )) ?? [{ n: 0 }];
    if (!users) {
      say('fail', 'seed', 'no users — run: npm run seed');
    } else {
      say('ok', 'seed', `${users} users`);
    }
  } catch (err) {
    say('fail', 'schema', `query failed: ${(err as Error)?.message ?? err}`);
  }
};

const checkSecrets = (): void => {
  const WEAK = new Set(['SuperSecret@123', 'changeme', 'secret', 'password', 'test', 'Demo@12345']);

  const lengthFloor: Record<string, number> = {
    JWT_ACCESS_SECRET: 32,
    JWT_REFRESH_SECRET: 32,
    ENCRYPTION_KEY: 64,
    SUPER_ADMIN_PASSWORD: 12,
  };

  const secretChecks: Array<[string, string]> = [
    ['JWT_ACCESS_SECRET', ENV.JWT_ACCESS_SECRET],
    ['JWT_REFRESH_SECRET', ENV.JWT_REFRESH_SECRET],
    ['ENCRYPTION_KEY', ENV.ENCRYPTION_KEY],
    ['SUPER_ADMIN_PASSWORD', ENV.SUPER_ADMIN_PASSWORD],
    ['CLOUDINARY_API_SECRET', ENV.CLOUDINARY_API_SECRET],
  ];

  for (const [name, value] of secretChecks) {
    if (!value) continue;
    if (WEAK.has(value) || value.toLowerCase().includes('secret@123')) {
      say('fail', name, `weak or default value (${mask(value)}) — rotate before going live`);
    } else {
      const floor = lengthFloor[name];
      if (floor && value.length < floor) {
        say('warn', name, `short (${mask(value)}) — ${floor}+ characters recommended`);
      } else {
        say('ok', name, `set (${mask(value)})`);
      }
    }
  }

  if (ENV.JWT_ACCESS_SECRET && ENV.JWT_ACCESS_SECRET === ENV.JWT_REFRESH_SECRET) {
    say('fail', 'JWT secrets', 'access and refresh secrets are identical');
  }

  if (ENV.ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(ENV.ENCRYPTION_KEY)) {
    say('fail', 'ENCRYPTION_KEY', 'must be exactly 64 hex characters');
  }

  if (ENV.OTP_STATIC_CODE) {
    if (ENV.NODE_ENV === 'production') {
      say(
        'fail',
        'OTP_STATIC_CODE',
        'set while NODE_ENV=production — the app should refuse to boot',
      );
    } else {
      say(
        'warn',
        'OTP_STATIC_CODE',
        `fixed OTP "${ENV.OTP_STATIC_CODE}" is active — harmless outside production`,
      );
    }
  } else {
    say('ok', 'OTP_STATIC_CODE', 'empty (real random codes)');
  }

  const tracked = git(['ls-files', '--', '.env', '.env.example']);
  if (tracked === null) {
    say('skip', 'git', 'not a git repository');
  } else {
    const files = tracked.split('\n').filter(Boolean);
    const envFiles = files.filter((f) => f === '.env' || f.startsWith('.env'));
    if (envFiles.length) {
      say(
        'warn',
        'exposure',
        `git is tracking ${envFiles.join(', ')} — intended for a PRIVATE repo. ` +
          'If this repo goes public, rotate the DB password, both JWT secrets and the Cloudinary secret.',
      );
    } else {
      say('ok', 'exposure', 'no .env files tracked by git');
    }

    const ignored = git(['ls-files', '--', 'uploads', 'pglite-data', 'dist', 'node_modules']);
    if (ignored) say('fail', 'exposure', `these must never be tracked: ${ignored}`);
  }

  const stray: string[] = [];
  for (const name of fs.readdirSync(ROOT)) {
    if (/\.(pem|key|p12|pfx)$/i.test(name)) stray.push(name);
  }
  if (stray.length) say('warn', 'stray files', `look like credentials: ${stray.join(', ')}`);

  if (/\.env\b/.test(ENV.DATABASE_URL) === false && ENV.DATABASE_URL.includes('@')) {
    // nothing to do; kept for symmetry with the readability of the checks above
  }
};

const checkIntegrations = async (): Promise<void> => {
  const policy = otpRequirement();

  if (ENV.OTP_REQUIRED) {
    say('ok', 'OTP_REQUIRED', 'on — registration demands a code before the row is written');
  } else {
    say(
      'warn',
      'OTP_REQUIRED',
      'off — accounts are created unverified and login skips verification. Never ship this.',
    );
  }

  if (policy.required && !policy.deliverable) {
    say(
      'fail',
      'otp delivery',
      'OTP_REQUIRED=true but no email or SMS provider is set. Codes cannot be ' +
        'delivered, so codes cannot be enforced — registration will accept an ' +
        'unverified signup. Set BREVO_API_KEY or MSG91_AUTHKEY, or OTP_REQUIRED=false.',
    );
  }

  if (isEmailConfigured) {
    const via = isBrevoConfigured
      ? `brevo (${ENV.BREVO_FROM_EMAIL || ENV.MAIL_FROM_EMAIL})`
      : `smtp (${ENV.SMTP_HOST}:${ENV.SMTP_PORT})`;
    say('ok', 'email', `configured — ${via}`);
    if (isBrevoConfigured && !ENV.BREVO_FROM_EMAIL) {
      say(
        'warn',
        'BREVO_FROM_EMAIL',
        'empty — falls back to MAIL_FROM_EMAIL; verify that domain in Brevo',
      );
    }
  } else {
    say('fail', 'email', 'not configured — every sendOtp is dropped in a log line');
    say(
      'skip',
      '  how',
      'harmless while building: OTP_STATIC_CODE makes the code visible in the ' +
        'log. Set BREVO_API_KEY or the SMTP_* block when a code must reach a real inbox.',
    );
  }

  if (ENV.SMTP_HOST && /gmail\.com|googlemail\.com/i.test(ENV.SMTP_HOST)) {
    say(
      'ok',
      'gmail',
      'host recognised — SMTP_PASS must be an App Password, not the account password',
    );
  }

  if (isMsg91Configured) {
    say('ok', 'sms', `configured — sender "${ENV.MSG91_SENDER_ID || '(none set)'}"`);
    if (!ENV.MSG91_TEMPLATE_ID) {
      say(
        'warn',
        'MSG91_TEMPLATE_ID',
        'empty — falls back to the free-form endpoint, which Indian DLT rules do not allow',
      );
    }
    if (!ENV.MSG91_SENDER_ID) {
      say('warn', 'MSG91_SENDER_ID', 'empty — MSG91 will reject every send');
    }
  } else {
    say('skip', 'sms', 'not configured (MSG91_AUTHKEY empty)');
  }

  if (ENV.OTP_SMS_ENABLED && !isMsg91Configured) {
    say('fail', 'OTP_SMS_ENABLED', 'true but no MSG91 key — phone signups get no code');
  } else if (ENV.OTP_SMS_ENABLED) {
    say('ok', 'OTP_SMS_ENABLED', 'on');
  } else {
    say('warn', 'OTP_SMS_ENABLED', 'off — a phone-number registration receives no code');
  }

  if (ENV.REDIS_URL) {
    if (await isRedisHealthy()) {
      say('ok', 'redis', 'reachable');
    } else {
      say('fail', 'redis', 'configured but NOT reachable — jobs and rate limiting degrade');
    }
  } else {
    say(
      ENV.QUEUE_ENABLED ? 'fail' : 'warn',
      'redis',
      ENV.QUEUE_ENABLED
        ? 'not set, and QUEUE_ENABLED=true — the app refuses to boot'
        : 'not set — jobs dropped, rate limiting is per-instance only',
    );
  }

  if (isCloudinaryConfigured) {
    say('ok', 'cloudinary', `configured (${ENV.CLOUDINARY_CLOUD_NAME})`);
  } else {
    say('fail', 'cloudinary', 'not configured — every upload route returns 503');
  }

  if (ENV.NODE_ENV === 'production') {
    if (!ENV.CORS_ORIGINS.length) {
      say('fail', 'CORS_ORIGINS', 'empty in production — every browser origin is rejected');
    } else if (ENV.CORS_ORIGINS.includes('*')) {
      say('fail', 'CORS_ORIGINS', 'wildcard is not allowed in production');
    } else {
      say('ok', 'CORS_ORIGINS', ENV.CORS_ORIGINS.join(', '));
    }
  } else {
    say(
      'ok',
      'CORS_ORIGINS',
      `${ENV.CORS_ORIGINS.length} origin(s); permissive while NODE_ENV=development`,
    );
  }
};

const main = async (): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log(`\n  projectname-api doctor — NODE_ENV=${ENV.NODE_ENV}\n`);

  await checkDatabase();
  checkSecrets();
  await checkIntegrations();

  for (const l of lines) {
    // eslint-disable-next-line no-console
    console.log(`  [${ICON[l.level]}] ${l.label.padEnd(18)} ${l.detail}`);
  }

  const failures = lines.filter((l) => l.level === 'fail');
  const warnings = lines.filter((l) => l.level === 'warn');

  // eslint-disable-next-line no-console
  console.log(
    `\n  ${lines.length - failures.length - warnings.length} passed, ` +
      `${warnings.length} warning(s), ${failures.length} failure(s)\n`,
  );

  await prisma.$disconnect();
  process.exit(failures.length ? 1 : 0);
};

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('[doctor] failed:', (err as Error)?.message ?? err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
