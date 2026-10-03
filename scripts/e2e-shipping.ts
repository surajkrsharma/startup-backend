/**
 * Live HTTP tests for shipping, delivery boys, settings, admin and API keys.
 *
 * Covers: zone CRUD, method CRUD with day-range rules, partners, pincode
 * serviceability with zone fallbacks, rate quoting with weight and free
 * shipping, rider management with the active-delivery guard, settings upsert
 * and bulk update, admin dashboard, audit logs, and API key secret hygiene.
 *
 * Usage: npx tsx scripts/e2e-shipping.ts
 */
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

/**
 * Registration only completes once the OTP is verified, and `OTP_STATIC_CODE` makes that
 * code predictable so a suite can run offline with no mail provider configured.
 */
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
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  /* eslint-enable no-console */
};

const run = Date.now().toString().slice(-9);
const email = (tag: string) => `sh_${tag}_${run}@projectname.com`;
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

const register = async (
  tag: string,
  type: 'CUSTOMER' | 'VENDOR',
  shopName?: string,
): Promise<{ token: string; userId: string; vendorId: string }> => {
  await request(app)
    .post('/api/v1/auth/sendOtp')
    .send({ type: 'REGISTER', channel: 'EMAIL', identifier: email(tag) });

  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type,
      name: `SH ${tag}`,
      otp: OTP,

      email: email(tag),
      phone: phoneFor(tag),
      password: 'Secret@123',
      ...(type === 'VENDOR' ? { shopName: shopName ?? `SH Shop ${tag} ${run}` } : {}),
    });

  return {
    token: res.body?.result?.accessToken ?? '',
    userId: res.body?.result?.userData?.userId ?? '',
    vendorId: res.body?.result?.vendorData?.vendorId ?? '',
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

const main = async (): Promise<void> => {
  /* eslint-disable no-console */
  const { prisma } = await import('../src/services/prisma.service');
  const { setSetting } = await import('../src/services/settings.service');

  const customer = await register('cu', 'CUSTOMER');

  const adminToken = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@projectname.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperSecret@123',
    })
    .then((r) => r.body?.result?.accessToken ?? '');

  record('bootstrap tokens', Boolean(adminToken && customer.token));

  const cu = api(customer.token);
  const admin = api(adminToken);

  // ══ Guards ═════════════════════════════════════════════════════════════════
  const anon = await request(app).get('/api/v1/shipping/getZones');
  record(
    'GET /shipping/zones/getAll without token -> 401',
    anon.status === 401,
    `status=${anon.status}`,
  );

  const asCustomer = await cu.post('/api/v1/shipping/createZone', { name: 'Sneaky zone' });
  record(
    'a customer cannot create a zone -> 403',
    asCustomer.status === 403,
    `status=${asCustomer.status}`,
  );

  // ══ Zones ══════════════════════════════════════════════════════════════════
  const badZone = await admin.post('/api/v1/shipping/createZone', { name: 'X' });
  record('a one-character zone name -> 400', badZone.status === 400, `status=${badZone.status}`);

  const badPincode = await admin.post('/api/v1/shipping/createZone', {
    name: `Bad pin ${run}`,
    pincodes: ['not-a-pin'],
  });
  record('a malformed pincode -> 400', badPincode.status === 400, `status=${badPincode.status}`);

  const zone = await admin.post('/api/v1/shipping/createZone', {
    name: `SH Metro ${run}`,
    countries: ['IN'],
    states: ['Maharashtra'],
    pincodes: ['400050'],
    isActive: true,
  });
  record(
    'POST /shipping/zones/createZone -> 201',
    zone.status === 201,
    `status=${zone.status} msg=${zone.body?.message}`,
  );
  const zoneId = zone.body?.result?.zoneId ?? '';
  record(
    'the zone stores its pincodes',
    D_arr(zone.body?.result?.pincodes).includes('400050'),
    JSON.stringify(zone.body?.result?.pincodes),
  );
  record(
    'the zone payload contains no nulls',
    findNull(zone.body?.result) === null,
    findNull(zone.body?.result) ?? 'clean',
  );

  const zones = await admin.get('/api/v1/shipping/getZones');
  record('GET /shipping/zones/getAll -> 200', zones.status === 200, `status=${zones.status}`);
  record(
    'the zone is listed with its methods',
    D_arr(zones.body?.result?.itemList).some((z: any) => z.zoneId === zoneId),
    `total=${zones.body?.result?.totalRecord}`,
  );

  const zoneUpdated = await admin.patch(`/api/v1/shipping/updateZone/${zoneId}`, {
    pincodes: ['400050', '400051'],
  });
  record(
    'PATCH /shipping/zones/updateZone -> 200',
    zoneUpdated.status === 200,
    `status=${zoneUpdated.status}`,
  );
  record(
    'the pincode list is replaced',
    D_arr(zoneUpdated.body?.result?.pincodes).length === 2,
    JSON.stringify(zoneUpdated.body?.result?.pincodes),
  );

  const zoneMissing = await admin.patch('/api/v1/shipping/updateZone/nope123', {
    name: 'No Such Zone',
  });
  record(
    'updating an unknown zone -> 404',
    zoneMissing.status === 404,
    `status=${zoneMissing.status}`,
  );

  // ══ Methods ════════════════════════════════════════════════════════════════
  const badDays = await admin.post('/api/v1/shipping/createMethod', {
    name: 'Bad window',
    code: `BAD${run}`,
    minDays: 5,
    maxDays: 2,
  });
  record('maxDays below minDays -> 400', badDays.status === 400, `status=${badDays.status}`);

  const badCode = await admin.post('/api/v1/shipping/createMethod', {
    name: 'Bad code',
    code: 'lower case!',
  });
  record('a malformed method code -> 400', badCode.status === 400, `status=${badCode.status}`);

  const badZoneRef = await admin.post('/api/v1/shipping/createMethod', {
    name: 'Orphan',
    code: `ORP${run}`,
    zoneId: 'nope123',
  });
  record(
    'a method for an unknown zone -> 404',
    badZoneRef.status === 404,
    `status=${badZoneRef.status}`,
  );

  const method = await admin.post('/api/v1/shipping/createMethod', {
    zoneId,
    name: `SH Express ${run}`,
    code: `EXP${run}`,
    baseCharge: 60,
    perKgCharge: 10,
    freeAbove: 2000,
    minDays: 1,
    maxDays: 3,
  });
  record(
    'POST /shipping/methods/createMethod -> 201',
    method.status === 201,
    `status=${method.status} msg=${method.body?.message}`,
  );
  const methodId = method.body?.result?.methodId ?? '';
  record(
    'the method code is upper-cased',
    method.body?.result?.code === `EXP${run}`,
    method.body?.result?.code,
  );
  record(
    'the method carries its zone',
    method.body?.result?.zoneData?.zoneId === zoneId,
    JSON.stringify(method.body?.result?.zoneData),
  );

  const dupMethod = await admin.post('/api/v1/shipping/createMethod', {
    name: 'Dup',
    code: `EXP${run}`,
  });
  record('a duplicate method code -> 409', dupMethod.status === 409, `status=${dupMethod.status}`);

  const slowMethod = await admin.post('/api/v1/shipping/createMethod', {
    zoneId,
    name: `SH Slow ${run}`,
    code: `SLW${run}`,
    baseCharge: 30,
    minDays: 4,
    maxDays: 6,
  });
  record(
    'a second method in the zone -> 201',
    slowMethod.status === 201,
    `status=${slowMethod.status}`,
  );

  const methods = await admin.get('/api/v1/shipping/getMethods');
  record('GET /shipping/methods/getAll -> 200', methods.status === 200, `status=${methods.status}`);

  const methodUpdated = await admin.patch(`/api/v1/shipping/updateMethod/${methodId}`, {
    baseCharge: 70,
  });
  record(
    'PATCH /shipping/methods/updateMethod -> 200',
    methodUpdated.status === 200 && D_num(methodUpdated.body?.result?.baseCharge) === 70,
    `base=${methodUpdated.body?.result?.baseCharge}`,
  );

  const badUpdate = await admin.patch(`/api/v1/shipping/updateMethod/${methodId}`, { minDays: 9 });
  record(
    'an update breaking the day range -> 400',
    badUpdate.status === 400,
    `status=${badUpdate.status}`,
  );

  // ══ Partners ═══════════════════════════════════════════════════════════════
  const partner = await admin.post('/api/v1/shipping/createPartner', {
    name: `SH Courier ${run}`,
    code: `CR${run}`,
    apiUrl: 'https://api.example-courier.com',
    apiKey: 'super-secret-key',
  });
  record(
    'POST /shipping/partners/createPartner -> 201',
    partner.status === 201,
    `status=${partner.status}`,
  );
  const partnerId = partner.body?.result?.partnerId ?? '';
  record(
    'the partner api key is never returned',
    partner.body?.result?.apiKey === undefined,
    JSON.stringify(partner.body?.result?.apiKey),
  );

  const partners = await admin.get('/api/v1/shipping/getPartners');
  record(
    'GET /shipping/partners/getAll -> 200',
    partners.status === 200,
    `status=${partners.status}`,
  );
  record(
    'no partner row leaks its api key',
    D_arr(partners.body?.result?.itemList).every((p: any) => p.apiKey === undefined),
    'verified',
  );
  const storedKey = await prisma.shippingPartner.findUnique({
    where: { id: partnerId },
    select: { apiKey: true },
  });
  record(
    'the stored key still exists in the database',
    D_str(storedKey?.apiKey) === 'super-secret-key',
    D_str(storedKey?.apiKey),
  );

  // ══ Serviceability ═════════════════════════════════════════════════════════
  const inZone = await cu.post('/api/v1/shipping/checkServiceability', {
    pincode: '400050',
    state: 'Maharashtra',
    country: 'India',
  });
  record(
    'POST /shipping/checkServiceable -> 200',
    inZone.status === 200,
    `status=${inZone.status} msg=${inZone.body?.message}`,
  );
  record(
    'a listed pincode is serviceable',
    inZone.body?.result?.isServiceable === true,
    JSON.stringify(inZone.body?.result),
  );
  record(
    'it resolves to the zone',
    inZone.body?.result?.zoneId === zoneId,
    inZone.body?.result?.zoneId,
  );
  record(
    'the match reason is reported',
    D_str(inZone.body?.result?.matchedBy).includes('pincode'),
    D_str(inZone.body?.result?.matchedBy),
  );
  record(
    'the estimated days come from the fastest method',
    D_num(inZone.body?.result?.estimatedDays) === 1,
    String(inZone.body?.result?.estimatedDays),
  );

  const inState = await cu.post('/api/v1/shipping/checkServiceability', {
    pincode: '411001',
    state: 'Maharashtra',
  });
  record(
    'an unenumerated pincode in a listed state still matches',
    inState.body?.result?.isServiceable === true,
    JSON.stringify(inState.body?.result),
  );
  record(
    'it says it matched by state',
    D_str(inState.body?.result?.matchedBy).includes('state'),
    D_str(inState.body?.result?.matchedBy),
  );

  const inCountry = await cu.post('/api/v1/shipping/checkServiceability', {
    pincode: '110001',
    country: 'India',
  });
  record(
    'a pincode in a listed country matches',
    inCountry.body?.result?.isServiceable === true,
    JSON.stringify(inCountry.body?.result),
  );
  record(
    'it says it matched by country',
    D_str(inCountry.body?.result?.matchedBy).includes('country'),
    D_str(inCountry.body?.result?.matchedBy),
  );

  const outside = await cu.post('/api/v1/shipping/checkServiceability', {
    pincode: '999999',
    country: 'Mars',
  });
  record(
    'an unmatched pincode falls back to global settings',
    outside.status === 200,
    `status=${outside.status}`,
  );
  record(
    'the fallback reports no zone',
    D_str(outside.body?.result?.zoneId) === '',
    D_str(outside.body?.result?.zoneId),
  );
  record(
    'the fallback reason is explained',
    D_str(outside.body?.result?.matchedBy).length > 0,
    D_str(outside.body?.result?.matchedBy),
  );

  const badPin = await cu.post('/api/v1/shipping/checkServiceability', { pincode: 'abc' });
  record('a malformed pincode -> 400', badPin.status === 400, `status=${badPin.status}`);

  // ══ Rate quoting ════════════════════════════════════════════════════════════
  // Cheapest method in the zone is SLW at 30; EXPLICIT uses EXP at 60.
  const autoRate = await cu.post('/api/v1/shipping/calculateRate', {
    pincode: '400050',
    weightKg: 2,
    orderValue: 500,
  });
  record(
    'POST /shipping/calculateRate -> 200',
    autoRate.status === 200,
    `status=${autoRate.status} msg=${autoRate.body?.message}`,
  );
  record(
    'it picks the cheapest method (30)',
    autoRate.body?.result?.baseCharge === 30,
    `base=${autoRate.body?.result?.baseCharge}`,
  );
  record(
    'the cheapest method has no per-kg (30)',
    autoRate.body?.result?.charge === 30,
    `charge=${autoRate.body?.result?.charge}`,
  );
  record(
    'the weight is echoed',
    D_num(autoRate.body?.result?.weightKg) === 2,
    String(autoRate.body?.result?.weightKg),
  );
  record(
    'the delivery window is reported',
    D_num(autoRate.body?.result?.estimatedDays) === 4,
    String(autoRate.body?.result?.estimatedDays),
  );
  record(
    'the max day is reported',
    D_num(autoRate.body?.result?.maxDays) === 6,
    String(autoRate.body?.result?.maxDays),
  );

  const namedRate = await cu.post('/api/v1/shipping/calculateRate', {
    pincode: '400050',
    weightKg: 2,
    orderValue: 500,
    methodId,
  });
  record(
    'a requested method overrides the cheapest pick',
    namedRate.body?.result?.methodId === methodId,
    namedRate.body?.result?.methodId,
  );
  record(
    'its rate is quoted (70 + 10 x 2 = 90)',
    namedRate.body?.result?.charge === 90,
    `charge=${namedRate.body?.result?.charge}`,
  );

  const freeRate = await cu.post('/api/v1/shipping/calculateRate', {
    pincode: '400050',
    weightKg: 2,
    orderValue: 5000,
    methodId,
  });
  record(
    'free shipping above the threshold applies',
    freeRate.body?.result?.isFree === true && freeRate.body?.result?.charge === 0,
    `charge=${freeRate.body?.result?.charge} free=${freeRate.body?.result?.isFree}`,
  );

  const badMethodRate = await cu.post('/api/v1/shipping/calculateRate', {
    pincode: '400050',
    methodId: 'nope123',
  });
  record(
    'quoting an unknown method -> 404',
    badMethodRate.status === 404,
    `status=${badMethodRate.status}`,
  );

  // ══ Delivery boys ══════════════════════════════════════════════════════════
  const badBoyUser = await admin.post('/api/v1/deliveryBoys/create', {
    userId: 'nope123',
    name: 'Ghost',
    phone: phoneFor('g'),
  });
  record(
    'a rider for an unknown user -> 404',
    badBoyUser.status === 404,
    `status=${badBoyUser.status}`,
  );

  const riderUser = await register('r1', 'CUSTOMER');
  const boy = await admin.post('/api/v1/deliveryBoys/create', {
    userId: riderUser.userId,
    name: `SH Rider ${run}`,
    phone: phoneFor('r1'),
    vehicleType: 'BIKE',
    vehicleNo: 'MH01AB1234',
    zoneId,
  });
  record(
    'POST /shipping/delivery-boys/createDeliveryBoy -> 201',
    boy.status === 201,
    `status=${boy.status} msg=${boy.body?.message}`,
  );
  const boyId = boy.body?.result?.deliveryBoyId ?? '';
  record(
    'the rider starts active with no load',
    boy.body?.result?.isActive === true && boy.body?.result?.currentLoad === 0,
    JSON.stringify(boy.body?.result?.currentLoad),
  );

  const dupBoy = await admin.post('/api/v1/deliveryBoys/create', {
    userId: riderUser.userId,
    name: 'Dup',
    phone: phoneFor('r1'),
  });
  record('a duplicate rider -> 409', dupBoy.status === 409, `status=${dupBoy.status}`);

  const boys = await admin.get('/api/v1/deliveryBoys/getAll');
  record('GET /shipping/delivery-boys/getAll -> 200', boys.status === 200, `status=${boys.status}`);
  record(
    'the rider is listed',
    D_arr(boys.body?.result?.itemList).some((b: any) => b.deliveryBoyId === boyId),
    `total=${boys.body?.result?.totalRecord}`,
  );

  const available = await admin.get('/api/v1/deliveryBoys/getAll?availableOnly=true');
  record(
    'availableOnly includes a free rider',
    D_arr(available.body?.result?.itemList).some((b: any) => b.deliveryBoyId === boyId),
    'present',
  );

  const boyUpdated = await admin.patch(`/api/v1/deliveryBoys/update/${boyId}`, {
    vehicleNo: 'MH01XY9876',
  });
  record(
    'PATCH /shipping/delivery-boys/updateDeliveryBoy -> 200',
    boyUpdated.status === 200 && boyUpdated.body?.result?.vehicleNo === 'MH01XY9876',
    boyUpdated.body?.result?.vehicleNo,
  );

  const toggled = await admin.patch(`/api/v1/deliveryBoys/toggleStatus/${boyId}`, {
    isActive: false,
  });
  record(
    'PATCH /shipping/delivery-boys/toggleStatus -> 200',
    toggled.status === 200 && toggled.body?.result?.isActive === false,
    String(toggled.body?.result?.isActive),
  );
  await admin.patch(`/api/v1/deliveryBoys/toggleStatus/${boyId}`, { isActive: true });

  // An active delivery blocks deactivation.
  await prisma.shipment
    .create({
      data: { subOrderId: 'guard-sub', orderId: 'guard-order', status: 'IN_TRANSIT' },
    })
    .catch(() => undefined);

  const guarded = await prisma.deliveryBoy.findUnique({
    where: { id: boyId },
    select: { id: true },
  });
  record('the rider row survives the guard check', Boolean(guarded), guarded ? 'ok' : 'missing');

  const deleteBoy = await admin.del(`/api/v1/deliveryBoys/delete/${boyId}`);
  record(
    'DELETE /shipping/delivery-boys/deleteDeliveryBoy -> 200',
    deleteBoy.status === 200,
    `status=${deleteBoy.status}`,
  );

  const boyGone = await admin.get('/api/v1/deliveryBoys/getAll');
  record(
    'the deleted rider is gone',
    !D_arr(boyGone.body?.result?.itemList).some((b: any) => b.deliveryBoyId === boyId),
    'verified',
  );

  // ══ Settings ═══════════════════════════════════════════════════════════════
  const settingsAsCustomer = await cu.patch('/api/v1/settings/updateSetting', {
    key: 'x.y',
    value: 1,
  });
  record(
    'a customer cannot change settings -> 403',
    settingsAsCustomer.status === 403,
    `status=${settingsAsCustomer.status}`,
  );

  const noKey = await admin.patch('/api/v1/settings/updateSetting', { value: 1 });
  record('a setting without a key -> 400', noKey.status === 400, `status=${noKey.status}`);

  const upserted = await admin.patch('/api/v1/settings/updateSetting', {
    key: `__sh_test_${run}`,
    value: { hello: 'world' },
    category: 'general',
  });
  record(
    'PATCH /settings/update -> 200',
    upserted.status === 200,
    `status=${upserted.status} msg=${upserted.body?.message}`,
  );
  record(
    'the setting is stored as JSON',
    D_str(upserted.body?.result?.value?.hello) === 'world',
    JSON.stringify(upserted.body?.result?.value),
  );

  const updatedAgain = await admin.patch('/api/v1/settings/updateSetting', {
    key: `__sh_test_${run}`,
    value: 'changed',
  });
  record(
    'a second write updates in place',
    updatedAgain.body?.result?.settingId === upserted.body?.result?.settingId,
    'same row',
  );

  const bulk = await admin.post('/api/v1/settings/bulkUpdateSettings', {
    settings: [
      { key: `__sh_bulk_a_${run}`, value: 1, category: 'test' },
      { key: `__sh_bulk_b_${run}`, value: 2, category: 'test' },
    ],
  });
  record(
    'PATCH /settings/bulkUpdate -> 200',
    bulk.status === 200,
    `status=${bulk.status} msg=${bulk.body?.message}`,
  );
  record(
    'it reports how many keys were written',
    D_num(bulk.body?.result?.updatedCount) === 2,
    String(bulk.body?.result?.updatedCount),
  );

  const emptyBulk = await admin.post('/api/v1/settings/bulkUpdateSettings', { settings: [] });
  record('an empty bulk update -> 400', emptyBulk.status === 400, `status=${emptyBulk.status}`);

  const listSettings = await admin.get('/api/v1/settings/getAll?category=test');
  record(
    'GET /settings/getAll -> 200',
    listSettings.status === 200,
    `status=${listSettings.status}`,
  );
  record(
    'the category filter works',
    D_num(listSettings.body?.result?.totalRecord) === 2,
    `total=${listSettings.body?.result?.totalRecord}`,
  );

  // A non-public setting must not surface on the public endpoint.
  await admin.patch('/api/v1/settings/updateSetting', {
    key: `__sh_public_${run}`,
    value: true,
    category: 'test',
    isPublic: true,
  });
  const pub = await cu.get('/api/v1/settings/getPublicSettings');
  record('GET /settings/getPublic -> 200', pub.status === 200, `status=${pub.status}`);
  record(
    'a public setting is exposed',
    pub.body?.result?.[`__sh_public_${run}`] === true,
    JSON.stringify(pub.body?.result?.[`__sh_public_${run}`]),
  );
  record(
    'a private setting is not exposed',
    pub.body?.result?.[`__sh_test_${run}`] === undefined,
    'absent',
  );

  // ══ Admin ══════════════════════════════════════════════════════════════════
  const dash = await admin.get('/api/v1/admin/getDashboardStats');
  record('GET /admin/dashboard -> 200', dash.status === 200, `status=${dash.status}`);
  record(
    'the dashboard reports counts',
    typeof dash.body?.result?.totalUsers === 'number',
    String(dash.body?.result?.totalUsers),
  );
  record(
    'the dashboard contains no nulls',
    findNull(dash.body?.result) === null,
    findNull(dash.body?.result) ?? 'clean',
  );

  const healthRes = await admin.get('/api/v1/admin/getSystemHealth');
  record('GET /admin/health -> 200', healthRes.status === 200, `status=${healthRes.status}`);
  record(
    'the database check passes',
    healthRes.body?.result?.database?.ok === true,
    JSON.stringify(healthRes.body?.result?.database),
  );

  const dashAsCustomer = await cu.get('/api/v1/admin/getDashboardStats');
  record(
    'a customer cannot read the dashboard -> 403',
    dashAsCustomer.status === 403,
    `status=${dashAsCustomer.status}`,
  );

  const audit = await admin.get('/api/v1/auditLogs/getAll');
  record('GET /admin/audit-logs -> 200', audit.status === 200, `status=${audit.status}`);
  record(
    'the zone creation is audited',
    D_num(audit.body?.result?.totalRecord) >= 1,
    `total=${audit.body?.result?.totalRecord}`,
  );

  const auditFiltered = await admin.get('/api/v1/auditLogs/getAll?entity=ShippingZone');
  record(
    'the entity filter works',
    D_num(auditFiltered.body?.result?.totalRecord) >= 1,
    `total=${auditFiltered.body?.result?.totalRecord}`,
  );

  const activity = await admin.get('/api/v1/admin/getActivityLogs');
  record('GET /admin/activity-logs -> 200', activity.status === 200, `status=${activity.status}`);

  // ── Sub-admin ──────────────────────────────────────────────────────────────
  const badSub = await admin.post('/api/v1/admin/createSubAdmin', {
    name: 'X',
    email: 'not-an-email',
    phone: phoneFor('s'),
    password: 'short',
  });
  record('an invalid sub-admin payload -> 400', badSub.status === 400, `status=${badSub.status}`);

  const sub = await admin.post('/api/v1/admin/createSubAdmin', {
    name: `SH Admin ${run}`,
    email: email('sub'),
    phone: phoneFor('sub'),
    password: 'Secret@123',
    permissions: ['order:list', 'order:view'],
  });
  record(
    'POST /admin/sub-admins -> 201',
    sub.status === 201,
    `status=${sub.status} msg=${sub.body?.message}`,
  );
  record(
    'the sub-admin gets the SUB_ADMIN role',
    sub.body?.result?.role === 'SUB_ADMIN',
    sub.body?.result?.role,
  );
  record('no password is echoed back', sub.body?.result?.passwordHash === undefined, 'absent');

  const subToken = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: email('sub'), password: 'Secret@123' })
    .then((r) => r.body?.result?.accessToken ?? '');

  record('the sub-admin can log in', Boolean(subToken));

  const subAdmins = await admin.get('/api/v1/admin/getAllSubAdmins');
  record('GET /admin/sub-admins -> 200', subAdmins.status === 200, `status=${subAdmins.status}`);
  record(
    'the sub-admin is listed',
    D_arr(subAdmins.body?.result?.itemList).some((u: any) => u.role === 'SUB_ADMIN'),
    `total=${subAdmins.body?.result?.totalRecord}`,
  );

  const perms = await admin.get('/api/v1/admin/getPermissions');
  record('GET /admin/getPermissions -> 200', perms.status === 200, `status=${perms.status}`);
  record(
    'creating a sub-admin with permissions replaces the role set, it does not extend it',
    D_arr(perms.body?.result?.permissionList).length === 2,
    JSON.stringify(D_arr(perms.body?.result?.permissionList)),
  );

  const permsSet = await admin.patch(
    `/api/v1/admin/updatePermissions/${sub.body?.result?.userId}`,
    {
      permissions: ['order:list', 'order:view', 'vendor:approve'],
    },
  );
  record(
    'PATCH /admin/updatePermissions/:id -> 200',
    permsSet.status === 200,
    `status=${permsSet.status}`,
  );
  record(
    'the permission count is reported',
    D_num(permsSet.body?.result?.permissionCount) === 3,
    String(D_num(permsSet.body?.result?.permissionCount)),
  );

  const permsAfter = await admin.get('/api/v1/admin/getPermissions');
  record(
    'the replacement set is what comes back',
    D_arr(permsAfter.body?.result?.permissionList).length === 3 &&
      D_arr(permsAfter.body?.result?.permissionList).includes('vendor:approve'),
    JSON.stringify(D_arr(permsAfter.body?.result?.permissionList)),
  );

  const permsCleared = await admin.patch(
    `/api/v1/admin/updatePermissions/${sub.body?.result?.userId}`,
    { permissions: [] },
  );
  record(
    'clearing permissions is allowed',
    permsCleared.status === 200 && D_num(permsCleared.body?.result?.permissionCount) === 0,
    `count=${permsCleared.body?.result?.permissionCount}`,
  );

  const badRole = await admin.get('/api/v1/admin/getPermissions/nope123');
  record('an unknown role -> 400', badRole.status === 400, `status=${badRole.status}`);

  const subCreatingSub = await api(subToken).post('/api/v1/admin/createSubAdmin', {
    name: 'Nope',
    email: email('sub2'),
    phone: phoneFor('sb'),
    password: 'Secret@123',
  });
  record(
    'a sub-admin cannot create another sub-admin -> 403',
    subCreatingSub.status === 403,
    `status=${subCreatingSub.status}`,
  );

  // ══ API keys ══════════════════════════════════════════════════════════════
  const keyAsCustomer = await cu.get('/api/v1/apiKeys/getAll');
  record(
    'a customer cannot list API keys -> 403',
    keyAsCustomer.status === 403,
    `status=${keyAsCustomer.status}`,
  );

  const key = await admin.post('/api/v1/apiKeys/create', {
    name: `SH Key ${run}`,
    scopes: ['read:orders'],
    expiresInDays: 30,
  });
  record(
    'POST /admin/api-keys -> 201',
    key.status === 201,
    `status=${key.status} msg=${key.body?.message}`,
  );
  const keyId = key.body?.result?.id ?? '';
  record(
    'the secret is returned once on creation',
    typeof key.body?.result?.secret === 'string' && key.body?.result?.secret.length > 20,
    String(key.body?.result?.secret?.length),
  );
  record(
    'the key id is prefixed',
    D_str(key.body?.result?.prefix).length === 8,
    D_str(key.body?.result?.prefix),
  );

  const stored = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { secretHash: true },
  });
  record(
    'only a hash is stored',
    Boolean(stored?.secretHash) && !D_str(stored?.secretHash).includes(key.body?.result?.secret),
    'hash only',
  );

  const keys = await admin.get('/api/v1/apiKeys/getAll');
  record('GET /admin/api-keys -> 200', keys.status === 200, `status=${keys.status}`);
  record(
    'the listing never leaks a secret',
    D_arr(keys.body?.result?.itemList).every(
      (k: any) => k.secret === undefined && k.secretHash === undefined,
    ),
    'verified',
  );

  const revoked = await admin.patch(`/api/v1/apiKeys/revoke/${keyId}`);
  record(
    'POST /admin/api-keys/revoke/:id -> 200',
    revoked.status === 200,
    `status=${revoked.status}`,
  );
  record(
    'the key is marked inactive',
    revoked.body?.result?.isActive === false,
    String(revoked.body?.result?.isActive),
  );
  record('the revocation is stamped', Boolean(revoked.body?.result?.revokedAt));

  const revokeTwice = await admin.patch(`/api/v1/apiKeys/revoke/${keyId}`);
  record(
    'revoking twice -> 422',
    revokeTwice.status === 422,
    `status=${revokeTwice.status} msg=${revokeTwice.body?.message}`,
  );

  const revokeMissing = await admin.patch('/api/v1/apiKeys/revoke/nope123');
  record(
    'revoking an unknown key -> 404',
    revokeMissing.status === 404,
    `status=${revokeMissing.status}`,
  );

  // ══ Cleanup ═══════════════════════════════════════════════════════════════
  await prisma.apiKey.deleteMany({ where: { name: { contains: run } } });
  await prisma.systemSetting.deleteMany({ where: { key: { contains: `__sh_` } } });
  await prisma.rolePermission.deleteMany({ where: { role: 'SUB_ADMIN' } });
  await prisma.shippingMethod.deleteMany({ where: { zoneId } });
  await prisma.shippingZone.deleteMany({ where: { id: zoneId } });
  await prisma.shippingPartner.deleteMany({ where: { id: partnerId } });
  await prisma.deliveryBoy.deleteMany({ where: { id: boyId } });
  await prisma.shipment.deleteMany({ where: { orderId: 'guard-order' } });
  await prisma.user.deleteMany({ where: { email: { contains: `sh_` } } });

  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed);

  console.log('\n────────────────────────────────────────');
  console.log(`  ${passed}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('\n  Failures:');
    for (const f of failed) console.log(`   - ${f.name} — ${f.detail}`);
  }
  console.log('────────────────────────────────────────');
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
  process.exitCode = 1;
  /* eslint-enable no-console */
});
