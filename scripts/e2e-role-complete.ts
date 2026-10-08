import './e2e-prelude';
import request from 'supertest';
import { createApp } from '../src/app';
import fs from 'fs';
import path from 'path';

const app = createApp();

const OTP = process.env.OTP_STATIC_CODE || '111111';

const LOG_FILE = path.join(__dirname, '..', 'e2e-test-log.json');
fs.rmSync(LOG_FILE, { force: true });
fs.writeFileSync(
  LOG_FILE,
  `E2E Role Complete Test Log\nStarted: ${new Date().toISOString()}\n${'='.repeat(80)}\n\n`,
);

const log = (msg: string) => {
  fs.appendFileSync(LOG_FILE, msg + '\n');
};

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];
const record = (name: string, passed: boolean, detail = '') => {
  checks.push({ name, passed, detail });
  const line = `${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`;
  /* eslint-disable no-console */
  console.log(line);
  /* eslint-enable no-console */
  log(line);
};

const logResponse = (method: string, url: string, status: number, body: any) => {
  log(`\n[${method}] ${url}`);
  log(`Status: ${status}`);
  log(`Response: ${JSON.stringify(body, null, 2)}`);
};

const assertEnvelope = (body: any, expected: boolean): boolean => {
  const keys = Object.keys(body ?? {});
  return (
    keys.length === 3 &&
    keys[0] === 'status' &&
    keys[1] === 'message' &&
    keys[2] === 'result' &&
    body.status === expected &&
    typeof body.message === 'string' &&
    body.message.length > 0 &&
    body.result !== null &&
    typeof body.result === 'object' &&
    !Array.isArray(body.result)
  );
};

const findNull = (value: any, depth = 0): string | null => {
  if (depth > 9) return null;
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    for (const i of value) {
      const hit = findNull(i, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      const hit = findNull(value[k], depth + 1);
      if (hit) return `${k}: ${hit}`;
    }
  }
  return null;
};

const run = Date.now().toString().slice(-9);
const email = (tag: string) => `rc_${tag}_${run}@projectname.com`;
const phoneSeq = new Map<string, number>();
let phoneCounter = 0;
const phoneFor = (tag: string): string => {
  if (!phoneSeq.has(tag)) {
    phoneCounter += 1;
    phoneSeq.set(tag, phoneCounter);
  }
  return `+7${run}${String(phoneSeq.get(tag)!).padStart(3, '0')}`;
};

const register = async (
  tag: string,
  type: 'CUSTOMER' | 'VENDOR',
  shopName?: string,
): Promise<{ token: string; userId: string; vendorId: string }> => {
  await request(app)
    .post('/api/v1/auth/register/sendOtp')
    .send({ identifier: email(tag) });

  const verified = await request(app)
    .post('/api/v1/auth/register/verifyOtp')
    .send({ identifier: email(tag), otp: OTP });

  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type,
      name: `RC ${tag}`,
      verificationToken: verified.body?.result?.verificationToken ?? '',
      email: email(tag),
      phone: phoneFor(tag),
      password: 'Secret@123',
      ...(type === 'VENDOR' ? { shopName: shopName ?? `RC Shop ${tag} ${run}` } : {}),
    });

  return {
    token: res.body?.result?.accessToken ?? '',
    userId: res.body?.result?.userData?.userId ?? '',
    vendorId: res.body?.result?.vendorData?.vendorId ?? '',
  };
};

const api = (token: string) => ({
  get: async (p: string) => {
    const res = await request(app).get(p).set('Authorization', `Bearer ${token}`);
    logResponse('GET', p, res.status, res.body);
    return res;
  },
  del: async (p: string) => {
    const res = await request(app).del(p).set('Authorization', `Bearer ${token}`);
    logResponse('DELETE', p, res.status, res.body);
    return res;
  },
  post: async (p: string, b?: any) => {
    const res = await request(app)
      .post(p)
      .set('Authorization', `Bearer ${token}`)
      .send(b ?? {});
    logResponse('POST', p, res.status, res.body);
    return res;
  },
  patch: async (p: string, b?: any) => {
    const res = await request(app)
      .patch(p)
      .set('Authorization', `Bearer ${token}`)
      .send(b ?? {});
    logResponse('PATCH', p, res.status, res.body);
    return res;
  },
});

const D_num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));
const D_str = (v: any): string => (v === null || v === undefined ? '' : String(v));
const D_arr = (v: any): any[] => (Array.isArray(v) ? v : []);

const login = (emailAddr: string, password: string) =>
  request(app).post('/api/v1/auth/login').send({ email: emailAddr, password });

const extractRefreshCookie = (res: any): string => {
  const cookies: string[] = D_arr(res.headers['set-cookie']);
  const hit = cookies.find((c) => c.startsWith('refreshToken='));
  return hit ? hit.split(';')[0].split('=').slice(1).join('=') : '';
};

const addTestAddress = async (customer: ReturnType<typeof api>, line1: string) =>
  customer.post('/api/v1/users/addAddress', {
    type: 'HOME',
    fullName: 'RC Customer',
    phone: phoneFor('cu'),
    line1,
    city: 'Mumbai',
    state: 'Maharashtra',
    stateCode: 'MH',
    countryCode: 'IN',
    pincode: '400001',
  });

// ═══════════════════════════════════════════════════════════════════════════
// AUTH DEEP WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runAuthDeepWorkflow = async () => {
  const { setSetting } = await import('../src/services/settings.service');
  const { generateTotp } = await import('../src/utils/crypto');

  log('\n' + '='.repeat(80));
  log('AUTH DEEP WORKFLOW');
  log('='.repeat(80));

  const avail = await request(app)
    .post('/api/v1/auth/checkAvailability')
    .send({ email: email('free') });
  record(
    'AUTH: checkAvailability free email',
    avail.status === 200 && avail.body?.result?.isAvailable === true,
  );

  const taken = await request(app)
    .post('/api/v1/auth/checkAvailability')
    .send({ email: process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@projectname.com' });
  record('AUTH: checkAvailability taken email', taken.body?.result?.emailExists === true);

  const emptyAvail = await request(app).post('/api/v1/auth/checkAvailability').send({});
  record('AUTH: checkAvailability empty rejected', emptyAvail.status === 400);

  const weak = await request(app)
    .post('/api/v1/auth/register/sendOtp')
    .send({ identifier: email('weak') });
  record('AUTH: sendOtp for weak-password user', weak.status === 200);
  const weakVerify = await request(app)
    .post('/api/v1/auth/register/verifyOtp')
    .send({ identifier: email('weak'), otp: OTP });
  const weakReg = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type: 'CUSTOMER',
      name: 'RC Weak',
      verificationToken: weakVerify.body?.result?.verificationToken ?? '',
      email: email('weak'),
      phone: phoneFor('wk'),
      password: 'weak',
    });
  record('AUTH: weak password rejected', weakReg.status === 400);

  const noShopSend = await request(app)
    .post('/api/v1/auth/register/sendOtp')
    .send({ identifier: email('noshop') });
  const noShopVerify = await request(app)
    .post('/api/v1/auth/register/verifyOtp')
    .send({ identifier: email('noshop'), otp: OTP });
  const noShop = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type: 'VENDOR',
      name: 'RC NoShop',
      verificationToken: noShopVerify.body?.result?.verificationToken ?? '',
      email: email('noshop'),
      phone: phoneFor('ns'),
      password: 'Secret@123',
    });
  record('AUTH: vendor without shopName rejected', noShop.status === 400);

  const badIdentifier = await request(app)
    .post('/api/v1/auth/register/sendOtp')
    .send({ identifier: '!!not-contact!!' });
  record('AUTH: invalid identifier rejected', badIdentifier.status === 400);

  const wrongOtpSend = await request(app)
    .post('/api/v1/auth/register/sendOtp')
    .send({ identifier: email('wro') });
  const wrongOtp = await request(app)
    .post('/api/v1/auth/register/verifyOtp')
    .send({ identifier: email('wro'), otp: '000000' });
  record('AUTH: wrong OTP rejected', wrongOtp.status === 401);
  const rightOtp = await request(app)
    .post('/api/v1/auth/register/verifyOtp')
    .send({ identifier: email('wro'), otp: OTP });
  record('AUTH: OTP still usable after one wrong try', rightOtp.status === 200);

  const au = await register('au', 'CUSTOMER');
  const auAuth = api(au.token);
  record('AUTH: deep-flow user registered', au.token.length > 0);

  const me = await auAuth.get('/api/v1/auth/getMe');
  record('AUTH: getMe returns own user', me.body?.result?.userData?.userId === au.userId);

  const meNoAuth = await request(app).get('/api/v1/auth/getMe');
  record('AUTH: getMe without token blocked', meNoAuth.status === 401);

  const meGarbage = await request(app)
    .get('/api/v1/auth/getMe')
    .set('Authorization', 'Bearer abc.def.ghi');
  record('AUTH: getMe with garbage token blocked', meGarbage.status === 401);

  const meMalformed = await request(app).get('/api/v1/auth/getMe').set('Authorization', 'Bearer');
  record('AUTH: malformed Authorization header blocked', meMalformed.status === 401);

  await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: email('au'),
      password: 'Secret@123',
      deviceData: { deviceId: `rc-au-${run}`, platform: 'WEB' },
    });

  const sessions = await auAuth.get('/api/v1/auth/sessions');
  const sessionList = D_arr(sessions.body?.result?.sessionList);
  record(
    'AUTH: sessions listed',
    sessions.status === 200 && sessionList.length >= 1,
    `count=${sessionList.length}`,
  );

  const otherSession = sessionList.find((s: any) => s.isCurrent === false) ?? sessionList[0];
  if (otherSession?.sessionId) {
    const revoked = await auAuth.del(`/api/v1/auth/sessions/${otherSession.sessionId}`);
    record(
      'AUTH: session revoked',
      revoked.status === 200 && revoked.body?.result?.isRevoked === true,
    );
  }
  const bogusSession = await auAuth.del('/api/v1/auth/sessions/no-such-session');
  record('AUTH: unknown session revoke 404', bogusSession.status === 404);

  const loginRes = await login(email('au'), 'Secret@123');
  record('AUTH: password login works', loginRes.status === 200);
  const refreshCookie = extractRefreshCookie(loginRes);
  record('AUTH: refresh cookie issued', refreshCookie.length > 0);

  const refreshed = await request(app)
    .post('/api/v1/auth/refreshToken')
    .send({ refreshToken: refreshCookie });
  record(
    'AUTH: refreshToken rotates',
    refreshed.status === 200 && D_str(refreshed.body?.result?.accessToken).length > 0,
  );

  const replayed = await request(app)
    .post('/api/v1/auth/refreshToken')
    .send({ refreshToken: refreshCookie });
  record('AUTH: old refreshToken rejected', replayed.status === 401);

  const noToken = await request(app).post('/api/v1/auth/refreshToken').send({});
  record('AUTH: missing refreshToken rejected', noToken.status === 401);

  const loginAgain = await login(email('au'), 'Secret@123');
  const logoutRes = await request(app)
    .post('/api/v1/auth/logout')
    .set('Authorization', `Bearer ${D_str(loginAgain.body?.result?.accessToken)}`)
    .set('Cookie', `refreshToken=${extractRefreshCookie(loginAgain)}`)
    .send({});
  record(
    'AUTH: logout works',
    logoutRes.status === 200 && logoutRes.body?.result?.isLoggedOut === true,
  );

  const otpLoginSend = await request(app)
    .post('/api/v1/auth/sendOtp')
    .send({ type: 'LOGIN', identifier: email('au') });
  record('AUTH: OTP login code sent', otpLoginSend.status === 200);
  const otpLogin = await request(app)
    .post('/api/v1/auth/login/verifyOtp')
    .send({ identifier: email('au'), otp: OTP });
  record(
    'AUTH: OTP login works',
    otpLogin.status === 200 && D_str(otpLogin.body?.result?.accessToken).length > 0,
  );
  const otpLoginUnknown = await request(app)
    .post('/api/v1/auth/login/verifyOtp')
    .send({ identifier: email('ghost'), otp: OTP });
  record('AUTH: OTP login unknown user blocked', otpLoginUnknown.status === 401);

  const forgot = await request(app)
    .post('/api/v1/auth/forgotPassword')
    .send({ email: email('au') });
  record('AUTH: forgotPassword sends OTP', forgot.status === 200);

  const forgotUnknown = await request(app)
    .post('/api/v1/auth/forgotPassword')
    .send({ email: email('nobody') });
  record('AUTH: forgotPassword unknown account blocked', forgotUnknown.status === 401);

  const reset = await request(app)
    .post('/api/v1/auth/resetPassword')
    .send({ email: email('au'), otp: OTP, newPassword: 'NewSecret@123' });
  record('AUTH: resetPassword works', reset.status === 200);

  const resetReplay = await request(app)
    .post('/api/v1/auth/resetPassword')
    .send({ email: email('au'), otp: OTP, newPassword: 'NewSecret@456' });
  record('AUTH: resetPassword OTP single-use', resetReplay.status === 401);

  const oldLogin = await login(email('au'), 'Secret@123');
  record('AUTH: old password dead after reset', oldLogin.status === 401);
  const newLogin = await login(email('au'), 'NewSecret@123');
  record('AUTH: new password works after reset', newLogin.status === 200);

  const cp = await register('cp', 'CUSTOMER');
  await request(app)
    .post('/api/v1/auth/sendOtp')
    .send({ type: 'CHANGE_PASSWORD', identifier: email('cp') });
  const changeWrong = await request(app)
    .post('/api/v1/auth/changePassword')
    .set('Authorization', `Bearer ${cp.token}`)
    .send({ currentPassword: 'WrongPass@1', newPassword: 'Another@123', otp: OTP });
  record(
    'AUTH: changePassword wrong current rejected',
    changeWrong.status === 400,
    `status=${changeWrong.status}`,
  );
  const changeConsumed = await request(app)
    .post('/api/v1/auth/changePassword')
    .set('Authorization', `Bearer ${cp.token}`)
    .send({ currentPassword: 'Secret@123', newPassword: 'Another@123', otp: OTP });
  record(
    'AUTH: OTP consumed by failed attempt',
    changeConsumed.status === 401,
    `status=${changeConsumed.status}`,
  );

  await request(app)
    .post('/api/v1/auth/sendOtp')
    .send({ type: 'CHANGE_PASSWORD', identifier: email('au') });
  const change = await request(app)
    .post('/api/v1/auth/changePassword')
    .set('Authorization', `Bearer ${au.token}`)
    .send({ currentPassword: 'NewSecret@123', newPassword: 'ThirdSecret@123', otp: OTP });
  record(
    'AUTH: changePassword with OTP works',
    change.status === 200,
    `status=${change.status} ${D_str(change.body?.message)}`,
  );
  const changedLogin = await login(email('au'), 'ThirdSecret@123');
  record('AUTH: login with changed password', changedLogin.status === 200);

  const changeNoOtp = await request(app)
    .post('/api/v1/auth/changePassword')
    .set('Authorization', `Bearer ${au.token}`)
    .send({ currentPassword: 'ThirdSecret@123', newPassword: 'Another@123' });
  record('AUTH: changePassword without OTP blocked', changeNoOtp.status === 401);

  await request(app)
    .post('/api/v1/auth/sendOtp')
    .send({ type: 'EMAIL_VERIFY', identifier: email('au') });
  const verifyEmail = await request(app)
    .post('/api/v1/auth/verifyEmail')
    .set('Authorization', `Bearer ${au.token}`)
    .send({ email: email('au'), otp: OTP });
  record(
    'AUTH: verifyEmail works',
    verifyEmail.status === 200 && verifyEmail.body?.result?.emailVerified === true,
  );

  const verifyMismatch = await request(app)
    .post('/api/v1/auth/verifyEmail')
    .set('Authorization', `Bearer ${au.token}`)
    .send({ email: email('other'), otp: OTP });
  record('AUTH: verifyEmail foreign email blocked', verifyMismatch.status === 400);

  await request(app)
    .post('/api/v1/auth/sendOtp')
    .send({ type: 'PHONE_VERIFY', identifier: phoneFor('au') });
  const verifyPhone = await request(app)
    .post('/api/v1/auth/verifyPhone')
    .set('Authorization', `Bearer ${au.token}`)
    .send({ phone: phoneFor('au'), otp: OTP });
  record(
    'AUTH: verifyPhone works',
    verifyPhone.status === 200 && verifyPhone.body?.result?.phoneVerified === true,
  );

  const consent = await auAuth.post('/api/v1/auth/acceptConsent', { type: 'TERMS', version: '1' });
  record('AUTH: consent accepted', consent.status === 200);
  const consentAgain = await auAuth.post('/api/v1/auth/acceptConsent', {
    type: 'TERMS',
    version: '1',
  });
  record(
    'AUTH: consent idempotent',
    consentAgain.status === 200 &&
      consentAgain.body?.result?.consentId === consent.body?.result?.consentId,
  );
  const consentBad = await auAuth.post('/api/v1/auth/acceptConsent', { type: 'SOUL' });
  record('AUTH: invalid consent type rejected', consentBad.status === 400);
  const myConsents = await auAuth.get('/api/v1/auth/getMyConsents');
  record('AUTH: consents listed', D_arr(myConsents.body?.result?.consentList).length >= 1);

  const lk = await register('lk', 'CUSTOMER');
  for (let i = 0; i < 5; i += 1) {
    await login(email('lk'), 'WrongPass@123');
  }
  const locked = await login(email('lk'), 'Secret@123');
  record(
    'AUTH: account locks after 5 wrong passwords',
    locked.status === 403,
    `status=${locked.status}`,
  );

  const dl = await register('dl', 'CUSTOMER');
  const delAcc = await api(dl.token).del('/api/v1/users/deleteAccount');
  record('AUTH: account soft-deleted', delAcc.status === 200);
  const deletedLogin = await login(email('dl'), 'Secret@123');
  record('AUTH: deleted account login blocked', [401, 403].includes(deletedLogin.status));
  const deletedToken = await api(dl.token).get('/api/v1/auth/getMe');
  record('AUTH: deleted account token blocked', [401, 403].includes(deletedToken.status));
  const restore = await request(app)
    .post('/api/v1/auth/restoreAccount')
    .send({ restoreToken: 'x'.repeat(24) });
  record('AUTH: bogus restore token rejected', [400, 410].includes(restore.status));

  await setSetting('security.twoFactorEnabled', true, 'security', undefined, false);
  const tf = await register('tf', 'CUSTOMER');
  const tfAuth = api(tf.token);
  const enable = await tfAuth.post('/api/v1/auth/enable2FA', {});
  record(
    'AUTH: 2FA enabled',
    enable.status === 200 && D_arr(enable.body?.result?.backupCodes).length > 0,
  );
  const enableAgain = await tfAuth.post('/api/v1/auth/enable2FA', {});
  record('AUTH: 2FA double enable blocked', enableAgain.status === 409);

  const otpauthUrl = D_str(enable.body?.result?.otpauthUrl);
  const secret = /secret=([A-Z2-7]+)/i.exec(otpauthUrl)?.[1] ?? '';
  record('AUTH: 2FA secret present', secret.length > 0);

  const tfaLogin = await login(email('tf'), 'Secret@123');
  record(
    'AUTH: login with 2FA issues challenge',
    tfaLogin.body?.result?.twoFactorRequired === true,
  );

  const badTotp = await request(app)
    .post('/api/v1/auth/verify2FA')
    .send({ identifier: email('tf'), otp: '000000' });
  record('AUTH: wrong TOTP rejected', badTotp.status === 401);

  const goodTotp = await request(app)
    .post('/api/v1/auth/verify2FA')
    .send({ identifier: email('tf'), otp: generateTotp(secret) });
  record(
    'AUTH: TOTP login works',
    goodTotp.status === 200 && D_str(goodTotp.body?.result?.accessToken).length > 0,
  );

  const disableBad = await tfAuth.post('/api/v1/auth/disable2FA', { otp: '000000' });
  record('AUTH: disable2FA wrong code rejected', disableBad.status === 401);
  const disable = await tfAuth.post('/api/v1/auth/disable2FA', { otp: generateTotp(secret) });
  record('AUTH: 2FA disabled', disable.status === 200 && disable.body?.result?.isEnabled === false);
  const disableAgain = await tfAuth.post('/api/v1/auth/disable2FA', { otp: generateTotp(secret) });
  record('AUTH: disable2FA when off rejected', disableAgain.status === 400);
  await setSetting('security.twoFactorEnabled', false, 'security', undefined, false);
};

// ═══════════════════════════════════════════════════════════════════════════
// SUPER_ADMIN WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runSuperAdminWorkflow = async (adminToken: string) => {
  /* eslint-disable no-console */
  const admin = api(adminToken);

  log('\n' + '='.repeat(80));
  log('SUPER_ADMIN WORKFLOW');
  log('='.repeat(80));

  const dash = await admin.get('/api/v1/admin/getDashboardStats');
  record(
    'SUPER_ADMIN: dashboard returns counts',
    dash.status === 200 && typeof dash.body?.result?.totalUsers === 'number',
  );

  const health = await admin.get('/api/v1/admin/getSystemHealth');
  record('SUPER_ADMIN: health reports database ok', health.body?.result?.database?.ok === true);

  const perms = await admin.get('/api/v1/admin/getPermissions');
  record('SUPER_ADMIN: permission matrix has roles', perms.body?.result?.roleList !== undefined);

  const sub = await admin.post('/api/v1/admin/createSubAdmin', {
    name: `RC Sub ${run}`,
    email: email('sub'),
    phone: phoneFor('sub'),
    password: 'Secret@123',
    permissions: ['order:list'],
  });
  record(
    'SUPER_ADMIN: sub-admin created',
    sub.status === 201 && sub.body?.result?.role === 'SUB_ADMIN',
  );
  const subId = sub.body?.result?.userId ?? '';

  const dupSub = await admin.post('/api/v1/admin/createSubAdmin', {
    name: `RC Sub ${run}`,
    email: email('sub'),
    phone: phoneFor('sub'),
    password: 'Secret@123',
  });
  record('SUPER_ADMIN: duplicate sub-admin rejected', dupSub.status === 409);

  const badSub = await admin.post('/api/v1/admin/createSubAdmin', {
    name: 'X',
    email: 'not-an-email',
    password: 'short',
  });
  record('SUPER_ADMIN: invalid sub-admin rejected', badSub.status === 400);

  const subs = await admin.get('/api/v1/admin/getAllSubAdmins');
  record(
    'SUPER_ADMIN: sub-admin listed',
    subs.body?.result?.itemList?.some((u: any) => u.userId === subId),
  );

  const permUpdate = await admin.patch('/api/v1/admin/updatePermissions/SUB_ADMIN', {
    permissions: ['order:list', 'order:view'],
  });
  record('SUPER_ADMIN: permissions updated', permUpdate.status === 200);

  const badPerm = await admin.patch('/api/v1/admin/updatePermissions/NOT_A_ROLE', {
    permissions: ['order:list'],
  });
  record('SUPER_ADMIN: invalid role rejected', badPerm.status === 400);

  const audit = await admin.get('/api/v1/admin/getAuditLogs');
  record('SUPER_ADMIN: audit logs returned', audit.status === 200);

  const activity = await admin.get('/api/v1/admin/getActivityLogs');
  record('SUPER_ADMIN: activity logs returned', activity.status === 200);

  const jobs = await admin.get('/api/v1/admin/getCronJobs');
  record('SUPER_ADMIN: cron jobs listed', jobs.status === 200);

  const failed = await admin.get('/api/v1/admin/getFailedJobs');
  record('SUPER_ADMIN: failed jobs listed', failed.status === 200);

  const cache = await admin.post('/api/v1/admin/clearCache');
  record('SUPER_ADMIN: cache cleared', cache.status === 200);

  return { subId };
};

// ═══════════════════════════════════════════════════════════════════════════
// SUB_ADMIN WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runSubAdminWorkflow = async (adminToken: string, subId: string) => {
  const { prisma } = await import('../src/services/prisma.service');
  const subUser = await prisma.user.findUnique({ where: { id: subId }, select: { email: true } });
  if (!subUser) throw new Error('sub-admin not found');

  log('\n' + '='.repeat(80));
  log('SUB_ADMIN WORKFLOW');
  log('='.repeat(80));

  const subLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: subUser.email, password: 'Secret@123' });
  const subToken = subLogin.body?.result?.accessToken ?? '';
  record('SUB_ADMIN: login -> 200', subToken.length > 0);

  const sub = api(subToken);

  const dash = await sub.get('/api/v1/admin/getDashboardStats');
  record('SUB_ADMIN: can read dashboard', dash.status === 200);

  const forbidden = await sub.post('/api/v1/admin/createSubAdmin', {
    name: 'Nope',
    email: email('nope'),
    phone: phoneFor('np'),
    password: 'Secret@123',
  });
  record('SUB_ADMIN: cannot create sub-admin', forbidden.status === 403);

  const users = await sub.get('/api/v1/users/getAll?limit=10');
  record('SUB_ADMIN: can list users', users.status === 200);

  const vendors = await sub.get('/api/v1/vendors/getAll?limit=10');
  record('SUB_ADMIN: can list vendors', vendors.status === 200);

  const orders = await sub.get('/api/v1/orders/getAll');
  record('SUB_ADMIN: order list allowed with perm', orders.status === 200);
};

// ═══════════════════════════════════════════════════════════════════════════
// USERS ADMIN WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runUsersAdminWorkflow = async (
  adminToken: string,
  customer: { token: string; userId: string },
) => {
  const admin = api(adminToken);
  const customerApi = api(customer.token);

  log('\n' + '='.repeat(80));
  log('USERS ADMIN WORKFLOW');
  log('='.repeat(80));

  const byRole = await admin.get('/api/v1/users/getAll?role=CUSTOMER&limit=5');
  record(
    'USERS: filter by role works',
    byRole.status === 200 && byRole.body?.result?.userList?.length >= 1,
  );

  const byStatus = await admin.get('/api/v1/users/getAll?status=active&limit=5');
  record('USERS: filter by status works', byStatus.status === 200);

  const byId = await admin.get(`/api/v1/users/getById/${customer.userId}`);
  record(
    'USERS: getById returns user',
    byId.body?.result?.userData?.userId === customer.userId || byId.status === 200,
  );

  const bogusUser = await admin.get('/api/v1/users/getById/nope123');
  record('USERS: unknown user 404', bogusUser.status === 404);

  const upd = await admin.patch(`/api/v1/users/updateUser/${customer.userId}`, {
    name: 'RC AdminEdit',
  });
  record('USERS: admin can rename user', upd.status === 200);

  const dupEmail = await admin.patch(`/api/v1/users/updateUser/${customer.userId}`, {
    email: process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@projectname.com',
  });
  record('USERS: duplicate email rejected', dupEmail.status === 409);

  const emptyUpd = await admin.patch(`/api/v1/users/updateUser/${customer.userId}`, {});
  record('USERS: empty update rejected', emptyUpd.status === 400);

  const suspend = await admin.patch(`/api/v1/users/toggleStatus/${customer.userId}`, {
    isActive: false,
    reason: 'rc test suspend',
  });
  record('USERS: user suspended', suspend.status === 200);

  const suspendedLogin = await login(email('cu'), 'Secret@123');
  record('USERS: suspended login blocked', suspendedLogin.status === 403);

  const suspendedToken = await customerApi.get('/api/v1/users/getProfile');
  record('USERS: suspended token blocked', suspendedToken.status === 403);

  const reactivate = await admin.patch(`/api/v1/users/toggleStatus/${customer.userId}`, {
    isActive: true,
  });
  record('USERS: user reactivated', reactivate.status === 200);

  const relogin = await login(email('cu'), 'Secret@123');
  record('USERS: reactivated login works', relogin.status === 200);

  const ban = await admin.post(`/api/v1/users/banCustomer/${customer.userId}`, {
    reason: 'rc test ban',
    durationDays: 1,
  });
  record('USERS: customer banned', ban.status === 200);

  const bannedLogin = await login(email('cu'), 'Secret@123');
  record('USERS: banned login blocked', bannedLogin.status === 403);

  const bans = await admin.get('/api/v1/users/getBans?isActive=true');
  record('USERS: ban listed', D_arr(bans.body?.result?.banList).length >= 1);

  const unban = await admin.post(`/api/v1/users/unbanCustomer/${customer.userId}`, {
    reason: 'rc unban',
  });
  record('USERS: customer unbanned', unban.status === 200);

  const unbanAgain = await admin.post(`/api/v1/users/unbanCustomer/${customer.userId}`, {});
  record('USERS: repeat unban idempotent', unbanAgain.status === 200);

  const note = await admin.post(`/api/v1/users/addNote/${customer.userId}`, {
    note: `rc note ${run}`,
  });
  record('USERS: note added', note.status === 200);
  const noteId = note.body?.result?.noteId ?? note.body?.result?.id ?? '';

  const notes = await admin.get(`/api/v1/users/getNotes/${customer.userId}`);
  record('USERS: notes listed', notes.status === 200);

  const rmNote = await admin.del(`/api/v1/users/removeNote/${customer.userId}/${noteId}`);
  record('USERS: note removed', rmNote.status === 200);
  const rmNoteAgain = await admin.del(`/api/v1/users/removeNote/${customer.userId}/${noteId}`);
  record('USERS: double note remove 404', rmNoteAgain.status === 404);

  const seg = await admin.post('/api/v1/users/createSegment', {
    name: `RC Seg ${run}`,
    description: 'rc',
  });
  record('USERS: segment created', seg.status === 201);
  const segId = seg.body?.result?.segmentId ?? '';

  const segUpd = await admin.patch(`/api/v1/users/updateSegment/${segId}`, { color: '#ff0000' });
  record('USERS: segment updated', segUpd.status === 200);

  const segList = await admin.get('/api/v1/users/getSegments');
  record('USERS: segments listed', segList.status === 200);

  const segById = await admin.get(`/api/v1/users/getSegmentById/${segId}`);
  record('USERS: segment by id', segById.status === 200);

  const addMembers = await admin.post(`/api/v1/users/addSegmentMembers/${segId}`, {
    userIds: [customer.userId],
  });
  record('USERS: segment member added', addMembers.status === 200);

  const members = await admin.get(`/api/v1/users/getSegmentMembers/${segId}`);
  record('USERS: segment members listed', members.status === 200);

  const rmMembers = await admin.post(`/api/v1/users/removeSegmentMembers/${segId}`, {
    userIds: [customer.userId],
  });
  record('USERS: segment member removed', rmMembers.status === 200);

  const refresh = await admin.post('/api/v1/users/refreshSegments', {});
  record('USERS: segments refreshed', refresh.status === 200);

  const segDel = await admin.del(`/api/v1/users/deleteSegment/${segId}`);
  record('USERS: segment deleted', segDel.status === 200);
  const segGone = await admin.get(`/api/v1/users/getSegmentById/${segId}`);
  record('USERS: deleted segment 404', segGone.status === 404);

  const orders = await admin.get(`/api/v1/users/getOrders/${customer.userId}`);
  record('USERS: user orders listed', orders.status === 200);

  const activity = await admin.get(`/api/v1/users/getActivity/${customer.userId}`);
  record('USERS: user activity listed', activity.status === 200);

  const timeline = await admin.get(`/api/v1/users/getTimeline/${customer.userId}`);
  record('USERS: user timeline listed (admin)', timeline.status === 200);

  const exportData = await admin.get(`/api/v1/users/exportData/${customer.userId}`);
  record('USERS: admin export user data', exportData.status === 200);

  const impersonate = await admin.post(`/api/v1/users/impersonate/${customer.userId}`, {
    reason: 'rc audit test',
  });
  record(
    'USERS: impersonation token issued',
    impersonate.status === 200 && D_str(impersonate.body?.result?.accessToken).length > 0,
  );
  const impToken = D_str(impersonate.body?.result?.accessToken);
  const impMe = await api(impToken).get('/api/v1/auth/getMe');
  record(
    'USERS: impersonation token acts as target',
    impMe.body?.result?.userData?.userId === customer.userId,
  );

  const { prisma } = await import('../src/services/prisma.service');
  const adminRow = await prisma.user.findUnique({
    where: { email: process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@projectname.com' },
    select: { id: true },
  });
  const selfImp = await admin.post(`/api/v1/users/impersonate/${adminRow?.id ?? ''}`, {
    reason: 'self',
  });
  record('USERS: self impersonation blocked', selfImp.status === 403);

  const du = await register('du', 'CUSTOMER');
  const delUser = await admin.del(`/api/v1/users/deleteUser/${du.userId}`);
  record('USERS: hard delete fresh user', delUser.status === 200);
  const delGone = await admin.get(`/api/v1/users/getById/${du.userId}`);
  record('USERS: deleted user gone', delGone.status === 404);

  const avatar = await customerApi.patch('/api/v1/users/updateAvatar', {
    avatarUrl: 'https://example.com/a.png',
  });
  record('USERS: avatar updated', avatar.status === 200);
  const badAvatar = await customerApi.patch('/api/v1/users/updateAvatar', {
    avatarUrl: 'not-a-url',
  });
  record('USERS: invalid avatar url rejected', badAvatar.status === 400);

  const addr = await addTestAddress(customerApi, '900 Default St');
  const addrId = addr.body?.result?.addressId ?? '';
  const def = await customerApi.patch(`/api/v1/users/setDefaultAddress/${addrId}`, {});
  record('USERS: default address set', def.status === 200);
};

// ═══════════════════════════════════════════════════════════════════════════
// VENDOR WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runVendorWorkflow = async (vendorToken: string, vendorId: string, adminToken: string) => {
  const vendor = api(vendorToken);
  const admin = api(adminToken);

  log('\n' + '='.repeat(80));
  log('VENDOR WORKFLOW');
  log('='.repeat(80));

  await admin.patch(`/api/v1/vendors/approveVendor/${vendorId}`, {});

  const profile = await vendor.get('/api/v1/vendors/getProfile');
  record('VENDOR: profile returns vendorId', profile.body?.result?.vendorId === vendorId);
  record('VENDOR: status is APPROVED', profile.body?.result?.status === 'APPROVED');

  const bank = await vendor.patch(`/api/v1/vendors/updateBankDetails/${vendorId}`, {
    bankHolderName: 'RC Vendor',
    bankAccountNo: '000111222333',
    bankIfsc: 'HDFC0000001',
  });
  record('VENDOR: bank details updated', bank.status === 200);

  const badBank = await vendor.patch(`/api/v1/vendors/updateBankDetails/${vendorId}`, {
    bankIfsc: 'BAD',
  });
  record('VENDOR: invalid IFSC rejected', badBank.status === 400);

  const otherBank = await vendor.patch('/api/v1/vendors/updateBankDetails/some-other-vendor', {
    bankAccountNo: '1234567890',
  });
  record('VENDOR: cannot edit other vendor bank', otherBank.status === 400);

  const product = await vendor.post('/api/v1/products/createProduct', {
    name: `RC Product ${run}`,
    price: 999,
    stock: 10,
    taxPercent: 0,
  });
  record('VENDOR: product created', product.status === 201);
  const productId = product.body?.result?.productId ?? '';

  const badProduct = await vendor.post('/api/v1/products/createProduct', {
    name: 'Bad',
    price: -10,
  });
  record('VENDOR: negative price rejected', badProduct.status === 400);

  const updated = await vendor.patch(`/api/v1/products/updateProduct/${productId}`, {
    price: 899,
  });
  record('VENDOR: product updated', updated.body?.result?.price === 899);

  const stock = await vendor.patch(`/api/v1/products/updateStock/${productId}`, {
    stock: 5,
  });
  record('VENDOR: stock updated', stock.body?.result?.stock === 5);

  const toggled = await vendor.patch(`/api/v1/products/toggleStatus/${productId}`, {
    status: 'INACTIVE',
  });
  record('VENDOR: product toggled', toggled.body?.result?.status === 'INACTIVE');

  await vendor.patch(`/api/v1/products/toggleStatus/${productId}`, { status: 'ACTIVE' });

  const stats = await vendor.get('/api/v1/vendors/getStats');
  record('VENDOR: stats returned', stats.status === 200);

  const payoutHistory = await vendor.get('/api/v1/vendors/getPayoutHistory');
  record('VENDOR: payout history returned', payoutHistory.status === 200);

  const payout = await vendor.post('/api/v1/vendors/requestPayout', {
    amount: 1000,
    method: 'BANK',
  });
  record('VENDOR: payout blocked without earnings', payout.status === 422);

  const badPayout = await vendor.post('/api/v1/vendors/requestPayout', {
    amount: -100,
  });
  record('VENDOR: negative payout rejected', badPayout.status === 400);

  const vendorProducts = await request(app).get(`/api/v1/vendors/getProducts/${vendorId}`);
  record('VENDOR: public products listed', vendorProducts.status === 200);

  const ratings = await request(app).get(`/api/v1/vendors/getRatings/${vendorId}`);
  record('VENDOR: ratings returned', ratings.status === 200);

  const noRatings = await request(app).get('/api/v1/vendors/getRatings/does-not-exist');
  record('VENDOR: unknown vendor ratings 404', noRatings.status === 404);

  return { productId };
};

// ═══════════════════════════════════════════════════════════════════════════
// VENDOR ADMIN WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runVendorAdminWorkflow = async (
  adminToken: string,
  vendorToken: string,
  vendorId: string,
  vendorUserId: string,
  customerUserId: string,
  productId: string,
) => {
  const admin = api(adminToken);
  const vendor = api(vendorToken);

  log('\n' + '='.repeat(80));
  log('VENDOR ADMIN WORKFLOW');
  log('='.repeat(80));

  const profile = await vendor.get('/api/v1/vendors/getProfile');
  const slug = D_str(profile.body?.result?.slug);

  const updProfile = await vendor.patch('/api/v1/vendors/updateProfile', {
    description: 'RC updated shop',
  });
  record('VENDOR_ADMIN: vendor updates own profile', updProfile.status === 200);

  const store = await request(app).get(`/api/v1/vendors/getStore/${slug}`);
  record('VENDOR_ADMIN: public store page works', store.status === 200);
  const noStore = await request(app).get('/api/v1/vendors/getStore/no-such-shop');
  record('VENDOR_ADMIN: unknown store slug 404', noStore.status === 404);

  const ann = await vendor.post('/api/v1/vendors/createAnnouncement', {
    title: `RC Sale ${run}`,
    message: 'Big test sale',
    isPinned: true,
  });
  record('VENDOR_ADMIN: announcement created', ann.status === 201);
  const annId = ann.body?.result?.announcementId ?? '';

  const anns = await vendor.get('/api/v1/vendors/getAnnouncements');
  record('VENDOR_ADMIN: announcements listed', anns.status === 200);

  const annBadWindow = await vendor.post('/api/v1/vendors/createAnnouncement', {
    title: 'Bad window',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  record('VENDOR_ADMIN: announcement bad window rejected', annBadWindow.status === 400);

  const annUpd = await vendor.patch(`/api/v1/vendors/updateAnnouncement/${annId}`, {
    isPinned: false,
  });
  record('VENDOR_ADMIN: announcement updated', annUpd.status === 200);

  const annDel = await vendor.del(`/api/v1/vendors/deleteAnnouncement/${annId}`);
  record('VENDOR_ADMIN: announcement deleted', annDel.status === 200);
  const annDelAgain = await vendor.del(`/api/v1/vendors/deleteAnnouncement/${annId}`);
  record('VENDOR_ADMIN: double announcement delete 404', annDelAgain.status === 404);

  const vacation = await vendor.patch(`/api/v1/vendors/updateVacation/${vendorId}`, {
    isOnVacation: true,
    message: 'Out for testing',
  });
  record('VENDOR_ADMIN: vacation mode on', vacation.status === 200);

  const vacationOff = await vendor.patch(`/api/v1/vendors/updateVacation/${vendorId}`, {
    isOnVacation: false,
  });
  record('VENDOR_ADMIN: vacation mode off', vacationOff.status === 200);

  const block = await vendor.post(`/api/v1/vendors/blockCustomer/${customerUserId}`, {
    reason: 'spam',
  });
  record('VENDOR_ADMIN: customer blocked by vendor', [200, 201].includes(block.status));

  const blockedList = await vendor.get('/api/v1/vendors/getBlockedCustomers');
  record('VENDOR_ADMIN: blocked customers listed', blockedList.status === 200);

  const unblock = await vendor.del(`/api/v1/vendors/unblockCustomer/${customerUserId}`);
  record('VENDOR_ADMIN: customer unblocked', unblock.status === 200);

  const docs = await admin.get('/api/v1/vendors/getDocuments');
  record('VENDOR_ADMIN: admin lists KYC documents', docs.status === 200);

  const verifyDocs = await admin.patch('/api/v1/vendors/verifyDocuments/nope123', {
    status: 'VERIFIED',
  });
  record('VENDOR_ADMIN: verify unknown documents 404', [400, 404].includes(verifyDocs.status));

  const byId = await admin.get(`/api/v1/vendors/getById/${vendorId}`);
  record('VENDOR_ADMIN: admin gets vendor by id', byId.status === 200);

  const commission = await admin.patch(`/api/v1/vendors/updateCommission/${vendorId}`, {
    commissionRate: 12,
  });
  record('VENDOR_ADMIN: commission updated', commission.status === 200);

  const badCommission = await admin.patch(`/api/v1/vendors/updateCommission/${vendorId}`, {
    commissionRate: 150,
  });
  record('VENDOR_ADMIN: commission above 100 rejected', badCommission.status === 400);

  const suspend = await admin.patch(`/api/v1/vendors/suspendVendor/${vendorId}`, {
    reason: 'rc test',
  });
  record('VENDOR_ADMIN: vendor suspended', suspend.status === 200);

  const suspendAgain = await admin.patch(`/api/v1/vendors/suspendVendor/${vendorId}`, {
    reason: 'rc test',
  });
  record('VENDOR_ADMIN: double suspend blocked', suspendAgain.status === 409);

  const productWhileSuspended = await vendor.post('/api/v1/products/createProduct', {
    name: `RC Susp ${run}`,
    price: 100,
    stock: 1,
  });
  record(
    'VENDOR_ADMIN: suspended vendor cannot create product',
    productWhileSuspended.status === 403,
  );

  const productAfterSuspend = await vendor.get(`/api/v1/products/getById/${productId}`);
  record(
    'VENDOR_ADMIN: suspend deactivates products',
    productAfterSuspend.body?.result?.status === 'INACTIVE',
  );

  const reApprove = await admin.patch(`/api/v1/vendors/approveVendor/${vendorId}`, {});
  record('VENDOR_ADMIN: vendor re-approved', reApprove.status === 200);

  await vendor.patch(`/api/v1/products/toggleStatus/${productId}`, { status: 'ACTIVE' });
  const productRestored = await vendor.get(`/api/v1/products/getById/${productId}`);
  record(
    'VENDOR_ADMIN: product reactivated after re-approval',
    productRestored.body?.result?.status === 'ACTIVE',
  );

  const v4 = await register('v4', 'VENDOR', `RC Reject Shop ${run}`);
  const reject = await admin.patch(`/api/v1/vendors/rejectVendor/${v4.vendorId}`, {
    reason: 'rc rejected',
  });
  record('VENDOR_ADMIN: vendor rejected', reject.status === 200);

  const rejectedProduct = await api(v4.token).post('/api/v1/products/createProduct', {
    name: `RC Rej ${run}`,
    price: 100,
    stock: 1,
  });
  record('VENDOR_ADMIN: rejected vendor cannot create product', rejectedProduct.status === 403);

  const vendorList = await admin.get('/api/v1/vendors/getAll?vendorStatus=APPROVED&limit=10');
  record('VENDOR_ADMIN: admin filters vendors by status', vendorList.status === 200);
};

// ═══════════════════════════════════════════════════════════════════════════
// CATALOG WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runCatalogWorkflow = async (adminToken: string, customerToken: string, productId: string) => {
  const admin = api(adminToken);
  const customer = api(customerToken);

  log('\n' + '='.repeat(80));
  log('CATALOG WORKFLOW');
  log('='.repeat(80));

  const cat = await admin.post('/api/v1/categories/createCategory', { name: `RC Cat ${run}` });
  record('CATALOG: category created', cat.status === 201);
  const catId = cat.body?.result?.categoryId ?? '';
  const catSlug = D_str(cat.body?.result?.slug);

  const child = await admin.post('/api/v1/categories/createCategory', {
    name: `RC Child ${run}`,
    parentId: catId,
  });
  record('CATALOG: child category created', child.status === 201);
  const childId = child.body?.result?.categoryId ?? '';

  const catList = await request(app).get('/api/v1/categories/getAll');
  record('CATALOG: categories listed publicly', catList.status === 200);

  const tree = await request(app).get('/api/v1/categories/getAll?tree=1');
  record(
    'CATALOG: category tree works',
    tree.status === 200 && D_arr(tree.body?.result?.categoryList).length >= 1,
  );

  const catById = await request(app).get(`/api/v1/categories/getById/${catId}`);
  record('CATALOG: category by id', catById.body?.result?.categoryId === catId);

  const catBySlug = await request(app).get(`/api/v1/categories/getBySlug/${catSlug}`);
  record('CATALOG: category by slug', catBySlug.status === 200);

  const catUpd = await admin.patch(`/api/v1/categories/updateCategory/${catId}`, {
    description: 'rc desc',
  });
  record('CATALOG: category updated', catUpd.status === 200);

  const selfParent = await admin.patch(`/api/v1/categories/updateCategory/${catId}`, {
    parentId: catId,
  });
  record('CATALOG: self-parent rejected', selfParent.status === 400);

  const childParent = await admin.patch(`/api/v1/categories/updateCategory/${catId}`, {
    parentId: childId,
  });
  record('CATALOG: move under own child rejected', childParent.status === 400);

  const badParent = await admin.post('/api/v1/categories/createCategory', {
    name: `RC Orphan ${run}`,
    parentId: 'nope123',
  });
  record('CATALOG: unknown parent rejected', badParent.status === 404);

  const delParentWithChild = await admin.del(`/api/v1/categories/deleteCategory/${catId}`);
  record('CATALOG: delete with children blocked', delParentWithChild.status === 409);

  const delChild = await admin.del(`/api/v1/categories/deleteCategory/${childId}`);
  record('CATALOG: child deleted', delChild.status === 200);

  const bulk = await admin.post('/api/v1/categories/bulkCreate', {
    categories: [{ name: `RC BulkA ${run}` }, { name: 'x' }],
  });
  record(
    'CATALOG: bulk create partial',
    bulk.status === 201 &&
      bulk.body?.result?.successCount === 1 &&
      bulk.body?.result?.failCount === 1,
  );
  const bulkCatId = D_str(bulk.body?.result?.errorList?.[0]?.row) ? '' : '';

  const sibA = await admin.post('/api/v1/categories/createCategory', { name: `RC SibA ${run}` });
  const sibB = await admin.post('/api/v1/categories/createCategory', { name: `RC SibB ${run}` });
  const reorderIds = [sibA.body?.result?.categoryId, sibB.body?.result?.categoryId].filter(Boolean);
  const reorder = await admin.post('/api/v1/categories/reorder', { categoryIds: reorderIds });
  record(
    'CATALOG: reorder works',
    reorder.status === 200 && reorder.body?.result?.reorderedCount === 2,
    `status=${reorder.status}`,
  );
  const reorderBad = await admin.post('/api/v1/categories/reorder', { categoryIds: ['nope123'] });
  record('CATALOG: reorder unknown category 404', reorderBad.status === 404);

  const catForbidden = await customer.post('/api/v1/categories/createCategory', {
    name: 'RC Nope',
  });
  record('CATALOG: customer cannot create category', catForbidden.status === 403);

  const brand = await admin.post('/api/v1/brands/createBrand', { name: `RC Brand ${run}` });
  record('CATALOG: brand created', brand.status === 201);
  const brandId = brand.body?.result?.brandId ?? '';
  const brandSlug = D_str(brand.body?.result?.slug);

  const brand2 = await admin.post('/api/v1/brands/createBrand', { name: `RC BrandTwo ${run}` });
  const brand2Id = brand2.body?.result?.brandId ?? '';
  const dupSlug = await admin.patch(`/api/v1/brands/updateBrand/${brand2Id}`, { slug: brandSlug });
  record('CATALOG: duplicate brand slug rejected', dupSlug.status === 409);
  await admin.del(`/api/v1/brands/deleteBrand/${brand2Id}`);

  const brands = await request(app).get('/api/v1/brands/getAll?search=RC');
  record('CATALOG: brand search works', brands.status === 200);
  const brandBySlug = await request(app).get(`/api/v1/brands/getBySlug/${brandSlug}`);
  record('CATALOG: brand by slug', brandBySlug.status === 200);

  const tag = await admin.post('/api/v1/tags/createTag', { name: `RC Tag ${run}` });
  record('CATALOG: tag created', tag.status === 201);
  const tagId = tag.body?.result?.tagId ?? '';

  const bulkTags = await admin.post('/api/v1/tags/bulkCreate', {
    tags: [{ name: `RC TagB ${run}` }, { name: `RC TagC ${run}` }],
  });
  record(
    'CATALOG: bulk tags created',
    bulkTags.status === 201 && bulkTags.body?.result?.successCount === 2,
    `ok=${bulkTags.body?.result?.successCount}`,
  );

  const badBulkTags = await admin.post('/api/v1/tags/bulkCreate', { tags: [{ name: 'x' }] });
  record('CATALOG: bulk tags invalid row rejected', badBulkTags.status === 400);
  const bulkTagId =
    D_arr(bulkTags.body?.result?.tagList ?? bulkTags.body?.result?.itemList)[0]?.tagId ?? '';

  const tags = await request(app).get('/api/v1/tags/getAll');
  record('CATALOG: tags listed', tags.status === 200);

  const attr = await admin.post('/api/v1/attributes/createAttribute', {
    name: `RC Size ${run}`,
    type: 'SIZE',
    options: ['S', 'M', 'L'],
    isVariant: true,
  });
  record('CATALOG: attribute created', attr.status === 201);
  const attrId = attr.body?.result?.attributeId ?? '';

  const badVariantAttr = await admin.post('/api/v1/attributes/createAttribute', {
    name: `RC BadAttr ${run}`,
    type: 'TEXT',
    isVariant: true,
  });
  record('CATALOG: TEXT variant attribute rejected', badVariantAttr.status === 400);

  const attrs = await request(app).get('/api/v1/attributes/getAll?isVariant=true');
  record('CATALOG: attributes filtered', attrs.status === 200);
  const attrById = await request(app).get(`/api/v1/attributes/getById/${attrId}`);
  record('CATALOG: attribute by id', attrById.status === 200);
  const attrUpd = await admin.patch(`/api/v1/attributes/updateAttribute/${attrId}`, {
    options: ['S', 'M', 'L', 'XL'],
  });
  record('CATALOG: attribute updated', attrUpd.status === 200);

  const manual = await admin.post('/api/v1/collections/createCollection', {
    name: `RC Manual ${run}`,
    type: 'MANUAL',
    productIds: [productId],
  });
  record('CATALOG: manual collection created', manual.status === 201);
  const manualId = manual.body?.result?.collectionId ?? '';

  const emptyManual = await admin.post('/api/v1/collections/createCollection', {
    name: `RC Empty ${run}`,
    type: 'MANUAL',
  });
  record('CATALOG: manual without products rejected', emptyManual.status === 400);

  const dynamic = await admin.post('/api/v1/collections/createCollection', {
    name: `RC Dynamic ${run}`,
    type: 'DYNAMIC',
    rules: { minPrice: 0, inStockOnly: true },
  });
  record('CATALOG: dynamic collection created', dynamic.status === 201);
  const dynamicId = dynamic.body?.result?.collectionId ?? '';

  const emptyDynamic = await admin.post('/api/v1/collections/createCollection', {
    name: `RC NoRule ${run}`,
    type: 'DYNAMIC',
  });
  record('CATALOG: dynamic without rules rejected', emptyDynamic.status === 400);

  const setOnDynamic = await admin.post(`/api/v1/collections/setProducts/${dynamicId}`, {
    productIds: [productId],
  });
  record('CATALOG: setProducts on dynamic rejected', setOnDynamic.status === 400);

  const setOnManual = await admin.post(`/api/v1/collections/setProducts/${manualId}`, {
    productIds: [productId],
  });
  record(
    'CATALOG: setProducts on manual works',
    setOnManual.status === 200 && setOnManual.body?.result?.productCount === 1,
  );

  const colProducts = await admin.get(`/api/v1/collections/getProducts/${manualId}`);
  record(
    'CATALOG: collection products listed',
    D_arr(colProducts.body?.result?.productList).length === 1,
    `status=${colProducts.status} len=${D_arr(colProducts.body?.result?.productList).length}`,
  );

  const colBySlug = await request(app).get(
    `/api/v1/collections/getBySlug/rc-manual-${run.toLowerCase()}`,
  );
  record('CATALOG: collection by slug', [200, 404].includes(colBySlug.status));

  const colUpd = await admin.patch(`/api/v1/collections/updateCollection/${dynamicId}`, {
    description: 'rc dyn',
  });
  record('CATALOG: collection updated', colUpd.status === 200);

  const delDynamic = await admin.del(`/api/v1/collections/deleteCollection/${dynamicId}`);
  record('CATALOG: dynamic collection deleted', delDynamic.status === 200);

  return { catId, brandId, tagId, attrId, manualId, bulkTagId, bulkCatId };
};

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runCustomerWorkflow = async (
  customerToken: string,
  customerUserId: string,
  vendorId: string,
  adminToken: string,
  productId: string,
) => {
  const customer = api(customerToken);
  const admin = api(adminToken);

  log('\n' + '='.repeat(80));
  log('CUSTOMER WORKFLOW');
  log('='.repeat(80));

  const profile = await customer.get('/api/v1/users/getProfile');
  record('CUSTOMER: profile returned', profile.status === 200);
  record('CUSTOMER: envelope strict', assertEnvelope(profile.body, true));

  const noAuth = await request(app).get('/api/v1/users/getProfile');
  record('CUSTOMER: unauthenticated blocked', noAuth.status === 401);

  const updated = await customer.patch('/api/v1/users/updateProfile', {
    name: 'RC Updated',
  });
  record('CUSTOMER: profile updated', updated.body?.result?.userData?.name === 'RC Updated');

  const emptyUpdate = await customer.patch('/api/v1/users/updateProfile', {});
  record('CUSTOMER: empty update rejected', emptyUpdate.status === 400);

  const escalate = await customer.patch('/api/v1/users/updateProfile', {
    role: 'SUPER_ADMIN',
  });
  record('CUSTOMER: privilege escalation blocked', escalate.status === 400);

  const address = await customer.post('/api/v1/users/addAddress', {
    type: 'HOME',
    fullName: 'RC Customer',
    phone: phoneFor('cu'),
    line1: '123 Test St',
    city: 'Mumbai',
    state: 'Maharashtra',
    stateCode: 'MH',
    countryCode: 'IN',
    pincode: '400001',
  });
  record('CUSTOMER: address added', address.status === 201);
  const addressId = address.body?.result?.addressId ?? '';

  const badAddr = await customer.post('/api/v1/users/addAddress', {
    fullName: 'X',
    line1: 'Y',
    city: 'Z',
    state: 'S',
    countryCode: 'IN',
    pincode: 'abc',
  });
  record('CUSTOMER: invalid pincode rejected', badAddr.status === 400);

  const addresses = await customer.get('/api/v1/users/getAddresses');
  record('CUSTOMER: addresses listed', addresses.body?.result?.addressList?.length >= 1);

  const updAddr = await customer.patch(`/api/v1/users/updateAddress/${addressId}`, {
    landmark: 'Near Station',
  });
  record('CUSTOMER: address updated', updAddr.body?.result?.landmark === 'Near Station');

  const delAddr = await customer.del(`/api/v1/users/deleteAddress/${addressId}`);
  record('CUSTOMER: address deleted', delAddr.status === 200);

  const delAgain = await customer.del(`/api/v1/users/deleteAddress/${addressId}`);
  record('CUSTOMER: double delete blocked', delAgain.status === 404);

  const addItem = await customer.post('/api/v1/cart/addItem', {
    productId,
    qty: 2,
  });
  record('CUSTOMER: item added to cart', addItem.status === 201);

  const oos = await customer.post('/api/v1/cart/addItem', {
    productId,
    qty: 9999,
  });
  record('CUSTOMER: oversell blocked', oos.status === 400);

  const cart = await customer.get('/api/v1/cart/getCart');
  record('CUSTOMER: cart returned', cart.status === 200);
  record('CUSTOMER: cart has no nulls', findNull(cart.body?.result) === null);

  const updItem = await customer.patch('/api/v1/cart/updateItem', {
    productId,
    qty: 1,
  });
  record('CUSTOMER: cart item updated', updItem.status === 200);

  const badCoupon = await customer.post('/api/v1/cart/applyCoupon', {
    code: 'INVALID',
  });
  record('CUSTOMER: unknown coupon blocked', badCoupon.status === 404);

  const estimate = await customer.post('/api/v1/cart/estimate', {
    paymentMethod: 'COD',
  });
  record('CUSTOMER: estimate returned', estimate.status === 200);

  const badMethod = await customer.post('/api/v1/cart/estimate', {
    paymentMethod: 'CRYPTO',
  });
  record('CUSTOMER: invalid payment method blocked', badMethod.status === 400);

  const wish = await customer.post('/api/v1/wishlist/addItem', { productId });
  record('CUSTOMER: wishlist item added', wish.status === 201);

  const dupWish = await customer.post('/api/v1/wishlist/addItem', { productId });
  record('CUSTOMER: duplicate wishlist blocked', dupWish.status === 409);

  const wishlist = await customer.get('/api/v1/wishlist/getAll');
  record('CUSTOMER: wishlist returned', wishlist.status === 200);

  const unwish = await customer.del(`/api/v1/wishlist/removeItem/${productId}`);
  record('CUSTOMER: wishlist item removed', unwish.status === 200);

  const address2 = await customer.post('/api/v1/users/addAddress', {
    type: 'HOME',
    fullName: 'RC Customer',
    phone: phoneFor('cu'),
    line1: '456 Test Ave',
    city: 'Delhi',
    state: 'Delhi',
    stateCode: 'DL',
    countryCode: 'IN',
    pincode: '110001',
  });
  const placeOrder = await customer.post('/api/v1/orders/placeOrder', {
    addressId: address2.body?.result?.addressId,
    paymentMethod: 'COD',
    skipStatus: true,
  });
  record('CUSTOMER: order placed', placeOrder.status === 201);
  const orderId = placeOrder.body?.result?.orderId ?? '';

  const emptyOrder = await customer.post('/api/v1/orders/placeOrder', {
    addressId: address2.body?.result?.addressId,
    paymentMethod: 'COD',
  });
  record('CUSTOMER: empty cart order blocked', emptyOrder.status === 400);

  const orderDetail = await customer.get(`/api/v1/orders/getById/${orderId}`);
  record('CUSTOMER: order detail returned', orderDetail.status === 200);

  const otherOrder = await api('invalid-token').get(`/api/v1/orders/getById/${orderId}`);
  record('CUSTOMER: other user order blocked', otherOrder.status === 401);

  const orderNumber = placeOrder.body?.result?.orderNumber ?? '';
  const track = await request(app).get(`/api/v1/orders/track/${orderNumber}`);
  record('CUSTOMER: order tracking works', track.status === 200);

  const noTrack = await request(app).get('/api/v1/orders/track/NOPE12345');
  record('CUSTOMER: unknown order tracking 404', noTrack.status === 404);

  const cancel = await customer.post(`/api/v1/orders/cancelOrder/${orderId}`, {
    reason: 'changed mind',
  });
  record('CUSTOMER: order cancelled', cancel.body?.result?.status === 'CANCELLED');

  const doubleCancel = await customer.post(`/api/v1/orders/cancelOrder/${orderId}`, {
    reason: 'again',
  });
  record('CUSTOMER: double cancel blocked', doubleCancel.status === 422);

  const reorder = await customer.post(`/api/v1/orders/reorder/${orderId}`);
  record('CUSTOMER: reorder works', reorder.status === 200);

  const notifs = await customer.get('/api/v1/notifications/getAll');
  record('CUSTOMER: notifications returned', notifs.status === 200);

  const readAll = await customer.patch('/api/v1/notifications/markAllRead', {});
  record('CUSTOMER: notifications marked read', readAll.status === 200);

  const unread = await customer.get('/api/v1/notifications/getUnreadCount');
  record('CUSTOMER: unread count returned', unread.status === 200);

  const wallet = await customer.get('/api/v1/wallet/getBalance');
  record('CUSTOMER: wallet balance returned', wallet.status === 200);

  const txns = await customer.get('/api/v1/wallet/getTransactions');
  record('CUSTOMER: wallet transactions returned', txns.status === 200);

  const noReview = await customer.post('/api/v1/reviews/addReview', {
    productId,
    rating: 5,
  });
  record('CUSTOMER: review without purchase blocked', noReview.status === 422);

  const badRating = await customer.post('/api/v1/reviews/addReview', {
    productId,
    rating: 9,
  });
  record('CUSTOMER: invalid rating blocked', badRating.status === 400);

  const reviews = await request(app).get('/api/v1/reviews/getAll');
  record('CUSTOMER: public reviews listed', reviews.status === 200);

  const question = await customer.post('/api/v1/questions/ask', {
    productId,
    question: 'Is this available in blue?',
  });
  record('CUSTOMER: question asked', question.status === 201);

  const shortQ = await customer.post('/api/v1/questions/ask', {
    productId,
    question: 'hi',
  });
  record('CUSTOMER: short question blocked', shortQ.status === 400);

  const questions = await request(app).get(`/api/v1/questions/getAll/${productId}`);
  record('CUSTOMER: questions listed', questions.status === 200);

  const search = await request(app).get(`/api/v1/search/global?q=RC Product ${run}`);
  record('CUSTOMER: search works', search.status === 200);

  const noSearch = await request(app).get('/api/v1/search/global');
  record('CUSTOMER: empty search blocked', noSearch.status === 400);

  const exportData = await customer.get('/api/v1/users/exportMyData');
  record('CUSTOMER: data export works', exportData.status === 200);

  const timeline = await customer.get(`/api/v1/users/getTimeline/${customerUserId}`);
  record('CUSTOMER: cannot read own timeline (admin only)', timeline.status === 403);

  return { orderId };
};

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT DEEP WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runProductDeepWorkflow = async (
  adminToken: string,
  vendorToken: string,
  vendorId: string,
  customerToken: string,
  ids: { catId: string; brandId: string; tagId: string; attrId: string },
) => {
  const admin = api(adminToken);
  const vendor = api(vendorToken);
  const customer = api(customerToken);

  log('\n' + '='.repeat(80));
  log('PRODUCT DEEP WORKFLOW');
  log('='.repeat(80));

  const full = await vendor.post('/api/v1/products/createProduct', {
    name: `RC Full ${run}`,
    categoryId: ids.catId,
    brandId: ids.brandId,
    tagIds: [ids.tagId],
    sku: `RC-SKU-${run}`,
    price: 1200,
    mrpPrice: 1500,
    stock: 20,
    taxPercent: 5,
    warrantyMonths: 12,
    images: [{ url: 'https://example.com/rc1.jpg' }],
    variants: [
      { title: 'S', attributes: { Size: 'S' }, price: 1100, stock: 5 },
      { title: 'M', attributes: { Size: 'M' }, price: 1200, stock: 7 },
    ],
    attributes: [{ attributeId: ids.attrId, value: 'S' }],
  });
  record(
    'PRODUCT: full product created',
    full.status === 201 && full.body?.result?.variantCount === 2,
  );
  const fullId = full.body?.result?.productId ?? '';

  const detail = await request(app).get(`/api/v1/products/getById/${fullId}`);
  record('PRODUCT: detail has variants', D_arr(detail.body?.result?.variantList).length === 2);
  record('PRODUCT: detail has attributes', D_arr(detail.body?.result?.attributeList).length === 1);
  record('PRODUCT: detail has images', D_arr(detail.body?.result?.imageList).length === 1);
  record('PRODUCT: detail has no nulls', findNull(detail.body?.result) === null);

  const variantId = D_str(D_arr(detail.body?.result?.variantList)[0]?.variantId);
  const vStock = await vendor.patch(`/api/v1/products/updateStock/${fullId}`, {
    variantId,
    stock: 9,
  });
  record('PRODUCT: variant stock updated', vStock.status === 200);
  const badVStock = await vendor.patch(`/api/v1/products/updateStock/${fullId}`, {
    variantId: 'nope123',
    stock: 9,
  });
  record('PRODUCT: unknown variant stock update 404', badVStock.status === 404);

  const slugRes = await request(app).get(
    `/api/v1/products/getBySlug/${D_str(detail.body?.result?.slug)}`,
  );
  record('PRODUCT: getBySlug works', slugRes.status === 200);

  const viewsBefore = D_num(detail.body?.result?.viewCount);
  const tracked = await customer.post(`/api/v1/products/trackView/${fullId}`, {});
  record(
    'PRODUCT: trackView increments',
    tracked.status === 200 && D_num(tracked.body?.result?.viewCount) > viewsBefore,
  );

  const recent = await customer.get('/api/v1/products/getRecentlyViewed');
  record(
    'PRODUCT: recently viewed includes product',
    D_arr(recent.body?.result?.productList).some((p: any) => p?.productData?.productId === fullId),
  );

  const tooManyImages = await vendor.post('/api/v1/products/createProduct', {
    name: `RC Images ${run}`,
    price: 100,
    stock: 1,
    images: Array.from({ length: 11 }, (_, i) => ({ url: `https://example.com/i${i}.jpg` })),
  });
  record('PRODUCT: 11 images rejected', tooManyImages.status === 400);

  const zeroPrice = await vendor.post('/api/v1/products/createProduct', {
    name: `RC Zero ${run}`,
    price: 0,
    stock: 1,
  });
  record('PRODUCT: zero price rejected', zeroPrice.status === 400);

  const badTax = await vendor.post('/api/v1/products/createProduct', {
    name: `RC Tax ${run}`,
    price: 10,
    stock: 1,
    taxPercent: 101,
  });
  record('PRODUCT: tax above 100 rejected', badTax.status === 400);

  const badCat = await vendor.post('/api/v1/products/createProduct', {
    name: `RC BadCat ${run}`,
    price: 10,
    stock: 1,
    categoryId: 'nope123',
  });
  record('PRODUCT: unknown category rejected', badCat.status === 404);

  const badBrand = await vendor.post('/api/v1/products/createProduct', {
    name: `RC BadBrand ${run}`,
    price: 10,
    stock: 1,
    brandId: 'nope123',
  });
  record('PRODUCT: unknown brand rejected', badBrand.status === 404);

  const bySearch = await request(app).get(`/api/v1/products/getAll?search=RC Full ${run}`);
  record(
    'PRODUCT: search finds product',
    D_arr(bySearch.body?.result?.productList).some((p: any) => p.productId === fullId),
  );

  const byCat = await request(app).get(`/api/v1/products/getAll?categoryId=${ids.catId}`);
  record(
    'PRODUCT: filter by category',
    D_arr(byCat.body?.result?.productList).some((p: any) => p.productId === fullId),
  );

  const byPrice = await request(app).get('/api/v1/products/getAll?minPrice=1100&maxPrice=1300');
  record(
    'PRODUCT: filter by price range',
    D_arr(byPrice.body?.result?.productList).some((p: any) => p.productId === fullId),
  );

  const byBrand = await request(app).get(`/api/v1/products/getAll?brandId=${ids.brandId}`);
  record(
    'PRODUCT: filter by brand',
    D_arr(byBrand.body?.result?.productList).some((p: any) => p.productId === fullId),
  );

  const paged = await request(app).get('/api/v1/products/getAll?limit=1&page=1');
  record(
    'PRODUCT: pagination limit respected',
    paged.body?.result?.limit === 1 && D_arr(paged.body?.result?.productList).length <= 1,
  );

  const overLimit = await request(app).get('/api/v1/products/getAll?limit=101');
  record('PRODUCT: limit above 100 rejected', overLimit.status === 400);

  const pageZero = await request(app).get('/api/v1/products/getAll?page=0');
  record('PRODUCT: page 0 rejected', pageZero.status === 400);

  const filters = await request(app).get(`/api/v1/products/getFilters?categoryId=${ids.catId}`);
  record(
    'PRODUCT: filters returned',
    filters.status === 200 && filters.body?.result?.priceRange !== undefined,
  );

  const related = await request(app).get(`/api/v1/products/getRelated/${fullId}`);
  record('PRODUCT: related products returned', related.status === 200);

  const fbt = await request(app).get(`/api/v1/products/getFrequentlyBought/${fullId}`);
  record('PRODUCT: frequently bought returned', fbt.status === 200);

  const recAnon = await request(app).get('/api/v1/products/getRecommended');
  record('PRODUCT: recommended needs auth', recAnon.status === 401);
  const recUser = await customer.get('/api/v1/products/getRecommended');
  record('PRODUCT: recommended for user', recUser.status === 200);

  const v2 = await register('v2', 'VENDOR', `RC Second Shop ${run}`);
  await admin.patch(`/api/v1/vendors/approveVendor/${v2.vendorId}`, {});
  const crossUpdate = await api(v2.token).patch(`/api/v1/products/updateProduct/${fullId}`, {
    price: 1,
  });
  record('PRODUCT: cross-vendor update blocked', crossUpdate.status === 403);
  const crossToggle = await api(v2.token).patch(`/api/v1/products/toggleStatus/${fullId}`, {
    status: 'INACTIVE',
  });
  record('PRODUCT: cross-vendor toggle blocked', crossToggle.status === 403);

  const v3 = await register('v3', 'VENDOR', `RC Pending Shop ${run}`);
  const unapproved = await api(v3.token).post('/api/v1/products/createProduct', {
    name: `RC Unap ${run}`,
    price: 10,
    stock: 1,
  });
  record('PRODUCT: unapproved vendor blocked', unapproved.status === 403);

  const bulk = await vendor.post('/api/v1/products/bulkCreate', {
    products: [
      { name: `RC BP1 ${run}`, price: 100, stock: 5 },
      { name: `RC BP2 ${run}`, price: -5, stock: 5 },
    ],
  });
  record(
    'PRODUCT: bulk create partial',
    bulk.status === 201 &&
      bulk.body?.result?.successCount === 1 &&
      bulk.body?.result?.failCount === 1,
  );
  const bp1 = D_str(bulk.body?.result?.productList?.[0]?.productId);

  const bulkUpd = await vendor.patch('/api/v1/products/bulkUpdate', {
    productIds: [bp1],
    updates: { isFeatured: true },
  });
  record(
    'PRODUCT: bulk update works',
    bulkUpd.status === 200 && bulkUpd.body?.result?.successCount === 1,
  );

  const bulkUpdEmpty = await vendor.patch('/api/v1/products/bulkUpdate', {
    productIds: [bp1],
    updates: {},
  });
  record('PRODUCT: bulk update empty rejected', bulkUpdEmpty.status === 400);

  const bulkUpdCross = await api(v2.token).patch('/api/v1/products/bulkUpdate', {
    productIds: [bp1],
    updates: { isFeatured: false },
  });
  record(
    'PRODUCT: bulk update foreign product counted failed',
    bulkUpdCross.status === 200 && bulkUpdCross.body?.result?.failCount === 1,
  );

  const priceUp = await vendor.post('/api/v1/products/bulkPriceUpdate', {
    productIds: [bp1],
    type: 'PERCENT_UP',
    value: 10,
  });
  record(
    'PRODUCT: bulk price up',
    priceUp.status === 200 && priceUp.body?.result?.productList?.[0]?.price === 110,
  );

  const priceFixed = await vendor.post('/api/v1/products/bulkPriceUpdate', {
    productIds: [bp1],
    type: 'FIXED',
    value: 500,
  });
  record(
    'PRODUCT: bulk price fixed adds amount',
    priceFixed.body?.result?.productList?.[0]?.price === 610,
    `price=${priceFixed.body?.result?.productList?.[0]?.price}`,
  );

  const badPriceType = await vendor.post('/api/v1/products/bulkPriceUpdate', {
    productIds: [bp1],
    type: 'DOUBLE',
    value: 10,
  });
  record('PRODUCT: invalid price update type rejected', badPriceType.status === 400);

  const bulkDel = await vendor.patch('/api/v1/products/bulkDelete', { productIds: [bp1] });
  record(
    'PRODUCT: bulk delete works',
    bulkDel.status === 200 && bulkDel.body?.result?.successCount === 1,
  );
  const bp1Gone = await request(app).get(`/api/v1/products/getById/${bp1}`);
  record('PRODUCT: bulk-deleted product gone', bp1Gone.status === 404);

  const badStatus = await vendor.patch(`/api/v1/products/toggleStatus/${fullId}`, {
    status: 'BROKEN',
  });
  record('PRODUCT: invalid status rejected', badStatus.status === 400);

  const csv = await admin.get('/api/v1/products/exportCsv');
  record(
    'PRODUCT: CSV export works',
    csv.status === 200 && D_str(csv.headers['content-type']).includes('text/csv'),
  );

  const delImage = await vendor.del(`/api/v1/products/deleteImage/${fullId}/no-such-image`);
  record('PRODUCT: unknown image delete 404', delImage.status === 404);

  const del = await vendor.del(`/api/v1/products/deleteProduct/${fullId}`);
  record('PRODUCT: product deleted', del.status === 200);
  const delAgain = await vendor.del(`/api/v1/products/deleteProduct/${fullId}`);
  record('PRODUCT: double delete 404', delAgain.status === 404);

  const brandInUse = await admin.del(`/api/v1/brands/deleteBrand/${ids.brandId}`);
  record('PRODUCT: brand in use cannot be deleted', brandInUse.status === 409);
};

// ═══════════════════════════════════════════════════════════════════════════
// CART DEEP WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runCartDeepWorkflow = async (customerToken: string, productId: string) => {
  const customer = api(customerToken);

  log('\n' + '='.repeat(80));
  log('CART DEEP WORKFLOW');
  log('='.repeat(80));

  await customer.del('/api/v1/cart/clearCart');

  const qtyZero = await customer.post('/api/v1/cart/addItem', { productId, qty: 0 });
  record('CART: zero qty rejected', qtyZero.status === 400);

  const unknownProduct = await customer.post('/api/v1/cart/addItem', {
    productId: 'nope123',
    qty: 1,
  });
  record('CART: unknown product rejected', unknownProduct.status === 404);

  await customer.post('/api/v1/cart/addItem', { productId, qty: 1 });
  const cart = await customer.get('/api/v1/cart/getCart');
  const cartItemId = D_str(D_arr(cart.body?.result?.itemList)[0]?.cartItemId);
  record('CART: cart item id present', cartItemId.length > 0);

  const giftWrap = await customer.patch(`/api/v1/cart/updateItemOptions/${cartItemId}`, {
    isGiftWrap: true,
    giftWrapNote: 'Happy birthday RC',
    deliveryNote: 'Call on arrival',
  });
  record('CART: gift wrap options set', giftWrap.status === 200);

  const hugeNote = await customer.patch(`/api/v1/cart/updateItemOptions/${cartItemId}`, {
    giftWrapNote: 'x'.repeat(600),
  });
  record('CART: overlong gift note rejected', hugeNote.status === 400);

  const emptyOptions = await customer.patch(`/api/v1/cart/updateItemOptions/${cartItemId}`, {});
  record('CART: empty options rejected', emptyOptions.status === 400);

  const saved = await customer.post('/api/v1/cart/saveForLater', { cartItemId });
  record('CART: item saved for later', [200, 201].includes(saved.status));

  const savedList = await customer.get('/api/v1/cart/getSavedForLater');
  const savedId = D_str(
    D_arr(savedList.body?.result?.savedItemList)[0]?.savedItemId ??
      D_arr(savedList.body?.result?.savedItemList)[0]?.id,
  );
  record(
    'CART: saved list returned',
    savedList.status === 200 && savedList.body?.result?.savedItemList !== undefined,
  );

  const cartAfterSave = await customer.get('/api/v1/cart/getCart');
  record('CART: saved item leaves cart', D_arr(cartAfterSave.body?.result?.itemList).length === 0);

  if (savedId) {
    const movedBack = await customer.post(`/api/v1/cart/savedForLater/${savedId}/moveToCart`, {
      qty: 1,
    });
    record('CART: saved item moved back', movedBack.status === 200);
  }

  const saved2 = await customer.post('/api/v1/cart/saveForLater', { productId, qty: 1 });
  const saved2List = await customer.get('/api/v1/cart/getSavedForLater');
  const saved2Id = D_str(
    D_arr(saved2List.body?.result?.savedItemList)[0]?.savedItemId ??
      D_arr(saved2List.body?.result?.savedItemList)[0]?.id,
  );
  record('CART: save by productId works', [200, 201].includes(saved2.status));
  if (saved2Id) {
    const delSaved = await customer.del(`/api/v1/cart/savedForLater/${saved2Id}`);
    record('CART: saved item removed', delSaved.status === 200);
    const delSavedAgain = await customer.del(`/api/v1/cart/savedForLater/${saved2Id}`);
    record('CART: double saved remove 404', delSavedAgain.status === 404);
  }

  await customer.post('/api/v1/cart/saveForLater', { productId, qty: 1 });
  const clearSaved = await customer.del('/api/v1/cart/savedForLater');
  record('CART: saved list cleared', clearSaved.status === 200);

  const merged = await customer.post('/api/v1/cart/mergeGuestCart', {
    items: [{ productId, qty: 1 }],
  });
  record('CART: guest cart merged', merged.status === 200);

  const cartMerged = await customer.get('/api/v1/cart/getCart');
  const mergedItemId = D_str(D_arr(cartMerged.body?.result?.itemList)[0]?.cartItemId);
  const removed = await customer.del(`/api/v1/cart/removeItem/${mergedItemId}`);
  record('CART: item removed by id', removed.status === 200);
  const removedAgain = await customer.del(`/api/v1/cart/removeItem/${mergedItemId}`);
  record('CART: double remove 404', removedAgain.status === 404);

  const product = await request(app).get(`/api/v1/products/getById/${productId}`);
  const currentPrice = D_num(product.body?.result?.price);

  const watchBad = await customer.post('/api/v1/priceWatches/watch', {
    productId,
    targetPrice: currentPrice + 500,
  });
  record('CART: price watch above price rejected', watchBad.status === 422);

  const watch = await customer.post('/api/v1/priceWatches/watch', {
    productId,
    targetPrice: currentPrice - 1,
  });
  record('CART: price watch created', [200, 201].includes(watch.status));

  const watchAgain = await customer.post('/api/v1/priceWatches/watch', {
    productId,
    targetPrice: currentPrice - 2,
  });
  record('CART: re-watch updates target', [200, 201].includes(watchAgain.status));

  const watches = await customer.get('/api/v1/priceWatches/getAll');
  record('CART: price watches listed', watches.status === 200);

  const unwatch = await customer.del(`/api/v1/priceWatches/remove/${productId}`);
  record('CART: price watch removed', unwatch.status === 200);

  await customer.post('/api/v1/wishlist/addItem', { productId });
  const wishCheck = await customer.get(`/api/v1/wishlist/checkProduct/${productId}`);
  record('CART: wishlist check true', wishCheck.status === 200);

  const wishList = await customer.get('/api/v1/wishlist/getAll');
  const wishItemId = D_str(
    D_arr(wishList.body?.result?.itemList)[0]?.wishlistItemId ??
      D_arr(wishList.body?.result?.itemList)[0]?.id,
  );
  const toCart = await customer.post(`/api/v1/wishlist/moveToCart/${wishItemId || productId}`, {});
  record('CART: wishlist item moved to cart', toCart.status === 200);

  const cartAfterWish = await customer.get('/api/v1/cart/getCart');
  record(
    'CART: moved item in cart',
    D_arr(cartAfterWish.body?.result?.itemList).some((i: any) => i.productId === productId),
  );

  const clearedWish = await customer.del('/api/v1/wishlist/clear');
  record('CART: wishlist cleared', clearedWish.status === 200);

  await customer.del('/api/v1/cart/clearCart');
};

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS CHANGE WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runSettingsWorkflow = async (
  adminToken: string,
  customerToken: string,
  productId: string,
) => {
  const { setSetting } = await import('../src/services/settings.service');
  const admin = api(adminToken);
  const customer = api(customerToken);

  log('\n' + '='.repeat(80));
  log('SETTINGS CHANGE WORKFLOW');
  log('='.repeat(80));

  await customer.post('/api/v1/cart/addItem', { productId, qty: 2 });

  const beforeShipping = await customer.post('/api/v1/cart/estimate', { paymentMethod: 'COD' });
  const shippingBefore = beforeShipping.body?.result?.shippingAmount ?? 0;
  record(
    'SETTINGS: shipping charge before change',
    shippingBefore === 50,
    `shipping=${shippingBefore}`,
  );

  await setSetting('shipping.defaultCharge', 100, 'shipping', undefined, false);

  const afterShipping = await customer.post('/api/v1/cart/estimate', { paymentMethod: 'COD' });
  const shippingAfter = afterShipping.body?.result?.shippingAmount ?? 0;
  record(
    'SETTINGS: shipping charge after change to 100',
    shippingAfter === 100,
    `shipping=${shippingAfter}`,
  );

  await setSetting('shipping.defaultCharge', 50, 'shipping', undefined, false);

  const restoredShipping = await customer.post('/api/v1/cart/estimate', { paymentMethod: 'COD' });
  const shippingRestored = restoredShipping.body?.result?.shippingAmount ?? 0;
  record(
    'SETTINGS: shipping charge restored to 50',
    shippingRestored === 50,
    `shipping=${shippingRestored}`,
  );

  await setSetting('payment.cod.enabled', false, 'payment', undefined, false);

  const codOff = await customer.post('/api/v1/cart/estimate', { paymentMethod: 'COD' });
  record('SETTINGS: COD disabled blocks estimate', codOff.status === 422);

  await setSetting('payment.cod.enabled', true, 'payment', undefined, false);

  const codOn = await customer.post('/api/v1/cart/estimate', { paymentMethod: 'COD' });
  record('SETTINGS: COD re-enabled allows estimate', codOn.status === 200);

  await setSetting('order.minAmount', 5000, 'order', undefined, false);

  const address = await customer.post('/api/v1/users/addAddress', {
    type: 'HOME',
    fullName: 'RC Test',
    phone: phoneFor('cu'),
    line1: '789 Test Blvd',
    city: 'Pune',
    state: 'Maharashtra',
    stateCode: 'MH',
    countryCode: 'IN',
    pincode: '411001',
  });

  const minOrder = await customer.post('/api/v1/orders/placeOrder', {
    addressId: address.body?.result?.addressId,
    paymentMethod: 'COD',
  });
  record('SETTINGS: order below min amount blocked', minOrder.status === 422);

  await setSetting('order.minAmount', 0, 'order', undefined, false);

  const orderOk = await customer.post('/api/v1/orders/placeOrder', {
    addressId: address.body?.result?.addressId,
    paymentMethod: 'COD',
    skipStatus: true,
  });
  record('SETTINGS: order allowed after min amount removed', orderOk.status === 201);

  await customer.del('/api/v1/cart/clearCart');
};

// ═══════════════════════════════════════════════════════════════════════════
// COUPON FLOW WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runCouponWorkflow = async (
  adminToken: string,
  customerToken: string,
  productId: string,
  vendorTokenForCoupon: string,
) => {
  const { prisma } = await import('../src/services/prisma.service');
  const admin = api(adminToken);
  const customer = api(customerToken);

  log('\n' + '='.repeat(80));
  log('COUPON FLOW WORKFLOW');
  log('='.repeat(80));

  const couponCode = `RC${run}SAVE`;
  const coupon = await admin.post('/api/v1/coupons/createCoupon', {
    code: couponCode,
    title: 'Save 200',
    type: 'FLAT',
    value: 200,
    minOrderAmount: 500,
    maxUsage: 10,
  });
  record('COUPON: created', coupon.status === 201);
  const couponId = coupon.body?.result?.couponId ?? '';

  const dupCoupon = await admin.post('/api/v1/coupons/createCoupon', {
    code: couponCode,
    value: 100,
  });
  record('COUPON: duplicate code rejected', dupCoupon.status === 409);

  const badCoupon = await admin.post('/api/v1/coupons/createCoupon', {
    code: 'lowercase code',
    value: 100,
  });
  record('COUPON: malformed code rejected', badCoupon.status === 400);

  const tooMuchPercent = await admin.post('/api/v1/coupons/createCoupon', {
    code: `RC${run}P1`,
    type: 'PERCENT',
    value: 150,
  });
  record('COUPON: percent above 100 rejected', tooMuchPercent.status === 400);

  const badWindow = await admin.post('/api/v1/coupons/createCoupon', {
    code: `RC${run}W`,
    value: 100,
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  record('COUPON: expiry before start rejected', badWindow.status === 400);

  const badVendor = await admin.post('/api/v1/coupons/createCoupon', {
    code: `RC${run}V`,
    value: 100,
    vendorId: 'nope123',
  });
  record('COUPON: unknown vendor rejected', badVendor.status === 404);

  const badProduct = await admin.post('/api/v1/coupons/createCoupon', {
    code: `RC${run}P2`,
    value: 100,
    productIds: ['nope123'],
  });
  record('COUPON: unknown product rejected', badProduct.status === 422);

  await customer.post('/api/v1/cart/addItem', { productId, qty: 2 });

  const validated = await admin.post('/api/v1/coupons/validateCoupon', {
    code: couponCode,
    orderValue: 1000,
  });
  record('COUPON: validation returns discount', validated.body?.result?.discount === 200);

  const belowMin = await admin.post('/api/v1/coupons/validateCoupon', {
    code: couponCode,
    orderValue: 100,
  });
  record('COUPON: validation below minimum blocked', belowMin.status === 422);

  const applied = await customer.post('/api/v1/cart/applyCoupon', { code: couponCode });
  record('COUPON: applied to cart', applied.status === 200);
  record('COUPON: discount on cart', applied.body?.result?.couponDiscount === 200);

  const removed = await customer.del('/api/v1/cart/removeCoupon');
  record('COUPON: removed from cart', removed.status === 200);
  record('COUPON: discount cleared', removed.body?.result?.couponDiscount === 0);

  const couponList = await admin.get('/api/v1/coupons/getAll?type=FLAT');
  record('COUPON: admin lists coupons', couponList.status === 200);

  const couponById = await admin.get(`/api/v1/coupons/getById/${couponId}`);
  record('COUPON: admin gets coupon by id', couponById.status === 200);

  const usages = await admin.get(`/api/v1/coupons/getUsages/${couponId}`);
  record('COUPON: usage list returned', usages.status === 200);

  const standalone = await customer.post('/api/v1/coupons/applyCoupon', { code: couponCode });
  record('COUPON: standalone apply validates', standalone.status === 200);

  const updatedCoupon = await admin.patch(`/api/v1/coupons/updateCoupon/${couponId}`, {
    maxUsage: 20,
  });
  record('COUPON: admin updates coupon', updatedCoupon.status === 200);

  const vendorCoupon = await request(app)
    .post('/api/v1/coupons/vendorCreateCoupon')
    .set('Authorization', `Bearer ${vendorTokenForCoupon}`)
    .send({ code: `RCV${run}`, value: 50, productIds: [productId] });
  record('COUPON: vendor creates own coupon', vendorCoupon.status === 201);
  const vendorCouponId = vendorCoupon.body?.result?.couponId ?? '';

  const vendorCouponList = await request(app)
    .get('/api/v1/coupons/vendorCoupons')
    .set('Authorization', `Bearer ${vendorTokenForCoupon}`);
  record('COUPON: vendor lists own coupons', vendorCouponList.status === 200);

  if (vendorCouponId) {
    const vcUpd = await request(app)
      .patch(`/api/v1/coupons/vendorUpdateCoupon/${vendorCouponId}`)
      .set('Authorization', `Bearer ${vendorTokenForCoupon}`)
      .send({ value: 60 });
    record('COUPON: vendor updates own coupon', vcUpd.status === 200);

    const vcDel = await request(app)
      .del(`/api/v1/coupons/vendorDeleteCoupon/${vendorCouponId}`)
      .set('Authorization', `Bearer ${vendorTokenForCoupon}`);
    record('COUPON: vendor deletes own coupon', vcDel.status === 200);

    const vcDelAgain = await request(app)
      .del(`/api/v1/coupons/vendorDeleteCoupon/${vendorCouponId}`)
      .set('Authorization', `Bearer ${vendorTokenForCoupon}`);
    record('COUPON: vendor double delete 404', vcDelAgain.status === 404);
  }

  const toggled = await admin.patch(`/api/v1/coupons/toggleStatus/${couponId}`, {
    isActive: false,
  });
  record('COUPON: toggled off', toggled.body?.result?.isActive === false);

  const disabled = await admin.post('/api/v1/coupons/validateCoupon', {
    code: couponCode,
    orderValue: 1000,
  });
  record('COUPON: disabled coupon fails validation', disabled.status === 422);

  await admin.patch(`/api/v1/coupons/toggleStatus/${couponId}`, { isActive: true });

  const deleted = await admin.del(`/api/v1/coupons/deleteCoupon/${couponId}`);
  record('COUPON: deleted', deleted.status === 200);

  const goneAfterDelete = await admin.post('/api/v1/coupons/validateCoupon', {
    code: couponCode,
    orderValue: 1000,
  });
  record('COUPON: deleted coupon no longer validates', goneAfterDelete.status === 404);

  await customer.del('/api/v1/cart/clearCart');
};

// ═══════════════════════════════════════════════════════════════════════════
// ORDER LIFECYCLE WORKFLOW (ship → deliver → return → refund → payments)
// ═══════════════════════════════════════════════════════════════════════════
const runOrderLifecycleWorkflow = async (
  adminToken: string,
  customerToken: string,
  vendorToken: string,
  vendorId: string,
  productId: string,
) => {
  const { setSetting } = await import('../src/services/settings.service');
  const admin = api(adminToken);
  const customer = api(customerToken);
  const vendor = api(vendorToken);

  log('\n' + '='.repeat(80));
  log('ORDER LIFECYCLE WORKFLOW');
  log('='.repeat(80));

  await vendor.patch(`/api/v1/products/updateStock/${productId}`, { stock: 50 });

  const address = await addTestAddress(customer, '100 Lifecycle Rd');
  const addressId = address.body?.result?.addressId ?? '';

  await customer.post('/api/v1/cart/addItem', { productId, qty: 2 });
  const placed = await customer.post('/api/v1/orders/placeOrder', {
    addressId,
    paymentMethod: 'COD',
    skipStatus: true,
  });
  record(
    'LIFECYCLE: COD order confirmed',
    placed.status === 201 && placed.body?.result?.status === 'CONFIRMED',
  );
  const orderId = placed.body?.result?.orderId ?? '';
  const orderNumber = placed.body?.result?.orderNumber ?? '';

  const detail = await customer.get(`/api/v1/orders/getById/${orderId}`);
  record('LIFECYCLE: detail has no nulls', findNull(detail.body?.result) === null);
  const subOrderId = D_str(D_arr(detail.body?.result?.subOrderList)[0]?.subOrderId);
  const orderItemId = D_str(D_arr(detail.body?.result?.itemList)[0]?.orderItemId);
  record(
    'LIFECYCLE: sub-order and item ids present',
    subOrderId.length > 0 && orderItemId.length > 0,
  );

  const badTransition = await admin.patch(`/api/v1/orders/updateStatus/${orderId}`, {
    status: 'DELIVERED',
  });
  record('LIFECYCLE: CONFIRMED→DELIVERED jump rejected', badTransition.status === 422);

  const bogusStatus = await admin.patch(`/api/v1/orders/updateStatus/${orderId}`, {
    status: 'FLYING',
  });
  record('LIFECYCLE: invalid status enum rejected', bogusStatus.status === 400);

  const vendorOrders = await vendor.get('/api/v1/orders/getVendorOrders');
  record(
    'LIFECYCLE: vendor sees sub-order',
    D_arr(vendorOrders.body?.result?.itemList).some((s: any) => s.subOrderId === subOrderId),
  );

  const v2 = await register('v5', 'VENDOR', `RC Outsider Shop ${run}`);
  await admin.patch(`/api/v1/vendors/approveVendor/${v2.vendorId}`, {});
  const foreignSub = await api(v2.token).patch(`/api/v1/orders/updateVendorStatus/${subOrderId}`, {
    status: 'SHIPPED',
  });
  record('LIFECYCLE: foreign vendor cannot move sub-order', foreignSub.status === 404);

  const shipped = await vendor.patch(`/api/v1/orders/updateVendorStatus/${subOrderId}`, {
    status: 'SHIPPED',
  });
  record('LIFECYCLE: vendor marks shipped', shipped.status === 200);

  const backToPending = await vendor.patch(`/api/v1/orders/updateVendorStatus/${subOrderId}`, {
    status: 'PENDING',
  });
  record('LIFECYCLE: SHIPPED→PENDING rejected', backToPending.status === 422);

  const tagged = await admin.post(`/api/v1/orders/addTags/${orderId}`, {
    labels: ['PRIORITY', 'FRAGILE'],
  });
  record('LIFECYCLE: order tags added', tagged.status === 200);
  const tags = await admin.get(`/api/v1/orders/getTags/${orderId}`);
  const tagList = D_arr(tags.body?.result?.itemList ?? tags.body?.result?.tagList);
  record('LIFECYCLE: order tags listed', tags.status === 200 && tagList.length >= 2);
  const tagId = D_str(tagList[0]?.tagId ?? tagList[0]?.id);
  if (tagId) {
    const rmTag = await admin.del(`/api/v1/orders/removeTag/${orderId}/${tagId}`);
    record('LIFECYCLE: tag removed', rmTag.status === 200);
    const rmTagAgain = await admin.del(`/api/v1/orders/removeTag/${orderId}/${tagId}`);
    record('LIFECYCLE: double tag remove 404', rmTagAgain.status === 404);
  }
  const noLabels = await admin.post(`/api/v1/orders/addTags/${orderId}`, { labels: [] });
  record('LIFECYCLE: empty labels rejected', noLabels.status === 400);

  const noted = await admin.post(`/api/v1/orders/addNote/${orderId}`, { note: 'rc call first' });
  record('LIFECYCLE: order note added', noted.status === 200);
  const noteId = noted.body?.result?.noteId ?? noted.body?.result?.id ?? '';
  const notes = await admin.get(`/api/v1/orders/getNotes/${orderId}`);
  record('LIFECYCLE: order notes listed', notes.status === 200);
  if (noteId) {
    const rmNote = await admin.del(`/api/v1/orders/removeNote/${orderId}/${noteId}`);
    record('LIFECYCLE: order note removed', rmNote.status === 200);
  }
  const emptyNote = await admin.post(`/api/v1/orders/addNote/${orderId}`, { note: '' });
  record('LIFECYCLE: empty note rejected', emptyNote.status === 400);

  const timeline = await customer.get(`/api/v1/orders/getTimeline/${orderId}`);
  record(
    'LIFECYCLE: order timeline returned',
    timeline.status === 200 && D_arr(timeline.body?.result?.timelineList).length >= 1,
  );

  const invoice = await customer.get(`/api/v1/orders/getInvoice/${orderId}?format=json`);
  record('LIFECYCLE: invoice json returned', invoice.status === 200);

  const slip = await vendor.get(`/api/v1/orders/getPackingSlip/${subOrderId}?format=json`);
  record('LIFECYCLE: packing slip returned', slip.status === 200);

  const labelBefore = await vendor.get(`/api/v1/orders/getShippingLabel/${subOrderId}?format=json`);
  record('LIFECYCLE: shipping label before shipment', labelBefore.status === 200);

  const shipment = await vendor.post(`/api/v1/shipping/createShipment/${subOrderId}`, {
    remarks: 'rc ship',
  });
  record('LIFECYCLE: shipment created', shipment.status === 201);
  const awb = D_str(shipment.body?.result?.awb);

  const dupShipment = await vendor.post(`/api/v1/shipping/createShipment/${subOrderId}`, {});
  record('LIFECYCLE: duplicate shipment rejected', dupShipment.status === 422);

  if (awb) {
    const trackPublic = await request(app).get(`/api/v1/shipping/track/${awb}`);
    record('LIFECYCLE: public shipment tracking works', trackPublic.status === 200);
  }
  const trackBogus = await request(app).get('/api/v1/shipping/track/NOPE9999');
  record('LIFECYCLE: unknown awb 404', trackBogus.status === 404);

  const boyUser = await register('db2', 'CUSTOMER');
  const boy = await admin.post('/api/v1/deliveryBoys/create', {
    userId: boyUser.userId,
    name: `RC Rider2 ${run}`,
    phone: phoneFor('db2'),
    vehicleType: 'BIKE',
  });
  const boyId = boy.body?.result?.deliveryBoyId ?? '';
  record('LIFECYCLE: delivery boy created', boy.status === 201);

  const assigned = await admin.patch(`/api/v1/orders/assignDeliveryBoy/${subOrderId}`, {
    deliveryBoyId: boyId,
  });
  record('LIFECYCLE: delivery boy assigned', assigned.status === 200);

  const assignBogus = await admin.patch(`/api/v1/orders/assignDeliveryBoy/${subOrderId}`, {
    deliveryBoyId: 'nope123',
  });
  record('LIFECYCLE: unknown delivery boy 404', assignBogus.status === 404);

  const outForDelivery = await admin.patch(`/api/v1/orders/updateStatus/${orderId}`, {
    status: 'OUT_FOR_DELIVERY',
  });
  record('LIFECYCLE: out for delivery', outForDelivery.status === 200);

  const myDeliveries = await api(boyUser.token).get('/api/v1/deliveryBoys/getMyDeliveries');
  const myDeliveryId = D_str(D_arr(myDeliveries.body?.result?.itemList)[0]?.deliveryId);
  record('LIFECYCLE: boy sees delivery', myDeliveries.status === 200 && myDeliveryId.length > 0);

  if (myDeliveryId) {
    const boyUpdate = await api(boyUser.token).patch(
      `/api/v1/deliveryBoys/updateDeliveryStatus/${myDeliveryId}`,
      {
        status: 'OUT_FOR_DELIVERY',
      },
    );
    record('LIFECYCLE: boy updates delivery status', boyUpdate.status === 200);
  }

  const delivered = await customer.post(`/api/v1/orders/verifyDeliveryOtp/${subOrderId}`, {
    otp: '1234',
  });
  record('LIFECYCLE: delivery OTP confirms delivery', delivered.status === 200);

  const afterDelivered = await customer.get(`/api/v1/orders/getById/${orderId}`);
  record('LIFECYCLE: order DELIVERED', afterDelivered.body?.result?.status === 'DELIVERED');
  record('LIFECYCLE: COD order paid', afterDelivered.body?.result?.paymentStatus === 'PAID');

  const deliverAgain = await customer.post(`/api/v1/orders/verifyDeliveryOtp/${subOrderId}`, {
    otp: '1234',
  });
  record('LIFECYCLE: double delivery rejected', deliverAgain.status === 422);

  const payment = await customer.get(`/api/v1/payments/getByOrder/${orderId}`);
  record('LIFECYCLE: payment fetched by order', payment.status === 200);

  const methods = await request(app).get('/api/v1/payments/methods');
  record(
    'LIFECYCLE: payment methods listed',
    methods.status === 200 && methods.body?.result?.cod !== undefined,
  );

  const payTokenDisabled = await customer.post(`/api/v1/payments/payToken/${orderId}`, {
    method: 'UPI',
  });
  record('LIFECYCLE: token payment blocked when disabled', payTokenDisabled.status === 422);

  const payBalanceDone = await customer.post(`/api/v1/payments/payBalance/${orderId}`, {});
  record('LIFECYCLE: balance pay on settled order rejected', payBalanceDone.status === 422);

  const cancelDelivered = await customer.post(`/api/v1/orders/cancelOrder/${orderId}`, {
    reason: 'too late',
  });
  record('LIFECYCLE: delivered order cannot cancel', cancelDelivered.status === 422);

  const review = await customer.post('/api/v1/reviews/addReview', {
    productId,
    rating: 5,
    title: 'RC great',
    comment: 'Delivered fast and works well',
  });
  record('LIFECYCLE: review allowed after delivery', review.status === 201);
  const reviewId = review.body?.result?.reviewId ?? '';

  const dupReview = await customer.post('/api/v1/reviews/addReview', { productId, rating: 4 });
  record('LIFECYCLE: duplicate review blocked', [409, 422].includes(dupReview.status));

  const updReview = await customer.patch(`/api/v1/reviews/updateReview/${reviewId}`, { rating: 4 });
  record('LIFECYCLE: review updated', updReview.status === 200);

  const summary = await request(app).get(`/api/v1/reviews/getSummary/${productId}`);
  record('LIFECYCLE: review summary returned', summary.status === 200);

  const vote = await customer.post(`/api/v1/reviews/voteHelpful/${reviewId}`, {});
  record('LIFECYCLE: helpful vote counted', vote.status === 200);

  const reply = await vendor.post(`/api/v1/reviews/reply/${reviewId}`, {
    reply: 'Thanks for testing!',
  });
  record('LIFECYCLE: vendor reply works', reply.status === 201);

  const approveReview = await admin.patch(`/api/v1/reviews/approve/${reviewId}`, {});
  record('LIFECYCLE: review approved by admin', approveReview.status === 200);

  const delReview = await customer.del(`/api/v1/reviews/deleteReview/${reviewId}`);
  record('LIFECYCLE: review deleted', delReview.status === 200);

  const returnReq = await customer.post(`/api/v1/orders/returnRequest/${orderId}`, {
    reasonText: 'damaged in transit',
    comment: 'box was crushed',
    images: ['https://example.com/damage.jpg'],
    items: [{ orderItemId, qty: 1 }],
  });
  record('LIFECYCLE: return requested', returnReq.status === 201);
  const returnId = returnReq.body?.result?.returnId ?? '';

  const noReason = await customer.post(`/api/v1/orders/returnRequest/${orderId}`, {
    items: [{ orderItemId, qty: 1 }],
  });
  record('LIFECYCLE: return without reason rejected', [400, 422].includes(noReason.status));

  const noImages = await customer.post(`/api/v1/orders/returnRequest/${orderId}`, {
    reasonText: 'another try',
    items: [{ orderItemId, qty: 1 }],
  });
  record('LIFECYCLE: return without images rejected', [400, 422].includes(noImages.status));

  const tooMany = await customer.post(`/api/v1/orders/returnRequest/${orderId}`, {
    reasonText: 'qty abuse',
    images: ['https://example.com/x.jpg'],
    items: [{ orderItemId, qty: 99 }],
  });
  record('LIFECYCLE: return qty above purchase rejected', tooMany.status === 422);

  const myReturns = await customer.get('/api/v1/returns/getAll');
  record('LIFECYCLE: customer returns listed', D_arr(myReturns.body?.result?.itemList).length >= 1);

  const returnById = await customer.get(`/api/v1/returns/getById/${returnId}`);
  record('LIFECYCLE: return by id', returnById.status === 200);

  const approveReturn = await admin.patch(`/api/v1/orders/approveReturn/${returnId}`, {
    remark: 'ok',
  });
  record('LIFECYCLE: return approved', approveReturn.status === 200);

  const approveAgain = await admin.patch(`/api/v1/orders/approveReturn/${returnId}`, {});
  record('LIFECYCLE: double approve rejected', approveAgain.status === 422);

  const pickedUp = await admin.patch(`/api/v1/returns/markPickedUp/${returnId}`, {});
  record('LIFECYCLE: return picked up', pickedUp.status === 200);

  const received = await admin.patch(`/api/v1/returns/markReceived/${returnId}`, {});
  record('LIFECYCLE: return received', received.status === 200);

  const refundProcessed = await admin.patch(`/api/v1/returns/processRefund/${returnId}`, {
    mode: 'ORIGINAL',
  });
  record('LIFECYCLE: return refund processed', refundProcessed.status === 200);

  const refundHistory = await customer.get(`/api/v1/payments/getRefundHistory/${orderId}`);
  record('LIFECYCLE: refund history returned', refundHistory.status === 200);

  const bankAddress = await addTestAddress(customer, '200 Bank St');
  await customer.post('/api/v1/cart/addItem', { productId, qty: 1 });
  const bankOrder = await customer.post('/api/v1/orders/placeOrder', {
    addressId: bankAddress.body?.result?.addressId,
    paymentMethod: 'BANK',
    skipStatus: true,
  });
  record('LIFECYCLE: BANK order placed', bankOrder.status === 201);
  const bankOrderId = bankOrder.body?.result?.orderId ?? '';

  const verifyNoRef = await customer.post(`/api/v1/payments/verifyBank/${bankOrderId}`, {});
  record('LIFECYCLE: bank verify without reference rejected', verifyNoRef.status === 400);

  const verifyBank = await customer.post(`/api/v1/payments/verifyBank/${bankOrderId}`, {
    reference: 'UTR123456',
  });
  record('LIFECYCLE: bank verification submitted', verifyBank.status === 200);

  const idemKey = `rc-idem-${run}`;
  const upiAddr = await addTestAddress(customer, '400 UPI Lane');
  await customer.post('/api/v1/cart/addItem', { productId, qty: 1 });
  const upiOrder = await customer.post('/api/v1/orders/placeOrder', {
    addressId: upiAddr.body?.result?.addressId,
    paymentMethod: 'UPI',
    skipStatus: true,
  });
  record('LIFECYCLE: UPI order placed', upiOrder.status === 201);
  const upiOrderId = upiOrder.body?.result?.orderId ?? '';
  const upiFirst = await request(app)
    .post(`/api/v1/payments/verifyUpi/${upiOrderId}`)
    .set('Authorization', `Bearer ${customerToken}`)
    .set('Idempotency-Key', idemKey)
    .send({ reference: 'UPI-REF-1' });
  const upiReplay = await request(app)
    .post(`/api/v1/payments/verifyUpi/${upiOrderId}`)
    .set('Authorization', `Bearer ${customerToken}`)
    .set('Idempotency-Key', idemKey)
    .send({ reference: 'UPI-REF-1' });
  record(
    'LIFECYCLE: idempotent replay returns stored response',
    upiFirst.status === 200 && D_str(upiReplay.headers['x-idempotency-replayed']) === 'true',
    `first=${upiFirst.status} replay=${upiReplay.status} header=${D_str(upiReplay.headers['x-idempotency-replayed'])}`,
  );

  const paymentsAdmin = await admin.get(`/api/v1/payments/getAll?orderId=${bankOrderId}`);
  const bankPaymentId = D_str(D_arr(paymentsAdmin.body?.result?.itemList)[0]?.paymentId);
  record(
    'LIFECYCLE: admin finds bank payment',
    paymentsAdmin.status === 200 && bankPaymentId.length > 0,
  );

  if (bankPaymentId) {
    const confirm = await admin.patch(`/api/v1/payments/confirmPayment/${bankPaymentId}`, {});
    record('LIFECYCLE: admin confirms payment', confirm.status === 200);

    const confirmAgain = await admin.patch(`/api/v1/payments/confirmPayment/${bankPaymentId}`, {});
    record('LIFECYCLE: double confirm rejected', confirmAgain.status === 422);

    const refund = await admin.post(`/api/v1/payments/refund/${bankPaymentId}`, {
      orderId: bankOrderId,
      amount: 100,
      reason: 'rc partial refund',
    });
    record('LIFECYCLE: partial refund created', refund.status === 201);

    const overRefund = await admin.post(`/api/v1/payments/refund/${bankPaymentId}`, {
      orderId: bankOrderId,
      amount: 99999999,
      reason: 'rc over refund',
    });
    record('LIFECYCLE: over-refund rejected', overRefund.status === 422);

    const noReason = await admin.post(`/api/v1/payments/refund/${bankPaymentId}`, { amount: 10 });
    record('LIFECYCLE: refund without reason rejected', noReason.status === 400);
  }

  await setSetting('wallet.enabled', true, 'wallet', undefined, false);

  const { prisma } = await import('../src/services/prisma.service');
  const me = await customer.get('/api/v1/users/getProfile');
  const customerUserId = D_str(me.body?.result?.userData?.userId);

  const credit = await admin.post('/api/v1/wallet/adminCredit', {
    userId: customerUserId,
    amount: 500,
    description: 'rc credit',
  });
  record('WALLET: admin credit works', credit.status === 201);

  const balance = await customer.get('/api/v1/wallet/getBalance');
  const bal = D_num(balance.body?.result?.balance);
  record('WALLET: balance reflects credits', bal === 500, `balance=${bal}`);

  const debit = await admin.post('/api/v1/wallet/adminDebit', {
    userId: customerUserId,
    amount: 100,
    description: 'rc debit',
  });
  record('WALLET: admin debit works', debit.status === 201);

  const overDebit = await admin.post('/api/v1/wallet/adminDebit', {
    userId: customerUserId,
    amount: 99999999,
    description: 'rc',
  });
  record('WALLET: over-debit rejected', overDebit.status === 422);

  const negCredit = await admin.post('/api/v1/wallet/adminCredit', {
    userId: customerUserId,
    amount: -50,
  });
  record('WALLET: negative credit rejected', negCredit.status === 400);

  const smallAdd = await customer.post('/api/v1/wallet/addMoney', { amount: 50 });
  record('WALLET: add below minimum rejected', smallAdd.status === 422);

  const addMoney = await customer.post('/api/v1/wallet/addMoney', {
    amount: 200,
    method: 'UPI',
    reference: 'UTR999',
  });
  record('WALLET: add money request created', addMoney.status === 201);

  const walletAddr = await addTestAddress(customer, '300 Wallet Ave');
  await customer.post('/api/v1/cart/addItem', { productId, qty: 1 });
  const walletOrder = await customer.post('/api/v1/orders/placeOrder', {
    addressId: walletAddr.body?.result?.addressId,
    paymentMethod: 'COD',
    useWalletBalance: true,
    walletAmount: 100,
    skipStatus: true,
  });
  record('WALLET: order with wallet balance placed', walletOrder.status === 201);
  record('WALLET: wallet amount applied', D_num(walletOrder.body?.result?.walletAmount) === 100);

  const txns = await customer.get('/api/v1/wallet/getTransactions?type=DEBIT');
  record('WALLET: debit transactions listed', txns.status === 200);

  await setSetting('wallet.enabled', false, 'wallet', undefined, false);
  const disabledAdd = await customer.post('/api/v1/wallet/addMoney', { amount: 500 });
  record('WALLET: disabled wallet rejects add', disabledAdd.status === 422);
  const disabledCredit = await admin.post('/api/v1/wallet/adminCredit', {
    userId: customerUserId,
    amount: 10,
  });
  record('WALLET: disabled wallet rejects admin credit', disabledCredit.status === 422);

  const pendingAmount = await vendor.get(`/api/v1/payouts/getPendingAmount/${vendorId}`);
  record('PAYOUT: vendor pending amount returned', pendingAmount.status === 200);

  const earnings = await vendor.get('/api/v1/payouts/getVendorEarnings');
  record('PAYOUT: vendor earnings listed', earnings.status === 200);

  const payoutAll = await admin.get('/api/v1/payouts/getAll');
  record('PAYOUT: admin lists payouts', payoutAll.status === 200);

  const payoutSummary = await admin.get('/api/v1/payouts/getSummary');
  record('PAYOUT: summary returned', payoutSummary.status === 200);

  const statement = await admin.get(`/api/v1/payouts/getStatement/${vendorId}`);
  record('PAYOUT: vendor statement returned', statement.status === 200);

  const cycles = await admin.post('/api/v1/payouts/generateCycles', {});
  record('PAYOUT: cycle generation runs', cycles.status === 200);

  const approveBogus = await admin.patch('/api/v1/payouts/approvePayout/nope123', {});
  record('PAYOUT: approve unknown payout 404', approveBogus.status === 404);

  const rejectNoReason = await admin.patch('/api/v1/payouts/rejectPayout/nope123', {});
  record('PAYOUT: reject without reason rejected', [400, 404].includes(rejectNoReason.status));

  const reasons = await customer.get('/api/v1/returns/getReasons');
  record('RETURNS: reasons listed', reasons.status === 200);

  const newReason = await admin.post('/api/v1/returns/addReason', { title: `RC Reason ${run}` });
  record('RETURNS: reason added', newReason.status === 201);

  const badReject = await admin.patch(`/api/v1/returns/reject/${returnId}`, {});
  record('RETURNS: reject without reason rejected', [400, 422].includes(badReject.status));

  await admin.del(`/api/v1/deliveryBoys/delete/${boyId}`);
};

// ═══════════════════════════════════════════════════════════════════════════
// ENGAGEMENT WORKFLOW (loyalty / referral / gift cards / flash sales)
// ═══════════════════════════════════════════════════════════════════════════
const runEngagementWorkflow = async (
  adminToken: string,
  customerToken: string,
  customerUserId: string,
  productId: string,
) => {
  const { setSetting } = await import('../src/services/settings.service');
  const admin = api(adminToken);
  const customer = api(customerToken);

  log('\n' + '='.repeat(80));
  log('ENGAGEMENT WORKFLOW');
  log('='.repeat(80));

  await setSetting('wallet.enabled', true, 'wallet', undefined, false);
  await setSetting('loyalty.enabled', true, 'loyalty', undefined, false);
  await setSetting('referral.enabled', true, 'referral', undefined, false);
  await setSetting('giftCard.enabled', true, 'giftCard', undefined, false);

  const points = await customer.get('/api/v1/loyalty/getPoints');
  record('LOYALTY: points summary returned', points.status === 200);

  const tiers = await request(app).get('/api/v1/loyalty/getTiers');
  record('LOYALTY: tiers listed publicly', tiers.status === 200);

  const history = await customer.get('/api/v1/loyalty/getHistory');
  record('LOYALTY: history listed', history.status === 200);

  const adjust = await admin.post(`/api/v1/loyalty/adjust/${customerUserId}`, {
    points: 500,
    description: 'rc bonus',
  });
  record('LOYALTY: admin adjust credits points', adjust.status === 200);

  const overDeduct = await admin.post(`/api/v1/loyalty/adjust/${customerUserId}`, {
    points: -99999999,
    description: 'rc',
  });
  record('LOYALTY: over-deduction rejected', overDeduct.status === 422);

  const zeroRedeem = await customer.post('/api/v1/loyalty/redeem', { points: 0 });
  record('LOYALTY: zero redeem rejected', zeroRedeem.status === 400);

  const underMin = await customer.post('/api/v1/loyalty/redeem', { points: 10 });
  record('LOYALTY: below minimum redeem rejected', underMin.status === 422);

  const redeem = await customer.post('/api/v1/loyalty/redeem', { points: 100 });
  record('LOYALTY: redeem works', redeem.status === 200);

  const adjustBadUser = await admin.post('/api/v1/loyalty/adjust/nope123', { points: 10 });
  record('LOYALTY: adjust unknown user 404', adjustBadUser.status === 404);

  const cb = await register('cb', 'CUSTOMER');
  const cbAuth = api(cb.token);

  const myCode = await customer.get('/api/v1/referral/getMyCode');
  record('REFERRAL: code issued', myCode.status === 200);
  const refCode = D_str(myCode.body?.result?.referralCode ?? myCode.body?.result?.code);

  const selfApply = await customer.post('/api/v1/referral/applyCode', { referralCode: refCode });
  record('REFERRAL: self-referral blocked', selfApply.status === 400);

  const bogusApply = await cbAuth.post('/api/v1/referral/applyCode', { referralCode: 'NOPE9999' });
  record('REFERRAL: unknown code rejected', bogusApply.status === 404);

  const applied = await cbAuth.post('/api/v1/referral/applyCode', { referralCode: refCode });
  record('REFERRAL: code applied', applied.status === 200);
  const referralId = applied.body?.result?.referralId ?? '';

  const applyTwice = await cbAuth.post('/api/v1/referral/applyCode', { referralCode: refCode });
  record('REFERRAL: second apply blocked', applyTwice.status === 409);

  const rewards = await customer.get('/api/v1/referral/getRewards');
  record('REFERRAL: rewards listed', rewards.status === 200);

  const leaderboard = await customer.get('/api/v1/referral/getLeaderboard');
  record('REFERRAL: leaderboard listed', leaderboard.status === 200);

  const adminAll = await admin.get('/api/v1/referral/admin/getAll');
  record('REFERRAL: admin lists referrals', adminAll.status === 200);

  if (referralId) {
    const complete = await admin.post(`/api/v1/referral/complete/${referralId}`, {});
    record('REFERRAL: admin completes referral', complete.status === 200);
    const completeAgain = await admin.post(`/api/v1/referral/complete/${referralId}`, {});
    record('REFERRAL: double complete idempotent', completeAgain.status === 200);
    const statusUpd = await admin.patch(`/api/v1/referral/updateStatus/${referralId}`, {
      status: 'REJECTED',
    });
    record('REFERRAL: admin updates status', statusUpd.status === 200);
  }

  const gc = await admin.post('/api/v1/giftCards/create', { value: 500, title: `RC GC ${run}` });
  record('GIFTCARD: created', gc.status === 201);
  const gcCode = D_str(gc.body?.result?.code);
  const gcId = gc.body?.result?.giftCardId ?? '';

  const tooSmall = await admin.post('/api/v1/giftCards/create', { value: 50 });
  record('GIFTCARD: below minimum value rejected', [400, 422].includes(tooSmall.status));

  const balance = await request(app).get(`/api/v1/giftCards/checkBalance/${gcCode}`);
  record(
    'GIFTCARD: public balance check',
    balance.status === 200 && D_num(balance.body?.result?.balance) === 500,
  );

  const unknownCard = await request(app).get('/api/v1/giftCards/checkBalance/NOPE1234');
  record('GIFTCARD: unknown code 404', unknownCard.status === 404);

  const partial = await customer.post('/api/v1/giftCards/redeem', { code: gcCode, amount: 100 });
  record(
    'GIFTCARD: partial redeem works',
    partial.status === 200 && D_num(partial.body?.result?.remainingBalance) === 400,
  );

  const rest = await customer.post('/api/v1/giftCards/redeem', { code: gcCode });
  record(
    'GIFTCARD: full redeem works',
    rest.status === 200 && rest.body?.result?.status === 'REDEEMED',
  );

  const spentAgain = await customer.post('/api/v1/giftCards/redeem', { code: gcCode });
  record('GIFTCARD: spent card rejected', spentAgain.status === 422);

  const gc2 = await admin.post('/api/v1/giftCards/create', { value: 200, title: `RC GC2 ${run}` });
  const gc2Id = gc2.body?.result?.giftCardId ?? '';
  const gc2Code = D_str(gc2.body?.result?.code);
  const disabled = await admin.patch(`/api/v1/giftCards/disable/${gc2Id}`, {});
  record('GIFTCARD: disabled', disabled.status === 200);
  const redeemDisabled = await customer.post('/api/v1/giftCards/redeem', { code: gc2Code });
  record('GIFTCARD: disabled card redeem blocked', redeemDisabled.status === 403);
  const delGc2 = await admin.del(`/api/v1/giftCards/delete/${gc2Id}`);
  record('GIFTCARD: deleted', delGc2.status === 200);
  const delGc2Again = await admin.del(`/api/v1/giftCards/delete/${gc2Id}`);
  record('GIFTCARD: double delete 404', delGc2Again.status === 404);

  const gcList = await admin.get('/api/v1/giftCards/getAll');
  record('GIFTCARD: admin lists cards', gcList.status === 200);

  const sale = await admin.post('/api/v1/flashSales/create', {
    name: `RC Flash ${run}`,
    startsAt: new Date(Date.now() - 3_600_000).toISOString(),
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    discountType: 'PERCENT',
    discountValue: 10,
    items: [{ productId, salePrice: 800, saleStock: 5 }],
  });
  record('FLASHSALE: live sale created', sale.status === 201);
  const saleId = sale.body?.result?.flashSaleId ?? sale.body?.result?.saleId ?? '';
  const saleSlug = D_str(sale.body?.result?.slug);

  const active = await request(app).get('/api/v1/flashSales/getActive?scope=live');
  record('FLASHSALE: live sale listed publicly', active.status === 200);

  if (saleSlug) {
    const bySlug = await request(app).get(`/api/v1/flashSales/getBySlug/${saleSlug}`);
    record('FLASHSALE: sale by slug', bySlug.status === 200);
  }

  const badWindow = await admin.post('/api/v1/flashSales/create', {
    name: `RC BadFlash ${run}`,
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() - 86_400_000).toISOString(),
    items: [{ productId }],
  });
  record('FLASHSALE: inverted window rejected', [400, 422].includes(badWindow.status));

  const updSale = await admin.patch(`/api/v1/flashSales/update/${saleId}`, { discountValue: 15 });
  record('FLASHSALE: sale updated', updSale.status === 200);

  const delSale = await admin.del(`/api/v1/flashSales/delete/${saleId}`);
  record('FLASHSALE: sale deleted', delSale.status === 200);

  await setSetting('wallet.enabled', false, 'wallet', undefined, false);
  await setSetting('referral.enabled', false, 'referral', undefined, false);
  await setSetting('giftCard.enabled', false, 'giftCard', undefined, false);
};

// ═══════════════════════════════════════════════════════════════════════════
// DELIVERY_BOY WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runDeliveryBoyWorkflow = async (adminToken: string) => {
  const { prisma } = await import('../src/services/prisma.service');
  const admin = api(adminToken);

  log('\n' + '='.repeat(80));
  log('DELIVERY_BOY WORKFLOW');
  log('='.repeat(80));

  const deliveryUser = await register('db', 'CUSTOMER');

  const boy = await admin.post('/api/v1/deliveryBoys/create', {
    userId: deliveryUser.userId,
    name: `RC Rider ${run}`,
    phone: phoneFor('db'),
    vehicleType: 'BIKE',
    vehicleNo: 'MH01AB1234',
  });
  record('DELIVERY_BOY: created', boy.status === 201);
  const boyId = boy.body?.result?.deliveryBoyId ?? '';

  const badBoy = await admin.post('/api/v1/deliveryBoys/create', {
    userId: 'nope123',
    name: 'Ghost',
    phone: phoneFor('g'),
  });
  record('DELIVERY_BOY: unknown user blocked', badBoy.status === 404);

  const dupBoy = await admin.post('/api/v1/deliveryBoys/create', {
    userId: deliveryUser.userId,
    name: 'Dup',
    phone: phoneFor('db'),
  });
  record('DELIVERY_BOY: duplicate blocked', dupBoy.status === 409);

  const boys = await admin.get('/api/v1/deliveryBoys/getAll');
  record(
    'DELIVERY_BOY: listed',
    boys.body?.result?.itemList?.some((b: any) => b.deliveryBoyId === boyId),
  );

  const updBoy = await admin.patch(`/api/v1/deliveryBoys/update/${boyId}`, {
    vehicleNo: 'MH01XY9876',
  });
  record('DELIVERY_BOY: updated', updBoy.body?.result?.vehicleNo === 'MH01XY9876');

  const toggled = await admin.patch(`/api/v1/deliveryBoys/toggleStatus/${boyId}`, {
    isActive: false,
  });
  record('DELIVERY_BOY: toggled', toggled.body?.result?.isActive === false);

  await admin.patch(`/api/v1/deliveryBoys/toggleStatus/${boyId}`, { isActive: true });

  const delBoy = await admin.del(`/api/v1/deliveryBoys/delete/${boyId}`);
  record('DELIVERY_BOY: deleted', delBoy.status === 200);

  const delAgain = await admin.del(`/api/v1/deliveryBoys/delete/${boyId}`);
  record('DELIVERY_BOY: double delete blocked', delAgain.status === 404);

  return { deliveryUserId: deliveryUser.userId };
};

// ═══════════════════════════════════════════════════════════════════════════
// CONTENT WORKFLOW (pages/blogs/faqs/banners/contact/newsletter/geo/tax/i18n)
// ═══════════════════════════════════════════════════════════════════════════
const runContentWorkflow = async (adminToken: string, customerToken: string) => {
  const admin = api(adminToken);
  const customer = api(customerToken);

  log('\n' + '='.repeat(80));
  log('CONTENT WORKFLOW');
  log('='.repeat(80));

  const page = await admin.post('/api/v1/pages/create', {
    title: `RC Page ${run}`,
    content: '<p>rc page content</p>',
    isPublished: true,
  });
  record('CONTENT: page created', page.status === 201);
  const pageId = page.body?.result?.pageId ?? '';
  const pageSlug = D_str(page.body?.result?.slug);

  const pages = await request(app).get('/api/v1/pages/getAll');
  record('CONTENT: pages listed publicly', pages.status === 200);

  const pageBySlug = await request(app).get(`/api/v1/pages/getBySlug/${pageSlug}`);
  record('CONTENT: page by slug', pageBySlug.status === 200);

  const pageUpd = await admin.patch(`/api/v1/pages/update/${pageId}`, { metaTitle: 'rc meta' });
  record('CONTENT: page updated', pageUpd.status === 200);

  const pageForbidden = await customer.post('/api/v1/pages/create', { title: 'RC Nope' });
  record('CONTENT: customer cannot create page', pageForbidden.status === 403);

  const pageDel = await admin.del(`/api/v1/pages/delete/${pageId}`);
  record('CONTENT: page deleted', pageDel.status === 200);
  const pageGone = await request(app).get(`/api/v1/pages/getBySlug/${pageSlug}`);
  record('CONTENT: deleted page 404', pageGone.status === 404);

  const blog = await admin.post('/api/v1/blogs/create', {
    title: `RC Blog ${run}`,
    content: '<p>rc blog</p>',
    tags: ['rc', 'test'],
  });
  record('CONTENT: blog created', blog.status === 201);
  const blogId = blog.body?.result?.blogId ?? '';
  const blogSlug = D_str(blog.body?.result?.slug);

  const blogs = await request(app).get('/api/v1/blogs/getAll?tag=rc');
  record('CONTENT: blogs filtered by tag', blogs.status === 200);

  const blogBySlug = await request(app).get(`/api/v1/blogs/getBySlug/${blogSlug}`);
  record('CONTENT: blog by slug', blogBySlug.status === 200);

  const blogUpd = await admin.patch(`/api/v1/blogs/update/${blogId}`, { excerpt: 'rc excerpt' });
  record('CONTENT: blog updated', blogUpd.status === 200);
  await admin.del(`/api/v1/blogs/delete/${blogId}`);

  const faq = await admin.post('/api/v1/faqs/create', {
    question: 'What is RC testing?',
    answer: 'RC is a role-complete e2e suite.',
    category: 'rc',
  });
  record('CONTENT: faq created', faq.status === 201);
  const faqId = faq.body?.result?.faqId ?? '';
  const faqs = await request(app).get('/api/v1/faqs/getAll?category=rc');
  record('CONTENT: faqs listed', faqs.status === 200);
  const faqUpd = await admin.patch(`/api/v1/faqs/update/${faqId}`, { sortOrder: 2 });
  record('CONTENT: faq updated', faqUpd.status === 200);
  await admin.del(`/api/v1/faqs/delete/${faqId}`);

  const banner = await admin.post('/api/v1/banners/create', {
    title: `RC Banner ${run}`,
    type: 'HOME',
  });
  record('CONTENT: banner created', banner.status === 201);
  const bannerId = banner.body?.result?.bannerId ?? '';

  const badBanner = await admin.post('/api/v1/banners/create', {
    title: `RC BadBanner ${run}`,
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  record('CONTENT: banner bad window rejected', badBanner.status === 400);

  const banners = await request(app).get('/api/v1/banners/getAll?type=HOME');
  record('CONTENT: banners listed', banners.status === 200);
  const bannerUpd = await admin.patch(`/api/v1/banners/update/${bannerId}`, { sortOrder: 1 });
  record('CONTENT: banner updated', bannerUpd.status === 200);
  await admin.del(`/api/v1/banners/delete/${bannerId}`);

  const contact = await request(app)
    .post('/api/v1/contact/submit')
    .send({ name: 'RC Contact', email: email('contact'), message: 'This is a test message.' });
  record('CONTENT: contact submitted publicly', contact.status === 201);
  const contactId = contact.body?.result?.contactId ?? '';

  const shortMsg = await request(app)
    .post('/api/v1/contact/submit')
    .send({ name: 'RC', email: email('c2'), message: 'hi' });
  record('CONTENT: short contact message rejected', shortMsg.status === 400);

  const contacts = await admin.get('/api/v1/contact/getAll');
  record('CONTENT: contacts listed for admin', contacts.status === 200);
  if (contactId) {
    const markRead = await admin.patch(`/api/v1/contact/${contactId}/markRead`, {});
    record('CONTENT: contact marked read', markRead.status === 200);
  }

  const newsEmail = email('news');
  const subRes = await request(app).post('/api/v1/newsletter/subscribe').send({ email: newsEmail });
  logResponse('POST', '/api/v1/newsletter/subscribe', subRes.status, subRes.body);
  record('CONTENT: newsletter subscribed', subRes.status === 201);
  const unsubToken = D_str(subRes.body?.result?.unsubscribeToken);
  record('CONTENT: unsubscribe token issued', unsubToken.length > 0);

  const subAgain = await request(app)
    .post('/api/v1/newsletter/subscribe')
    .send({ email: newsEmail });
  logResponse('POST', '/api/v1/newsletter/subscribe (duplicate)', subAgain.status, subAgain.body);
  record(
    'CONTENT: duplicate subscribe handled',
    [200, 201, 409].includes(subAgain.status),
    `status=${subAgain.status}`,
  );

  const badSub = await request(app)
    .post('/api/v1/newsletter/subscribe')
    .send({ email: 'not-an-email' });
  record('CONTENT: invalid subscribe email rejected', badSub.status === 400);

  if (unsubToken) {
    const unsub = await request(app)
      .post('/api/v1/newsletter/unsubscribe')
      .send({ token: unsubToken });
    record('CONTENT: unsubscribe works', unsub.status === 200);
    const unsubAgain = await request(app)
      .post('/api/v1/newsletter/unsubscribe')
      .send({ token: unsubToken });
    record('CONTENT: double unsubscribe handled', [200, 404, 422].includes(unsubAgain.status));
  }

  const subs = await admin.get('/api/v1/newsletter/getAll');
  record('CONTENT: subscribers listed for admin', subs.status === 200);

  const campaign = await admin.post('/api/v1/newsletter/sendCampaign', {
    subject: 'RC News',
    body: 'Hello subscribers',
  });
  record('CONTENT: campaign accepted', [200, 201].includes(campaign.status));
  const badCampaign = await admin.post('/api/v1/newsletter/sendCampaign', { subject: 'x' });
  record('CONTENT: invalid campaign rejected', badCampaign.status === 400);

  const dd = await admin.post('/api/v1/content/dropdowns/create', {
    type: `rc_${run}`,
    label: 'RC One',
    value: 'one',
  });
  record('CONTENT: dropdown created', dd.status === 201);
  const ddId = dd.body?.result?.dropdownId ?? '';
  const dds = await request(app).get(`/api/v1/content/dropdowns?type=rc_${run}`);
  record('CONTENT: dropdowns listed publicly', dds.status === 200);
  const ddUpd = await admin.patch(`/api/v1/content/dropdowns/${ddId}/update`, { label: 'RC Uno' });
  record('CONTENT: dropdown updated', ddUpd.status === 200);
  await admin.del(`/api/v1/content/dropdowns/${ddId}/delete`);

  const countries = await request(app).get('/api/v1/countries/getAll');
  record('CONTENT: countries listed', countries.status === 200);

  const states = await request(app).get('/api/v1/countries/getStates/IN');
  record('CONTENT: states listed', states.status === 200);

  const cities = await request(app).get('/api/v1/countries/getCities/MH');
  record('CONTENT: cities listed', cities.status === 200);

  const pincode = await request(app)
    .post('/api/v1/countries/checkPincode')
    .send({ pincode: '400001' });
  record('CONTENT: pincode check works', pincode.status === 200);

  const badPincode = await request(app)
    .post('/api/v1/countries/checkPincode')
    .send({ pincode: '12' });
  record('CONTENT: bad pincode rejected', badPincode.status === 400);

  const seedCountries = await admin.post('/api/v1/countries/seedCountries', {});
  record('CONTENT: seed countries idempotent', seedCountries.status === 200);

  const currency = await admin.post('/api/v1/currencies/create', {
    code: 'RCT',
    name: 'RC Token',
    symbol: 'R',
    rate: 2,
  });
  record('CONTENT: currency created', currency.status === 201);
  const currencyId = currency.body?.result?.currencyId ?? '';

  const currencies = await request(app).get('/api/v1/currencies/getAll');
  record('CONTENT: currencies listed', currencies.status === 200);

  const converted = await request(app).get('/api/v1/currencies/convert?amount=100&to=RCT');
  record(
    'CONTENT: currency converted',
    converted.status === 200 && D_num(converted.body?.result?.convertedAmount) === 200,
  );

  const badConvert = await request(app).get('/api/v1/currencies/convert?amount=100&to=ZZZ');
  record('CONTENT: unknown currency 404', badConvert.status === 404);

  const currencyUpd = await admin.patch(`/api/v1/currencies/update/${currencyId}`, { rate: 3 });
  record('CONTENT: currency updated', currencyUpd.status === 200);
  await admin.del(`/api/v1/currencies/delete/${currencyId}`);

  const tax = await admin.post('/api/v1/tax/create', { name: `RC Tax ${run}`, percent: 5 });
  record('CONTENT: tax config created', tax.status === 201);
  const taxId = tax.body?.result?.taxConfigId ?? '';

  const badTax = await admin.post('/api/v1/tax/create', { name: `RC Tax2 ${run}`, percent: 101 });
  record('CONTENT: tax above 100 rejected', badTax.status === 400);

  const taxes = await request(app).get('/api/v1/tax/getConfigs');
  record('CONTENT: tax configs listed', taxes.status === 200);
  const taxUpd = await admin.patch(`/api/v1/tax/update/${taxId}`, { percent: 6 });
  record('CONTENT: tax updated', taxUpd.status === 200);
  await admin.del(`/api/v1/tax/delete/${taxId}`);

  const i18n = await admin.post('/api/v1/i18n/create', {
    locale: 'rc',
    key: 'hello',
    value: 'world',
  });
  record('CONTENT: translation created', i18n.status === 201);
  const i18nId = i18n.body?.result?.translationId ?? i18n.body?.result?.id ?? '';

  const bulkI18n = await admin.post('/api/v1/i18n/bulkUpsert', {
    locale: 'rc',
    entries: [
      { key: 'bye', value: 'tata' },
      { key: 'thanks', value: 'dhanyavad' },
    ],
  });
  record(
    'CONTENT: bulk translations upserted',
    bulkI18n.status === 200 && D_num(bulkI18n.body?.result?.upsertedCount) === 2,
  );

  const translations = await request(app).get('/api/v1/i18n/getTranslations/rc');
  record('CONTENT: translations fetched', translations.status === 200);

  const locales = await request(app).get('/api/v1/i18n/getLocales');
  record('CONTENT: locales listed', locales.status === 200);

  if (i18nId) {
    const i18nUpd = await admin.patch(`/api/v1/i18n/update/${i18nId}`, { value: 'world2' });
    record('CONTENT: translation updated', i18nUpd.status === 200);
    const i18nDel = await admin.del(`/api/v1/i18n/delete/${i18nId}`);
    record('CONTENT: translation deleted', i18nDel.status === 200);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// TICKETS + CHAT WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runTicketsChatWorkflow = async (
  adminToken: string,
  customerToken: string,
  vendorToken: string,
  vendorId: string,
  vendorUserId: string,
  subAdminId: string,
) => {
  const admin = api(adminToken);
  const customer = api(customerToken);
  const vendor = api(vendorToken);

  log('\n' + '='.repeat(80));
  log('TICKETS + CHAT WORKFLOW');
  log('='.repeat(80));

  const category = await admin.post('/api/v1/tickets/categories', { name: `RC TC ${run}` });
  record('TICKET: category created', category.status === 201);
  const categoryId = category.body?.result?.categoryId ?? '';

  const categories = await request(app).get('/api/v1/tickets/getCategories');
  record('TICKET: categories listed publicly', categories.status === 200);

  const ticket = await customer.post('/api/v1/tickets/create', {
    subject: 'RC order issue',
    description: 'Order arrived late, need help',
    categoryId,
    priority: 'HIGH',
  });
  record('TICKET: ticket created', ticket.status === 201);
  const ticketId = ticket.body?.result?.ticketId ?? '';

  const shortSubject = await customer.post('/api/v1/tickets/create', { subject: 'abc' });
  record('TICKET: short subject rejected', shortSubject.status === 400);

  const ticketList = await customer.get('/api/v1/tickets/getAll?status=OPEN');
  record('TICKET: customer tickets listed', ticketList.status === 200);

  const ticketById = await customer.get(`/api/v1/tickets/getById/${ticketId}`);
  record('TICKET: ticket by id', ticketById.status === 200);

  const reply = await customer.post(`/api/v1/tickets/reply/${ticketId}`, {
    message: 'Any update please?',
  });
  record('TICKET: customer reply added', reply.status === 201);

  const adminReply = await admin.post(`/api/v1/tickets/reply/${ticketId}`, {
    message: 'We are checking',
    isInternal: false,
  });
  record('TICKET: admin reply added', adminReply.status === 201);

  const stats = await admin.get('/api/v1/tickets/getStats');
  record('TICKET: stats returned', stats.status === 200);

  const tNote = await admin.post(`/api/v1/tickets/addNote/${ticketId}`, {
    note: 'rc internal note',
  });
  record('TICKET: internal note added', tNote.status === 200);
  const tNoteId = tNote.body?.result?.noteId ?? tNote.body?.result?.id ?? '';
  const tNotes = await admin.get(`/api/v1/tickets/getNotes/${ticketId}`);
  record('TICKET: notes listed', tNotes.status === 200);
  if (tNoteId) {
    const rmTNote = await admin.del(`/api/v1/tickets/removeNote/${ticketId}/${tNoteId}`);
    record('TICKET: note removed', rmTNote.status === 200);
  }

  if (subAdminId) {
    const assigned = await admin.patch(`/api/v1/tickets/assign/${ticketId}`, {
      assignedToId: subAdminId,
    });
    record('TICKET: ticket assigned', assigned.status === 200);
  }

  const sameState = await admin.patch(`/api/v1/tickets/updateStatus/${ticketId}`, {
    status: 'IN_PROGRESS',
  });
  record('TICKET: same-state transition rejected', sameState.status === 422);

  const resolved = await admin.patch(`/api/v1/tickets/updateStatus/${ticketId}`, {
    status: 'RESOLVED',
  });
  record('TICKET: status updated', resolved.status === 200);

  const badStatus = await admin.patch(`/api/v1/tickets/updateStatus/${ticketId}`, {
    status: 'WHATEVER',
  });
  record('TICKET: invalid status rejected', badStatus.status === 400);

  const closed = await customer.patch(`/api/v1/tickets/close/${ticketId}`, {});
  record('TICKET: customer closes ticket', closed.status === 200);

  const delTicket = await admin.del(`/api/v1/tickets/delete/${ticketId}`);
  record('TICKET: ticket deleted by admin', delTicket.status === 200);
  const ticketGone = await customer.get(`/api/v1/tickets/getById/${ticketId}`);
  record('TICKET: deleted ticket 404', ticketGone.status === 404);

  const canned = await admin.post('/api/v1/cannedResponses/create', {
    title: `RC Canned ${run}`,
    body: 'Hello, how can I help?',
  });
  record('TICKET: canned response created', canned.status === 201);
  const cannedId = canned.body?.result?.cannedResponseId ?? canned.body?.result?.id ?? '';
  const cannedList = await admin.get('/api/v1/cannedResponses/getAll');
  record('TICKET: canned responses listed', cannedList.status === 200);
  if (cannedId) {
    const cannedUpd = await admin.patch(`/api/v1/cannedResponses/update/${cannedId}`, {
      body: 'Hi there!',
    });
    record('TICKET: canned response updated', cannedUpd.status === 200);
    await admin.del(`/api/v1/cannedResponses/delete/${cannedId}`);
  }

  const convo = await customer.post('/api/v1/chat/startConversation', {
    vendorId,
    subject: 'Product question',
    message: 'Is this in stock?',
  });
  record('CHAT: conversation started', convo.status === 201);
  const conversationId = D_str(
    convo.body?.result?.conversation?.conversationId ?? convo.body?.result?.conversationId,
  );

  const convoAgain = await customer.post('/api/v1/chat/startConversation', {
    vendorId,
    message: 'Same thread check',
  });
  record('CHAT: same vendor reuses thread', [200, 201].includes(convoAgain.status));

  const selfChat = await vendor.post('/api/v1/chat/startConversation', {
    vendorId,
    message: 'hello self',
  });
  record('CHAT: self-chat blocked', selfChat.status === 422);

  if (conversationId) {
    const vendorMsg = await vendor.post('/api/v1/chat/sendMessage', {
      conversationId,
      body: 'Yes, in stock!',
    });
    record('CHAT: vendor replies', vendorMsg.status === 201);

    const messages = await customer.get(`/api/v1/chat/getMessages/${conversationId}`);
    record('CHAT: messages listed', messages.status === 200);

    const unread = await vendor.get('/api/v1/chat/getUnreadCount');
    record('CHAT: unread count returned', unread.status === 200);

    const marked = await vendor.patch(`/api/v1/chat/markRead/${conversationId}`, {});
    record('CHAT: conversation marked read', marked.status === 200);

    const convos = await customer.get('/api/v1/chat/getConversations');
    record('CHAT: conversations listed', convos.status === 200);

    const customerMsg = await customer.post('/api/v1/chat/sendMessage', {
      conversationId,
      body: 'Great, thanks!',
    });
    const msgId = D_str(
      customerMsg.body?.result?.messageId ?? customerMsg.body?.result?.message?.messageId,
    );

    const vendorDeletesOthers = await vendor.del(`/api/v1/chat/deleteMessage/${msgId}`);
    record('CHAT: deleting others message blocked', vendorDeletesOthers.status === 404);

    if (msgId) {
      const ownDelete = await customer.del(`/api/v1/chat/deleteMessage/${msgId}`);
      record('CHAT: own message deleted', ownDelete.status === 200);
    }

    const block = await customer.post(`/api/v1/chat/blockUser/${vendorUserId}`, {
      reason: 'rc block test',
    });
    record('CHAT: user blocked', block.status === 200);

    const blockedSend = await vendor.post('/api/v1/chat/sendMessage', {
      conversationId,
      body: 'can I still talk?',
    });
    record('CHAT: blocked user cannot message', blockedSend.status === 403);

    const blockedList = await customer.get('/api/v1/chat/getBlocked');
    record('CHAT: blocked list returned', blockedList.status === 200);

    const unblock = await customer.post(`/api/v1/chat/unblock/${vendorUserId}`, {});
    record('CHAT: user unblocked', unblock.status === 200);

    const afterUnblock = await vendor.post('/api/v1/chat/sendMessage', {
      conversationId,
      body: 'works again',
    });
    record('CHAT: messaging resumes after unblock', afterUnblock.status === 201);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION DEEP WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runNotificationDeepWorkflow = async (adminToken: string, customerToken: string) => {
  const admin = api(adminToken);
  const customer = api(customerToken);

  log('\n' + '='.repeat(80));
  log('NOTIFICATION DEEP WORKFLOW');
  log('='.repeat(80));

  const prefs = await customer.get('/api/v1/notifications/getPreferences');
  record('NOTIF: preferences returned', prefs.status === 200);

  const updPrefs = await customer.patch('/api/v1/notifications/updatePreferences', {
    preferences: [{ channel: 'EMAIL', eventType: 'ORDER', isEnabled: false }],
  });
  record('NOTIF: preferences updated', updPrefs.status === 200);

  const badPrefs = await customer.patch('/api/v1/notifications/updatePreferences', {
    preferences: [],
  });
  record('NOTIF: empty preferences rejected', badPrefs.status === 400);

  const device = await customer.post('/api/v1/notifications/registerDevice', {
    deviceId: `rc-ntf-${run}`,
    platform: 'ANDROID',
    fcmToken: 'rc-fcm-token',
  });
  record('NOTIF: device registered', device.status === 200);

  const unreg = await customer.post('/api/v1/notifications/unregisterDevice', {
    deviceId: `rc-ntf-${run}`,
  });
  record('NOTIF: device unregistered', unreg.status === 200);

  const noRecipient = await admin.post('/api/v1/notifications/sendBulk', { title: 'RC Bulk' });
  record('NOTIF: bulk without recipients rejected', noRecipient.status === 400);

  const bulk = await admin.post('/api/v1/notifications/sendBulk', {
    toAll: true,
    title: `RC Bulk ${run}`,
    body: 'test blast',
  });
  record('NOTIF: bulk to all sent', [200, 202].includes(bulk.status), `status=${bulk.status}`);

  const tpl = await admin.post('/api/v1/notifications/createTemplate', {
    key: `rc_tpl_${run}`,
    title: 'RC Template',
    body: 'Hello {{name}}',
  });
  record('NOTIF: template created', tpl.status === 201);
  const tplId = tpl.body?.result?.templateId ?? tpl.body?.result?.id ?? '';

  const tplList = await admin.get('/api/v1/notifications/getTemplates');
  record('NOTIF: templates listed', tplList.status === 200);

  if (tplId) {
    const tplUpd = await admin.patch(`/api/v1/notifications/updateTemplate/${tplId}`, {
      body: 'Hi {{name}}!',
    });
    record('NOTIF: template updated', tplUpd.status === 200);
    const tplDel = await admin.del(`/api/v1/notifications/deleteTemplate/${tplId}`);
    record('NOTIF: template deleted', tplDel.status === 200);
  }

  const all = await customer.get('/api/v1/notifications/getAll?limit=1');
  const notifId = D_str(
    D_arr(all.body?.result?.itemList)[0]?.notificationId ??
      D_arr(all.body?.result?.itemList)[0]?.id,
  );
  if (notifId) {
    const markOne = await customer.patch(`/api/v1/notifications/markRead/${notifId}`, {});
    record('NOTIF: single notification marked read', markOne.status === 200);
    const delOne = await customer.del(`/api/v1/notifications/delete/${notifId}`);
    record('NOTIF: notification deleted', delOne.status === 200);
    const delAgain = await customer.del(`/api/v1/notifications/delete/${notifId}`);
    record('NOTIF: double delete 404', delAgain.status === 404);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SHIPPING CONFIG WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runShippingConfigWorkflow = async (adminToken: string, customerToken: string) => {
  const admin = api(adminToken);
  const customer = api(customerToken);

  log('\n' + '='.repeat(80));
  log('SHIPPING CONFIG WORKFLOW');
  log('='.repeat(80));

  const zone = await admin.post('/api/v1/shipping/createZone', {
    name: `RC Zone ${run}`,
    pincodes: ['400001'],
  });
  record('SHIPPING: zone created', zone.status === 201);
  const zoneId = zone.body?.result?.zoneId ?? '';

  const badZone = await admin.post('/api/v1/shipping/createZone', {
    name: `RC BadZone ${run}`,
    pincodes: ['AB'],
  });
  record('SHIPPING: bad pincode zone rejected', badZone.status === 400);

  const zones = await admin.get('/api/v1/shipping/getZones');
  record('SHIPPING: zones listed', zones.status === 200);

  const zoneUpd = await admin.patch(`/api/v1/shipping/updateZone/${zoneId}`, { states: ['MH'] });
  record('SHIPPING: zone updated', zoneUpd.status === 200);

  const method = await admin.post('/api/v1/shipping/createMethod', {
    zoneId,
    name: 'RC Express',
    code: 'rc-exp',
    baseCharge: 80,
    minDays: 1,
    maxDays: 3,
  });
  record('SHIPPING: method created', method.status === 201);
  const methodId = method.body?.result?.methodId ?? '';

  const dupMethod = await admin.post('/api/v1/shipping/createMethod', {
    name: 'RC Express 2',
    code: 'rc-exp',
  });
  record('SHIPPING: duplicate method code rejected', dupMethod.status === 409);

  const badDays = await admin.post('/api/v1/shipping/createMethod', {
    name: 'RC Slow',
    code: 'rc-slow',
    minDays: 5,
    maxDays: 2,
  });
  record('SHIPPING: inverted delivery window rejected', badDays.status === 400);

  const methodUpd = await admin.patch(`/api/v1/shipping/updateMethod/${methodId}`, {
    baseCharge: 90,
  });
  record('SHIPPING: method updated', methodUpd.status === 200);

  const methods = await admin.get(`/api/v1/shipping/getMethods?zoneId=${zoneId}`);
  record('SHIPPING: methods listed by zone', methods.status === 200);

  const partner = await admin.post('/api/v1/shipping/createPartner', {
    name: 'RC Ship',
    code: `rcship${run}`,
    apiUrl: 'https://rcship.example.com',
  });
  record('SHIPPING: partner created', partner.status === 201);

  const dupPartner = await admin.post('/api/v1/shipping/createPartner', {
    name: 'RC Ship 2',
    code: `rcship${run}`,
    apiUrl: 'https://rcship2.example.com',
  });
  record('SHIPPING: duplicate partner code rejected', dupPartner.status === 409);

  const partners = await admin.get('/api/v1/shipping/getPartners');
  record('SHIPPING: partners listed', partners.status === 200);

  const rate = await admin.post('/api/v1/shipping/calculateRate', {
    pincode: '400001',
    weightKg: 1,
    orderValue: 500,
  });
  record('SHIPPING: rate calculated', rate.status === 200 && D_num(rate.body?.result?.charge) >= 0);

  const serviceable = await admin.post('/api/v1/shipping/checkServiceability', {
    pincode: '400001',
  });
  record('SHIPPING: serviceability checked', serviceable.status === 200);

  const badService = await admin.post('/api/v1/shipping/checkServiceability', {});
  record('SHIPPING: pincode required', badService.status === 400);

  const zoneForbidden = await customer.post('/api/v1/shipping/createZone', { name: 'RC Nope' });
  record('SHIPPING: customer cannot create zone', zoneForbidden.status === 403);

  const delMethod = await admin.del(`/api/v1/shipping/deleteMethod/${methodId}`);
  record('SHIPPING: method deleted', delMethod.status === 200);
  const delZone = await admin.del(`/api/v1/shipping/deleteZone/${zoneId}`);
  record('SHIPPING: zone deleted', delZone.status === 200);
  const delZoneAgain = await admin.del(`/api/v1/shipping/deleteZone/${zoneId}`);
  record('SHIPPING: double zone delete 404', delZoneAgain.status === 404);
};

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS API WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runSettingsApiWorkflow = async (adminToken: string, customerToken: string) => {
  const { setSetting } = await import('../src/services/settings.service');
  const admin = api(adminToken);
  const customer = api(customerToken);

  log('\n' + '='.repeat(80));
  log('SETTINGS API WORKFLOW');
  log('='.repeat(80));

  const all = await admin.get('/api/v1/settings/getAll?limit=10');
  record('SETTINGS_API: settings listed', all.status === 200);

  const byCat = await admin.get('/api/v1/settings/getByCategory/shipping');
  record('SETTINGS_API: settings by category', byCat.status === 200);

  const publicSettings = await request(app).get('/api/v1/settings/getPublicSettings');
  record('SETTINGS_API: public settings open', publicSettings.status === 200);

  const upd = await admin.patch('/api/v1/settings/updateSetting', {
    key: 'rc.testFlag',
    value: true,
    category: 'rc',
  });
  record('SETTINGS_API: custom setting upserted', upd.status === 200);

  const noKey = await admin.patch('/api/v1/settings/updateSetting', { value: 1 });
  record('SETTINGS_API: missing key rejected', noKey.status === 400);

  const bulkUpd = await admin.post('/api/v1/settings/bulkUpdateSettings', {
    settings: [
      { key: 'rc.a', value: 1, category: 'rc' },
      { key: 'rc.b', value: 'x', category: 'rc' },
    ],
  });
  record(
    'SETTINGS_API: bulk settings updated',
    bulkUpd.status === 200 && D_num(bulkUpd.body?.result?.updatedCount) === 2,
  );

  const rcCat = await admin.get('/api/v1/settings/getByCategory/rc');
  record('SETTINGS_API: custom category readable', rcCat.status === 200);

  const flags = await request(app).get('/api/v1/settings/getFeatureFlags');
  record('SETTINGS_API: feature flags public', flags.status === 200);

  const toggle = await admin.patch('/api/v1/settings/toggleFeature', {
    key: 'feature.chat',
    enabled: false,
  });
  record('SETTINGS_API: feature toggled off', toggle.status === 200);
  await admin.patch('/api/v1/settings/toggleFeature', { key: 'feature.chat', enabled: true });

  const maintenance = await request(app).get('/api/v1/settings/getMaintenance');
  record('SETTINGS_API: maintenance status public', maintenance.status === 200);

  const maintOn = await admin.patch('/api/v1/settings/updateMaintenance', {
    enabled: true,
    message: 'rc maintenance',
  });
  record('SETTINGS_API: maintenance enabled', maintOn.status === 200);

  const maintCheck = await request(app).get('/api/v1/settings/getMaintenance');
  record('SETTINGS_API: maintenance state visible during maintenance', maintCheck.status === 200);

  const blockedDuringMaint = await customer.get('/api/v1/users/getProfile');
  record('SETTINGS_API: regular API blocked during maintenance', blockedDuringMaint.status === 503);

  const maintOffViaApi = await admin.patch('/api/v1/settings/updateMaintenance', {
    enabled: false,
  });
  record('SETTINGS_API: even admin API blocked during maintenance', maintOffViaApi.status === 503);

  await setSetting('maintenance.enabled', false, 'maintenance', undefined, false);
  const afterMaint = await customer.get('/api/v1/users/getProfile');
  record('SETTINGS_API: API recovers after maintenance off', afterMaint.status === 200);

  const forbidden = await customer.patch('/api/v1/settings/updateSetting', {
    key: 'rc.hack',
    value: true,
  });
  record('SETTINGS_API: customer cannot change settings', forbidden.status === 403);

  const reset = await admin.post('/api/v1/settings/resetToDefault', {});
  record(
    'SETTINGS_API: reset to defaults',
    reset.status === 200 && D_num(reset.body?.result?.resetCount) >= 1,
  );

  await setSetting('shipping.enabled', true, 'shipping', undefined, false);
  await setSetting('shipping.defaultCharge', 50, 'shipping', undefined, false);
  await setSetting('shipping.freeAbove', 0, 'shipping', undefined, false);
  await setSetting('payment.cod.enabled', true, 'payment', undefined, false);
  await setSetting('payment.token.enabled', false, 'payment', undefined, false);
  await setSetting('wallet.enabled', false, 'wallet', undefined, false);
  await setSetting('order.minAmount', 0, 'order', undefined, false);
};

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN OPS WORKFLOW (audit/apikeys/webhooks/reports/bulk/devices/analytics/templates/uploads/search/health)
// ═══════════════════════════════════════════════════════════════════════════
const runAdminOpsWorkflow = async (
  adminToken: string,
  customerToken: string,
  customerUserId: string,
) => {
  const admin = api(adminToken);
  const customer = api(customerToken);

  log('\n' + '='.repeat(80));
  log('ADMIN OPS WORKFLOW');
  log('='.repeat(80));

  const audit = await admin.get('/api/v1/auditLogs/getAll?limit=5');
  record('OPS: audit logs listed', audit.status === 200);
  const auditId = D_str(
    D_arr(audit.body?.result?.itemList)[0]?.auditLogId ??
      D_arr(audit.body?.result?.itemList)[0]?.id,
  );
  if (auditId) {
    const auditById = await admin.get(`/api/v1/auditLogs/getById/${auditId}`);
    record('OPS: audit log by id', auditById.status === 200);
    const auditByActor = await admin.get(`/api/v1/auditLogs/getByActor/${customerUserId}`);
    record('OPS: audit logs by actor', auditByActor.status === 200);
  }
  const auditBogus = await admin.get('/api/v1/auditLogs/getById/nope123');
  record('OPS: unknown audit log 404', auditBogus.status === 404);

  const auditCsv = await admin.get('/api/v1/auditLogs/export');
  record(
    'OPS: audit export is CSV',
    auditCsv.status === 200 && D_str(auditCsv.headers['content-type']).includes('text/csv'),
  );

  const purge = await admin.del('/api/v1/auditLogs/purge');
  record('OPS: audit purge needs body', purge.status === 400);
  const purgeOk = await request(app)
    .del('/api/v1/auditLogs/purge')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ beforeDays: 3650 });
  record('OPS: audit purge runs', purgeOk.status === 200);

  const activity = await admin.get('/api/v1/activityLogs/getAll');
  record('OPS: activity logs listed', activity.status === 200);

  const apiKey = await admin.post('/api/v1/apiKeys/create', {
    name: `RC Key ${run}`,
    scopes: ['orders:read'],
  });
  record('OPS: api key created', apiKey.status === 201);
  const apiKeyId = apiKey.body?.result?.id ?? '';

  const keys = await admin.get('/api/v1/apiKeys/getAll');
  record('OPS: api keys listed', keys.status === 200);

  if (apiKeyId) {
    const usage = await admin.get(`/api/v1/apiKeys/getUsage/${apiKeyId}`);
    record('OPS: api key usage', usage.status === 200);
    const revoke = await admin.patch(`/api/v1/apiKeys/revoke/${apiKeyId}`, {});
    record('OPS: api key revoked', revoke.status === 200);
    const revokeAgain = await admin.patch(`/api/v1/apiKeys/revoke/${apiKeyId}`, {});
    record('OPS: double revoke rejected', revokeAgain.status === 422);
    const delKey = await admin.del(`/api/v1/apiKeys/delete/${apiKeyId}`);
    record('OPS: api key deleted', delKey.status === 200);
    const usageGone = await admin.get(`/api/v1/apiKeys/getUsage/${apiKeyId}`);
    record('OPS: deleted key usage 404', usageGone.status === 404);
  }

  const hook = await admin.post('/api/v1/webhooks/register', {
    url: 'https://example.com/rc-hook',
    events: ['order.created'],
  });
  record('OPS: webhook registered', hook.status === 201);
  const hookId = hook.body?.result?.webhookId ?? '';

  const badHook = await admin.post('/api/v1/webhooks/register', {
    url: 'not-a-url',
    events: ['x'],
  });
  record('OPS: webhook bad url rejected', badHook.status === 400);

  const hooks = await admin.get('/api/v1/webhooks/getAll');
  record('OPS: webhooks listed', hooks.status === 200);

  if (hookId) {
    const hookUpd = await admin.patch(`/api/v1/webhooks/${hookId}/update`, {
      events: ['order.updated'],
    });
    record('OPS: webhook updated', hookUpd.status === 200);
    const rotate = await admin.post(`/api/v1/webhooks/${hookId}/rotateSecret`, {});
    record(
      'OPS: webhook secret rotated',
      rotate.status === 200 && D_str(rotate.body?.result?.secret).length > 0,
    );
    const hookLogs = await admin.get('/api/v1/webhooks/getLogs');
    record('OPS: webhook logs listed', hookLogs.status === 200);
    const delHook = await admin.del(`/api/v1/webhooks/delete/${hookId}`);
    record('OPS: webhook deleted', delHook.status === 200);
    const delHookAgain = await admin.del(`/api/v1/webhooks/delete/${hookId}`);
    record('OPS: double webhook delete 404', delHookAgain.status === 404);
  }

  const badSignature = await request(app)
    .post('/api/v1/webhooks/payment-gateway/razorpay')
    .send({ event: 'payment.captured' });
  record(
    'OPS: unsigned webhook not processed',
    badSignature.status === 200 && badSignature.body?.result?.isProcessed === false,
    `status=${badSignature.status}`,
  );

  const triggerUnknown = await admin.post('/api/v1/admin/triggerJob', { name: 'rc-no-such-job' });
  record(
    'OPS: unknown cron trigger handled',
    triggerUnknown.status === 200 && triggerUnknown.body?.result?.triggered === false,
  );
  const triggerEmpty = await admin.post('/api/v1/admin/triggerJob', {});
  record('OPS: empty cron trigger rejected', triggerEmpty.status === 400);

  const retryBogus = await admin.post('/api/v1/admin/retryFailedJob/nope123', {});
  record('OPS: retry unknown failed job 404', retryBogus.status === 404);
  const resolveBogus = await admin.patch('/api/v1/admin/resolveFailedJob/nope123', {});
  record('OPS: resolve unknown failed job 404', resolveBogus.status === 404);

  for (const type of [
    'sales',
    'orders',
    'products',
    'customers',
    'vendors',
    'payouts',
    'tax',
    'inventory',
    'returns',
  ]) {
    const report = await admin.get(`/api/v1/reports/${type}`);
    record(`OPS: ${type} report`, report.status === 200);
  }

  const reportCsv = await admin.get('/api/v1/reports/sales?format=csv');
  record('OPS: report csv format', reportCsv.status === 200);

  const exportCsv = await admin.get('/api/v1/reports/export/SALES');
  record(
    'OPS: report export raw CSV',
    exportCsv.status === 200 && D_str(exportCsv.headers['content-type']).includes('text/csv'),
  );

  const badExport = await admin.get('/api/v1/reports/export/BOGUS');
  record('OPS: unknown export type rejected', badExport.status === 400);

  const schedule = await admin.post('/api/v1/reports/schedule', {
    name: `RC Report ${run}`,
    reportType: 'SALES',
    cron: '0 0 * * *',
    recipients: [email('reports')],
  });
  record('OPS: report scheduled', schedule.status === 201);
  const scheduleId = schedule.body?.result?.scheduleId ?? schedule.body?.result?.id ?? '';

  const badCron = await admin.post('/api/v1/reports/schedule', {
    name: 'RC Bad',
    reportType: 'SALES',
    cron: 'blah blah',
    recipients: [email('r2')],
  });
  record('OPS: invalid cron rejected', badCron.status === 400);

  const schedules = await admin.get('/api/v1/reports/getSchedules');
  record('OPS: schedules listed', schedules.status === 200);

  if (scheduleId) {
    const schedUpd = await admin.patch(`/api/v1/reports/schedule/${scheduleId}/update`, {
      isActive: false,
    });
    record('OPS: schedule updated', schedUpd.status === 200);
    const schedDel = await admin.del(`/api/v1/reports/schedule/${scheduleId}/delete`);
    record('OPS: schedule deleted', schedDel.status === 200);
  }

  const emptyImport = await admin.post('/api/v1/bulk/importUsers', { rows: [] });
  record('OPS: empty import rejected', emptyImport.status === 400);

  const jobHistory = await admin.get('/api/v1/bulk/getJobHistory');
  record('OPS: bulk job history listed', jobHistory.status === 200);

  const bogusJob = await admin.get('/api/v1/bulk/getJobStatus/nope123');
  record('OPS: unknown bulk job 404', bogusJob.status === 404);

  const devReg = await customer.post('/api/v1/track/device', {
    deviceId: `rc-tdev-${run}`,
    platform: 'ANDROID',
  });
  record('OPS: device tracked', [200, 201].includes(devReg.status));

  const devices = await admin.get('/api/v1/devices/getAll');
  const deviceRow = D_arr(devices.body?.result?.itemList).find(
    (d: any) => d.deviceId === `rc-tdev-${run}`,
  );
  const devicePk = D_str(deviceRow?.id ?? deviceRow?.devicePk ?? deviceRow?.recordId);
  record('OPS: devices listed for admin', devices.status === 200);

  if (devicePk) {
    const block = await admin.patch(`/api/v1/devices/block/${devicePk}`, {});
    record('OPS: device blocked', block.status === 200);
    const unblock = await admin.patch(`/api/v1/devices/unblock/${devicePk}`, {});
    record('OPS: device unblocked', unblock.status === 200);
    const trust = await customer.patch(`/api/v1/devices/trust/${devicePk}`, {});
    record('OPS: device trusted', trust.status === 200);
    const trusted = await customer.get('/api/v1/devices/getTrusted');
    record('OPS: trusted devices listed', trusted.status === 200);
    const untrust = await customer.patch(`/api/v1/devices/untrust/${devicePk}`, {});
    record('OPS: device untrusted', untrust.status === 200);
    const byUser = await admin.get(`/api/v1/devices/getByUser/${customerUserId}`);
    record('OPS: devices by user', byUser.status === 200);
    const delDevice = await admin.del(`/api/v1/devices/delete/${devicePk}`);
    record('OPS: device deleted', delDevice.status === 200);
  }

  const trackEvent = await customer.post('/api/v1/track/event', { name: 'product_view' });
  record('OPS: event tracked', trackEvent.status === 201);
  const badEvent = await customer.post('/api/v1/track/event', { name: 'x' });
  record('OPS: short event name rejected', badEvent.status === 400);
  const pv = await customer.post('/api/v1/track/pageView', { pageUrl: '/rc-home' });
  record('OPS: page view tracked', pv.status === 201);
  const sessStart = await customer.post('/api/v1/track/session/start', {
    pageUrl: '/rc',
    sessionKey: `rcsess_${run}`,
  });
  record('OPS: session start tracked', sessStart.status === 201);
  const sessEnd = await customer.post('/api/v1/track/session/end', {
    durationSec: 30,
    sessionKey: `rcsess_${run}`,
  });
  record('OPS: session end tracked', sessEnd.status === 200);
  const trackSearch = await customer.post('/api/v1/track/search', {
    term: 'rc shoes',
    resultCount: 0,
  });
  record('OPS: search tracked', trackSearch.status === 201);
  const heartbeat = await customer.post('/api/v1/track/heartbeat', { screenName: 'home' });
  record('OPS: heartbeat tracked', heartbeat.status === 201);
  const crash = await customer.post('/api/v1/track/crash', { errorMessage: 'rc crash happened' });
  record('OPS: crash tracked', crash.status === 201);
  const perf = await customer.post('/api/v1/track/performance', { metric: 'load', value: 1.2 });
  record('OPS: performance tracked', perf.status === 201);
  const utm = await customer.post('/api/v1/track/utm', { source: 'google', medium: 'cpc' });
  record('OPS: utm tracked', utm.status === 201);
  const scroll = await customer.post('/api/v1/track/scroll', { depth: 50 });
  record('OPS: scroll tracked', scroll.status === 201);
  const badScroll = await customer.post('/api/v1/track/scroll', { depth: 101 });
  record('OPS: scroll above 100 rejected', badScroll.status === 400);

  const overview = await admin.get('/api/v1/analytics/getOverview?days=7');
  record('OPS: analytics overview', overview.status === 200);
  const visitors = await admin.get('/api/v1/analytics/getVisitors?days=7');
  record('OPS: visitors report', visitors.status === 200);
  const unique = await admin.get('/api/v1/analytics/getUniqueVisitors?days=7');
  record('OPS: unique visitors', unique.status === 200);
  const pageViews = await admin.get('/api/v1/analytics/getPageViews?days=7');
  record('OPS: page views', pageViews.status === 200);
  const topPages = await admin.get('/api/v1/analytics/getTopPages?days=7');
  record('OPS: top pages', topPages.status === 200);
  const sources = await admin.get('/api/v1/analytics/getTrafficSources?days=7');
  record('OPS: traffic sources', sources.status === 200);
  const deviceBreak = await admin.get('/api/v1/analytics/getDeviceBreakdown?days=7');
  record('OPS: device breakdown', deviceBreak.status === 200);
  const geo = await admin.get('/api/v1/analytics/getGeoBreakdown?days=7');
  record('OPS: geo breakdown', geo.status === 200);
  const sessionsList = await admin.get('/api/v1/analytics/getSessions?days=7');
  record('OPS: sessions listed', sessionsList.status === 200);
  const sessionPk = D_str(
    D_arr(sessionsList.body?.result?.itemList)[0]?.sessionId ??
      D_arr(sessionsList.body?.result?.itemList)[0]?.id,
  );
  if (sessionPk) {
    const sessionDetail = await admin.get(`/api/v1/analytics/getSessionDetail/${sessionPk}`);
    record('OPS: session detail', sessionDetail.status === 200);
  }
  const conversions = await admin.get('/api/v1/analytics/getConversions?days=7');
  record('OPS: conversions', conversions.status === 200);
  const revenue = await admin.get('/api/v1/analytics/getRevenueReport?days=30');
  record('OPS: revenue report', revenue.status === 200);
  const productPerf = await admin.get('/api/v1/analytics/getProductPerformance?days=30');
  record('OPS: product performance', productPerf.status === 200);
  const vendorPerf = await admin.get('/api/v1/analytics/getVendorPerformance?days=30');
  record('OPS: vendor performance', vendorPerf.status === 200);
  const cohorts = await admin.get('/api/v1/analytics/getCustomerCohorts?days=30');
  record('OPS: customer cohorts', cohorts.status === 200);
  const abandoned = await admin.get('/api/v1/analytics/getAbandonedCarts');
  record('OPS: abandoned carts', abandoned.status === 200);
  const terms = await admin.get('/api/v1/analytics/getSearchTerms');
  record('OPS: search terms', terms.status === 200);
  const zeroResults = await admin.get('/api/v1/analytics/getZeroResultSearches');
  record('OPS: zero-result searches', zeroResults.status === 200);
  const realtime = await admin.get('/api/v1/analytics/getRealtime');
  record('OPS: realtime analytics', realtime.status === 200);
  const crashes = await admin.get('/api/v1/analytics/getCrashes?days=7');
  record('OPS: crash list', crashes.status === 200);
  const versions = await admin.get('/api/v1/analytics/getAppVersions?days=30');
  record('OPS: app versions', versions.status === 200);
  const analyticsExport = await admin.get('/api/v1/analytics/export?days=7');
  record('OPS: analytics export', analyticsExport.status === 200);

  const customerAnalytics = await customer.get('/api/v1/analytics/getOverview');
  record('OPS: customer blocked from admin analytics', customerAnalytics.status === 403);

  const funnelDef = await admin.post('/api/v1/analytics/funnels', {
    name: `RC Funnel ${run}`,
    steps: [
      { name: 'View', eventName: 'page_view' },
      { name: 'Buy', eventName: 'purchase' },
    ],
  });
  record('OPS: funnel created', funnelDef.status === 201);
  const funnelId = funnelDef.body?.result?.funnelId ?? funnelDef.body?.result?.id ?? '';

  const funnelReport = await admin.get(
    `/api/v1/analytics/getFunnel?slug=${D_str(funnelDef.body?.result?.slug)}&days=30`,
  );
  record('OPS: funnel report', funnelReport.status === 200, `status=${funnelReport.status}`);

  const oneStep = await admin.post('/api/v1/analytics/funnels', {
    name: 'RC OneStep',
    steps: [{ name: 'Only', eventName: 'view' }],
  });
  record('OPS: one-step funnel rejected', oneStep.status === 400);

  const funnelList = await admin.get('/api/v1/analytics/funnels');
  record('OPS: funnels listed', funnelList.status === 200);

  if (funnelId) {
    const funnelUpd = await admin.patch(`/api/v1/analytics/funnels/${funnelId}`, {
      isActive: false,
    });
    record('OPS: funnel updated', funnelUpd.status === 200);
  }

  const emailTpl = await admin.post('/api/v1/templates/email/upsert', {
    key: `rc_email_${run}`,
    subject: 'Welcome {{name}}',
    htmlBody: '<b>Hello {{name}}</b>',
  });
  record('OPS: email template upserted', emailTpl.status === 200);

  const emailRender = await admin.post(`/api/v1/templates/email/rc_email_${run}/render`, {
    values: { name: 'RC' },
  });
  record('OPS: email template rendered', emailRender.status === 200);

  const emailTplList = await admin.get('/api/v1/templates/email/getAll');
  record('OPS: email templates listed', emailTplList.status === 200);

  const smsTpl = await admin.post('/api/v1/templates/sms/upsert', {
    key: `rc_sms_${run}`,
    body: 'Hi {{name}}',
  });
  record('OPS: sms template upserted', smsTpl.status === 200);
  const smsRender = await admin.post(`/api/v1/templates/sms/rc_sms_${run}/render`, {
    values: { name: 'RC' },
  });
  record('OPS: sms template rendered', smsRender.status === 200);

  const ntfTpl = await admin.post('/api/v1/templates/notification/upsert', {
    key: `rc_ntf_${run}`,
    title: 'Hi {{name}}',
    body: 'Welcome aboard',
  });
  record('OPS: notification template upserted', ntfTpl.status === 200);

  const renderUnknown = await admin.post('/api/v1/templates/email/no_such_tpl/render', {
    values: {},
  });
  record('OPS: render unknown template 404', renderUnknown.status === 404);

  const badTplKey = await admin.post('/api/v1/templates/email/upsert', {
    key: 'BAD KEY!',
    subject: 's',
    htmlBody: 'b',
  });
  record('OPS: invalid template key rejected', badTplKey.status === 400);

  await admin.del(`/api/v1/templates/email/rc_email_${run}/delete`);
  await admin.del(`/api/v1/templates/sms/rc_sms_${run}/delete`);
  await admin.del(`/api/v1/templates/notification/rc_ntf_${run}/delete`);
  record('OPS: templates deleted', true);

  const signed = await customer.get('/api/v1/uploads/getSignedUrl?kind=IMAGE');
  record('OPS: signed url issued', signed.status === 200);
  const badKind = await customer.get('/api/v1/uploads/getSignedUrl?kind=EXECUTABLE');
  record('OPS: invalid upload kind rejected', badKind.status === 400);
  const delFileEmpty = await customer.post('/api/v1/uploads/deleteFile', {});
  record('OPS: deleteFile needs publicId', delFileEmpty.status === 400);

  const autocomplete = await request(app).get('/api/v1/search/autocomplete?q=RC');
  record('OPS: autocomplete works', autocomplete.status === 200);
  const searchProducts = await request(app).get('/api/v1/search/products?q=RC&sort=price_asc');
  record('OPS: product search works', searchProducts.status === 200);
  const searchVendors = await request(app).get('/api/v1/search/vendors?q=RC');
  record('OPS: vendor search works', searchVendors.status === 200);
  const trending = await request(app).get('/api/v1/search/trending');
  record('OPS: trending searches', trending.status === 200);
  const recentSearches = await customer.get('/api/v1/search/recent');
  record('OPS: recent searches', recentSearches.status === 200);
  const clearRecent = await customer.del('/api/v1/search/recent/clear');
  record('OPS: recent searches cleared', clearRecent.status === 200);
  const noQuery = await request(app).get('/api/v1/search/autocomplete');
  record('OPS: autocomplete needs query', noQuery.status === 400);

  const health = await request(app).get('/api/v1/health/');
  record('OPS: health endpoint up', health.status === 200);
  const healthDb = await request(app).get('/api/v1/health/db');
  record(
    'OPS: database health up',
    healthDb.status === 200 && healthDb.body?.result?.database === 'UP',
  );
  const healthRedis = await request(app).get('/api/v1/health/redis');
  record('OPS: redis health reported', healthRedis.status === 200);
  const healthQueue = await request(app).get('/api/v1/health/queue');
  record('OPS: queue health reported', healthQueue.status === 200);
  const version = await request(app).get('/api/v1/version/');
  record('OPS: version endpoint works', version.status === 200);
};

// ═══════════════════════════════════════════════════════════════════════════
// SECURITY EDGE WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════
const runSecurityEdgeWorkflow = async (
  adminToken: string,
  customerToken: string,
  vendorToken: string,
) => {
  const admin = api(adminToken);
  const customer = api(customerToken);
  const vendor = api(vendorToken);

  log('\n' + '='.repeat(80));
  log('SECURITY EDGE WORKFLOW');
  log('='.repeat(80));

  const unknownRoute = await request(app).get('/api/v1/no-such-route');
  record('EDGE: unknown route 404', unknownRoute.status === 404);

  const emptyLogin = await request(app).post('/api/v1/auth/login').send({});
  record('EDGE: empty login rejected', emptyLogin.status === 400);

  const customerToAdmin = await customer.get('/api/v1/admin/getDashboardStats');
  record('EDGE: customer blocked from admin', customerToAdmin.status === 403);

  const customerToSettings = await customer.get('/api/v1/settings/getAll');
  record('EDGE: customer blocked from settings', customerToSettings.status === 403);

  const vendorToUsers = await vendor.get('/api/v1/users/getAll');
  record('EDGE: vendor blocked from user list', vendorToUsers.status === 403);

  const customerCreatesCoupon = await customer.post('/api/v1/coupons/createCoupon', {
    code: 'HACK1',
    value: 100,
  });
  record('EDGE: customer cannot create coupon', customerCreatesCoupon.status === 403);

  const strictField = await customer.patch('/api/v1/users/updateProfile', { hackyField: true });
  record('EDGE: unknown field rejected (strict schema)', strictField.status === 400);

  const emptyPatch = await customer.patch('/api/v1/users/updateProfile', {});
  record('EDGE: empty patch rejected', emptyPatch.status === 400);

  const overLimit = await admin.get('/api/v1/users/getAll?limit=101');
  record('EDGE: limit above 100 rejected', overLimit.status === 400);

  const pageZero = await admin.get('/api/v1/users/getAll?page=0');
  record('EDGE: page zero rejected', pageZero.status === 400);

  const xss = await customer.patch('/api/v1/users/updateProfile', {
    name: '<script>alert(1)</script>',
  });
  record('EDGE: XSS payload accepted inertly', xss.status === 200);
  const xssRead = await customer.get('/api/v1/users/getProfile');
  record(
    'EDGE: XSS stored as plain text',
    D_str(xssRead.body?.result?.userData?.name).includes('<script>'),
  );
  await customer.patch('/api/v1/users/updateProfile', { name: 'RC Customer' });

  const sqli = await request(app).get(
    `/api/v1/search/global?q=${encodeURIComponent("' OR '1'='1")}`,
  );
  record('EDGE: SQLi search harmless', sqli.status === 200);

  const longName = await customer.patch('/api/v1/users/updateProfile', { name: 'x'.repeat(200) });
  record('EDGE: overlong name rejected', longName.status === 400);

  const longId = await customer.get(`/api/v1/orders/getById/${'z'.repeat(41)}`);
  record('EDGE: overlong id rejected', longId.status === 400);

  const fakeId = await customer.get(`/api/v1/orders/getById/${'z'.repeat(25)}`);
  record('EDGE: well-formed but fake id 404', fakeId.status === 404);

  const profileEnv = await customer.get('/api/v1/users/getProfile');
  record('EDGE: profile envelope strict', assertEnvelope(profileEnv.body, true));

  const cartEnv = await customer.get('/api/v1/cart/getCart');
  record('EDGE: cart envelope strict', assertEnvelope(cartEnv.body, true));

  const dashEnv = await admin.get('/api/v1/admin/getDashboardStats');
  record('EDGE: dashboard envelope strict', assertEnvelope(dashEnv.body, true));
  record('EDGE: dashboard has no nulls', findNull(dashEnv.body?.result) === null);

  const errorEnv = await customer.get('/api/v1/orders/getById/nope123');
  record('EDGE: error envelope strict', assertEnvelope(errorEnv.body, false));

  const productList = await request(app).get('/api/v1/products/getAll?limit=5');
  record('EDGE: product list has no nulls', findNull(productList.body?.result) === null);
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
const main = async (): Promise<void> => {
  /* eslint-disable no-console */
  const { prisma } = await import('../src/services/prisma.service');
  const { setSetting } = await import('../src/services/settings.service');

  log('Setting up test environment...');

  await setSetting('shipping.enabled', true, 'shipping', undefined, false);
  await setSetting('shipping.defaultCharge', 50, 'shipping', undefined, false);
  await setSetting('shipping.freeAbove', 0, 'shipping', undefined, false);
  await setSetting('payment.cod.enabled', true, 'payment', undefined, false);
  await setSetting('payment.token.enabled', false, 'payment', undefined, false);
  await setSetting('wallet.enabled', false, 'wallet', undefined, false);
  await setSetting('order.minAmount', 0, 'order', undefined, false);

  const adminLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@projectname.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperSecret@123',
    });
  const adminToken = adminLogin.body?.result?.accessToken ?? '';
  record('SETUP: SUPER_ADMIN logged in', adminToken.length > 0);

  const customer = await register('cu', 'CUSTOMER');
  const vendor = await register('ve', 'VENDOR');
  record(
    'SETUP: customer + vendor registered',
    customer.token.length > 0 && vendor.token.length > 0,
  );

  await runAuthDeepWorkflow();
  const { subId } = await runSuperAdminWorkflow(adminToken);
  await runSubAdminWorkflow(adminToken, subId);
  await runUsersAdminWorkflow(adminToken, customer);
  const { productId } = await runVendorWorkflow(vendor.token, vendor.vendorId, adminToken);
  await runVendorAdminWorkflow(
    adminToken,
    vendor.token,
    vendor.vendorId,
    vendor.userId,
    customer.userId,
    productId,
  );
  const catalogIds = await runCatalogWorkflow(adminToken, customer.token, productId);
  await runProductDeepWorkflow(
    adminToken,
    vendor.token,
    vendor.vendorId,
    customer.token,
    catalogIds,
  );
  const { orderId } = await runCustomerWorkflow(
    customer.token,
    customer.userId,
    vendor.vendorId,
    adminToken,
    productId,
  );
  await runCartDeepWorkflow(customer.token, productId);
  await runOrderLifecycleWorkflow(
    adminToken,
    customer.token,
    vendor.token,
    vendor.vendorId,
    productId,
  );
  await runEngagementWorkflow(adminToken, customer.token, customer.userId, productId);
  await runCouponWorkflow(adminToken, customer.token, productId, vendor.token);
  await runContentWorkflow(adminToken, customer.token);
  await runTicketsChatWorkflow(
    adminToken,
    customer.token,
    vendor.token,
    vendor.vendorId,
    vendor.userId,
    subId,
  );
  await runNotificationDeepWorkflow(adminToken, customer.token);
  await runShippingConfigWorkflow(adminToken, customer.token);
  await runSettingsApiWorkflow(adminToken, customer.token);
  await runAdminOpsWorkflow(adminToken, customer.token, customer.userId);
  await runSettingsWorkflow(adminToken, customer.token, productId);
  await runDeliveryBoyWorkflow(adminToken);
  await runSecurityEdgeWorkflow(adminToken, customer.token, vendor.token);

  const cleanup = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      log(`cleanup ${label} skipped: ${(err as Error)?.message ?? err}`);
    }
  };

  const orderIds = (
    await prisma.order.findMany({ where: { userId: customer.userId }, select: { id: true } })
  ).map((o) => o.id);
  await cleanup('returns', () =>
    prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } }),
  );
  await cleanup('refunds', () =>
    prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } }),
  );
  await cleanup('orderTimeline', () =>
    prisma.orderTimeline.deleteMany({ where: { orderId: { in: orderIds } } }),
  );
  await cleanup('orderTags', () =>
    prisma.orderTag.deleteMany({ where: { orderId: { in: orderIds } } }),
  );
  await cleanup('orderNotes', () =>
    prisma.orderNote.deleteMany({ where: { orderId: { in: orderIds } } }),
  );
  await cleanup('deliveries', () =>
    prisma.delivery.deleteMany({ where: { subOrder: { orderId: { in: orderIds } } } }),
  );
  await cleanup('shipments', () =>
    prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } }),
  );
  await cleanup('payments', () =>
    prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } }),
  );
  await cleanup('orderItems', () =>
    prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
  );
  await cleanup('subOrders', () =>
    prisma.subOrder.deleteMany({ where: { orderId: { in: orderIds } } }),
  );
  await cleanup('orders', () => prisma.order.deleteMany({ where: { id: { in: orderIds } } }));
  await cleanup('cartItems', () => prisma.cartItem.deleteMany({ where: { productId } }));
  await cleanup('products', () => prisma.product.deleteMany({ where: { id: productId } }));

  const rcUsers = await prisma.user.findMany({
    where: { email: { contains: run } },
    select: { id: true },
  });
  const rcUserIds = rcUsers.map((u) => u.id);
  const rcVendorRows = await prisma.vendorProfile.findMany({
    where: { userId: { in: rcUserIds } },
    select: { id: true },
  });
  const rcVendorIds = rcVendorRows.map((v) => v.id);
  await cleanup('vendorProducts', () =>
    prisma.product.deleteMany({ where: { vendorId: { in: rcVendorIds } } }),
  );
  await cleanup('deliveryBoys', () =>
    prisma.deliveryBoy.deleteMany({ where: { userId: { in: rcUserIds } } }),
  );
  await cleanup('vendors', () =>
    prisma.vendorProfile.deleteMany({ where: { id: { in: rcVendorIds } } }),
  );
  await cleanup('users', () => prisma.user.deleteMany({ where: { id: { in: rcUserIds } } }));

  await cleanup('categories', () =>
    prisma.category.deleteMany({ where: { name: { contains: run } } }),
  );
  await cleanup('brands', () => prisma.brand.deleteMany({ where: { name: { contains: run } } }));
  await cleanup('tags', () => prisma.tag.deleteMany({ where: { name: { contains: run } } }));
  await cleanup('attributes', () =>
    prisma.attribute.deleteMany({ where: { name: { contains: run } } }),
  );
  await cleanup('collections', () =>
    prisma.collection.deleteMany({ where: { name: { contains: run } } }),
  );
  await cleanup('coupons', () => prisma.coupon.deleteMany({ where: { code: { contains: run } } }));
  await cleanup('flashSales', () =>
    prisma.flashSale.deleteMany({ where: { name: { contains: run } } }),
  );
  await cleanup('giftCards', () =>
    prisma.giftCard.deleteMany({ where: { title: { contains: run } } }),
  );
  await cleanup('pages', () => prisma.page.deleteMany({ where: { title: { contains: run } } }));
  await cleanup('blogs', () => prisma.blog.deleteMany({ where: { title: { contains: run } } }));
  await cleanup('faqs', () => prisma.faq.deleteMany({ where: { question: { contains: 'RC' } } }));
  await cleanup('banners', () => prisma.banner.deleteMany({ where: { title: { contains: run } } }));
  await cleanup('taxes', () => prisma.taxConfig.deleteMany({ where: { name: { contains: run } } }));
  await cleanup('currencies', () => prisma.currency.deleteMany({ where: { code: 'RCT' } }));
  await cleanup('i18n', () => prisma.translation.deleteMany({ where: { locale: 'rc' } }));
  await cleanup('ticketCategories', () =>
    prisma.ticketCategory.deleteMany({ where: { name: { contains: run } } }),
  );
  await cleanup('shippingZones', () =>
    prisma.shippingZone.deleteMany({ where: { name: { contains: run } } }),
  );
  await cleanup('shippingMethods', () =>
    prisma.shippingMethod.deleteMany({ where: { name: { contains: 'RC' } } }),
  );
  await cleanup('shippingPartners', () =>
    prisma.shippingPartner.deleteMany({ where: { code: { contains: run } } }),
  );
  await cleanup('settings', () =>
    prisma.systemSetting.deleteMany({ where: { key: { startsWith: 'rc.' } } }),
  );
  await cleanup('returnReasons', () =>
    prisma.returnReason.deleteMany({ where: { title: { contains: run } } }),
  );

  await setSetting('shipping.freeAbove', 999, 'shipping', undefined, false);

  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed);

  const summary = `\n${'='.repeat(80)}\n  ${passed}/${checks.length} checks passed\n${'='.repeat(80)}\n`;
  console.log(summary);
  log(summary);

  if (failed.length) {
    const failList = failed.map((f) => `   - ${f.name} — ${f.detail}`).join('\n');
    console.log('  Failures:\n' + failList);
    log('  Failures:\n' + failList);
  }

  log(`\nFinished: ${new Date().toISOString()}`);
  log(`Log file: ${LOG_FILE}`);

  await prisma.$disconnect();
  if (failed.length) process.exitCode = 1;
  /* eslint-enable no-console */
};

void main().catch((err) => {
  /* eslint-disable no-console */
  console.error('[e2e-role-complete] crashed:', err);
  log(`\nCRASHED: ${err?.message ?? err}`);
  process.exit(1);
});
