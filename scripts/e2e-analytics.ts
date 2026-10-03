/**
 * Live HTTP tests for tracking, analytics, funnels, search and uploads.
 *
 * Covers: event and page-view ingestion, device registration and identity
 * protection, the analytics aggregates, funnel step dropoff, product/vendor
 * search with search logging, and the upload endpoints' failure mode when no
 * storage backend is configured.
 *
 * Usage: npx tsx scripts/e2e-analytics.ts
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
const email = (tag: string) => `an_${tag}_${run}@projectname.com`;
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
      name: `AN ${tag}`,
      otp: OTP,
      email: email(tag),
      phone: phoneFor(tag),
      password: 'Secret@123',
      ...(type === 'VENDOR' ? { shopName: shopName ?? `AN Shop ${tag} ${run}` } : {}),
    });

  return {
    token: res.body?.result?.accessToken ?? '',
    userId: res.body?.result?.userData?.userId ?? '',
    vendorId: res.body?.result?.vendorData?.vendorId ?? '',
  };
};

const api = (token: string) => ({
  get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${token}`),
  del: (p: string) => request(app).del(p).set('Authorization', `Bearer ${token}`),
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
});

/** Emits a known tracking event; returns the response. */
const fire = (name: string, sessionKey: string, extra: Record<string, any> = {}) =>
  request(app)
    .post('/api/v1/track/event')
    .set('x-session-id', sessionKey)
    .send({ name, sessionKey, ...extra });

const main = async (): Promise<void> => {
  /* eslint-disable no-console */
  const { prisma } = await import('../src/services/prisma.service');

  const customer = await register('cu', 'CUSTOMER');
  const vendor = await register('v1', 'VENDOR');
  const rival = await register('v2', 'VENDOR');

  const adminToken = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@projectname.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperSecret@123',
    })
    .then((r) => r.body?.result?.accessToken ?? '');

  record('bootstrap tokens', Boolean(adminToken && customer.token && vendor.token));

  const cu = api(customer.token);
  const admin = api(adminToken);

  for (const v of [vendor, rival]) {
    await admin.patch(`/api/v1/vendors/approveVendor/${v.vendorId}`, {});
  }
  record('vendors approved', true);

  const teeName = `AN Tee ${run}`;
  const hatName = `AN Hat ${run}`;

  const tee = await api(vendor.token).post('/api/v1/products/createProduct', {
    name: teeName,
    price: 900,
    stock: 25,
    taxPercent: 0,
  });
  const hat = await api(rival.token).post('/api/v1/products/createProduct', {
    name: hatName,
    price: 300,
    stock: 10,
    taxPercent: 0,
  });
  record(
    'two products created',
    Boolean(tee.body?.result?.productId && hat.body?.result?.productId),
  );

  // Revenue reports read OrderItem, so the suite needs a real sale of its own —
  // otherwise every qty/revenue assertion is asserting on an empty list.
  const analyticsAddress = await cu.post('/api/v1/users/addAddress', {
    type: 'HOME',
    fullName: 'Analytics Tester',
    phone: '+919876543210',
    line1: '1 Test Lane',
    city: 'Pune',
    state: 'Maharashtra',
    stateCode: 'MH',
    country: 'India',
    pincode: '411001',
    isDefault: true,
  });
  const analyticsAddressId = analyticsAddress.body?.result?.addressId ?? '';
  record(
    'the analytics customer has a delivery address',
    analyticsAddress.status === 201 && Boolean(analyticsAddressId),
    `status=${analyticsAddress.status}`,
  );

  const teeId = tee.body?.result?.productId ?? '';
  await cu.post('/api/v1/cart/addItem', { productId: teeId, qty: 2 });
  await cu.post('/api/v1/cart/addItem', { productId: hat.body?.result?.productId, qty: 1 });

  const salesOrder = await cu.post('/api/v1/orders/placeOrder', {
    addressId: analyticsAddressId,
    paymentMethod: 'COD',
    skipStatus: true,
  });
  const salesOrderId = salesOrder.body?.result?.orderId ?? '';
  record(
    'a COD order is placed to generate revenue',
    salesOrder.status === 201 && Boolean(salesOrderId),
    `status=${salesOrder.status} msg=${salesOrder.body?.message}`,
  );

  await admin.patch(`/api/v1/orders/updateStatus/${salesOrderId}`, { status: 'SHIPPED' });
  await admin.patch(`/api/v1/orders/updateStatus/${salesOrderId}`, {
    status: 'OUT_FOR_DELIVERY',
  });
  const deliveredOrder = await admin.patch(`/api/v1/orders/updateStatus/${salesOrderId}`, {
    status: 'DELIVERED',
  });
  record(
    'the order reaches DELIVERED so it counts as revenue',
    deliveredOrder.status === 200 && deliveredOrder.body?.result?.status === 'DELIVERED',
    `status=${deliveredOrder.status}`,
  );

  // ══ Tracking ingestion ═════════════════════════════════════════════════════
  const unknown = await fire('not_a_real_event', 'an-unknown-1');
  record(
    'an unknown event name -> 400',
    unknown.status === 400,
    `status=${unknown.status} msg=${unknown.body?.message}`,
  );

  const session = `an-session-${run}`;
  const ev1 = await fire('product_view', session, {
    meta: { productId: tee.body?.result?.productId },
  });
  record(
    'POST /tracking/event -> 201',
    ev1.status === 201,
    `status=${ev1.status} msg=${ev1.body?.message}`,
  );
  record(
    'the event name is echoed back',
    ev1.body?.result?.name === 'product_view',
    ev1.body?.result?.name,
  );
  /**
   * The tracking middleware resolves a canonical Session row, so the echoed key is the server's
   * identity for this visitor, not the client's raw header.
   */
  record(
    'a canonical session key is resolved and echoed',
    typeof ev1.body?.result?.sessionKey === 'string' && ev1.body?.result?.sessionKey.length > 0,
    ev1.body?.result?.sessionKey,
  );

  const noName = await request(app).post('/api/v1/track/event').send({ sessionKey: session });
  record('an event without a name -> 400', noName.status === 400, `status=${noName.status}`);

  const pv = await request(app).post('/api/v1/track/pageView').set('x-session-id', session).send({
    pageUrl: '/products/tee',
    pageTitle: 'Tee',
    timeOnPage: 42,
    scrollDepth: 80,
    deviceType: 'mobile',
    referrer: 'https://www.google.com/search?q=tee',
  });
  record('POST /tracking/pageView -> 201', pv.status === 201, `status=${pv.status}`);
  record('the view id is returned', Boolean(pv.body?.result?.viewId), pv.body?.result?.viewId);

  const noUrl = await request(app)
    .post('/api/v1/track/pageView')
    .set('x-session-id', session)
    .send({});
  record('a page view without a URL -> 400', noUrl.status === 400, `status=${noUrl.status}`);

  // A second, separate session so unique-visitor maths has something to count.
  await fire('app_open', `an-session2-${run}`);
  await request(app)
    .post('/api/v1/track/pageView')
    .set('x-session-id', `an-session2-${run}`)
    .send({ pageUrl: '/', deviceType: 'desktop' });

  const crash = await request(app).post('/api/v1/track/crash').set('x-session-id', session).send({
    errorMessage: 'TypeError: cannot read x',
    errorType: 'TypeError',
    appVersion: '1.2.3',
    platform: 'ANDROID',
  });
  record('POST /tracking/crash -> 201', crash.status === 201, `status=${crash.status}`);
  record(
    'the crash id is returned',
    Boolean(crash.body?.result?.crashId),
    crash.body?.result?.crashId,
  );

  // ══ Devices ═══════════════════════════════════════════════════════════════
  const devId = `an-device-${run}`;
  const registered = await request(app)
    .post('/api/v1/track/device')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({
      deviceId: devId,
      platform: 'ANDROID',
      os: 'Android',
      osVersion: '14',
      appVersion: '1.2.3',
      fcmToken: 'tok-1',
    });
  record('POST /tracking/device -> 200', registered.status === 200, `status=${registered.status}`);
  record(
    'the device is linked to the caller',
    registered.body?.result?.userId === customer.userId,
    registered.body?.result?.userId,
  );
  record(
    'the push token is never exposed to a client',
    registered.body?.result?.fcmToken === undefined,
    JSON.stringify(registered.body?.result?.fcmToken),
  );

  const refresh = await request(app)
    .post('/api/v1/track/device')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ deviceId: devId, platform: 'ANDROID', appVersion: '1.3.0' });
  record(
    're-registering the same device refreshes it',
    refresh.body?.result?.appVersion === '1.3.0',
    refresh.body?.result?.appVersion,
  );

  const stolen = await request(app)
    .post('/api/v1/track/device')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ deviceId: devId, platform: 'IOS' });
  record(
    're-registering your own device is fine',
    stolen.status === 200,
    `status=${stolen.status}`,
  );

  const byOther = await request(app)
    .post('/api/v1/track/device')
    .set('Authorization', `Bearer ${vendor.token}`)
    .send({ deviceId: devId, platform: 'IOS' });
  record(
    'another user cannot claim your device -> 403',
    byOther.status === 403,
    `status=${byOther.status} msg=${byOther.body?.message}`,
  );

  const badDevice = await request(app).post('/api/v1/track/device').send({ deviceId: 'ab' });
  record('a too-short device id -> 400', badDevice.status === 400, `status=${badDevice.status}`);

  // /devices/getAll is the admin device inventory per the contract; a customer's own
  // device is reachable through /devices/getTrusted and /track/device.
  const devices = await admin.get('/api/v1/devices/getAll');
  record('GET /devices/getAll -> 200 (admin)', devices.status === 200, `status=${devices.status}`);
  record(
    'the caller sees their own device',
    D_arr(devices.body?.result?.deviceList).some((d: any) => d.deviceId === devId),
    JSON.stringify(D_arr(devices.body?.result?.deviceList).map((d: any) => d.deviceId)),
  );

  const devicesAsCustomer = await cu.get('/api/v1/devices/getAll');
  record(
    'a customer cannot list every device -> 403',
    devicesAsCustomer.status === 403,
    `status=${devicesAsCustomer.status}`,
  );

  const otherDevices = await api(vendor.token).get('/api/v1/devices/getAll');
  record(
    'a vendor cannot list every device either',
    otherDevices.status === 403,
    `status=${otherDevices.status}`,
  );

  const trusted = await cu.get('/api/v1/devices/getTrusted');
  record(
    'GET /devices/getTrusted -> 200 for the owner',
    trusted.status === 200,
    `status=${trusted.status}`,
  );

  // ══ Analytics ══════════════════════════════════════════════════════════════
  const anonOverview = await request(app).get('/api/v1/analytics/getOverview');
  record(
    'GET /analytics/overview without auth -> 401',
    anonOverview.status === 401,
    `status=${anonOverview.status}`,
  );

  const asCustomer = await cu.get('/api/v1/analytics/getOverview');
  record(
    'a customer cannot read analytics -> 403',
    asCustomer.status === 403,
    `status=${asCustomer.status}`,
  );

  const overview = await admin.get('/api/v1/analytics/getOverview?days=7');
  record('GET /analytics/overview -> 200', overview.status === 200, `status=${overview.status}`);
  record(
    'page views are counted',
    D_num(overview.body?.result?.pageViews) >= 2,
    `views=${overview.body?.result?.pageViews}`,
  );
  record(
    'unique visitors are deduplicated by session',
    D_num(overview.body?.result?.uniqueVisitors) >= 1 &&
      D_num(overview.body?.result?.uniqueVisitors) <= D_num(overview.body?.result?.pageViews),
    `visitors=${overview.body?.result?.uniqueVisitors} views=${overview.body?.result?.pageViews}`,
  );
  record(
    'the window is echoed',
    D_str(overview.body?.result?.from).length > 0 && D_str(overview.body?.result?.to).length > 0,
    'set',
  );
  record(
    'the overview contains no nulls',
    findNull(overview.body?.result) === null,
    findNull(overview.body?.result) ?? 'clean',
  );

  const visitors = await admin.get('/api/v1/analytics/getVisitors?days=7');
  record('GET /analytics/visitors -> 200', visitors.status === 200, `status=${visitors.status}`);
  record(
    'a device breakdown is returned',
    D_arr(visitors.body?.result?.byDevice).length >= 1,
    JSON.stringify(visitors.body?.result?.byDevice),
  );
  record(
    'a platform breakdown is returned',
    D_arr(visitors.body?.result?.byPlatform).length >= 1,
    JSON.stringify(visitors.body?.result?.byPlatform),
  );
  record(
    'a daily series is returned',
    D_arr(visitors.body?.result?.byDay).length >= 1,
    `days=${D_arr(visitors.body?.result?.byDay).length}`,
  );
  record(
    'a peak day is identified',
    D_num(visitors.body?.result?.peakDay?.count) >= 1,
    JSON.stringify(visitors.body?.result?.peakDay),
  );

  const topPages = await admin.get('/api/v1/analytics/getTopPages?days=7');
  record('GET /analytics/topPages -> 200', topPages.status === 200, `status=${topPages.status}`);
  record(
    'pages are ranked with percentages',
    D_arr(topPages.body?.result?.itemList).every((p: any) => typeof p.percentage === 'number'),
    JSON.stringify(D_arr(topPages.body?.result?.itemList)[0]),
  );

  const sources = await admin.get('/api/v1/analytics/getTrafficSources?days=7');
  record(
    'GET /analytics/trafficSources -> 200',
    sources.status === 200,
    `status=${sources.status}`,
  );
  record(
    'a google referrer is classified as google',
    D_arr(sources.body?.result?.sourceList).some((s: any) => s.source === 'google'),
    JSON.stringify(D_arr(sources.body?.result?.sourceList).map((s: any) => s.source)),
  );
  record(
    'a missing referrer is counted as direct',
    D_arr(sources.body?.result?.sourceList).some((s: any) => s.source === 'direct'),
    JSON.stringify(D_arr(sources.body?.result?.sourceList).map((s: any) => s.source)),
  );

  const geo = await admin.get('/api/v1/analytics/getGeoBreakdown?days=7');
  record('GET /analytics/geo -> 200', geo.status === 200, `status=${geo.status}`);

  const revenue = await admin.get('/api/v1/analytics/getRevenueReport?days=7');
  record('GET /analytics/revenue -> 200', revenue.status === 200, `status=${revenue.status}`);
  record(
    'revenue totals are reported',
    typeof revenue.body?.result?.totalRevenue === 'number',
    String(revenue.body?.result?.totalRevenue),
  );
  record(
    'an average order value is reported',
    typeof revenue.body?.result?.averageOrderValue === 'number',
    String(revenue.body?.result?.averageOrderValue),
  );
  record('a date series is returned', Array.isArray(revenue.body?.result?.series), 'series');

  const perf = await admin.get('/api/v1/analytics/getProductPerformance?days=7');
  record('GET /analytics/productPerformance -> 200', perf.status === 200, `status=${perf.status}`);
  record(
    'performance rows carry revenue and qty',
    typeof perf.body?.result?.productList?.[0]?.revenue === 'number' &&
      typeof perf.body?.result?.productList?.[0]?.qty === 'number',
    JSON.stringify(perf.body?.result?.productList?.[0]),
  );
  record(
    'the tee sold in this run shows its qty and revenue',
    D_arr(perf.body?.result?.productList).some(
      (p: any) => p.productId === teeId && p.qty === 2 && p.revenue === 1800,
    ),
    JSON.stringify(
      D_arr(perf.body?.result?.productList).map((p: any) => `${p.productId}:${p.qty}:${p.revenue}`),
    ),
  );

  const perfVendor = await api(vendor.token).get('/api/v1/analytics/getProductPerformance?days=7');
  record(
    'a vendor may read their own performance',
    perfVendor.status === 200,
    `status=${perfVendor.status}`,
  );

  const abandoned = await admin.get('/api/v1/analytics/getAbandonedCarts?minAgeHours=1');
  record(
    'GET /analytics/abandonedCarts -> 200',
    abandoned.status === 200,
    `status=${abandoned.status}`,
  );
  record(
    'an abandoned total is reported',
    typeof abandoned.body?.result?.totalValue === 'number',
    String(abandoned.body?.result?.totalValue),
  );

  const cohorts = await admin.get('/api/v1/analytics/getCustomerCohorts?days=7');
  record('GET /analytics/cohorts -> 200', cohorts.status === 200, `status=${cohorts.status}`);
  record('a cohort series is returned', Array.isArray(cohorts.body?.result?.series), 'series');

  const realtime = await admin.get('/api/v1/analytics/getRealtime');
  record('GET /analytics/realtime -> 200', realtime.status === 200, `status=${realtime.status}`);
  record(
    'active visitors are counted',
    typeof realtime.body?.result?.activeVisitors === 'number',
    String(realtime.body?.result?.activeVisitors),
  );

  const terms = await admin.get('/api/v1/analytics/getSearchTerms');
  record('GET /analytics/searchTerms -> 200', terms.status === 200, `status=${terms.status}`);

  // ══ Funnels ════════════════════════════════════════════════════════════════
  const badFunnel = await admin.post('/api/v1/analytics/funnels', {
    name: 'Too short',
    steps: [{ name: 'Only', eventName: 'login' }],
  });
  record('a funnel with one step -> 400', badFunnel.status === 400, `status=${badFunnel.status}`);

  const funnel = await admin.post('/api/v1/analytics/funnels', {
    name: `AN Funnel ${run}`,
    description: 'Browse to buy',
    steps: [
      { name: 'Viewed', eventName: 'product_view' },
      { name: 'Added', eventName: 'add_to_cart' },
      { name: 'Bought', eventName: 'purchase' },
    ],
  });
  record(
    'POST /analytics/funnels -> 201',
    funnel.status === 201,
    `status=${funnel.status} msg=${funnel.body?.message}`,
  );
  const funnelSlug = funnel.body?.result?.slug ?? '';
  record('the funnel slug is generated', funnelSlug.length > 0, funnelSlug);

  // One session walks the whole funnel; a second stops after step one.
  await fire('product_view', 'an-funnel-a');
  await fire('add_to_cart', 'an-funnel-a');
  await fire('purchase', 'an-funnel-a');
  await fire('product_view', 'an-funnel-b');

  const result = await admin.get(`/api/v1/analytics/getFunnel?slug=${funnelSlug}&days=7`);
  record('GET /analytics/getFunnel?slug -> 200', result.status === 200, `status=${result.status}`);
  record(
    'the funnel reports 3 steps',
    D_arr(result.body?.result?.stepList).length === 3,
    `n=${D_arr(result.body?.result?.stepList).length}`,
  );
  record(
    'step one counted both sessions',
    D_num(result.body?.result?.stepList?.[0]?.count) >= 2,
    `count=${result.body?.result?.stepList?.[0]?.count}`,
  );
  record(
    'step two counted one session',
    D_num(result.body?.result?.stepList?.[1]?.count) >= 1,
    `count=${result.body?.result?.stepList?.[1]?.count}`,
  );
  record(
    'the dropoff is reported between steps',
    D_num(result.body?.result?.stepList?.[1]?.dropOff) >= 1,
    `dropOff=${result.body?.result?.stepList?.[1]?.dropOff}`,
  );
  record(
    'a conversion rate is reported per step',
    typeof result.body?.result?.stepList?.[0]?.conversionRate === 'number',
    String(result.body?.result?.stepList?.[0]?.conversionRate),
  );
  record(
    'an overall conversion rate is reported',
    typeof result.body?.result?.overallConversionRate === 'number',
    String(result.body?.result?.overallConversionRate),
  );

  // The funnel is named by slug (or funnel), never id — the schema is strict.
  const funnelMissing = await admin.get('/api/v1/analytics/getFunnel?slug=no-such-funnel');
  record(
    'an unknown funnel -> 404',
    funnelMissing.status === 404,
    `status=${funnelMissing.status} msg=${funnelMissing.body?.message}`,
  );

  // A funnel report with no name resolves to an empty lookup, not a validation
  // error — the query schema has nothing required.
  const funnelNoName = await admin.get('/api/v1/analytics/getFunnel');
  record(
    'a funnel report with no name -> 404',
    funnelNoName.status === 404,
    `status=${funnelNoName.status} msg=${funnelNoName.body?.message}`,
  );

  const funnelBadParam = await admin.get('/api/v1/analytics/getFunnel?id=no-such-funnel');
  record(
    'naming a funnel by an unsupported key -> 400',
    funnelBadParam.status === 400 && String(funnelBadParam.body?.message).includes('id'),
    `status=${funnelBadParam.status} msg=${funnelBadParam.body?.message}`,
  );

  const listFunnels = await admin.get('/api/v1/analytics/funnels');
  record(
    'GET /analytics/funnels -> 200',
    listFunnels.status === 200,
    `status=${listFunnels.status}`,
  );
  record(
    'the funnel is listed',
    D_arr(listFunnels.body?.result?.funnelList).some((f: any) => f.slug === funnelSlug),
    `n=${listFunnels.body?.result?.funnelCount}`,
  );

  const funnelToggled = await admin.patch(
    `/api/v1/analytics/funnels/${funnel.body?.result?.funnelId}`,
    { isActive: false },
  );
  record(
    'PATCH /analytics/funnels/:id -> 200',
    funnelToggled.status === 200,
    `status=${funnelToggled.status}`,
  );
  record(
    'the funnel is deactivated',
    funnelToggled.body?.result?.isActive === false,
    String(funnelToggled.body?.result?.isActive),
  );

  // ══ Search ════════════════════════════════════════════════════════════════
  const noQuery = await request(app).get('/api/v1/search/global');
  record('GET /search without a term -> 400', noQuery.status === 400, `status=${noQuery.status}`);

  const global = await request(app).get(`/api/v1/search/global?q=AN Tee`);
  record(
    'GET /search works without auth',
    global.status === 200,
    `status=${global.status} msg=${global.body?.message}`,
  );
  record(
    'the term is echoed',
    D_str(global.body?.result?.term) === 'AN Tee',
    global.body?.result?.term,
  );
  record(
    'products are found',
    D_arr(global.body?.result?.productList).length >= 1,
    `n=${D_arr(global.body?.result?.productList).length}`,
  );
  record(
    'a product-only term matches no shops',
    D_arr(global.body?.result?.vendorList).length === 0,
    `n=${D_arr(global.body?.result?.vendorList).length}`,
  );

  const byShop = await request(app).get(`/api/v1/search/global?q=${encodeURIComponent('AN Shop')}`);
  record(
    'a shop-name term finds shops',
    D_arr(byShop.body?.result?.vendorList).length >= 1,
    `n=${D_arr(byShop.body?.result?.vendorList).length}`,
  );
  record(
    'a total count is reported',
    D_num(global.body?.result?.totalCount) >= 1,
    `total=${global.body?.result?.totalCount}`,
  );
  record(
    'the search payload contains no nulls',
    findNull(global.body?.result) === null,
    findNull(global.body?.result) ?? 'clean',
  );

  const productOnly = await request(app).get('/api/v1/search/global?q=AN Tee&types=product');
  record(
    'types=product narrows the result',
    D_arr(productOnly.body?.result?.vendorList).length === 0,
    `vendors=${D_arr(productOnly.body?.result?.vendorList).length}`,
  );

  const productSearch = await request(app).get('/api/v1/search/products?q=AN Hat');
  record(
    'GET /search/products -> 200',
    productSearch.status === 200,
    `status=${productSearch.status}`,
  );
  record(
    'it finds the matching product',
    D_num(productSearch.body?.result?.totalRecord) >= 1,
    `total=${productSearch.body?.result?.totalRecord}`,
  );
  record(
    'pagination numbers come first',
    JSON.stringify(Object.keys(productSearch.body?.result ?? {}).slice(0, 8)) ===
      JSON.stringify([
        'totalRecord',
        'totalPage',
        'currentPage',
        'limit',
        'hasNext',
        'hasPrevious',
        'nextPage',
        'previousPage',
      ]),
    JSON.stringify(Object.keys(productSearch.body?.result ?? {}).slice(0, 8)),
  );

  const priceFiltered = await request(app).get('/api/v1/search/products?q=AN&maxPrice=400');
  record(
    'a maxPrice filter excludes the 900 product',
    D_arr(priceFiltered.body?.result?.itemList).every((p: any) => D_num(p.price) <= 400),
    JSON.stringify(D_arr(priceFiltered.body?.result?.itemList).map((p: any) => p.price)),
  );

  const vendorSearch = await request(app).get(`/api/v1/search/vendors?q=AN Shop v1`);
  record(
    'GET /search/vendors -> 200',
    vendorSearch.status === 200,
    `status=${vendorSearch.status}`,
  );
  record(
    'only APPROVED shops are listed',
    D_arr(vendorSearch.body?.result?.itemList).every((v: any) => D_str(v.status) === 'APPROVED'),
    'approved only',
  );

  const suggestions = await request(app).get('/api/v1/search/autocomplete?q=AN');
  record(
    'GET /search/suggestions -> 200',
    suggestions.status === 200,
    `status=${suggestions.status}`,
  );
  record(
    'suggestions are typed',
    D_arr(suggestions.body?.result?.suggestionList).every((s: any) =>
      ['PRODUCT', 'CATEGORY', 'VENDOR'].includes(D_str(s.type)),
    ),
    'typed',
  );

  const trending = await request(app).get('/api/v1/search/trending?days=7');
  record('GET /search/trending -> 200', trending.status === 200, `status=${trending.status}`);
  record(
    'the searched term trends',
    D_arr(trending.body?.result?.termList).some(
      (t: any) => D_str(t.term).toLowerCase() === 'an tee',
    ),
    JSON.stringify(D_arr(trending.body?.result?.termList).map((t: any) => t.term)),
  );

  const recent = await cu.get('/api/v1/search/recent');
  record('GET /search/recent -> 200', recent.status === 200, `status=${recent.status}`);
  record(
    'it lists recent terms for the caller',
    Array.isArray(recent.body?.result?.termList),
    'array',
  );

  const cleared = await cu.del('/api/v1/search/recent/clear');
  record('POST /search/recent/clear -> 200', cleared.status === 200, `status=${cleared.status}`);

  const searchLogs = await admin.get('/api/v1/analytics/getSearchTerms');
  record(
    'searches were logged for later analysis',
    D_num(searchLogs.body?.result?.totalRecord) >= 1,
    `total=${searchLogs.body?.result?.totalRecord}`,
  );

  // ══ Uploads ════════════════════════════════════════════════════════════════
  const anonUpload = await request(app).post('/api/v1/uploads/uploadImage');
  record(
    'POST /upload/image without auth -> 401',
    anonUpload.status === 401,
    `status=${anonUpload.status}`,
  );

  // multer runs happily with no file, so this used to answer 201 "Image uploaded
  // successfully." for a request that uploaded nothing.
  const noFile = await cu.post('/api/v1/uploads/uploadImage');
  record(
    'an upload with no file -> 400 FILE_REQUIRED',
    noFile.status === 400 && String(noFile.body?.message).includes('FILE_REQUIRED'),
    `status=${noFile.status} msg=${noFile.body?.message}`,
  );

  // Uploads are open to any signed-in account per the contract, so a customer is
  // allowed here — the guard is the missing file, not the role.
  const documentNoFile = await cu.post('/api/v1/uploads/uploadDocument');
  record(
    'a document upload with no file -> 400 as well',
    documentNoFile.status === 400 && String(documentNoFile.body?.message).includes('FILE_REQUIRED'),
    `status=${documentNoFile.status} msg=${documentNoFile.body?.message}`,
  );

  const signed = await cu.get('/api/v1/uploads/getSignedUrl');
  record(
    'signed params either work or report storage is unconfigured',
    signed.status === 200 || signed.status === 503,
    `status=${signed.status} msg=${signed.body?.message}`,
  );
  record(
    'a 503 from signing is explicit, not silent',
    signed.status === 200 || String(signed.body?.message).toLowerCase().includes('upload failed'),
    signed.body?.message,
  );

  // ══ Cleanup ════════════════════════════════════════════════════════════════
  await prisma.funnel.deleteMany({ where: { slug: funnelSlug } });
  await prisma.event.deleteMany({ where: { sessionKey: { startsWith: 'an-' } } });
  await prisma.pageView.deleteMany({ where: { sessionKey: { startsWith: 'an-' } } });
  await prisma.crashLog.deleteMany({ where: { sessionKey: { startsWith: 'an-' } } });
  await prisma.device.deleteMany({ where: { deviceId: { startsWith: 'an-' } } });
  await prisma.searchLog.deleteMany({ where: { term: { startsWith: 'AN' } } });

  // The sales order has to go before the products: OrderItem.productId is RESTRICT.
  if (salesOrderId) {
    const orderRows = await prisma.order.findUnique({
      where: { id: salesOrderId },
      select: { subOrders: { select: { id: true } } },
    });
    const subIds = (orderRows?.subOrders ?? []).map((s: any) => s.id);
    await prisma.orderTimeline.deleteMany({ where: { orderId: salesOrderId } });
    await prisma.vendorEarning.deleteMany({ where: { orderId: salesOrderId } });
    await prisma.orderItem.deleteMany({ where: { orderId: salesOrderId } });
    await prisma.payment.deleteMany({ where: { orderId: salesOrderId } });
    await prisma.cartItem.deleteMany({ where: { productId: { in: [teeId] } } });
    await prisma.subOrder.deleteMany({ where: { id: { in: subIds } } });
    await prisma.order.deleteMany({ where: { id: salesOrderId } });
  }

  await prisma.cartItem.deleteMany({
    where: { productId: { in: [teeId, hat.body?.result?.productId] } },
  });
  await prisma.productVariant.deleteMany({
    where: { productId: { in: [teeId, hat.body?.result?.productId] } },
  });
  await prisma.product.deleteMany({
    where: { id: { in: [teeId, hat.body?.result?.productId] } },
  });
  // Scoped by the run id: Prisma compiles `contains` to a LIKE without escaping `_`,
  // so a prefix pattern like `an_` is really `%an_%` and would match
  // "superadmin@projectname.com" too. Digits are not LIKE metacharacters.
  await prisma.user.deleteMany({ where: { email: { contains: run } } });

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
  console.error(err?.stack ?? 'no stack');
  process.exitCode = 1;
  /* eslint-enable no-console */
});
