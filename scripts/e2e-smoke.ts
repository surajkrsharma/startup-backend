import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

const OTP = process.env.OTP_STATIC_CODE || '111111';

const sendOtp = (identifier: string) =>
  request(app)
    .post('/api/v1/auth/sendOtp')
    .send({ type: 'REGISTER', channel: 'EMAIL', identifier });

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];
const record = (name: string, passed: boolean, detail = '') => {
  checks.push({ name, passed, detail });
  // eslint-disable-next-line no-console
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const assertEnvelope = (body: any, expected: boolean): string => {
  const keys = Object.keys(body ?? {});
  const ok =
    keys.length === 3 &&
    keys[0] === 'status' &&
    keys[1] === 'message' &&
    keys[2] === 'result' &&
    body.status === expected &&
    typeof body.message === 'string' &&
    body.message.length > 0 &&
    body.result !== null &&
    typeof body.result === 'object' &&
    !Array.isArray(body.result);
  return ok ? '' : `keys=${keys.join(',')}`;
};

const runId = Date.now().toString().slice(-9);
const uniqueEmail = `e2e_${runId}@projectname.com`;
const uniquePhone = `+7${runId}11`;

const main = async (): Promise<void> => {
  /* eslint-disable no-console */

  const health = await request(app).get('/api/v1/health');
  record(
    'GET /health returns 200 envelope',
    health.status === 200 && assertEnvelope(health.body, true) === '',
    assertEnvelope(health.body, true),
  );
  record('health echoes X-Request-Id', Boolean(health.headers['x-request-id']));

  const db = await request(app).get('/api/v1/health/db');
  record(
    'GET /health/db reports database UP',
    db.status === 200 && db.body?.result?.database === 'UP',
    `status=${db.body?.result?.database}`,
  );

  await sendOtp(uniqueEmail);

  const register = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type: 'VENDOR',
      name: 'E2E Vendor',
      otp: OTP,
      email: uniqueEmail,
      phone: uniquePhone,
      password: 'Secret@123',
      shopName: `E2E Store ${runId}`,
    });

  record(
    'POST /auth/register (VENDOR) -> 201',
    register.status === 201,
    `status=${register.status} msg=${register.body?.message}`,
  );
  record('register response has strict envelope', assertEnvelope(register.body, true) === '');

  const accessToken = register.body?.result?.accessToken;
  const vendorId = register.body?.result?.vendorData?.vendorId;
  const vendorStatus = register.body?.result?.vendorData?.status;
  const roles = register.body?.result?.rolesList;

  record('register issues an access token', Boolean(accessToken));
  record('register returns vendorData.vendorId', Boolean(vendorId), String(vendorId));
  record(
    'vendor role assigned',
    Array.isArray(roles) && roles[0] === 'VENDOR',
    JSON.stringify(roles),
  );
  record(
    'vendor.autoApprove=false leaves status PENDING',
    vendorStatus === 'PENDING',
    String(vendorStatus),
  );

  const setCookie = register.headers['set-cookie'];
  record(
    'refresh token set as HttpOnly cookie',
    Array.isArray(setCookie) &&
      setCookie.some((c) => c.includes('refreshToken') && /HttpOnly/i.test(c)),
  );

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: uniqueEmail, password: 'Secret@123' });

  record('POST /auth/login -> 200', login.status === 200, `status=${login.status}`);
  record('login issues an access token', Boolean(login.body?.result?.accessToken));

  const loginToken = login.body?.result?.accessToken;

  const badLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: uniqueEmail, password: 'WrongPass@123' });

  record(
    'wrong password -> 401 INVALID_CREDENTIALS',
    badLogin.status === 401 && String(badLogin.body?.message).includes('INVALID_CREDENTIALS'),
    `status=${badLogin.status} msg=${badLogin.body?.message}`,
  );
  record('failed login returns empty result', JSON.stringify(badLogin.body?.result) === '{}');

  const refresh = await request(app)
    .post('/api/v1/auth/refreshToken')
    .send({ refreshToken: extractRefreshCookie(login.headers['set-cookie']) });

  record(
    'POST /auth/refreshToken -> 200',
    refresh.status === 200,
    `status=${refresh.status} msg=${refresh.body?.message}`,
  );
  record('refresh rotates the access token', Boolean(refresh.body?.result?.accessToken));

  const me = await request(app)
    .get('/api/v1/auth/getMe')
    .set('Authorization', `Bearer ${loginToken}`);

  record('GET /auth/getMe -> 200', me.status === 200, `status=${me.status}`);
  record(
    'getMe returns the registered email',
    me.body?.result?.userData?.email === uniqueEmail,
    me.body?.result?.userData?.email,
  );

  const noAuth = await request(app).get('/api/v1/auth/getMe');
  record(
    'GET /auth/getMe without token -> 401',
    noAuth.status === 401 && String(noAuth.body?.message).includes('UNAUTHORIZED'),
    `status=${noAuth.status}`,
  );

  const adminRoute = await request(app)
    .get('/api/v1/admin/getDashboardStats')
    .set('Authorization', `Bearer ${loginToken}`);

  record(
    'vendor blocked from admin route (404 until module lands, never 200)',
    adminRoute.status !== 200,
    `status=${adminRoute.status}`,
  );

  const unknownField = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type: 'CUSTOMER',
      name: 'Valid Name',
      email: `u_${Date.now()}@x.com`,
      password: 'Secret@123',
      isAdmin: true,
    });

  record(
    'unknown field rejected -> 400 VALIDATION_ERROR',
    unknownField.status === 400 &&
      String(unknownField.body?.message).includes('VALIDATION_ERROR') &&
      String(unknownField.body?.message).includes('isAdmin'),
    `status=${unknownField.status} msg=${unknownField.body?.message}`,
  );

  const badEmail = await request(app).post('/api/v1/auth/register').send({
    type: 'CUSTOMER',
    name: 'Valid Name',
    email: 'not-an-email',
    password: 'Secret@123',
  });

  record(
    'invalid email -> 400 "Please enter a valid email address."',
    badEmail.status === 400 &&
      String(badEmail.body?.message).startsWith('Please enter a valid email address.'),
    `status=${badEmail.status} msg=${badEmail.body?.message}`,
  );

  const badType = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type: 'ADMIN',
      name: 'Valid Name',
      email: `a_${Date.now()}@x.com`,
      password: 'Secret@123',
    });

  record(
    'invalid type -> 400 "Invalid register type."',
    badType.status === 400 && String(badType.body?.message).startsWith('Invalid register type.'),
    `status=${badType.status} msg=${badType.body?.message}`,
  );

  const noShop = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type: 'VENDOR',
      name: 'Valid Name',
      email: `b_${Date.now()}@x.com`,
      password: 'Secret@123',
    });

  record(
    'vendor without shopName -> 400 and shopName is named',
    noShop.status === 400 && String(noShop.body?.message).includes('shopName'),
    `status=${noShop.status} msg=${noShop.body?.message}`,
  );

  const weakPassword = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type: 'CUSTOMER',
      name: 'Valid Name',
      email: `w_${Date.now()}@x.com`,
      password: 'weakpassword',
    });

  record(
    'password without uppercase -> 400 and password is named',
    weakPassword.status === 400 && String(weakPassword.body?.message).includes('password'),
    `status=${weakPassword.status} msg=${weakPassword.body?.message}`,
  );

  const smuggledEmail = `r_${runId}@projectname.com`;
  await sendOtp(smuggledEmail);

  const smuggledRole = await request(app).post('/api/v1/auth/register').send({
    type: 'CUSTOMER',
    name: 'Valid Name',
    otp: OTP,
    email: smuggledEmail,
    password: 'Secret@123',
    role: 'SUPER_ADMIN',
  });

  record(
    'smuggled role rejected -> 400, not silently honoured',
    smuggledRole.status === 400,
    `status=${smuggledRole.status} msg=${smuggledRole.body?.message}`,
  );

  await sendOtp(uniqueEmail);

  const dupe = await request(app).post('/api/v1/auth/register').send({
    type: 'VENDOR',
    name: 'Dup',
    otp: OTP,
    email: uniqueEmail,
    password: 'Secret@123',
    shopName: 'Dup Store',
  });

  record(
    'duplicate email -> 409 EMAIL_EXISTS',
    dupe.status === 409 && String(dupe.body?.message).includes('EMAIL_EXISTS'),
    `status=${dupe.status} msg=${dupe.body?.message}`,
  );

  await sendOtp(`e2e2_${runId}@projectname.com`);

  const secondVendor = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type: 'VENDOR',
      name: 'E2E Vendor Two',
      otp: OTP,
      email: `e2e2_${runId}@projectname.com`,
      password: 'Secret@123',
      shopName: `E2E Store ${runId}`,
    });

  const expectedSlug = `e2e-store-${runId}-2`;
  record(
    'duplicate shopName -> slug auto-suffixed',
    secondVendor.status === 201 && secondVendor.body?.result?.vendorData?.slug === expectedSlug,
    `got=${secondVendor.body?.result?.vendorData?.slug} want=${expectedSlug}`,
  );

  const availability = await request(app)
    .post('/api/v1/auth/checkAvailability')
    .send({ email: uniqueEmail });

  record(
    'POST /auth/checkAvailability reports taken email',
    availability.status === 200 && availability.body?.result?.emailExists === true,
    `status=${availability.status}`,
  );

  const sessions = await request(app)
    .get('/api/v1/auth/sessions')
    .set('Authorization', `Bearer ${loginToken}`);

  record(
    'GET /auth/sessions -> 200 with envelope',
    sessions.status === 200 && assertEnvelope(sessions.body, true) === '',
    `status=${sessions.status}`,
  );

  const logout = await request(app)
    .post('/api/v1/auth/logout')
    .set('Authorization', `Bearer ${loginToken}`);

  record('POST /auth/logout -> 200', logout.status === 200, `status=${logout.status}`);

  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
  /* eslint-enable no-console */
};

const extractRefreshCookie = (setCookie?: string | string[]): string => {
  if (!setCookie) return '';
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  const match = cookies.find((c) => c.startsWith('refreshToken='));
  return match ? decodeURIComponent(match.split(';')[0].split('=')[1]) : '';
};

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[e2e] crashed:', err);
  process.exit(1);
});
