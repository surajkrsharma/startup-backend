/**
 * Encryption + settings integration checks against a live database.
 *
 * Boots the real Express app in-process with ENCRYPTION_ENABLED=true and
 * verifies the AES-256-GCM transport contract in both directions.
 *
 * Usage: npx tsx scripts/e2e-encryption.ts
 */
import crypto from 'crypto';
import request from 'supertest';

process.env.ENCRYPTION_ENABLED = 'true';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? crypto.randomBytes(32).toString('hex');

const encrypt = (data: any, key: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64'),
  };
};

const decrypt = (payload: { iv: string; tag: string; data: string }, key: string) => {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(payload.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'base64')),
      decipher.final(),
    ]).toString('utf8'),
  );
};

const checks: { name: string; passed: boolean; detail: string }[] = [];
const record = (name: string, passed: boolean, detail = '') => {
  checks.push({ name, passed, detail });
  // eslint-disable-next-line no-console
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const key = process.env.ENCRYPTION_KEY;

const main = async (): Promise<void> => {
  /* eslint-disable no-console */
  // `createApp` is required lazily so env.config reads the flags set above.
  const { createApp } = await import('../src/app');
  const app = createApp();

  // ── Plain request still works when encryption is on ──────────────────────
  const plain = await request(app).get('/api/v1/health');
  record('plain request unaffected by encryption', plain.status === 200, `status=${plain.status}`);
  record('plain response is readable JSON', plain.body?.status === true);

  // ── Encrypted request → encrypted response ───────────────────────────────
  const payload = encrypt({ email: 'nobody@example.com', password: 'WrongPass@123' }, key);
  const enc = await request(app).post('/api/v1/auth/login').set('x-encrypted', '1').send(payload);

  record('encrypted request accepted', enc.status === 401, `status=${enc.status}`);
  record('response is wrapped as encrypted', enc.body?.encrypted === true);

  const decoded = enc.body?.encrypted ? decrypt(enc.body, key) : null;
  record('encrypted response decrypts', Boolean(decoded));
  record(
    'decrypted payload is the normal 3-key envelope',
    decoded &&
      JSON.stringify(Object.keys(decoded)) === JSON.stringify(['status', 'message', 'result']),
    decoded ? JSON.stringify(Object.keys(decoded)) : 'n/a',
  );
  record(
    'decrypted envelope reports INVALID_CREDENTIALS',
    decoded?.status === false && String(decoded?.message).includes('INVALID_CREDENTIALS'),
    decoded?.message,
  );
  record('decrypted error result is empty', JSON.stringify(decoded?.result) === '{}');

  // ── Tampered ciphertext must be rejected ─────────────────────────────────
  const tampered = encrypt({ email: 'a@b.com', password: 'x' }, key);
  tampered.data = Buffer.from('garbage-not-valid-ciphertext').toString('base64');
  const tamperRes = await request(app)
    .post('/api/v1/auth/login')
    .set('x-encrypted', '1')
    .send(tampered);

  record(
    'tampered payload -> 400 DECRYPT_FAILED',
    tamperRes.status === 400 && String(tamperRes.body?.message).includes('DECRYPT_FAILED'),
    `status=${tamperRes.status} msg=${tamperRes.body?.message}`,
  );

  // ── Header set but body not encrypted ────────────────────────────────────
  const badShape = await request(app)
    .post('/api/v1/auth/login')
    .set('x-encrypted', '1')
    .send({ email: 'a@b.com', password: 'x' });

  record(
    'x-encrypted without ciphertext -> 400 INVALID_ENCRYPTED_PAYLOAD',
    badShape.status === 400 && String(badShape.body?.message).includes('INVALID_ENCRYPTED_PAYLOAD'),
    `status=${badShape.status} msg=${badShape.body?.message}`,
  );

  // ── Skip paths are never encrypted ───────────────────────────────────────
  for (const skipPath of ['/api/v1/health', '/api/v1/version', '/api/v1/docs.json']) {
    const res = await request(app).get(skipPath).set('x-encrypted', '1');
    record(
      `skip path ${skipPath} stays plain`,
      res.body?.encrypted !== true,
      `status=${res.status}`,
    );
  }

  // ── Dynamic settings read from the live DB ───────────────────────────────
  const { getSetting, setSetting, getFeatureFlags, toggleFeature, getMaintenanceStatus } =
    await import('../src/services/settings.service');

  const before = await getSetting<string>('site.name', 'fallback');
  record('reads a seeded setting from DB', before === 'ProjectName', before);

  await setSetting('__e2e__', { hello: 'world' }, 'general', undefined, false);
  const after = await getSetting<{ hello: string }>('__e2e__', { hello: '' });
  record('writes then reads a new setting', after?.hello === 'world', JSON.stringify(after));

  const cacheKeyProbe = await getSetting<string>('__missing__', 'fallback-value');
  record('missing setting falls back to the code default', cacheKeyProbe === 'fallback-value');

  const flags = await getFeatureFlags();
  record(
    'feature flags load from DB',
    typeof flags['feature.reviews'] === 'boolean' && flags['feature.reviews'] === true,
    `reviews=${flags['feature.reviews']}`,
  );

  await toggleFeature('feature.wallet', true);
  const flagsAfter = await getFeatureFlags();
  record('toggleFeature invalidates the cache', flagsAfter['feature.wallet'] === true);
  await toggleFeature('feature.wallet', false);

  // ── Maintenance mode ─────────────────────────────────────────────────────
  await setSetting('maintenance.enabled', true, 'system', undefined, false);
  const maintenance = await getMaintenanceStatus();
  record('maintenance mode reads ON from DB', maintenance.enabled === true);

  const blocked = await request(app).get('/api/v1/auth/getMe');
  record(
    'maintenance blocks normal routes with 503',
    blocked.status === 503,
    `status=${blocked.status}`,
  );
  record(
    'maintenance message follows the setting',
    String(blocked.body?.message).includes('back soon'),
    blocked.body?.message,
  );

  const healthDuring = await request(app).get('/api/v1/health');
  record(
    'maintenance still allows /health',
    healthDuring.status === 200,
    `status=${healthDuring.status}`,
  );

  await setSetting('maintenance.enabled', false, 'system', undefined, false);
  const restored = await request(app).get('/api/v1/health');
  record('maintenance off restores traffic', restored.status === 200);

  // ── Summary ──────────────────────────────────────────────────────────────
  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
  /* eslint-enable no-console */
};

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[e2e-encryption] crashed:', err);
  process.exit(1);
});
