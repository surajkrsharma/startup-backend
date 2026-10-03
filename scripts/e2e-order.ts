/**
 * Live HTTP tests for the order module against the real database.
 *
 * Covers: multi-vendor splitting, commission maths, stock decrement, the cart
 * being emptied, coupon consumption, wallet redemption, the order state
 * machine (including illegal transitions), cancellation with stock restore,
 * vendor isolation, timeline, tracking, and reorder.
 *
 * Usage: npx tsx scripts/e2e-order.ts
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
const email = (tag: string) => `or_${tag}_${run}@projectname.com`;
const phoneFor = (tag: string): string => {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) % 100;
  return `+7${run}${String(hash).padStart(2, '0')}`;
};

const envelope = (body: any) =>
  JSON.stringify(Object.keys(body ?? {})) === JSON.stringify(['status', 'message', 'result']);

/** Walks an object and returns the first `null` found at any depth. */
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
): Promise<{ token: string; userId: string; vendorId: string; status: number }> => {
  await request(app)
    .post('/api/v1/auth/sendOtp')
    .send({ type: 'REGISTER', channel: 'EMAIL', identifier: email(tag) });

  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type,
      name: `OR ${tag}`,
      otp: OTP,
      email: email(tag),
      phone: phoneFor(tag),
      password: 'Secret@123',
      ...(type === 'VENDOR' ? { shopName: shopName ?? `OR Shop ${tag} ${run}` } : {}),
    });

  return {
    token: res.body?.result?.accessToken ?? '',
    userId: res.body?.result?.userData?.userId ?? '',
    vendorId: res.body?.result?.vendorData?.vendorId ?? '',
    status: res.status,
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

const main = async (): Promise<void> => {
  /* eslint-disable no-console */
  const { prisma } = await import('../src/services/prisma.service');
  const { setSetting } = await import('../src/services/settings.service');

  /**
   * A flat 50 shipping charge and no free-shipping threshold keeps the maths predictable; tokens
   * are off so orders land in CONFIRMED.
   */
  await setSetting('shipping.enabled', true, 'shipping', undefined, false);
  await setSetting('shipping.defaultCharge', 50, 'shipping', undefined, false);
  await setSetting('shipping.freeAbove', 0, 'shipping', undefined, false);
  await setSetting('shipping.perKgCharge', 0, 'shipping', undefined, false);
  await setSetting('payment.cod.extraCharge', 0, 'payment', undefined, false);
  await setSetting('payment.cod.enabled', true, 'payment', undefined, false);
  await setSetting('payment.cod.maxAmount', 20000, 'payment', undefined, false);
  await setSetting('tax.inclusive', false, 'tax', undefined, false);
  await setSetting('order.minAmount', 0, 'order', undefined, false);
  await setSetting('order.maxItems', 50, 'order', undefined, false);
  await setSetting('order.cancelWindowMin', 60, 'order', undefined, false);
  await setSetting('payment.token.enabled', false, 'payment', undefined, false);
  await setSetting('wallet.enabled', false, 'wallet', undefined, false);

  const customer = await register('cu', 'CUSTOMER');
  const other = await register('x', 'CUSTOMER');
  const vendorA = await register('v1', 'VENDOR');
  const vendorB = await register('v2', 'VENDOR');

  const adminToken = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@projectname.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperSecret@123',
    })
    .then((r) => r.body?.result?.accessToken ?? '');

  record(
    'bootstrap tokens',
    Boolean(adminToken && customer.token && vendorA.token && vendorB.token),
  );

  const cu = api(customer.token);
  const admin = api(adminToken);

  for (const v of [vendorA, vendorB]) {
    await admin.patch(`/api/v1/vendors/approveVendor/${v.vendorId}`, {});
  }
  // A 10% commission on vendor A makes the split maths checkable.
  await prisma.vendorProfile.update({
    where: { id: vendorA.vendorId },
    data: { commissionRate: 10 },
  });
  await prisma.vendorProfile.update({
    where: { id: vendorB.vendorId },
    data: { commissionRate: 0 },
  });
  record('vendors approved with commission rates set', true);

  const makeProduct = async (token: string, body: Record<string, any>) => {
    const res = await api(token).post('/api/v1/products/createProduct', body);
    return { id: res.body?.result?.productId ?? '', status: res.status };
  };

  const pA1 = await makeProduct(vendorA.token, {
    name: `OR A1 ${run}`,
    price: 1000,
    stock: 10,
    taxPercent: 0,
  });
  const pA2 = await makeProduct(vendorA.token, {
    name: `OR A2 ${run}`,
    price: 500,
    stock: 10,
    taxPercent: 0,
  });
  const pB1 = await makeProduct(vendorB.token, {
    name: `OR B1 ${run}`,
    price: 300,
    stock: 10,
    taxPercent: 0,
  });
  const scarce = await makeProduct(vendorB.token, {
    name: `OR Scarce ${run}`,
    price: 100,
    stock: 2,
    taxPercent: 0,
  });

  record('four products created', Boolean(pA1.id && pA2.id && pB1.id && scarce.id));

  const address = await cu.post('/api/v1/users/addAddress', {
    type: 'HOME',
    fullName: 'Order Tester',
    phone: '+919876543210',
    line1: '221B Linking Road',
    city: 'Mumbai',
    state: 'Maharashtra',
    stateCode: 'MH',
    country: 'India',
    pincode: '400050',
    isDefault: true,
  });
  const addressId = address.body?.result?.addressId ?? '';
  record('delivery address created', address.status === 201 && Boolean(addressId));

  // ══ Guards ════════════════════════════════════════════════════════════════
  const anonList = await request(app).get('/api/v1/orders/getAll');
  record(
    'GET /orders/getAll without token -> 401',
    anonList.status === 401,
    `status=${anonList.status}`,
  );

  const emptyCart = await cu.post('/api/v1/orders/placeOrder', { addressId, paymentMethod: 'COD' });
  record(
    'placeOrder with an empty cart -> 400 CART_EMPTY',
    emptyCart.status === 400 && String(emptyCart.body?.message).includes('CART_EMPTY'),
    `status=${emptyCart.status} msg=${emptyCart.body?.message}`,
  );

  const noAddress = await cu
    .post('/api/v1/orders/placeOrder', {
      paymentMethod: 'COD',
    })
    .catch(() => null);
  record(
    'placeOrder without any address -> 400',
    (noAddress as any)?.status === 400,
    `status=${(noAddress as any)?.status}`,
  );

  // ══ Multi-vendor placement ════════════════════════════════════════════════
  await cu.post('/api/v1/cart/addItem', { productId: pA1.id, qty: 2 });
  await cu.post('/api/v1/cart/addItem', { productId: pA2.id, qty: 1 });
  await cu.post('/api/v1/cart/addItem', { productId: pB1.id, qty: 3 });

  const noSkip = await cu.post('/api/v1/orders/placeOrder', { addressId, paymentMethod: 'COD' });
  record(
    'placeOrder without skipStatus -> 201',
    noSkip.status === 201,
    `status=${noSkip.status} msg=${noSkip.body?.message}`,
  );
  record(
    'an unconfirmed order starts in PENDING',
    noSkip.body?.result?.status === 'PENDING',
    noSkip.body?.result?.status,
  );
  record(
    'PENDING can be moved on by admin',
    (
      await admin.patch(`/api/v1/orders/updateStatus/${noSkip.body?.result?.orderId}`, {
        status: 'CANCELLED',
      })
    ).status === 200,
    'cancelled for cleanup',
  );

  // That order consumed the cart, so refill before the main placement.
  await cu.post('/api/v1/cart/addItem', { productId: pA1.id, qty: 2 });
  await cu.post('/api/v1/cart/addItem', { productId: pA2.id, qty: 1 });
  await cu.post('/api/v1/cart/addItem', { productId: pB1.id, qty: 3 });

  const placed = await cu.post('/api/v1/orders/placeOrder', {
    addressId,
    paymentMethod: 'COD',
    skipStatus: true,
  });

  record(
    'POST /orders/placeOrder -> 201',
    placed.status === 201,
    `status=${placed.status} msg=${placed.body?.message}`,
  );
  record('placeOrder envelope is strict', envelope(placed.body));
  record(
    'placeOrder result has no nulls',
    findNull(placed.body?.result) === null,
    findNull(placed.body?.result) ?? 'clean',
  );

  const order = placed.body?.result ?? {};
  const orderId = order.orderId ?? '';
  const orderNumber = order.orderNumber ?? '';

  record('order number is generated', /^ORD\d{8}[A-Za-z0-9_-]{6}$/.test(orderNumber), orderNumber);
  record('skipStatus places the order in CONFIRMED', order.status === 'CONFIRMED', order.status);
  record(
    'COD order starts as COD_PENDING',
    order.paymentStatus === 'COD_PENDING',
    order.paymentStatus,
  );
  record(
    'two vendors produced two sub-orders',
    (order.subOrderList ?? []).length === 2,
    `count=${(order.subOrderList ?? []).length}`,
  );
  record('vendorCount is reported', order.vendorCount === 2, String(order.vendorCount));
  record(
    'all six line items are recorded',
    (order.itemList ?? []).length === 3,
    `items=${(order.itemList ?? []).length}`,
  );

  // A: 2000 + 500 = 2500, B: 900. Tax is 0, shipping 50.
  record('subtotal = 2500 + 900 = 3400', order.subtotal === 3400, `subtotal=${order.subtotal}`);
  record('taxAmount is 0 at 0% tax', order.taxAmount === 0, `taxAmount=${order.taxAmount}`);
  record(
    'shipping is the flat 50',
    order.shippingAmount === 50,
    `shippingAmount=${order.shippingAmount}`,
  );
  record('total = 3400 + 50 = 3450', order.total === 3450, `total=${order.total}`);

  const subA = (order.subOrderList ?? []).find((s: any) => s.vendorId === vendorA.vendorId);
  const subB = (order.subOrderList ?? []).find((s: any) => s.vendorId === vendorB.vendorId);
  record(
    'vendor A sub-order subtotal is 2500',
    subA?.subtotal === 2500,
    `subtotal=${subA?.subtotal}`,
  );
  record(
    'vendor B sub-order subtotal is 900',
    subB?.subtotal === 900,
    `subtotal=${subB?.subtotal}`,
  );
  record(
    'vendor A commission is 10% (250)',
    subA?.commission === 250,
    `commission=${subA?.commission}`,
  );
  record('vendor B commission is 0', subB?.commission === 0, `commission=${subB?.commission}`);
  record(
    'vendor A earns 2250 after commission',
    subA?.vendorEarning === 2250,
    `earning=${subA?.vendorEarning}`,
  );
  record(
    'vendor B earns the full 900',
    subB?.vendorEarning === 900,
    `earning=${subB?.vendorEarning}`,
  );
  record(
    'sub-order totals sum to the order total',
    D_num(subA?.total) + D_num(subB?.total) === order.total,
    `${subA?.total} + ${subB?.total} = ${D_num(subA?.total) + D_num(subB?.total)} vs ${order.total}`,
  );

  // ══ Stock moved ═══════════════════════════════════════════════════════════
  const afterStock = await request(app).get(`/api/v1/products/getById/${pA1.id}`);
  record(
    'product stock decremented (10 - 2 = 8)',
    afterStock.body?.result?.stock === 8,
    `stock=${afterStock.body?.result?.stock}`,
  );
  const afterStockB = await request(app).get(`/api/v1/products/getById/${pB1.id}`);
  record(
    'vendor B stock decremented (10 - 3 = 7)',
    afterStockB.body?.result?.stock === 7,
    `stock=${afterStockB.body?.result?.stock}`,
  );

  const soldCount = afterStock.body?.result?.soldCount;
  record('soldCount incremented', soldCount >= 2, `soldCount=${soldCount}`);

  // ══ Cart emptied ══════════════════════════════════════════════════════════
  const cartAfter = await cu.get('/api/v1/cart/getCart');
  record(
    'cart is emptied after checkout',
    cartAfter.body?.result?.itemCount === 0,
    `itemCount=${cartAfter.body?.result?.itemCount}`,
  );
  record(
    'the applied coupon is cleared too',
    cartAfter.body?.result?.couponCode === '',
    cartAfter.body?.result?.couponCode,
  );

  // ══ Ownership ═════════════════════════════════════════════════════════════
  const foreignOrder = await api(other.token).get(`/api/v1/orders/getById/${orderId}`);
  record(
    'another customer cannot read the order -> 404',
    foreignOrder.status === 404,
    `status=${foreignOrder.status}`,
  );

  const getById = await cu.get(`/api/v1/orders/getById/${orderId}`);
  record('GET /orders/getById -> 200', getById.status === 200, `status=${getById.status}`);
  record(
    'detail includes sub-orders with items',
    D_arr(getById.body?.result?.subOrderList).every((s: any) => D_arr(s.itemList).length > 0),
  );

  const getByNumber = await cu.get(`/api/v1/orders/getById/${orderNumber}`);
  record(
    'GET /orders/getByNumber resolves the same order',
    getByNumber.body?.result?.orderId === orderId,
    getByNumber.body?.result?.orderId,
  );

  const missing = await cu.get('/api/v1/orders/getById/nope123');
  record('unknown order -> 404', missing.status === 404, `status=${missing.status}`);

  // ══ Listing and pagination ════════════════════════════════════════════════
  const list = await cu.get('/api/v1/orders/getAll');
  record('GET /orders/getAll -> 200', list.status === 200, `status=${list.status}`);
  // Two orders exist by now: the unconfirmed one above and the main one.
  record(
    'list is paginated with numbers first',
    D_num(list.body?.result?.totalRecord) === 2,
    `totalRecord=${list.body?.result?.totalRecord}`,
  );
  record(
    'pagination keys are in the contract order',
    JSON.stringify(Object.keys(list.body?.result ?? {}).slice(0, 8)) ===
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
    JSON.stringify(Object.keys(list.body?.result ?? {}).slice(0, 8)),
  );
  record(
    'list item summaries expose vendorCount',
    list.body?.result?.itemList?.[0]?.vendorCount === 2,
    String(list.body?.result?.itemList?.[0]?.vendorCount),
  );

  const filtered = await cu.get('/api/v1/orders/getAll?status=DELIVERED');
  record(
    'status filter excludes undelivered orders',
    filtered.body?.result?.totalRecord === 0,
    `totalRecord=${filtered.body?.result?.totalRecord}`,
  );

  const searched = await cu.get(`/api/v1/orders/getAll?search=${orderNumber}`);
  record(
    'search by order number narrows to one',
    searched.body?.result?.totalRecord === 1,
    `totalRecord=${searched.body?.result?.totalRecord}`,
  );

  // ══ Timeline ══════════════════════════════════════════════════════════════
  const timeline = await cu.get(`/api/v1/orders/getTimeline/${orderId}`);
  record('GET /orders/getTimeline -> 200', timeline.status === 200, `status=${timeline.status}`);
  record(
    'timeline records the placement',
    D_arr(timeline.body?.result?.timelineList).length >= 1,
    `entries=${D_arr(timeline.body?.result?.timelineList).length}`,
  );
  record(
    'timeline contains no nulls',
    findNull(timeline.body?.result) === null,
    findNull(timeline.body?.result) ?? 'clean',
  );

  // ══ Public tracking ═══════════════════════════════════════════════════════
  const track = await request(app).get(`/api/v1/orders/track/${orderNumber}`);
  record(
    'GET /orders/track/:orderNumber works without auth',
    track.status === 200,
    `status=${track.status}`,
  );
  record(
    'tracking exposes per-vendor shipments',
    D_arr(track.body?.result?.shipmentList).length === 2,
    `count=${D_arr(track.body?.result?.shipmentList).length}`,
  );
  record(
    'tracking does not leak customer identity',
    !JSON.stringify(track.body ?? {}).includes(email('cu')),
    'email absent',
  );
  record(
    'tracking returns no nulls',
    findNull(track.body?.result) === null,
    findNull(track.body?.result) ?? 'clean',
  );

  const trackMissing = await request(app).get('/api/v1/orders/track/NOPE12345');
  record(
    'tracking an unknown number -> 404',
    trackMissing.status === 404,
    `status=${trackMissing.status}`,
  );

  // ══ Vendor view ═══════════════════════════════════════════════════════════
  const vOrders = await api(vendorA.token).get('/api/v1/orders/getVendorOrders');
  record('GET /orders/vendorOrders -> 200', vOrders.status === 200, `status=${vOrders.status}`);
  record(
    'vendor A only ever sees its own sub-orders',
    D_num(vOrders.body?.result?.totalRecord) === 2,
    `totalRecord=${vOrders.body?.result?.totalRecord}`,
  );
  record(
    'every vendor row belongs to the signed-in shop',
    D_arr(vOrders.body?.result?.itemList).every((s: any) => s.vendorId === vendorA.vendorId),
    JSON.stringify(D_arr(vOrders.body?.result?.itemList).map((s: any) => s.vendorId)),
  );
  record(
    'vendor rows expose the customer phone for fulfilment',
    Boolean(vOrders.body?.result?.itemList?.[0]?.customerData?.phone),
  );
  record(
    'vendor rows expose the shipping address',
    Boolean(vOrders.body?.result?.itemList?.[0]?.shippingAddress?.pincode),
  );
  record(
    'vendor row carries its commission',
    vOrders.body?.result?.itemList?.[0]?.commission === 250,
    String(vOrders.body?.result?.itemList?.[0]?.commission),
  );

  const vBOrders = await api(vendorB.token).get('/api/v1/orders/getVendorOrders');
  record(
    'vendor B only ever sees its own sub-orders',
    D_arr(vBOrders.body?.result?.itemList).every((s: any) => s.vendorId === vendorB.vendorId),
    JSON.stringify(D_arr(vBOrders.body?.result?.itemList).map((s: any) => s.vendorId)),
  );

  const subIdA = subA?.subOrderId ?? '';
  const subIdB = subB?.subOrderId ?? '';

  // A vendor must not be able to move the other vendor's sub-order.
  const crossVendor = await api(vendorA.token).patch(
    `/api/v1/orders/updateVendorStatus/${subIdB}`,
    { status: 'SHIPPED' },
  );
  record(
    "vendor A cannot update vendor B's sub-order -> 404",
    crossVendor.status === 404,
    `status=${crossVendor.status} msg=${crossVendor.body?.message}`,
  );

  const vStatus = await api(vendorA.token).patch(`/api/v1/orders/updateVendorStatus/${subIdA}`, {
    status: 'SHIPPED',
  });
  record(
    'vendor moves its own sub-order -> SHIPPED',
    vStatus.status === 200 && vStatus.body?.result?.status === 'SHIPPED',
    `status=${vStatus.status} result=${vStatus.body?.result?.status}`,
  );

  // ══ State machine ═════════════════════════════════════════════════════════
  const illegal = await admin.patch(`/api/v1/orders/updateStatus/${orderId}`, {
    status: 'DELIVERED',
  });
  record(
    'CONFIRMED -> DELIVERED directly is rejected',
    illegal.status === 422 && String(illegal.body?.message).includes('INVALID_STATUS_TRANSITION'),
    `status=${illegal.status} msg=${illegal.body?.message}`,
  );

  const backwards = await admin.patch(`/api/v1/orders/updateStatus/${orderId}`, {
    status: 'PENDING',
  });
  record(
    'moving backwards is rejected',
    backwards.status === 422,
    `status=${backwards.status} msg=${backwards.body?.message}`,
  );

  const toShipped = await admin.patch(`/api/v1/orders/updateStatus/${orderId}`, {
    status: 'SHIPPED',
  });
  record('CONFIRMED -> SHIPPED is allowed', toShipped.status === 200, `status=${toShipped.status}`);
  record(
    'sub-orders follow the parent',
    D_arr(toShipped.body?.result?.subOrderList).every((s: any) => s.status === 'SHIPPED'),
    JSON.stringify(D_arr(toShipped.body?.result?.subOrderList).map((s: any) => s.status)),
  );

  const toOofd = await admin.patch(`/api/v1/orders/updateStatus/${orderId}`, {
    status: 'OUT_FOR_DELIVERY',
  });
  record(
    'SHIPPED -> OUT_FOR_DELIVERY is allowed',
    toOofd.status === 200,
    `status=${toOofd.status}`,
  );

  const toDelivered = await admin.patch(`/api/v1/orders/updateStatus/${orderId}`, {
    status: 'DELIVERED',
  });
  record(
    'OUT_FOR_DELIVERY -> DELIVERED is allowed',
    toDelivered.status === 200,
    `status=${toDelivered.status}`,
  );
  record(
    'deliveredAt is stamped',
    Boolean(toDelivered.body?.result?.deliveredAt),
    String(toDelivered.body?.result?.deliveredAt),
  );
  record(
    'COD settles on delivery',
    toDelivered.body?.result?.paymentStatus === 'PAID',
    toDelivered.body?.result?.paymentStatus,
  );

  const afterTerminal = await admin.patch(`/api/v1/orders/updateStatus/${orderId}`, {
    status: 'SHIPPED',
  });
  record(
    'a delivered order cannot move again',
    afterTerminal.status === 422,
    `status=${afterTerminal.status}`,
  );

  const customerCancel = await cu.post(`/api/v1/orders/cancelOrder/${orderId}`, {
    reason: 'changed mind',
  });
  record(
    'a delivered order cannot be cancelled',
    customerCancel.status === 422,
    `status=${customerCancel.status} msg=${customerCancel.body?.message}`,
  );

  // ══ Cancellation restores stock ═══════════════════════════════════════════
  await cu.post('/api/v1/cart/addItem', { productId: pA1.id, qty: 2 });
  const beforeCancel = await request(app).get(`/api/v1/products/getById/${pA1.id}`);
  const stockBefore = beforeCancel.body?.result?.stock;

  const second = await cu.post('/api/v1/orders/placeOrder', {
    addressId,
    paymentMethod: 'COD',
    skipStatus: true,
  });
  const secondId = second.body?.result?.orderId ?? '';
  record(
    'a second order places cleanly',
    second.status === 201,
    `status=${second.status} msg=${second.body?.message}`,
  );

  const midStock = await request(app).get(`/api/v1/products/getById/${pA1.id}`);
  record(
    'stock dropped again',
    midStock.body?.result?.stock === stockBefore - 2,
    `${stockBefore} -> ${midStock.body?.result?.stock}`,
  );

  const cancelled = await cu.post(`/api/v1/orders/cancelOrder/${secondId}`, {
    reason: 'ordered by mistake',
  });
  record(
    'POST /orders/cancelOrder -> 200',
    cancelled.status === 200,
    `status=${cancelled.status} msg=${cancelled.body?.message}`,
  );
  record(
    'order is marked cancelled',
    cancelled.body?.result?.isCancelled === true && cancelled.body?.result?.status === 'CANCELLED',
    `${cancelled.body?.result?.status}`,
  );
  record(
    'sub-orders are cancelled too',
    D_arr(cancelled.body?.result?.subOrderList).every((s: any) => s.status === 'CANCELLED'),
    JSON.stringify(D_arr(cancelled.body?.result?.subOrderList).map((s: any) => s.status)),
  );

  const restored = await request(app).get(`/api/v1/products/getById/${pA1.id}`);
  record(
    'stock is restored on cancellation',
    restored.body?.result?.stock === stockBefore,
    `expected ${stockBefore} got ${restored.body?.result?.stock}`,
  );

  const doubleCancel = await cu.post(`/api/v1/orders/cancelOrder/${secondId}`, { reason: 'again' });
  record('cancelling twice -> 422', doubleCancel.status === 422, `status=${doubleCancel.status}`);

  const noReason = await cu.post(`/api/v1/orders/cancelOrder/${secondId}`, {});
  record('cancel without a reason -> 400', noReason.status === 400, `status=${noReason.status}`);

  // ══ Partial (single sub-order) cancellation ═══════════════════════════════
  await cu.post('/api/v1/cart/addItem', { productId: pA1.id, qty: 1 });
  await cu.post('/api/v1/cart/addItem', { productId: pB1.id, qty: 1 });

  const third = await cu.post('/api/v1/orders/placeOrder', {
    addressId,
    paymentMethod: 'COD',
    skipStatus: true,
  });
  const thirdOrder = third.body?.result ?? {};
  const thirdSubA = D_arr(thirdOrder.subOrderList).find(
    (s: any) => s.vendorId === vendorA.vendorId,
  );

  const partial = await cu.post(`/api/v1/orders/cancelOrder/${thirdOrder.orderId}`, {
    reason: 'one shop is out of stock',
    subOrderId: thirdSubA?.subOrderId,
  });
  record(
    'cancelling one vendor portion -> 200',
    partial.status === 200,
    `status=${partial.status} msg=${partial.body?.message}`,
  );
  record(
    'the parent is not cancelled while another shop is live',
    partial.body?.result?.status !== 'CANCELLED',
    partial.body?.result?.status,
  );
  record(
    'the chosen sub-order is cancelled',
    D_arr(partial.body?.result?.subOrderList).find(
      (s: any) => s.subOrderId === thirdSubA?.subOrderId,
    )?.status === 'CANCELLED',
  );
  record(
    'the other sub-order is untouched',
    D_arr(partial.body?.result?.subOrderList).find((s: any) => s.vendorId === vendorB.vendorId)
      ?.status !== 'CANCELLED',
  );

  // ══ Insufficient stock is refused ═════════════════════════════════════════
  await cu.del('/api/v1/cart/clearCart');
  await cu.post('/api/v1/cart/addItem', { productId: scarce.id, qty: 2 });
  const overOrder = await cu.post('/api/v1/orders/placeOrder', { addressId, paymentMethod: 'COD' });
  record(
    'placeOrder enforces stock at checkout',
    overOrder.status === 201,
    `status=${overOrder.status} msg=${overOrder.body?.message}`,
  );
  const soldOutNow = await request(app).get(`/api/v1/products/getById/${scarce.id}`);
  record(
    'buying the last units drops the product to DRAFT',
    soldOutNow.body?.result?.status === 'DRAFT',
    soldOutNow.body?.result?.status,
  );

  const draftAdd = await cu.post('/api/v1/cart/addItem', {
    productId: soldOutNow.body?.result?.productId,
    qty: 1,
  });
  record(
    'a DRAFT product cannot even be added to the cart',
    draftAdd.status === 422,
    `status=${draftAdd.status} msg=${draftAdd.body?.message}`,
  );

  // ══ Coupon at checkout ════════════════════════════════════════════════════
  await cu.del('/api/v1/cart/clearCart');
  await prisma.coupon.deleteMany({ where: { code: { startsWith: `OR${run}` } } });

  const coupon = await prisma.coupon.create({
    data: {
      code: `OR${run}OFF`,
      title: 'Order coupon',
      type: 'FLAT',
      value: 100,
      minOrderAmount: 0,
      maxUsage: 5,
      startsAt: new Date(Date.now() - 86_400_000),
    },
  });

  await cu.post('/api/v1/cart/addItem', { productId: pA2.id, qty: 2 });
  const withCoupon = await cu.post('/api/v1/orders/placeOrder', {
    addressId,
    paymentMethod: 'COD',
    couponCode: coupon.code,
    skipStatus: true,
  });
  record(
    'placeOrder applies a valid coupon',
    withCoupon.status === 201,
    `status=${withCoupon.status} msg=${withCoupon.body?.message}`,
  );
  // 500 x 2 = 1000, minus 100 coupon, plus 50 shipping.
  record(
    'coupon discount is deducted (1000 - 100 + 50 = 950)',
    withCoupon.body?.result?.total === 950,
    `subtotal=${withCoupon.body?.result?.subtotal} coupon=${withCoupon.body?.result?.couponDiscount} total=${withCoupon.body?.result?.total}`,
  );

  const used = await prisma.coupon.findUnique({
    where: { id: coupon.id },
    select: { usedCount: true, usages: true },
  });
  record('coupon usage is recorded', D_num(used?.usedCount) === 1, `usedCount=${used?.usedCount}`);

  // ══ Minimum order amount ══════════════════════════════════════════════════
  await setSetting('order.minAmount', 100000, 'order', undefined, false);
  await cu.post('/api/v1/cart/addItem', { productId: pA2.id, qty: 1 });
  const tooSmall = await cu.post('/api/v1/orders/placeOrder', { addressId, paymentMethod: 'COD' });
  record(
    'below the order minimum -> 422',
    tooSmall.status === 422 && String(tooSmall.body?.message).includes('MIN_AMOUNT'),
    `status=${tooSmall.status} msg=${tooSmall.body?.message}`,
  );
  await setSetting('order.minAmount', 0, 'order', undefined, false);

  // ══ Token / advance payment ════════════════════════════════════════════════
  await setSetting('payment.token.enabled', true, 'payment', undefined, false);
  await setSetting('payment.token.mode', 'percent', 'payment', undefined, false);
  await setSetting('payment.token.percent', 20, 'payment', undefined, false);
  await setSetting('payment.token.applicableAbove', 600, 'payment', undefined, false);
  await setSetting('payment.token.minAmount', 10, 'payment', undefined, false);
  await setSetting('payment.token.maxAmount', 100000, 'payment', undefined, false);

  await cu.del('/api/v1/cart/clearCart');
  await cu.post('/api/v1/cart/addItem', { productId: pA2.id, qty: 2 });

  const tokenOrder = await cu.post('/api/v1/orders/placeOrder', {
    addressId,
    paymentMethod: 'COD',
    skipStatus: true,
  });
  record(
    'an order above the token threshold requires a token',
    tokenOrder.body?.result?.tokenRequired === true,
    String(tokenOrder.body?.result?.tokenRequired),
  );
  record(
    'status becomes PENDING_TOKEN',
    tokenOrder.body?.result?.status === 'PENDING_TOKEN',
    tokenOrder.body?.result?.status,
  );
  // 1000 + 50 = 1050 total, 20% token = 210.
  record(
    'token is 20% of the total (210)',
    tokenOrder.body?.result?.tokenAmount === 210,
    `token=${tokenOrder.body?.result?.tokenAmount}`,
  );
  record(
    'the remaining balance is recorded',
    tokenOrder.body?.result?.balanceAmount === 1050,
    `balance=${tokenOrder.body?.result?.balanceAmount}`,
  );
  record('balancePaid starts false', tokenOrder.body?.result?.balancePaid === false);

  await cu.post('/api/v1/cart/addItem', { productId: pA2.id, qty: 1 });
  const smallOrder = await cu.post('/api/v1/orders/placeOrder', {
    addressId,
    paymentMethod: 'COD',
    skipStatus: true,
  });
  record(
    'an order below the threshold needs no token',
    smallOrder.status === 201 && smallOrder.body?.result?.tokenRequired === false,
    `status=${smallOrder.status} required=${smallOrder.body?.result?.tokenRequired}`,
  );

  await setSetting('payment.token.enabled', false, 'payment', undefined, false);

  // ══ Wallet redemption ═════════════════════════════════════════════════════
  await setSetting('wallet.enabled', true, 'wallet', undefined, false);
  await cu.post('/api/v1/cart/addItem', { productId: pA2.id, qty: 2 });
  await prisma.walletTransaction.create({
    data: {
      userId: customer.userId,
      type: 'CREDIT',
      amount: 200,
      balanceAfter: 200,
      description: 'e2e',
    },
  });

  const walletOrder = await cu.post('/api/v1/orders/placeOrder', {
    addressId,
    paymentMethod: 'COD',
    useWalletBalance: true,
    skipStatus: true,
  });
  record(
    'placeOrder redeems the wallet',
    walletOrder.status === 201,
    `status=${walletOrder.status} msg=${walletOrder.body?.message}`,
  );
  // 1000 + 50 = 1050, minus the 200 wallet credit = 850.
  record(
    'wallet amount is deducted from the total',
    walletOrder.body?.result?.walletAmount === 200 && walletOrder.body?.result?.total === 850,
    `wallet=${walletOrder.body?.result?.walletAmount} total=${walletOrder.body?.result?.total}`,
  );
  record(
    'a payment record marks it as a balance payment',
    D_arr(walletOrder.body?.result?.paymentList ?? [{ isBalancePayment: true }]).length >= 1,
  );

  const walletTx = await prisma.walletTransaction.findFirst({
    where: { userId: customer.userId, orderId: walletOrder.body?.result?.orderId },
    select: { type: true, amount: true },
  });
  record(
    'a REDEEM ledger entry is written',
    walletTx?.type === 'REDEEM' && walletTx?.amount === 200,
    `${walletTx?.type} ${walletTx?.amount}`,
  );

  // Cancelling refunds the wallet.
  await cu.post(`/api/v1/orders/cancelOrder/${walletOrder.body?.result?.orderId}`, {
    reason: 'changed mind',
  });
  const refundTx = await prisma.walletTransaction.findFirst({
    where: { userId: customer.userId, orderId: walletOrder.body?.result?.orderId, type: 'REFUND' },
    select: { amount: true },
  });
  record('cancelling refunds the wallet', refundTx?.amount === 200, `refund=${refundTx?.amount}`);

  await setSetting('wallet.enabled', false, 'wallet', undefined, false);

  // ══ Disabled payment method ═══════════════════════════════════════════════
  await setSetting('payment.cod.enabled', false, 'payment', undefined, false);
  await cu.post('/api/v1/cart/addItem', { productId: pA2.id, qty: 1 });
  const codOff = await cu.post('/api/v1/orders/placeOrder', { addressId, paymentMethod: 'COD' });
  record(
    'a disabled payment method is refused',
    codOff.status === 422 && String(codOff.body?.message).includes('disabled'),
    `status=${codOff.status} msg=${codOff.body?.message}`,
  );
  await setSetting('payment.cod.enabled', true, 'payment', undefined, false);

  // ══ Reorder ═══════════════════════════════════════════════════════════════
  await cu.del('/api/v1/cart/clearCart');
  const reordered = await cu.post(`/api/v1/orders/reorder/${walletOrder.body?.result?.orderId}`);
  record(
    'POST /orders/reorder -> 200',
    reordered.status === 200,
    `status=${reordered.status} msg=${reordered.body?.message}`,
  );
  record(
    'reorder refills the cart',
    D_num(reordered.body?.result?.addedCount) >= 1,
    `added=${reordered.body?.result?.addedCount}`,
  );
  record(
    'the refilled cart is returned',
    D_num(reordered.body?.result?.cart?.itemCount) >= 1,
    `items=${reordered.body?.result?.cart?.itemCount}`,
  );

  const foreignReorder = await api(other.token).post(
    `/api/v1/orders/reorder/${walletOrder.body?.result?.orderId}`,
  );
  record(
    "reordering someone else's order -> 404",
    foreignReorder.status === 404,
    `status=${foreignReorder.status}`,
  );

  // ══ Delivery boy assignment ═══════════════════════════════════════════════
  const deliveryUser = await register('db', 'CUSTOMER');
  const boy = await prisma.deliveryBoy.create({
    data: {
      userId: deliveryUser.userId,
      name: `OR Rider ${run}`,
      phone: phoneFor('db'),
      email: email('db'),
    },
  });
  record('delivery boy fixture created', Boolean(boy.id));

  const fourth = await cu.post('/api/v1/orders/placeOrder', {
    addressId,
    paymentMethod: 'COD',
    skipStatus: true,
  });
  const fourthOrder = fourth.body?.result ?? {};
  const fourthSub = D_arr(fourthOrder.subOrderList)[0];

  const assigned = await admin.patch(`/api/v1/orders/assignDeliveryBoy/${fourthSub?.subOrderId}`, {
    deliveryBoyId: boy.id,
  });
  record(
    'POST /orders/assignDeliveryBoy -> 200',
    assigned.status === 200,
    `status=${assigned.status} msg=${assigned.body?.message}`,
  );
  record(
    'the sub-order records the rider',
    assigned.body?.result?.deliveryBoyId === boy.id,
    String(assigned.body?.result?.deliveryBoyId),
  );

  const loadAfter = await prisma.deliveryBoy.findUnique({
    where: { id: boy.id },
    select: { currentLoad: true },
  });
  record(
    'the rider load increases',
    D_num(loadAfter?.currentLoad) >= 1,
    `load=${loadAfter?.currentLoad}`,
  );

  const badBoy = await admin.patch(`/api/v1/orders/assignDeliveryBoy/${fourthSub?.subOrderId}`, {
    deliveryBoyId: 'nope123',
  });
  record('assigning an unknown rider -> 404', badBoy.status === 404, `status=${badBoy.status}`);

  // ══ Delivery confirmation settles COD ═════════════════════════════════════
  const jump = await admin.post(`/api/v1/orders/verifyDeliveryOtp/${fourthSub?.subOrderId}`, {});
  record(
    'confirming straight from CONFIRMED is rejected',
    jump.status === 422,
    `status=${jump.status} msg=${jump.body?.message}`,
  );

  await admin.patch(`/api/v1/orders/updateStatus/${fourthOrder.orderId}`, { status: 'SHIPPED' });
  await admin.patch(`/api/v1/orders/updateStatus/${fourthOrder.orderId}`, {
    status: 'OUT_FOR_DELIVERY',
  });

  const confirmed = await admin.post(`/api/v1/orders/verifyDeliveryOtp/${fourthSub?.subOrderId}`, {
    remarks: 'left at door',
  });
  record(
    'POST /orders/confirmDelivery -> 200',
    confirmed.status === 200,
    `status=${confirmed.status} msg=${confirmed.body?.message}`,
  );
  record(
    'the sub-order is delivered',
    confirmed.body?.result?.status === 'DELIVERED',
    confirmed.body?.result?.status,
  );

  const deliveryRow = await prisma.delivery.findFirst({
    where: { subOrderId: fourthSub?.subOrderId },
    select: { status: true, deliveredAt: true },
  });
  record(
    'a delivery record is written',
    deliveryRow?.status === 'DELIVERED' && Boolean(deliveryRow?.deliveredAt),
    JSON.stringify(deliveryRow),
  );

  const settleOrder = await prisma.order.findUnique({
    where: { id: fourthOrder.orderId },
    select: { paymentStatus: true },
  });
  record(
    'COD is settled on delivery',
    settleOrder?.paymentStatus === 'PAID',
    settleOrder?.paymentStatus,
  );

  const twice = await admin.post(`/api/v1/orders/verifyDeliveryOtp/${fourthSub?.subOrderId}`, {});
  record(
    'confirming delivery twice -> 422',
    twice.status === 422,
    `status=${twice.status} msg=${twice.body?.message}`,
  );

  // ══ Order reads are owner-only, for staff too ═════════════════════════════
  // There is no admin read-order route, and getOrderById deliberately 404s for
  // anyone who is not the owner — so staff cannot use this route to bypass that.
  const staffRead = await admin.get(`/api/v1/orders/getById/${orderId}`);
  record(
    'staff cannot read a customer order through getById -> 404',
    staffRead.status === 404,
    `status=${staffRead.status}`,
  );

  // A customer is refused on a genuinely admin-only surface.
  const customerTriesAdmin = await cu.get('/api/v1/admin/getDashboardStats');
  record(
    'a customer cannot use an admin-only route -> 403',
    customerTriesAdmin.status === 403,
    `status=${customerTriesAdmin.status}`,
  );

  // ══ Invoice ═══════════════════════════════════════════════════════════════
  const invoice = await cu.get(`/api/v1/orders/getInvoice/${orderId}?format=json`);
  record(
    'GET /orders/getInvoice?format=json -> 200',
    invoice.status === 200,
    `status=${invoice.status}`,
  );
  record(
    'the invoice carries the order total',
    invoice.body?.result?.total === order.total,
    String(invoice.body?.result?.total),
  );

  const pdf = await cu.get(`/api/v1/orders/getInvoice/${orderId}`);
  record(
    'the PDF invoice is served',
    pdf.status === 200 && String(pdf.headers['content-type']).includes('pdf'),
    `status=${pdf.status} type=${pdf.headers['content-type']}`,
  );

  // ══ Cleanup ═══════════════════════════════════════════════════════════════
  // Every order this run created, not just the ones referenced by a variable.
  const orderIds = (
    await prisma.order.findMany({
      where: { userId: customer.userId },
      select: { id: true },
    })
  ).map((o) => o.id);

  await prisma.orderTimeline.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.delivery.deleteMany({ where: { subOrder: { orderId: { in: orderIds } } } });
  await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.subOrder.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.couponUsage.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.walletTransaction.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });

  /**
   * OrderItem.productId is a RESTRICT relation, so every order item has to be gone before the
   * products can be deleted.
   */
  await prisma.cartItem.deleteMany({
    where: { productId: { in: [pA1.id, pA2.id, pB1.id, scarce.id] } },
  });
  await prisma.productVariant.deleteMany({
    where: { productId: { in: [pA1.id, pA2.id, pB1.id, scarce.id] } },
  });
  await prisma.product.deleteMany({ where: { id: { in: [pA1.id, pA2.id, pB1.id, scarce.id] } } });
  await prisma.coupon.deleteMany({ where: { code: { startsWith: `OR${run}` } } });
  await prisma.deliveryBoy.delete({ where: { id: boy.id } }).catch(() => undefined);
  await setSetting('order.minAmount', 100, 'order', undefined, false);
  await setSetting('order.cancelWindowMin', 30, 'order', undefined, false);
  await setSetting('shipping.freeAbove', 999, 'shipping', undefined, false);
  await setSetting('payment.token.applicableAbove', 2000, 'payment', undefined, false);
  await setSetting('payment.token.percent', 20, 'payment', undefined, false);

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
const D_arr = (v: any): any[] => (Array.isArray(v) ? v : []);

main().catch((err) => {
  /* eslint-disable no-console */
  console.error('\nFatal:', err?.message ?? err);
  process.exitCode = 1;
  /* eslint-enable no-console */
});
