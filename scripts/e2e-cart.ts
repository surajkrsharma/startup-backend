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
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  /* eslint-enable no-console */
};

const run = Date.now().toString().slice(-9);
const email = (tag: string) => `ct_${tag}_${run}@projectname.com`;
const phoneFor = (tag: string): string => {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) % 100;
  return `+7${run}${String(hash).padStart(2, '0')}`;
};

const envelope = (body: any) =>
  JSON.stringify(Object.keys(body ?? {})) === JSON.stringify(['status', 'message', 'result']);

const strictEnvelope = (body: any) =>
  envelope(body) &&
  body.result !== null &&
  typeof body.result === 'object' &&
  !Array.isArray(body.result);

const findNull = (value: any, depth = 0): string | null => {
  if (depth > 8) return null;
  if (value === null) return 'null at depth ' + depth;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findNull(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const hit = findNull(value[key], depth + 1);
      if (hit) return `${key}: ${hit}`;
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
      name: `CT ${tag}`,
      otp: OTP,
      email: email(tag),
      phone: phoneFor(tag),
      password: 'Secret@123',
      ...(type === 'VENDOR' ? { shopName: shopName ?? `CT Shop ${tag} ${run}` } : {}),
    });

  return {
    token: res.body?.result?.accessToken ?? '',
    userId: res.body?.result?.userData?.userId ?? '',
    vendorId: res.body?.result?.vendorData?.vendorId ?? '',
    status: res.status,
  };
};

const api = (token: string) => ({
  get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`),
  post: (path: string, body?: any) =>
    request(app)
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body ?? {}),
  patch: (path: string, body?: any) =>
    request(app)
      .patch(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body ?? {}),
  del: (path: string) => request(app).del(path).set('Authorization', `Bearer ${token}`),
});

const main = async (): Promise<void> => {
  /* eslint-disable no-console */
  const { prisma } = await import('../src/services/prisma.service');
  const { setSetting } = await import('../src/services/settings.service');

  await setSetting('shipping.enabled', true, 'shipping', undefined, false);
  await setSetting('shipping.defaultCharge', 50, 'shipping', undefined, false);
  await setSetting('shipping.freeAbove', 0, 'shipping', undefined, false);
  await setSetting('shipping.perKgCharge', 0, 'shipping', undefined, false);
  await setSetting('payment.cod.extraCharge', 0, 'payment', undefined, false);
  await setSetting('payment.cod.enabled', true, 'payment', undefined, false);
  await setSetting('payment.cod.maxAmount', 20_000, 'payment', undefined, false);
  await setSetting('tax.inclusive', false, 'tax', undefined, false);
  await setSetting('tax.defaultGstPercent', 18, 'tax', undefined, false);
  await setSetting('cart.maxItems', 3, 'cart', undefined, false);
  await setSetting('wallet.enabled', true, 'wallet', undefined, false);
  await setSetting('wallet.maxBalance', 5000, 'wallet', undefined, false);
  await setSetting('wallet.minRedeem', 100, 'wallet', undefined, false);

  const customer = await register('cu', 'CUSTOMER');
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
  const vA = api(vendorA.token);
  const vB = api(vendorB.token);

  const anon = await request(app).get('/api/v1/cart/getCart');
  record('GET /cart/getCart without token -> 401', anon.status === 401, `status=${anon.status}`);

  const makeProduct = async (
    token: string,
    body: Record<string, any>,
  ): Promise<{ id: string; slug: string; status: number }> => {
    const res = await api(token).post('/api/v1/products/createProduct', body);
    return {
      id: res.body?.result?.productId ?? '',
      slug: res.body?.result?.slug ?? '',
      status: res.status,
    };
  };

  for (const v of [vendorA, vendorB]) {
    await api(adminToken).patch(`/api/v1/vendors/approveVendor/${v.vendorId}`, {});
  }
  record('both vendors approved', true);

  const shirt = await makeProduct(vendorA.token, {
    name: `CT Shirt ${run}`,
    price: 1000,
    mrpPrice: 1400,
    stock: 10,
    taxPercent: 10,
    weight: 0.5,
  });

  const cap = await makeProduct(vendorB.token, {
    name: `CT Cap ${run}`,
    price: 400,
    stock: 3,
    taxPercent: 0,
  });

  const scarce = await makeProduct(vendorB.token, {
    name: `CT Scarce ${run}`,
    price: 250,
    stock: 1,
  });

  const variantProduct = await makeProduct(vendorA.token, {
    name: `CT Variant Tee ${run}`,
    price: 800,
    stock: 6,
    taxPercent: 5,
    variants: [
      { title: 'S', sku: `CT-S-${run}`, attributes: { size: 'S' }, price: 800, stock: 4 },
      { title: 'M', sku: `CT-M-${run}`, attributes: { size: 'M' }, price: 820, stock: 2 },
    ],
  });

  const soldOut = await makeProduct(vendorB.token, {
    name: `CT Sold Out ${run}`,
    price: 300,
    stock: 0,
  });

  record(
    'four sellable products created',
    Boolean(shirt.id && cap.id && scarce.id && variantProduct.id),
  );
  record('zero-stock product lands DRAFT', soldOut.status === 201, `status=${soldOut.status}`);

  const empty = await cu.get('/api/v1/cart/getCart');
  record(
    'GET /cart/getCart on a new account -> 200',
    empty.status === 200,
    `status=${empty.status}`,
  );
  record(
    'empty cart returns itemCount 0',
    empty.body?.result?.itemCount === 0,
    String(empty.body?.result?.itemCount),
  );
  record('getCart envelope is strict', strictEnvelope(empty.body));
  record(
    'getCart contains no nulls',
    findNull(empty.body?.result) === null,
    findNull(empty.body?.result) ?? 'clean',
  );

  const emptyEstimate = await cu.post('/api/v1/cart/estimate', { paymentMethod: 'COD' });
  record(
    'estimate on empty cart -> 400 Cart is empty',
    emptyEstimate.status === 400 && String(emptyEstimate.body?.message).includes('Cart is empty'),
    `status=${emptyEstimate.status} msg=${emptyEstimate.body?.message}`,
  );

  const add1 = await cu.post('/api/v1/cart/addItem', { productId: shirt.id, qty: 2 });
  record(
    'POST /cart/addItem -> 201',
    add1.status === 201,
    `status=${add1.status} msg=${add1.body?.message}`,
  );
  record('addItem envelope is strict', strictEnvelope(add1.body));
  record('addItem returns cartItemId', Boolean(add1.body?.result?.cartItemId));
  record(
    'addItem lineTotal = 1000 x 2 = 2000',
    add1.body?.result?.lineTotal === 2000,
    String(add1.body?.result?.lineTotal),
  );

  const add2 = await cu.post('/api/v1/cart/addItem', { productId: shirt.id, qty: 3 });
  record(
    'adding the same product again accumulates qty (2+3=5)',
    add2.body?.result?.qty === 5,
    `qty=${add2.body?.result?.qty}`,
  );

  const afterAdd = await cu.get('/api/v1/cart/getCart');
  const cart = afterAdd.body?.result ?? {};
  record(
    'cart holds exactly 1 line after two adds',
    cart.itemCount === 1,
    `itemCount=${cart.itemCount}`,
  );
  record('totalQty is 5', cart.totalQty === 5, `totalQty=${cart.totalQty}`);
  record('subtotal = 5000', cart.subtotal === 5000, `subtotal=${cart.subtotal}`);
  record('taxAmount = 10% of 5000 = 500', cart.taxAmount === 500, `taxAmount=${cart.taxAmount}`);
  record(
    'shippingAmount = flat 50',
    cart.shippingAmount === 50,
    `shippingAmount=${cart.shippingAmount}`,
  );
  record('total = 5000 + 500 + 50 = 5550', cart.total === 5550, `total=${cart.total}`);

  await api(vendorA.token).patch(`/api/v1/products/updateProduct/${shirt.id}`, { price: 1200 });
  const repriced = await cu.get('/api/v1/cart/getCart');
  record(
    'price change is reflected live (5 x 1200 = 6000)',
    repriced.body?.result?.subtotal === 6000,
    `subtotal=${repriced.body?.result?.subtotal}`,
  );
  record(
    'tax follows the new price (10% of 6000 = 600)',
    repriced.body?.result?.taxAmount === 600,
    `taxAmount=${repriced.body?.result?.taxAmount}`,
  );

  const overSell = await cu.post('/api/v1/cart/addItem', { productId: shirt.id, qty: 999 });
  record(
    'qty beyond stock -> 422 OUT_OF_STOCK',
    overSell.status === 422 && String(overSell.body?.message).includes('OUT_OF_STOCK'),
    `status=${overSell.status} msg=${overSell.body?.message}`,
  );

  const zeroStock = await cu.post('/api/v1/cart/addItem', { productId: soldOut.id, qty: 1 });
  record(
    'out-of-stock product -> 422',
    zeroStock.status === 422,
    `status=${zeroStock.status} msg=${zeroStock.body?.message}`,
  );

  await prisma.vendorProfile.update({
    where: { id: vendorA.vendorId },
    data: { status: 'SUSPENDED' },
  });
  const suspendedAdd = await cu.post('/api/v1/cart/addItem', { productId: shirt.id, qty: 1 });
  record(
    'addItem from a SUSPENDED vendor -> 403 VENDOR_NOT_APPROVED',
    suspendedAdd.status === 403 &&
      String(suspendedAdd.body?.message).includes('VENDOR_NOT_APPROVED'),
    `status=${suspendedAdd.status} msg=${suspendedAdd.body?.message}`,
  );
  await prisma.vendorProfile.update({
    where: { id: vendorA.vendorId },
    data: { status: 'APPROVED' },
  });

  const badQty = await cu.post('/api/v1/cart/addItem', { productId: cap.id, qty: 0 });
  record('addItem qty 0 -> 400 validation', badQty.status === 400, `status=${badQty.status}`);

  const noProduct = await cu.post('/api/v1/cart/addItem', { productId: 'nope123', qty: 1 });
  record('addItem unknown product -> 404', noProduct.status === 404, `status=${noProduct.status}`);

  const addCap = await cu.post('/api/v1/cart/addItem', { productId: cap.id, qty: 2 });
  record('addItem for a second vendor -> 201', addCap.status === 201, `status=${addCap.status}`);

  const multi = await cu.get('/api/v1/cart/getCart');
  const groups = multi.body?.result?.vendorGroupList ?? [];
  record('vendorGroupList splits by shop', groups.length === 2, `groups=${groups.length}`);
  record(
    'group subtotals are per-vendor',
    groups.some((g: any) => g.subtotal === 6000) && groups.some((g: any) => g.subtotal === 800),
    JSON.stringify(groups.map((g: any) => [g.subtotal, g.itemCount])),
  );
  record(
    'shopName is populated on each group',
    groups.every((g: any) => typeof g.shopName === 'string' && g.shopName.length > 0),
    JSON.stringify(groups.map((g: any) => g.shopName)),
  );

  const variantFull = await vA.get(`/api/v1/products/getById/${variantProduct.id}`);
  const variantList = variantFull.body?.result?.variantList ?? [];
  record(
    'variant product exposes 2 variants',
    variantList.length === 2,
    `count=${variantList.length}`,
  );

  const smallVariant = variantList.find((v: any) => v.title === 'S');
  const addVariant = await cu.post('/api/v1/cart/addItem', {
    productId: variantProduct.id,
    variantId: smallVariant?.variantId,
    qty: 2,
  });
  record(
    'addItem with a variantId -> 201',
    addVariant.status === 201,
    `status=${addVariant.status}`,
  );
  record(
    'variant price overrides the product price (2 x 800 = 1600)',
    addVariant.body?.result?.lineTotal === 1600,
    `lineTotal=${addVariant.body?.result?.lineTotal}`,
  );

  const fourth = await cu.post('/api/v1/cart/addItem', { productId: scarce.id, qty: 1 });
  record(
    'fourth distinct line -> 422 CART_MAX_ITEMS',
    fourth.status === 422 && String(fourth.body?.message).includes('CART_MAX_ITEMS'),
    `status=${fourth.status} msg=${fourth.body?.message}`,
  );

  record(
    'raising qty on an existing line still works at the cap',
    (await cu.post('/api/v1/cart/addItem', { productId: shirt.id, qty: 1 })).status === 201,
  );

  const updated = await cu.patch('/api/v1/cart/updateItem', { productId: shirt.id, qty: 2 });
  record('PATCH /cart/updateItem -> 200', updated.status === 200, `status=${updated.status}`);
  record(
    'updateItem sets the quantity (not accumulates)',
    updated.body?.result?.itemList?.find((i: any) => i.productId === shirt.id)?.qty === 2,
    JSON.stringify(updated.body?.result?.itemList?.map((i: any) => [i.productId, i.qty])),
  );

  const updatedOver = await cu.patch('/api/v1/cart/updateItem', { productId: cap.id, qty: 99 });
  record(
    'updateItem beyond stock -> 422',
    updatedOver.status === 422,
    `status=${updatedOver.status} msg=${updatedOver.body?.message}`,
  );

  const updateMissing = await cu.patch('/api/v1/cart/updateItem', { productId: 'nope123', qty: 1 });
  record(
    'updateItem unknown line -> 404',
    updateMissing.status === 404,
    `status=${updateMissing.status}`,
  );

  const hasBoth = await cu.get('/api/v1/cart/getCart');
  const ids = (hasBoth.body?.result?.itemList ?? []).map(
    (i: any) => `${i.productId}:${i.variantId}`,
  );
  record(
    'product line and variant line coexist',
    ids.includes(`${shirt.id}:`) && ids.some((i: string) => i.startsWith(`${variantProduct.id}:`)),
    JSON.stringify(ids),
  );

  await prisma.coupon.deleteMany({ where: { code: { startsWith: `CT${run}` } } });

  const flat = await prisma.coupon.create({
    data: {
      code: `CT${run}FLAT`,
      title: 'Flat 200 off',
      type: 'FLAT',
      value: 200,
      maxDiscount: 0,

      minOrderAmount: 4200,
      maxUsage: 2,
      startsAt: new Date(Date.now() - 86_400_000),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  record('flat coupon fixture created', Boolean(flat.id));

  const pct = await prisma.coupon.create({
    data: {
      code: `CT${run}PCT`,
      title: '10% off capped at 150',
      type: 'PERCENT',
      value: 10,
      maxDiscount: 150,
      minOrderAmount: 0,
      startsAt: new Date(Date.now() - 86_400_000),
    },
  });

  const expired = await prisma.coupon.create({
    data: {
      code: `CT${run}OLD`,
      title: 'Expired',
      type: 'FLAT',
      value: 100,
      minOrderAmount: 0,
      startsAt: new Date(Date.now() - 172_800_000),
      expiresAt: new Date(Date.now() - 86_400_000),
    },
  });

  const minOrder = await prisma.coupon.create({
    data: {
      code: `CT${run}BIG`,
      title: 'Needs 99999',
      type: 'FLAT',
      value: 100,
      minOrderAmount: 99_999,
      startsAt: new Date(Date.now() - 86_400_000),
    },
  });

  const usedUp = await prisma.coupon.create({
    data: {
      code: `CT${run}USED`,
      title: 'Exhausted',
      type: 'FLAT',
      value: 100,
      minOrderAmount: 0,
      maxUsage: 1,
      usedCount: 1,
      startsAt: new Date(Date.now() - 86_400_000),
    },
  });

  const inactive = await prisma.coupon.create({
    data: {
      code: `CT${run}OFF`,
      title: 'Disabled',
      type: 'FLAT',
      value: 100,
      minOrderAmount: 0,
      isActive: false,
      startsAt: new Date(Date.now() - 86_400_000),
    },
  });

  const vendorScoped = await prisma.coupon.create({
    data: {
      code: `CT${run}VEN`,
      title: 'Vendor B only',
      type: 'FLAT',
      value: 50,
      minOrderAmount: 0,
      vendorId: vendorB.vendorId,
      startsAt: new Date(Date.now() - 86_400_000),
    },
  });

  const unknown = await cu.post('/api/v1/cart/applyCoupon', { code: `CT${run}ZZZZ` });
  record(
    'unknown coupon -> 404 COUPON_NOT_FOUND',
    unknown.status === 404 && String(unknown.body?.message).includes('COUPON_NOT_FOUND'),
    `status=${unknown.status} msg=${unknown.body?.message}`,
  );

  const expRes = await cu.post('/api/v1/cart/applyCoupon', { code: `CT${run}OLD` });
  record(
    'expired coupon -> 422 EXPIRED',
    expRes.status === 422 && String(expRes.body?.message).includes('expired'),
    `status=${expRes.status} msg=${expRes.body?.message}`,
  );

  const bigRes = await cu.post('/api/v1/cart/applyCoupon', { code: `CT${run}BIG` });
  record(
    'minimum not met -> 422',
    bigRes.status === 422 && String(bigRes.body?.message).includes('minimum'),
    `status=${bigRes.status} msg=${bigRes.body?.message}`,
  );

  const usedRes = await cu.post('/api/v1/cart/applyCoupon', { code: `CT${run}USED` });
  record(
    'usage cap reached -> 422',
    usedRes.status === 422 && String(usedRes.body?.message).includes('usage limit'),
    `status=${usedRes.status} msg=${usedRes.body?.message}`,
  );

  const offRes = await cu.post('/api/v1/cart/applyCoupon', { code: `CT${run}OFF` });
  record(
    'inactive coupon -> 422',
    offRes.status === 422,
    `status=${offRes.status} msg=${offRes.body?.message}`,
  );

  const badFormat = await cu.post('/api/v1/cart/applyCoupon', { code: 'lower case code!!' });
  record('malformed coupon code -> 400', badFormat.status === 400, `status=${badFormat.status}`);

  const afterRejects = await cu.get('/api/v1/cart/getCart');
  record(
    'rejected coupons leave no residue on the cart',
    afterRejects.body?.result?.couponCode === '' && afterRejects.body?.result?.couponDiscount === 0,
    `code=${afterRejects.body?.result?.couponCode} disc=${afterRejects.body?.result?.couponDiscount}`,
  );

  const venOk = await cu.post('/api/v1/cart/applyCoupon', { code: `CT${run}VEN` });
  record(
    'vendor-scoped coupon applies when that vendor is present',
    venOk.status === 200,
    `status=${venOk.status}`,
  );
  record(
    'vendor coupon discounts 50',
    venOk.body?.result?.couponDiscount === 50,
    `couponDiscount=${venOk.body?.result?.couponDiscount}`,
  );
  record(
    'applied coupon code is persisted on the cart',
    venOk.body?.result?.couponCode === `CT${run}VEN`,
    venOk.body?.result?.couponCode,
  );
  record(
    'couponData block describes the coupon',
    venOk.body?.result?.couponData?.type === 'FLAT' &&
      venOk.body?.result?.couponData?.discount === 50,
    JSON.stringify(venOk.body?.result?.couponData),
  );

  const removed = await cu.del('/api/v1/cart/removeCoupon');
  record('POST /cart/removeCoupon -> 200', removed.status === 200, `status=${removed.status}`);
  record(
    'removeCoupon zeroes the discount',
    removed.body?.result?.couponDiscount === 0 && removed.body?.result?.couponCode === '',
    `disc=${removed.body?.result?.couponDiscount}`,
  );

  const pctRes = await cu.post('/api/v1/cart/applyCoupon', { code: `CT${run}PCT` });

  record(
    'percent coupon respects maxDiscount cap (150 of 480)',
    pctRes.body?.result?.couponDiscount === 150,
    `couponDiscount=${pctRes.body?.result?.couponDiscount}`,
  );

  record(
    'tax is per-line (240 + 80 + 0 = 320)',
    pctRes.body?.result?.taxAmount === 320,
    `taxAmount=${pctRes.body?.result?.taxAmount}`,
  );
  record(
    'total = 4800 - 150 + 320 tax + 50 shipping = 5020',
    pctRes.body?.result?.total === 5020,
    `total=${pctRes.body?.result?.total}`,
  );

  await cu.del('/api/v1/cart/removeCoupon');
  await cu.post('/api/v1/cart/applyCoupon', { code: `CT${run}FLAT` });
  const shrink = await cu.patch('/api/v1/cart/updateItem', { productId: shirt.id, qty: 1 });
  record(
    'a coupon stops applying once the cart falls below its minimum',
    shrink.status === 200 && shrink.body?.result?.couponDiscount === 0,
    `status=${shrink.status} disc=${shrink.body?.result?.couponDiscount}`,
  );
  record(
    'a stale coupon is flagged rather than silently ignored',
    shrink.body?.result?.couponInvalid === true,
    `couponInvalid=${shrink.body?.result?.couponInvalid}`,
  );
  record(
    'the cart still reads normally with a stale coupon attached',
    (shrink.body?.result?.itemList ?? []).length >= 1,
    `lines=${(shrink.body?.result?.itemList ?? []).length}`,
  );
  await cu.del('/api/v1/cart/removeCoupon');
  await cu.del('/api/v1/cart/removeCoupon');
  void vendorScoped;

  await setSetting('tax.inclusive', true, 'tax', undefined, false);
  const inclusive = await cu.get('/api/v1/cart/getCart');

  record(
    'inclusive tax is extracted, not added (185.28)',
    Math.abs(inclusive.body?.result?.taxAmount - 185.28) < 0.02,
    `taxAmount=${inclusive.body?.result?.taxAmount} subtotal=${inclusive.body?.result?.subtotal}`,
  );
  record(
    'inclusive total = 3600 + 185.28 + 50 shipping',
    Math.abs(inclusive.body?.result?.total - 3835.28) < 0.02,
    `total=${inclusive.body?.result?.total}`,
  );
  await setSetting('tax.inclusive', false, 'tax', undefined, false);

  const address = await cu.post('/api/v1/users/addAddress', {
    type: 'HOME',
    fullName: 'Cart Tester',
    phone: '+919876543210',
    line1: '221B Linking Road',
    city: 'Mumbai',
    state: 'Maharashtra',
    stateCode: 'MH',
    country: 'India',
    pincode: '400050',
    isDefault: true,
  });
  record('address created for the estimate', address.status === 201, `status=${address.status}`);
  const addressId = address.body?.result?.addressId ?? '';

  const est = await cu.post('/api/v1/cart/estimate', {
    addressId,
    paymentMethod: 'COD',
  });
  record(
    'POST /cart/estimate -> 200',
    est.status === 200,
    `status=${est.status} msg=${est.body?.message}`,
  );
  record('estimate envelope is strict', strictEnvelope(est.body));
  record(
    'estimate contains no nulls',
    findNull(est.body?.result) === null,
    findNull(est.body?.result) ?? 'clean',
  );
  record(
    'estimate echoes the address',
    est.body?.result?.addressData?.pincode === '400050',
    JSON.stringify(est.body?.result?.addressData?.pincode),
  );
  record(
    'estimate flags COD correctly',
    est.body?.result?.paymentData?.isCod === true &&
      est.body?.result?.paymentData?.method === 'COD',
    JSON.stringify(est.body?.result?.paymentData),
  );
  record(
    'estimate exposes the per-vendor split',
    (est.body?.result?.vendorGroupList ?? []).length === 2,
    `groups=${(est.body?.result?.vendorGroupList ?? []).length}`,
  );
  record(
    'estimate has no stock issues',
    est.body?.result?.hasStockIssue === false,
    String(est.body?.result?.hasStockIssue),
  );

  const foreignAddress = (await customer.userId)
    ? await (async () => {
        const other = await register('x', 'CUSTOMER');
        const res = await api(other.token).post('/api/v1/users/addAddress', {
          type: 'HOME',
          fullName: 'Other',
          phone: '+919876543211',
          line1: 'Somewhere',
          city: 'Pune',
          state: 'Maharashtra',
          stateCode: 'MH',
          country: 'India',
          pincode: '411001',
        });
        return { id: res.body?.result?.addressId ?? '', token: other.token };
      })()
    : { id: '', token: '' };

  const foreignEst = await cu.post('/api/v1/cart/estimate', { addressId: foreignAddress.id });
  record(
    "estimate with another user's address -> 404",
    foreignEst.status === 404,
    `status=${foreignEst.status}`,
  );

  const badMethod = await cu.post('/api/v1/cart/estimate', { paymentMethod: 'CRYPTO' });
  record(
    'estimate with an unknown payment method -> 400',
    badMethod.status === 400,
    `status=${badMethod.status}`,
  );

  await setSetting('payment.cod.maxAmount', 100, 'payment', undefined, false);
  const codOver = await cu.post('/api/v1/cart/estimate', { paymentMethod: 'COD' });
  record(
    'COD above the ceiling -> 422',
    codOver.status === 422 && String(codOver.body?.message).includes('20000') === false,
    `status=${codOver.status} msg=${codOver.body?.message}`,
  );
  await setSetting('payment.cod.maxAmount', 20_000, 'payment', undefined, false);

  await setSetting('payment.cod.enabled', false, 'payment', undefined, false);
  const codOff = await cu.post('/api/v1/cart/estimate', { paymentMethod: 'COD' });
  record(
    'estimate with COD disabled -> 422 METHOD_DISABLED',
    codOff.status === 422 && String(codOff.body?.message).includes('disabled'),
    `status=${codOff.status} msg=${codOff.body?.message}`,
  );
  await setSetting('payment.cod.enabled', true, 'payment', undefined, false);

  await setSetting('payment.cod.extraCharge', 25, 'payment', undefined, false);
  const codFee = await cu.post('/api/v1/cart/estimate', { paymentMethod: 'COD' });
  const upiFee = await cu.post('/api/v1/cart/estimate', { paymentMethod: 'UPI' });
  record(
    'COD adds the handling surcharge to shipping (50 + 25 = 75)',
    codFee.body?.result?.shippingAmount === 75,
    `shippingAmount=${codFee.body?.result?.shippingAmount}`,
  );
  record(
    'UPI carries no surcharge (50)',
    upiFee.body?.result?.shippingAmount === 50,
    `shippingAmount=${upiFee.body?.result?.shippingAmount}`,
  );
  await setSetting('payment.cod.extraCharge', 0, 'payment', undefined, false);

  const walletOff = await cu.post('/api/v1/cart/estimate', { useWalletBalance: true });
  record(
    'wallet balance reported when enabled',
    typeof walletOff.body?.result?.paymentData?.walletBalance === 'number',
    String(walletOff.body?.result?.paymentData?.walletBalance),
  );

  await prisma.walletTransaction.create({
    data: {
      userId: customer.userId,
      type: 'CREDIT',
      amount: 1000,
      balanceAfter: 1000,
      description: 'e2e top-up',
    },
  });
  const walletOn = await cu.post('/api/v1/cart/estimate', { useWalletBalance: true });
  record(
    'wallet balance is the credit ledger total (1000)',
    walletOn.body?.result?.paymentData?.walletBalance === 1000,
    `walletBalance=${walletOn.body?.result?.paymentData?.walletBalance}`,
  );

  const fullRedeem = await cu.post('/api/v1/cart/estimate', {
    useWalletBalance: true,
    walletAmount: 999_999,
  });

  record(
    'wallet redemption is clamped to the payable amount',
    fullRedeem.body?.result?.total === 0,
    `wallet=${fullRedeem.body?.result?.walletAmount} total=${fullRedeem.body?.result?.total}`,
  );
  record(
    'a fully-redeemed order totals 0',
    fullRedeem.body?.result?.total === 0,
    `total=${fullRedeem.body?.result?.total}`,
  );

  const capped = await cu.post('/api/v1/cart/estimate', {
    useWalletBalance: true,
    walletAmount: 400,
  });
  record(
    'partial redemption lowers the total by exactly the redeemed amount',
    capped.body?.result?.walletAmount === 400 &&
      Math.abs(
        capped.body?.result?.total -
          (fullRedeem.body?.result?.total + fullRedeem.body?.result?.walletAmount - 400),
      ) < 0.01,
    `wallet=${capped.body?.result?.walletAmount} total=${capped.body?.result?.total}`,
  );

  const cartBeforeRemove = await cu.get('/api/v1/cart/getCart');
  const capLine = (cartBeforeRemove.body?.result?.itemList ?? []).find(
    (i: any) => i.productId === cap.id,
  );
  record(
    'the capped line is present in the cart',
    Boolean(capLine?.cartItemId),
    JSON.stringify(capLine?.cartItemId),
  );

  const remByProduct = await cu.del(`/api/v1/cart/removeItem/${capLine?.cartItemId}`);
  record(
    'DELETE /cart/removeItem/:cartItemId -> 200',
    remByProduct.status === 200,
    `status=${remByProduct.status}`,
  );
  record(
    'removeItem drops exactly that line',
    !(remByProduct.body?.result?.itemList ?? []).some((i: any) => i.productId === cap.id),
    JSON.stringify((remByProduct.body?.result?.itemList ?? []).map((i: any) => i.productId)),
  );

  const remMissing = await cu.del('/api/v1/cart/removeItem/nope123');
  record(
    'removeItem unknown line -> 404',
    remMissing.status === 404,
    `status=${remMissing.status}`,
  );

  const remNoArg = await cu.del(`/api/v1/cart/removeItem/${capLine?.cartItemId}`);
  record(
    'removing the same line twice -> 404',
    remNoArg.status === 404,
    `status=${remNoArg.status}`,
  );

  const zeroUpdate = await cu.patch('/api/v1/cart/updateItem', { productId: shirt.id, qty: 0 });
  record(
    'updateItem qty 0 removes the line',
    !(zeroUpdate.body?.result?.itemList ?? []).some((i: any) => i.productId === shirt.id),
    JSON.stringify((zeroUpdate.body?.result?.itemList ?? []).map((i: any) => i.productId)),
  );

  const cleared = await cu.del('/api/v1/cart/clearCart');
  record('POST /cart/clear -> 200', cleared.status === 200, `status=${cleared.status}`);
  record(
    'clear empties the cart and reports the count',
    cleared.body?.result?.removedCount >= 1 && cleared.body?.result?.cart?.itemCount === 0,
    `removed=${cleared.body?.result?.removedCount} left=${cleared.body?.result?.cart?.itemCount}`,
  );
  record(
    'clear also drops the applied coupon',
    cleared.body?.result?.cart?.couponCode === '',
    cleared.body?.result?.cart?.couponCode,
  );

  const guestCustomer = await register('gm', 'CUSTOMER');
  const g = api(guestCustomer.token);

  const sessionKey = `ct-session-${run}`;
  const sessionCart = await prisma.cart.create({
    data: { userId: guestCustomer.userId, sessionKey },
  });
  await prisma.cartItem.createMany({
    data: [
      {
        cartId: sessionCart.id,
        productId: cap.id,
        qty: 2,
        price: 400,
        userId: guestCustomer.userId,
      },

      {
        cartId: sessionCart.id,
        productId: scarce.id,
        qty: 9,
        price: 250,
        userId: guestCustomer.userId,
      },
    ],
  });

  const merged = await g.post('/api/v1/cart/mergeGuestCart', { sessionKey });
  record(
    'POST /cart/mergeGuestCart -> 200',
    merged.status === 200,
    `status=${merged.status} msg=${merged.body?.message}`,
  );
  record(
    'merge reports how many lines landed',
    merged.body?.result?.mergedCount === 2,
    `mergedCount=${merged.body?.result?.mergedCount} skipped=${merged.body?.result?.skippedCount}`,
  );
  record(
    'merged qty is clamped to available stock (9 -> 1)',
    (merged.body?.result?.cart?.itemList ?? []).find((i: any) => i.productId === scarce.id)?.qty ===
      1,
    JSON.stringify(
      (merged.body?.result?.cart?.itemList ?? []).map((i: any) => [i.productId, i.qty]),
    ),
  );

  const mergedAgain = await g.post('/api/v1/cart/mergeGuestCart', {
    sessionKey,
    items: [{ productId: cap.id, qty: 1 }],
  });
  record(
    're-merging accumulates quantities (cap 2 + client 1 = 3)',
    (mergedAgain.body?.result?.cart?.itemList ?? []).find((i: any) => i.productId === cap.id)
      ?.qty === 3,
    JSON.stringify(
      (mergedAgain.body?.result?.cart?.itemList ?? []).map((i: any) => [i.productId, i.qty]),
    ),
  );

  const ghost = await makeProduct(vendorA.token, {
    name: `CT Ghost ${run}`,
    price: 120,
    stock: 5,
  });
  await prisma.cartItem.create({
    data: {
      cartId: sessionCart.id,
      productId: ghost.id,
      qty: 1,
      price: 120,
      userId: guestCustomer.userId,
    },
  });
  await prisma.vendorProfile.update({
    where: { id: vendorA.vendorId },
    data: { status: 'SUSPENDED' },
  });

  const withGhost = await g.post('/api/v1/cart/mergeGuestCart', { sessionKey });
  record(
    'an unpurchasable guest line is skipped without failing the merge',
    withGhost.status === 200 && withGhost.body?.result?.skippedCount >= 1,
    `status=${withGhost.status} skipped=${withGhost.body?.result?.skippedCount}`,
  );
  record(
    'mergeable lines still land while others are skipped',
    withGhost.body?.result?.mergedCount >= 1,
    `mergedCount=${withGhost.body?.result?.mergedCount}`,
  );

  await prisma.vendorProfile.update({
    where: { id: vendorA.vendorId },
    data: { status: 'APPROVED' },
  });

  const emptyWl = await cu.get('/api/v1/wishlist/getAll');
  record('GET /wishlist/getAll -> 200', emptyWl.status === 200, `status=${emptyWl.status}`);
  record('wishlist envelope is strict', strictEnvelope(emptyWl.body));
  record(
    'new wishlist is empty',
    emptyWl.body?.result?.itemCount === 0,
    String(emptyWl.body?.result?.itemCount),
  );

  const wlAdd = await cu.post('/api/v1/wishlist/addItem', { productId: shirt.id });
  record(
    'POST /wishlist/addItem -> 201',
    wlAdd.status === 201,
    `status=${wlAdd.status} msg=${wlAdd.body?.message}`,
  );
  record(
    'wishlist item carries product details',
    wlAdd.body?.result?.productData?.name === `CT Shirt ${run}` &&
      Array.isArray(wlAdd.body?.result?.productData?.imageList),
    JSON.stringify(wlAdd.body?.result?.productData?.name),
  );
  record(
    'wishlist productData includes vendor details',
    Boolean(wlAdd.body?.result?.productData?.vendorData?.shopName),
    JSON.stringify(wlAdd.body?.result?.productData?.vendorData),
  );

  const wlDup = await cu.post('/api/v1/wishlist/addItem', { productId: shirt.id });
  record(
    'adding the same product twice -> 409 DUPLICATE',
    wlDup.status === 409 && String(wlDup.body?.message).includes('DUPLICATE'),
    `status=${wlDup.status} msg=${wlDup.body?.message}`,
  );

  const wlMissing = await cu.post('/api/v1/wishlist/addItem', { productId: 'nope123' });
  record(
    'wishlist add unknown product -> 404',
    wlMissing.status === 404,
    `status=${wlMissing.status}`,
  );

  await cu.post('/api/v1/wishlist/addItem', { productId: cap.id });
  await cu.post('/api/v1/wishlist/addItem', { productId: soldOut.id });

  const wlList = await cu.get('/api/v1/wishlist/getAll');
  record(
    'wishlist lists 3 items',
    wlList.body?.result?.itemCount === 3,
    `count=${wlList.body?.result?.itemCount}`,
  );
  record(
    'wishlist counts in-stock and out-of-stock separately',
    wlList.body?.result?.inStockCount === 2 && wlList.body?.result?.outOfStockCount === 1,
    `in=${wlList.body?.result?.inStockCount} out=${wlList.body?.result?.outOfStockCount}`,
  );
  record(
    'wishlist list contains no nulls',
    findNull(wlList.body?.result) === null,
    findNull(wlList.body?.result) ?? 'clean',
  );

  const check = await cu.get(`/api/v1/wishlist/checkProduct/${shirt.id}`);
  record(
    'checkProduct reports membership',
    check.body?.result?.isInWishlist === true,
    JSON.stringify(check.body?.result),
  );
  const checkMiss = await cu.get(`/api/v1/wishlist/checkProduct/${scarce.id}`);
  record(
    'checkProduct reports non-membership',
    checkMiss.body?.result?.isInWishlist === false,
    JSON.stringify(checkMiss.body?.result),
  );

  const moved = await cu.post(`/api/v1/wishlist/moveToCart/${shirt.id}`, { qty: 1 });
  record(
    'POST /wishlist/moveToCart/:id -> 200',
    moved.status === 200,
    `status=${moved.status} msg=${moved.body?.message}`,
  );
  record(
    'moveToCart puts the product in the cart',
    (moved.body?.result?.cart?.itemList ?? []).some((i: any) => i.productId === shirt.id),
    JSON.stringify((moved.body?.result?.cart?.itemList ?? []).map((i: any) => i.productId)),
  );

  const afterMove = await cu.get('/api/v1/wishlist/getAll');
  record(
    'moveToCart removes the item from the wishlist',
    !(afterMove.body?.result?.itemList ?? []).some((i: any) => i.productId === shirt.id),
    JSON.stringify((afterMove.body?.result?.itemList ?? []).map((i: any) => i.productId)),
  );

  const moveTwice = await cu.post(`/api/v1/wishlist/moveToCart/${shirt.id}`, { qty: 1 });
  record(
    'moveToCart on a removed item -> 404',
    moveTwice.status === 404,
    `status=${moveTwice.status}`,
  );

  const wlRemove = await cu.del(`/api/v1/wishlist/removeItem/${cap.id}`);
  record(
    'DELETE /wishlist/removeItem/:id -> 200',
    wlRemove.status === 200,
    `status=${wlRemove.status}`,
  );
  const afterRemove = await cu.get('/api/v1/wishlist/getAll');
  record(
    'wishlist removal works by product id',
    afterRemove.body?.result?.itemCount === 1,
    `count=${afterRemove.body?.result?.itemCount}`,
  );

  const wlRemoveMissing = await cu.del('/api/v1/wishlist/removeItem/nope123');
  record(
    'wishlist remove unknown item -> 404',
    wlRemoveMissing.status === 404,
    `status=${wlRemoveMissing.status}`,
  );

  const otherWl = await api(foreignAddress.token).get('/api/v1/wishlist/getAll');
  record(
    'wishlists are isolated per user',
    otherWl.body?.result?.itemCount === 0,
    `count=${otherWl.body?.result?.itemCount}`,
  );

  const wlClear = await cu.del('/api/v1/wishlist/clear');
  record('POST /wishlist/clear -> 200', wlClear.status === 200, `status=${wlClear.status}`);
  record(
    'clear empties the wishlist',
    wlClear.body?.result?.removedCount >= 1,
    `removed=${wlClear.body?.result?.removedCount}`,
  );
  const afterClear = await cu.get('/api/v1/wishlist/getAll');
  record(
    'wishlist is empty after clearing',
    afterClear.body?.result?.itemCount === 0,
    String(afterClear.body?.result?.itemCount),
  );

  await prisma.cartItem.deleteMany({ where: { cartId: sessionCart.id } });
  await prisma.cart.delete({ where: { id: sessionCart.id } }).catch(() => undefined);
  await prisma.walletTransaction.deleteMany({ where: { userId: customer.userId } });
  await prisma.cartItem.deleteMany({
    where: { productId: { in: [shirt.id, cap.id, scarce.id, variantProduct.id, soldOut.id] } },
  });
  await prisma.coupon.deleteMany({ where: { code: { startsWith: `CT${run}` } } });
  await prisma.productVariant.deleteMany({ where: { productId: variantProduct.id } });
  await prisma.product.deleteMany({
    where: { id: { in: [shirt.id, cap.id, scarce.id, variantProduct.id, soldOut.id, ghost.id] } },
  });
  await setSetting('cart.maxItems', 50, 'cart', undefined, false);
  await setSetting('wallet.enabled', false, 'wallet', undefined, false);
  await setSetting('shipping.freeAbove', 999, 'shipping', undefined, false);

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

main().catch((err) => {
  /* eslint-disable no-console */
  console.error('\nFatal:', err?.message ?? err);
  process.exitCode = 1;
  /* eslint-enable no-console */
});
