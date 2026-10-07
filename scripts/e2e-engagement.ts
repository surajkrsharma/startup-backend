import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

const OTP = process.env.OTP_STATIC_CODE || '111111';

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];
const record = (name: string, passed: boolean, detail = '') => {
  checks.push({ name, passed, detail });
  /* eslint-disable no-console */
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
  /* eslint-enable no-console */
};

const run = Date.now().toString().slice(-9);
const email = (tag: string) => `eg_${tag}_${run}@projectname.com`;
const phoneFor = (tag: string): string => {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) % 100;
  return `+7${run}${String(hash).padStart(2, '0')}`;
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

const envelope = (res: any, label: string): boolean => {
  const keys = Object.keys(res.body ?? {});
  const ordered =
    JSON.stringify(keys.slice(0, 3)) === JSON.stringify(['status', 'message', 'result']);
  const shaped = typeof res.body?.status === 'boolean' && typeof res.body?.message === 'string';
  const resultOk = res.body?.result !== null && typeof res.body?.result === 'object';
  const nullHit = findNull(res.body);

  record(
    `${label} envelope is strict`,
    ordered && shaped && resultOk && nullHit === null,
    nullHit ? `null at ${nullHit}` : `keys=${keys.join(',')}`,
  );

  return ordered && shaped && resultOk && nullHit === null;
};

const register = async (tag: string): Promise<{ token: string; userId: string }> => {
  await request(app)
    .post('/api/v1/auth/register/sendOtp')
    .send({ identifier: email(tag) });

  const verified = await request(app)
    .post('/api/v1/auth/register/verifyOtp')
    .send({ identifier: email(tag), otp: OTP });

  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type: 'CUSTOMER',
      name: `EG ${tag}`,
      verificationToken: verified.body?.result?.verificationToken ?? '',
      email: email(tag),
      phone: phoneFor(tag),
      password: 'Secret@123',
    });

  return {
    token: res.body?.result?.accessToken ?? '',
    userId: res.body?.result?.userData?.userId ?? '',
  };
};

const api = (token: string) => ({
  get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string, b?: any) =>
    request(app)
      .post(p)
      .set('Authorization', `Bearer ${token}`)
      .send(b ?? {}),
  patch: (p: string, b?: any) =>
    request(app)
      .patch(p)
      .set('Authorization', `Bearer ${token}`)
      .send(b ?? {}),
  del: (p: string) => request(app).del(p).set('Authorization', `Bearer ${token}`),
});

const FEATURE_KEYS = {
  loyaltyEnabled: 'loyalty.enabled',
  pointsPerRupee: 'loyalty.pointsPerRupee',
  pointValue: 'loyalty.pointValue',
  minRedeemPoints: 'loyalty.minRedeemPoints',
  referralEnabled: 'referral.enabled',
  referrerReward: 'referral.referrerReward',
  refereeReward: 'referral.refereeReward',
  expiryDays: 'referral.expiryDays',
  giftCardEnabled: 'giftCard.enabled',
  minAmount: 'giftCard.minAmount',
  maxAmount: 'giftCard.maxAmount',
};

const main = async (): Promise<void> => {
  /* eslint-disable no-console */
  const { prisma } = await import('../src/services/prisma.service');

  const alice = await register('al');
  const bob = await register('bo');
  const carol = await register('ca');

  const adminToken = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@projectname.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperSecret@123',
    })
    .then((r) => r.body?.result?.accessToken ?? '');

  record('bootstrap tokens', Boolean(adminToken && alice.token && bob.token && carol.token));

  if (!adminToken) {
    throw new Error(
      'SUPER_ADMIN login failed. If the shared database was reset, run `npm run seed` before this suite.',
    );
  }

  const admin = api(adminToken);

  const baseline: Record<string, any> = {};
  for (const key of Object.values(FEATURE_KEYS)) {
    const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    baseline[key] = row?.value;
  }

  const setSetting = async (key: string, value: any) => {
    const res = await admin.patch('/api/v1/settings/updateSetting', { key, value });
    return res;
  };

  const turnOn = async (key: string, value: any, label: string) => {
    const res = await setSetting(key, value);
    record(
      `${label} is enabled`,
      res.status === 200,
      `status=${res.status} msg=${res.body?.message}`,
    );
  };

  await turnOn(FEATURE_KEYS.loyaltyEnabled, true, 'loyalty.enabled');
  await turnOn(FEATURE_KEYS.pointsPerRupee, 1, 'loyalty.pointsPerRupee');
  await turnOn(FEATURE_KEYS.pointValue, 0.01, 'loyalty.pointValue');
  await turnOn(FEATURE_KEYS.minRedeemPoints, 100, 'loyalty.minRedeemPoints');
  await turnOn(FEATURE_KEYS.referralEnabled, true, 'referral.enabled');
  await turnOn(FEATURE_KEYS.referrerReward, 75, 'referral.referrerReward');
  await turnOn(FEATURE_KEYS.refereeReward, 50, 'referral.refereeReward');
  await turnOn(FEATURE_KEYS.expiryDays, 30, 'referral.expiryDays');
  await turnOn(FEATURE_KEYS.giftCardEnabled, true, 'giftCard.enabled');
  await turnOn(FEATURE_KEYS.minAmount, 100, 'giftCard.minAmount');
  await turnOn(FEATURE_KEYS.maxAmount, 50000, 'giftCard.maxAmount');

  const al = api(alice.token);

  const tiers = await al.get('/api/v1/loyalty/getTiers');
  record('GET /loyalty/getTiers -> 200', tiers.status === 200, `status=${tiers.status}`);
  envelope(tiers, 'GET /loyalty/getTiers');
  record(
    'the tier table is returned',
    D_arr(tiers.body?.result?.itemList).length === 5,
    `count=${D_arr(tiers.body?.result?.itemList).length}`,
  );
  record(
    'every tier carries a threshold and multiplier',
    D_arr(tiers.body?.result?.itemList).every(
      (t: any) => D_num(t?.minPoints) >= 0 && D_num(t?.multiplier) >= 1,
    ),
    JSON.stringify(D_arr(tiers.body?.result?.itemList)[1]),
  );

  const summary = await al.get('/api/v1/loyalty/getPoints');
  record('GET /loyalty/getSummary -> 200', summary.status === 200, `status=${summary.status}`);
  envelope(summary, 'GET /loyalty/getSummary');
  record(
    'a new account starts on the base tier with zero points',
    D_str(summary.body?.result?.tier) === 'BRONZE' && D_num(summary.body?.result?.balance) === 0,
    JSON.stringify({ tier: summary.body?.result?.tier, balance: summary.body?.result?.balance }),
  );
  record('the summary reports the feature is on', summary.body?.result?.isEnabled === true);

  const noAuth = await request(app).get('/api/v1/loyalty/getPoints');
  record(
    'the loyalty summary needs a token -> 401',
    noAuth.status === 401,
    `status=${noAuth.status}`,
  );

  const grant = await admin.post(`/api/v1/loyalty/adjust/${alice.userId}`, {
    points: 1200,
    description: 'Test grant',
  });
  record(
    'POST /loyalty/adjust/:userId -> 200',
    grant.status === 200,
    `status=${grant.status} msg=${grant.body?.message}`,
  );
  record(
    'the balance reflects the grant',
    D_num(grant.body?.result?.balanceAfter) === 1200,
    JSON.stringify(grant.body?.result),
  );

  const afterGrant = await al.get('/api/v1/loyalty/getPoints');
  record(
    'the tier follows the balance',
    D_str(afterGrant.body?.result?.tier) === 'SILVER',
    D_str(afterGrant.body?.result?.tier),
  );
  record(
    'the distance to the next tier is reported',
    D_num(afterGrant.body?.result?.pointsToNextTier) === 800,
    String(D_num(afterGrant.body?.result?.pointsToNextTier)),
  );
  record(
    'the next tier is named',
    D_str(afterGrant.body?.result?.nextTier) === 'GOLD',
    D_str(afterGrant.body?.result?.nextTier),
  );
  record(
    'the redeemable amount uses the configured point value',
    D_num(afterGrant.body?.result?.redeemableAmount) === 12,
    String(D_num(afterGrant.body?.result?.redeemableAmount)),
  );

  const bigGrant = await admin.post(`/api/v1/loyalty/adjust/${alice.userId}`, {
    points: 10000,
    description: 'Big grant',
  });
  record(
    'a large grant jumps to the top tier',
    D_num(bigGrant.body?.result?.balanceAfter) === 11200 &&
      D_str(bigGrant.body?.result?.tier) === 'DIAMOND',
    JSON.stringify(bigGrant.body?.result),
  );
  const topTier = await al.get('/api/v1/loyalty/getPoints');
  record(
    'the top tier reports nothing left to reach',
    D_num(topTier.body?.result?.pointsToNextTier) === 0,
    String(D_num(topTier.body?.result?.pointsToNextTier)),
  );

  const clawback = await admin.post(`/api/v1/loyalty/adjust/${alice.userId}`, {
    points: -11200,
    description: 'Reversal',
  });
  record(
    'a negative adjustment claws the balance back to zero',
    D_num(clawback.body?.result?.balanceAfter) === 0 &&
      D_str(clawback.body?.result?.tier) === 'BRONZE',
    JSON.stringify(clawback.body?.result),
  );

  const overdraw = await admin.post(`/api/v1/loyalty/adjust/${alice.userId}`, {
    points: -50,
    description: 'Too much',
  });
  record(
    'clawing back more than the balance -> 422',
    overdraw.status === 422,
    `status=${overdraw.status} msg=${overdraw.body?.message}`,
  );

  await admin.post(`/api/v1/loyalty/adjust/${alice.userId}`, {
    points: 1200,
    description: 'Test grant',
  });

  const zero = await admin.post(`/api/v1/loyalty/adjust/${alice.userId}`, {
    points: 0,
    description: 'Nothing',
  });
  record('a zero-point adjustment -> 400', zero.status === 400, `status=${zero.status}`);

  const unknownUser = await admin.post('/api/v1/loyalty/adjust/clzzzzzzzzzzzzzzzzzzzzzz', {
    points: 10,
  });
  record(
    'adjusting an unknown user -> 404',
    unknownUser.status === 404,
    `status=${unknownUser.status}`,
  );

  const grantAsCustomer = await al.post(`/api/v1/loyalty/adjust/${bob.userId}`, { points: 10 });
  record(
    'a customer cannot adjust points -> 403',
    grantAsCustomer.status === 403,
    `status=${grantAsCustomer.status}`,
  );

  const tooFew = await al.post('/api/v1/loyalty/redeem', { points: 10 });
  record(
    'redeeming under the minimum -> 422',
    tooFew.status === 422,
    `status=${tooFew.status} msg=${tooFew.body?.message}`,
  );

  const tooMany = await al.post('/api/v1/loyalty/redeem', { points: 99999 });
  record(
    'redeeming more than the balance -> 422',
    tooMany.status === 422,
    `status=${tooMany.status} msg=${tooMany.body?.message}`,
  );

  const noPoints = await al.post('/api/v1/loyalty/redeem', { points: 0 });
  record('redeeming zero points -> 400', noPoints.status === 400, `status=${noPoints.status}`);

  const redeem = await al.post('/api/v1/loyalty/redeem', { points: 500 });
  record(
    'POST /loyalty/redeem -> 200',
    redeem.status === 200,
    `status=${redeem.status} msg=${redeem.body?.message}`,
  );
  record(
    'the balance drops by the redeemed points',
    D_num(redeem.body?.result?.balanceAfter) === 700,
    JSON.stringify(redeem.body?.result),
  );
  record(
    'the cash value uses the point value',
    D_num(redeem.body?.result?.amount) === 5,
    String(D_num(redeem.body?.result?.amount)),
  );

  const history = await al.get('/api/v1/loyalty/getHistory');
  record('GET /loyalty/getHistory -> 200', history.status === 200, `status=${history.status}`);
  envelope(history, 'GET /loyalty/getHistory');
  const historyRows = D_arr(history.body?.result?.itemList);
  record('every ledger row is present', historyRows.length >= 3, `count=${historyRows.length}`);
  record(
    'the newest entry is the redemption',
    D_str(historyRows[0]?.type) === 'REDEEM',
    D_str(historyRows[0]?.type),
  );
  record(
    'a redemption is stored as a negative entry',
    D_num(historyRows[0]?.points) === -500,
    String(D_num(historyRows[0]?.points)),
  );
  record(
    'the ledger carries a running balanceAfter',
    D_num(historyRows[0]?.balanceAfter) === 700,
    String(D_num(historyRows[0]?.balanceAfter)),
  );

  const walk = [...historyRows]
    .reverse()
    .reduce((sum: number, t: any) => sum + D_num(t?.points), 0);
  record(
    'the rows sum to the reported balance',
    walk === D_num((await al.get('/api/v1/loyalty/getPoints')).body?.result?.balance),
    `walk=${walk}`,
  );

  const byType = await al.get('/api/v1/loyalty/getHistory?type=ADJUSTMENT');
  record(
    'the ledger filters on type',
    D_arr(byType.body?.result?.itemList).every((t: any) => D_str(t?.type) === 'ADJUSTMENT'),
    `count=${D_arr(byType.body?.result?.itemList).length}`,
  );

  const badType = await al.get('/api/v1/loyalty/getHistory?type=NOPE');
  record('an unknown ledger type -> 400', badType.status === 400, `status=${badType.status}`);

  await setSetting(FEATURE_KEYS.loyaltyEnabled, false);
  const redeemOff = await al.post('/api/v1/loyalty/redeem', { points: 100 });
  record(
    'redeeming with loyalty disabled -> 403',
    redeemOff.status === 403,
    `status=${redeemOff.status} msg=${redeemOff.body?.message}`,
  );
  await setSetting(FEATURE_KEYS.loyaltyEnabled, true);

  const alSummary = await al.get('/api/v1/referral/getMyCode');
  record(
    'GET /referrals/getSummary -> 200',
    alSummary.status === 200,
    `status=${alSummary.status}`,
  );
  envelope(alSummary, 'GET /referrals/getSummary');
  const alCode = D_str(alSummary.body?.result?.referralCode);
  record(
    'a referral code is issued on demand',
    alCode.startsWith('REF') && alCode.length >= 8,
    alCode,
  );

  const again = await al.get('/api/v1/referral/getMyCode');
  record(
    'asking again returns the same code',
    D_str(again.body?.result?.referralCode) === alCode,
    D_str(again.body?.result?.referralCode),
  );

  const boCodeRes = await api(bob.token).get('/api/v1/referral/getMyCode');
  const boCode = D_str(boCodeRes.body?.result?.referralCode);
  record('two users get different codes', boCode.length > 0 && boCode !== alCode, boCode);

  const selfRef = await al.post('/api/v1/referral/applyCode', { referralCode: alCode });
  record(
    'using your own code -> 400',
    selfRef.status === 400,
    `status=${selfRef.status} msg=${selfRef.body?.message}`,
  );

  const badCode = await api(bob.token).post('/api/v1/referral/applyCode', {
    referralCode: 'REFNOTREAL',
  });
  record(
    'an unknown code -> 404',
    badCode.status === 404,
    `status=${badCode.status} msg=${badCode.body?.message}`,
  );

  const shortCode = await api(bob.token).post('/api/v1/referral/applyCode', { referralCode: 'AB' });
  record('a too-short code -> 400', shortCode.status === 400, `status=${shortCode.status}`);

  const applied = await api(bob.token).post('/api/v1/referral/applyCode', { referralCode: alCode });
  record(
    'POST /referrals/apply -> 200',
    applied.status === 200,
    `status=${applied.status} msg=${applied.body?.message}`,
  );
  envelope(applied, 'POST /referrals/apply');
  const referralId = D_str(applied.body?.result?.referralId);
  record(
    'the referral starts pending',
    D_str(applied.body?.result?.status) === 'PENDING',
    D_str(applied.body?.result?.status),
  );
  record(
    'both rewards are snapshotted onto the referral',
    D_num(applied.body?.result?.referrerReward) === 75 &&
      D_num(applied.body?.result?.refereeReward) === 50,
    JSON.stringify(applied.body?.result),
  );
  record(
    'an expiry is set from the configured window',
    D_str(applied.body?.result?.expiresAt).length > 0,
    D_str(applied.body?.result?.expiresAt),
  );

  const twice = await api(bob.token).post('/api/v1/referral/applyCode', { referralCode: alCode });
  record(
    'applying a second code -> 409',
    twice.status === 409,
    `status=${twice.status} msg=${twice.body?.message}`,
  );

  const carolApply = await api(carol.token).post('/api/v1/referral/applyCode', {
    referralCode: boCode,
  });
  record(
    'a different user can use a different code',
    carolApply.status === 200,
    `status=${carolApply.status}`,
  );

  const myRefs = await al.get('/api/v1/referral/getRewards');
  record('GET /referrals/getAll -> 200', myRefs.status === 200, `status=${myRefs.status}`);
  envelope(myRefs, 'GET /referrals/getAll');
  const myRefRows = D_arr(myRefs.body?.result?.itemList);
  record(
    'the referrer sees the applied referral',
    myRefRows.length === 1,
    `count=${myRefRows.length}`,
  );
  record(
    'the referral row carries the referee',
    D_str(myRefRows[0]?.userData?.email) === email('bo'),
    D_str(myRefRows[0]?.userData?.email),
  );

  const codeRowHidden = await al.get('/api/v1/referral/getRewards');
  record(
    'the bare code row is never listed as a referral',
    D_arr(codeRowHidden.body?.result?.itemList).every(
      (r: any) => D_str(r?.userData?.userId) !== '',
    ),
    'all rows have a referee',
  );

  const bobRefs = await api(bob.token).get('/api/v1/referral/getRewards');
  record(
    'a user sees only the referrals they made',
    D_arr(bobRefs.body?.result?.itemList).length === 1,
    `count=${D_arr(bobRefs.body?.result?.itemList).length}`,
  );
  record(
    "a user does not see another referrer's referrals",
    !D_arr(bobRefs.body?.result?.itemList).some(
      (r: any) => D_str(r?.userData?.email) === email('bo'),
    ),
    JSON.stringify(
      D_arr(bobRefs.body?.result?.itemList).map((r: any) => D_str(r?.userData?.email)),
    ),
  );

  const adminRefs = await admin.get('/api/v1/referral/admin/getAll');
  record(
    'GET /referrals/admin/getAll -> 200 (admin)',
    adminRefs.status === 200,
    `status=${adminRefs.status}`,
  );
  record(
    'the admin queue sees both applied referrals',
    D_arr(adminRefs.body?.result?.itemList).length === 2,
    `count=${D_arr(adminRefs.body?.result?.itemList).length}`,
  );

  const adminRefsAsCustomer = await al.get('/api/v1/referral/admin/getAll');
  record(
    'a customer cannot read the admin queue -> 403',
    adminRefsAsCustomer.status === 403,
    `status=${adminRefsAsCustomer.status}`,
  );

  const completeAsCustomer = await al.post(`/api/v1/referral/complete/${referralId}`);
  record(
    'a customer cannot settle a referral -> 403',
    completeAsCustomer.status === 403,
    `status=${completeAsCustomer.status}`,
  );

  const settled = await admin.post(`/api/v1/referral/complete/${referralId}`);
  record(
    'POST /referrals/:id/complete -> 200',
    settled.status === 200,
    `status=${settled.status} msg=${settled.body?.message}`,
  );
  record(
    'the referral is completed with both rewards',
    D_str(settled.body?.result?.status) === 'COMPLETED' &&
      D_num(settled.body?.result?.referrerReward) === 75,
    JSON.stringify(settled.body?.result),
  );

  const settledTwice = await admin.post(`/api/v1/referral/complete/${referralId}`);
  record(
    'settling twice is idempotent',
    settledTwice.status === 200 && settledTwice.body?.result?.alreadyCompleted === true,
    JSON.stringify(settledTwice.body?.result),
  );

  const walletCheck = await prisma.walletTransaction.count({
    where: { reference: `referral_${referralId}` },
  });
  record('exactly two wallet credits were written', walletCheck === 2, `rows=${walletCheck}`);

  const summaryAfter = await al.get('/api/v1/referral/getMyCode');
  record(
    'the referrer sees the completed count and reward',
    D_num(summaryAfter.body?.result?.completedCount) === 1 &&
      D_num(summaryAfter.body?.result?.totalEarned) === 75,
    JSON.stringify(summaryAfter.body?.result),
  );

  const leaderboard = await al.get('/api/v1/referral/getLeaderboard');
  record(
    'GET /referrals/leaderboard -> 200',
    leaderboard.status === 200,
    `status=${leaderboard.status}`,
  );
  envelope(leaderboard, 'GET /referrals/leaderboard');
  const board = D_arr(leaderboard.body?.result?.itemList);
  record(
    'the referrer is ranked first',
    D_num(board[0]?.completedCount) === 1 && D_num(board[0]?.totalEarned) === 75,
    JSON.stringify(board[0]),
  );

  const reject = await admin.patch(
    `/api/v1/referral/updateStatus/${D_str(carolApply.body?.result?.referralId)}`,
    { status: 'REJECTED' },
  );
  record(
    'PATCH /referral/updateStatus/:id -> 200',
    reject.status === 200 && D_str(reject.body?.result?.status) === 'REJECTED',
    `status=${reject.status}`,
  );

  const badStatus = await admin.patch(`/api/v1/referral/updateStatus/${referralId}`, {
    status: 'NOPE',
  });
  record(
    'an unsupported referral status -> 400',
    badStatus.status === 400,
    `status=${badStatus.status}`,
  );

  await setSetting(FEATURE_KEYS.referralEnabled, false);
  const applyOff = await api(carol.token).post('/api/v1/referral/applyCode', {
    referralCode: alCode,
  });
  record(
    'applying a code with referrals disabled -> 403',
    applyOff.status === 403,
    `status=${applyOff.status}`,
  );
  await setSetting(FEATURE_KEYS.referralEnabled, true);

  const alBalance = await al.get('/api/v1/wallet/getBalance');
  record('GET /wallet/getBalance -> 200', alBalance.status === 200, `status=${alBalance.status}`);
  envelope(alBalance, 'GET /wallet/getBalance');
  record(
    'the wallet holds exactly the referral reward credited earlier',
    D_num(alBalance.body?.result?.balance) === 75,
    JSON.stringify(alBalance.body?.result),
  );
  const walletBeforeCards = D_num(alBalance.body?.result?.balance);

  const issue = await admin.post('/api/v1/giftCards/create', {
    title: `Test Card ${run}`,
    description: 'Issued by the e2e suite',
    value: 1000,
    userId: alice.userId,
  });
  record(
    'POST /gift-cards/create -> 201',
    issue.status === 201,
    `status=${issue.status} msg=${issue.body?.message}`,
  );
  envelope(issue, 'POST /gift-cards/create');
  const cardCode = D_str(issue.body?.result?.code);
  const cardId = D_str(issue.body?.result?.giftCardId);
  record(
    'a code is generated when none is supplied',
    cardCode.startsWith('GC') && cardCode.length >= 10,
    cardCode,
  );
  record(
    'the card starts active at full value',
    D_str(issue.body?.result?.status) === 'ACTIVE' && D_num(issue.body?.result?.value) === 1000,
    JSON.stringify(issue.body?.result),
  );
  record(
    'the card is assigned to its owner',
    D_str(issue.body?.result?.userId) === alice.userId,
    D_str(issue.body?.result?.userId),
  );

  const custom = await admin.post('/api/v1/giftCards/create', {
    value: 500,
    code: `CUSTOM${run}`,
  });
  record(
    'a custom code is accepted',
    custom.status === 201 && D_str(custom.body?.result?.code) === `CUSTOM${run}`,
    D_str(custom.body?.result?.code),
  );

  const dupCode = await admin.post('/api/v1/giftCards/create', {
    value: 500,
    code: `CUSTOM${run}`,
  });
  record('a duplicate code -> 409', dupCode.status === 409, `status=${dupCode.status}`);

  const tooSmall = await admin.post('/api/v1/giftCards/create', { value: 10 });
  record(
    'a value under the configured minimum -> 400',
    tooSmall.status === 400,
    `status=${tooSmall.status} msg=${tooSmall.body?.message}`,
  );

  const tooBig = await admin.post('/api/v1/giftCards/create', { value: 999999 });
  record(
    'a value over the configured maximum -> 400',
    tooBig.status === 400,
    `status=${tooBig.status}`,
  );

  const zeroValue = await admin.post('/api/v1/giftCards/create', { value: 0 });
  record('a zero-value card -> 400', zeroValue.status === 400, `status=${zeroValue.status}`);

  const issueAsCustomer = await al.post('/api/v1/giftCards/create', { value: 100 });
  record(
    'a customer cannot issue a gift card -> 403',
    issueAsCustomer.status === 403,
    `status=${issueAsCustomer.status}`,
  );

  const mine = await admin.get('/api/v1/giftCards/getAll');
  record('GET /giftCards/getAll -> 200 (admin)', mine.status === 200, `status=${mine.status}`);
  envelope(mine, 'GET /giftCards/getAll');
  record(
    'the issued card is listed',
    D_arr(mine.body?.result?.itemList).some((c: any) => D_str(c?.code) === cardCode),
    `count=${D_arr(mine.body?.result?.itemList).length}`,
  );

  const listAsCustomer = await al.get('/api/v1/giftCards/getAll');
  record(
    'a customer cannot list every card -> 403',
    listAsCustomer.status === 403,
    `status=${listAsCustomer.status}`,
  );

  const notMine = await admin.get(`/api/v1/giftCards/getAll?search=${cardCode}`);
  record(
    "another user's card is not reachable without the code",
    notMine.status === 200 &&
      D_arr(notMine.body?.result?.itemList).every((c: any) => D_str(c?.code) !== 'GCDOESNOTEXIST'),
    `count=${D_arr(notMine.body?.result?.itemList).length}`,
  );

  const checked = await al.get(`/api/v1/giftCards/checkBalance/${cardCode}`);
  record('GET /gift-cards/check -> 200', checked.status === 200, `status=${checked.status}`);
  envelope(checked, 'GET /gift-cards/check');
  record(
    'the balance lookup reports the full value',
    D_num(checked.body?.result?.balance) === 1000 && checked.body?.result?.isValid === true,
    JSON.stringify(checked.body?.result),
  );
  record(
    'the lookup never reveals the owner',
    checked.body?.result?.userId === undefined,
    JSON.stringify(checked.body?.result?.userId),
  );

  const checkBad = await al.get('/api/v1/giftCards/checkBalance/GCDOESNOTEXIST');
  record('an unknown gift card code -> 404', checkBad.status === 404, `status=${checkBad.status}`);

  const partial = await al.post('/api/v1/giftCards/redeem', { code: cardCode, amount: 400 });
  record(
    'POST /gift-cards/redeem with a partial amount -> 200',
    partial.status === 200,
    `status=${partial.status} msg=${partial.body?.message}`,
  );
  record(
    'only the requested amount is taken',
    D_num(partial.body?.result?.redeemedAmount) === 400,
    JSON.stringify(partial.body?.result),
  );
  record(
    'the remainder stays on the card',
    D_num(partial.body?.result?.remainingBalance) === 600,
    String(D_num(partial.body?.result?.remainingBalance)),
  );
  record(
    'a partially used card is still active',
    partial.body?.result?.isFullyRedeemed === false &&
      D_str(partial.body?.result?.status) === 'ACTIVE',
    D_str(partial.body?.result?.status),
  );

  const overRedeem = await al.post('/api/v1/giftCards/redeem', { code: cardCode, amount: 99999 });
  record(
    'redeeming more than the balance caps at the remainder',
    D_num(overRedeem.body?.result?.redeemedAmount) === 600,
    JSON.stringify(overRedeem.body?.result),
  );

  const spentTwice = await al.post('/api/v1/giftCards/redeem', { code: cardCode, amount: 1 });
  record(
    'redeeming a spent card -> 422',
    spentTwice.status === 422,
    `status=${spentTwice.status} msg=${spentTwice.body?.message}`,
  );

  const balanceAfter = await al.get('/api/v1/wallet/getBalance');
  record(
    'the balance reflects the redemption',
    D_num(balanceAfter.body?.result?.balance) === walletBeforeCards,
    `before=${walletBeforeCards} after=${balanceAfter.body?.result?.balance}`,
  );

  const disabledCard = await admin.post('/api/v1/giftCards/create', { value: 200 });
  const disabledCode = D_str(disabledCard.body?.result?.code);
  const disable = await admin.patch(
    `/api/v1/giftCards/disable/${D_str(disabledCard.body?.result?.giftCardId)}`,
  );
  record(
    'PATCH /giftCards/disable/:id -> 200',
    disable.status === 200 && D_str(disable.body?.result?.status) === 'DISABLED',
    `status=${disable.status}`,
  );
  record(
    'a disabled card cannot be redeemed',
    (await al.post('/api/v1/giftCards/redeem', { code: disabledCode })).status === 403,
  );
  record(
    'a disabled card cannot be redeemed',
    (await al.post('/api/v1/giftCards/redeem', { code: disabledCode })).status === 403,
  );

  const checkDisabled = await al.get(`/api/v1/giftCards/checkBalance/${disabledCode}`);
  record(
    'a disabled card checks as invalid',
    checkDisabled.body?.result?.isValid === false,
    JSON.stringify(checkDisabled.body?.result),
  );

  const expiredCard = await admin.post('/api/v1/giftCards/create', {
    value: 200,
    expiresInDays: 1,
  });
  const expiredCode = D_str(expiredCard.body?.result?.code);
  await prisma.giftCard.update({
    where: { code: expiredCode },
    data: { expiresAt: new Date(Date.now() - 86_400_000) },
  });
  const redeemExpired = await al.post('/api/v1/giftCards/redeem', { code: expiredCode });
  record(
    'an expired card cannot be redeemed -> 422',
    redeemExpired.status === 422,
    `status=${redeemExpired.status} msg=${redeemExpired.body?.message}`,
  );

  const checkExpired = await al.get(`/api/v1/giftCards/checkBalance/${expiredCode}`);
  record(
    'an expired card reports isExpired',
    checkExpired.body?.result?.isExpired === true,
    JSON.stringify(checkExpired.body?.result),
  );

  const adminCards = await admin.get('/api/v1/giftCards/getAll');
  record(
    'the admin listing includes the disabled and expired cards',
    adminCards.status === 200 && D_arr(adminCards.body?.result?.itemList).length >= 3,
    `status=${adminCards.status} count=${D_arr(adminCards.body?.result?.itemList).length}`,
  );

  const deleteSpent = await admin.del(`/api/v1/giftCards/delete/${cardId}`);
  record(
    'a redeemed card is kept for accounting -> 422',
    deleteSpent.status === 422,
    `status=${deleteSpent.status} msg=${deleteSpent.body?.message}`,
  );

  const deleteOk = await admin.del(
    `/api/v1/giftCards/delete/${D_str(disabledCard.body?.result?.giftCardId)}`,
  );
  record(
    'DELETE /giftCards/delete/:id -> 200',
    deleteOk.status === 200,
    `status=${deleteOk.status}`,
  );
  const deleteAgain = await admin.del(
    `/api/v1/giftCards/delete/${D_str(disabledCard.body?.result?.giftCardId)}`,
  );
  record(
    'deleting a gift card twice -> 404',
    deleteAgain.status === 404,
    `status=${deleteAgain.status}`,
  );

  await setSetting(FEATURE_KEYS.giftCardEnabled, false);
  const issueOff = await admin.post('/api/v1/giftCards/create', { value: 100 });
  record(
    'issuing a card with the feature off -> 403',
    issueOff.status === 403,
    `status=${issueOff.status}`,
  );
  await setSetting(FEATURE_KEYS.giftCardEnabled, true);

  const emailUpsert = await admin.post('/api/v1/templates/email/upsert', {
    key: `order.shipped.${run}`,
    name: 'Order shipped',
    subject: 'Order {{orderNumber}} has shipped',
    htmlBody: '<p>Hello {{name}}, your order is on the way.</p>',
    textBody: 'Hello {{name}}, order {{orderNumber}} shipped.',
    variables: ['name', 'orderNumber'],
  });
  record(
    'POST /templates/email/upsert -> 200',
    emailUpsert.status === 200,
    `status=${emailUpsert.status} msg=${emailUpsert.body?.message}`,
  );
  envelope(emailUpsert, 'POST /templates/email/upsert');
  const emailKey = D_str(emailUpsert.body?.result?.key);

  const render = await admin.post(`/api/v1/templates/email/${emailKey}/render`, {
    values: { name: 'Ayesha', orderNumber: 'ORD-1' },
  });
  record(
    'POST /templates/email/:key/render -> 200',
    render.status === 200,
    `status=${render.status}`,
  );
  envelope(render, 'templates render');
  record(
    'every placeholder is substituted',
    D_str(render.body?.result?.subject) === 'Order ORD-1 has shipped',
    D_str(render.body?.result?.subject),
  );
  record(
    'the html body is rendered too',
    D_str(render.body?.result?.htmlBody).includes('Hello Ayesha'),
    D_str(render.body?.result?.htmlBody),
  );
  record(
    'the text body is rendered too',
    D_str(render.body?.result?.textBody) === 'Hello Ayesha, order ORD-1 shipped.',
    D_str(render.body?.result?.textBody),
  );
  record(
    'nothing is left unrendered',
    !D_str(render.body?.result?.htmlBody).includes('{{'),
    D_str(render.body?.result?.htmlBody),
  );
  record(
    'no variables are missing',
    D_arr(render.body?.result?.missingVariables).length === 0,
    JSON.stringify(render.body?.result?.missingVariables),
  );

  const emailUpsertAgain = await admin.post('/api/v1/templates/email/upsert', {
    key: `order.shipped.${run}`,
    name: 'Order shipped v2',
    subject: 'Updated {{orderNumber}}',
    htmlBody: '<p>{{name}}</p>',
  });
  record(
    'upserting the same key updates in place',
    emailUpsertAgain.status === 200 &&
      D_str(emailUpsertAgain.body?.result?.name) === 'Order shipped v2',
    D_str(emailUpsertAgain.body?.result?.name),
  );

  const renderUpdated = await admin.post(`/api/v1/templates/email/${emailKey}/render`, {
    values: { name: 'Ayesha', orderNumber: 'ORD-2' },
  });
  record(
    'the update replaced the subject',
    D_str(renderUpdated.body?.result?.subject) === 'Updated ORD-2',
    D_str(renderUpdated.body?.result?.subject),
  );
  record(
    'an omitted field is left as it was',
    D_str(renderUpdated.body?.result?.textBody).includes('ORD-2'),
    D_str(renderUpdated.body?.result?.textBody),
  );

  const emailList = await admin.get('/api/v1/templates/email/getAll');
  record(
    'GET /templates/email/getAll -> 200',
    emailList.status === 200,
    `status=${emailList.status}`,
  );
  envelope(emailList, 'GET /templates/email/getAll');
  record(
    'the template is listed once',
    D_arr(emailList.body?.result?.itemList).filter((t: any) => D_str(t?.key) === emailKey)
      .length === 1,
  );

  const renderPartial = await admin.post(`/api/v1/templates/email/${emailKey}/render`, {
    values: { name: 'Ayesha' },
  });
  record(
    'a missing variable is flagged, not silently blank',
    D_arr(renderPartial.body?.result?.missingVariables).includes('orderNumber'),
    JSON.stringify(renderPartial.body?.result?.missingVariables),
  );
  record(
    'an unmatched placeholder stays visible',
    D_str(renderPartial.body?.result?.subject).includes('{{orderNumber}}'),
    D_str(renderPartial.body?.result?.subject),
  );

  const renderUnknown = await admin.post('/api/v1/templates/email/no.such.template/render', {
    values: {},
  });
  record(
    'rendering an unknown template -> 404',
    renderUnknown.status === 404,
    `status=${renderUnknown.status}`,
  );

  const badKey = await admin.post('/api/v1/templates/email/upsert', {
    key: 'Not A Key',
    subject: 'x',
    htmlBody: 'y',
  });
  record('a malformed template key -> 400', badKey.status === 400, `status=${badKey.status}`);

  const missingSubject = await admin.post('/api/v1/templates/email/upsert', {
    key: `no.subject.${run}`,
    htmlBody: 'y',
  });
  record(
    'an email template without a subject -> 400',
    missingSubject.status === 400,
    `status=${missingSubject.status}`,
  );

  const templatesAsCustomer = await al.get('/api/v1/templates/email/getAll');
  record(
    'a customer cannot read templates -> 403',
    templatesAsCustomer.status === 403,
    `status=${templatesAsCustomer.status}`,
  );

  const smsUpsert = await admin.post('/api/v1/templates/sms/upsert', {
    key: `otp.${run}`,
    body: 'Your code is {{otp}}, valid for {{minutes}} minutes.',
    variables: ['otp', 'minutes'],
  });
  record(
    'POST /templates/sms/upsert -> 200',
    smsUpsert.status === 200,
    `status=${smsUpsert.status}`,
  );
  const smsKey = D_str(smsUpsert.body?.result?.key);

  const smsRender = await admin.post(`/api/v1/templates/sms/${smsKey}/render`, {
    values: { otp: '123456', minutes: 10 },
  });
  record(
    'an SMS template renders',
    D_str(smsRender.body?.result?.body) === 'Your code is 123456, valid for 10 minutes.',
    D_str(smsRender.body?.result?.body),
  );

  const smsList = await admin.get('/api/v1/templates/sms/getAll');
  record(
    'GET /templates/sms/getAll -> 200',
    smsList.status === 200 && D_arr(smsList.body?.result?.itemList).length >= 1,
    `status=${smsList.status}`,
  );

  const smsDelete = await admin.del(`/api/v1/templates/sms/${smsKey}/delete`);
  record(
    'DELETE /templates/sms/:key/delete -> 200',
    smsDelete.status === 200,
    `status=${smsDelete.status}`,
  );
  const smsDeleteAgain = await admin.del(`/api/v1/templates/sms/${smsKey}/delete`);
  record(
    'deleting a template twice -> 404',
    smsDeleteAgain.status === 404,
    `status=${smsDeleteAgain.status}`,
  );

  const notifUpsert = await admin.post('/api/v1/templates/notification/upsert', {
    key: `order.delivered.${run}`,
    channel: 'IN_APP',
    title: 'Order {{orderNumber}} delivered',
    body: 'Enjoy your order, {{name}}.',
    variables: ['orderNumber', 'name'],
  });
  record(
    'POST /templates/notification/upsert -> 200',
    notifUpsert.status === 200,
    `status=${notifUpsert.status}`,
  );
  const notifKey = D_str(notifUpsert.body?.result?.key);
  record(
    'the channel is stored',
    D_str(notifUpsert.body?.result?.channel) === 'IN_APP',
    D_str(notifUpsert.body?.result?.channel),
  );

  const notifRender = await admin.post(`/api/v1/templates/notification/${notifKey}/render`, {
    values: { orderNumber: 'ORD-9', name: 'Ravi' },
  });
  record(
    'a notification template renders',
    D_str(notifRender.body?.result?.title) === 'Order ORD-9 delivered',
    D_str(notifRender.body?.result?.title),
  );

  const byChannel = await admin.get('/api/v1/templates/notification/getAll?channel=IN_APP');
  record(
    'notification templates filter on channel',
    D_arr(byChannel.body?.result?.itemList).every((t: any) => D_str(t?.channel) === 'IN_APP'),
    `count=${D_arr(byChannel.body?.result?.itemList).length}`,
  );

  const badChannel = await admin.get('/api/v1/templates/notification/getAll?channel=TELEPATHY');
  record('an unknown channel -> 400', badChannel.status === 400, `status=${badChannel.status}`);

  const notifDelete = await admin.del(`/api/v1/templates/notification/${notifKey}/delete`);
  record(
    'DELETE /templates/notification/:key/delete -> 200',
    notifDelete.status === 200,
    `status=${notifDelete.status}`,
  );

  const emailDelete = await admin.del(`/api/v1/templates/email/${emailKey}/delete`);
  record(
    'DELETE /templates/email/:key/delete -> 200',
    emailDelete.status === 200,
    `status=${emailDelete.status}`,
  );

  await prisma.walletTransaction.deleteMany({ where: { reference: { startsWith: 'referral_' } } });
  await prisma.referral.deleteMany({ where: { referralCode: { in: [alCode, boCode] } } });
  await prisma.giftCard.deleteMany({
    where: { code: { in: [cardCode, `CUSTOM${run}`, disabledCode, expiredCode] } },
  });
  await prisma.loyaltyTransaction.deleteMany({
    where: { userId: { in: [alice.userId, bob.userId, carol.userId] } },
  });
  await prisma.emailTemplate.deleteMany({ where: { key: { contains: run } } });
  await prisma.smsTemplate.deleteMany({ where: { key: { contains: run } } });
  await prisma.notificationTemplate.deleteMany({ where: { key: { contains: run } } });
  await prisma.user.updateMany({
    where: { id: { in: [alice.userId, bob.userId, carol.userId] } },
    data: { referredById: null },
  });

  await prisma.user.deleteMany({ where: { email: { contains: run } } });

  for (const [key, value] of Object.entries(baseline)) {
    if (value === undefined || value === null) {
      await prisma.systemSetting.deleteMany({ where: { key } });
    } else {
      await prisma.systemSetting.upsert({
        where: { key },
        create: { key, value, category: key.split('.')[0] },
        update: { value },
      });
    }
  }

  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed);

  console.log('\n========================================');
  console.log(`  ${passed}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('\n  Failures:');
    for (const f of failed) console.log(`   - ${f.name} - ${f.detail}`);
  }
  console.log('========================================');
  console.log(`  ${passed}/${checks.length} checks passed\n`);

  await prisma.$disconnect();
  if (failed.length) process.exitCode = 1;
  /* eslint-enable no-console */
};

const D_num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));
const D_str = (v: any): string => (v === null || v === undefined ? '' : String(v));
const D_arr = (v: any): any[] => (Array.isArray(v) ? v : []);

main().catch((err) => {
  /* eslint-disable no-console */
  console.error('\nFatal:', err?.message ?? err);
  console.error(err?.stack ?? 'no stack');
  process.exitCode = 1;
  /* eslint-enable no-console */
});
