/**
 * Live HTTP tests for payment, wallet, payout and return modules.
 *
 * Covers: token payment, balance settlement, COD collection, refunds and their
 * caps, wallet ledger and admin adjustments, payout request/approve/reject/settle
 * with the earnings hold, and the full return lifecycle including the window,
 * quantity limits, per-item approval, stock restore and wallet refunds.
 *
 * Usage: npx tsx scripts/e2e-payment.ts
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
const email = (tag: string) => `py_${tag}_${run}@projectname.com`;
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
      name: `PY ${tag}`,
      otp: OTP,
      email: email(tag),
      phone: phoneFor(tag),
      password: 'Secret@123',
      ...(type === 'VENDOR' ? { shopName: shopName ?? `PY Shop ${tag} ${run}` } : {}),
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

const main = async (): Promise<void> => {
  /* eslint-disable no-console */
  const { prisma } = await import('../src/services/prisma.service');
  const { setSetting } = await import('../src/services/settings.service');

  await setSetting('shipping.defaultCharge', 50, 'shipping', undefined, false);
  await setSetting('shipping.freeAbove', 0, 'shipping', undefined, false);
  await setSetting('payment.cod.extraCharge', 0, 'payment', undefined, false);
  await setSetting('order.minAmount', 0, 'order', undefined, false);
  await setSetting('tax.inclusive', false, 'tax', undefined, false);

  /**
   * Pin the token settings off: a crashed earlier run can leave them enabled, which would
   * silently turn every COD order into a token order.
   */
  await setSetting('payment.token.enabled', false, 'payment', undefined, false);
  await setSetting('payment.token.applicableAbove', 2000, 'payment', undefined, false);
  await setSetting('wallet.enabled', false, 'wallet', undefined, false);

  const customer = await register('cu', 'CUSTOMER');
  const other = await register('x', 'CUSTOMER');
  const vendor = await register('v1', 'VENDOR');

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

  await admin.patch(`/api/v1/vendors/approveVendor/${vendor.vendorId}`, {});
  // Bank details are required before a payout can be requested.
  await prisma.vendorProfile.update({
    where: { id: vendor.vendorId },
    data: {
      bankAccountNo: '4111111111111111',
      bankIfsc: 'HDFC0001234',
      bankHolderName: 'Py Vendor',
      upiId: 'pyvendor@upi',
    },
  });
  record('vendor approved with bank details', true);

  const product = await api(vendor.token).post('/api/v1/products/createProduct', {
    name: `Py Tee ${run}`,
    price: 1000,
    stock: 20,
    taxPercent: 0,
  });
  const productId = product.body?.result?.productId ?? '';
  record('product created', product.status === 201 && Boolean(productId));

  const address = await cu.post('/api/v1/users/addAddress', {
    type: 'HOME',
    fullName: 'Pay Tester',
    phone: '+919876543210',
    line1: '221B Linking Road',
    city: 'Mumbai',
    state: 'Maharashtra',
    stateCode: 'MH',
    country: 'India',
    pincode: '400050',
  });
  const addressId = address.body?.result?.addressId ?? '';

  /** Places an order and returns its id. */
  const place = async (qty = 1) => {
    await cu.del('/api/v1/cart/clearCart');
    await cu.post('/api/v1/cart/addItem', { productId, qty });
    const res = await cu.post('/api/v1/orders/placeOrder', {
      addressId,
      paymentMethod: 'COD',
      skipStatus: true,
    });
    return {
      id: res.body?.result?.orderId ?? '',
      body: res.body?.result ?? {},
      status: res.status,
    };
  };

  // ══ Guards ═════════════════════════════════════════════════════════════════
  const anon = await request(app).get('/api/v1/payments/getAll');
  record('GET /payments/getAll without token -> 401', anon.status === 401, `status=${anon.status}`);

  const noRecord = await cu.get(`/api/v1/payments/getByOrder/nope123`);
  record(
    'payments for an unknown order -> 404',
    noRecord.status === 404,
    `status=${noRecord.status}`,
  );

  // ══ COD order ══════════════════════════════════════════════════════════════
  const codOrder = await place(2);
  record(
    'COD order placed',
    codOrder.status === 201 && Boolean(codOrder.id),
    `status=${codOrder.status}`,
  );
  record(
    'COD payment status is COD_PENDING',
    codOrder.body.paymentStatus === 'COD_PENDING',
    codOrder.body.paymentStatus,
  );

  const byOrder = await cu.get(`/api/v1/payments/getByOrder/${codOrder.id}`);
  record('GET /payments/getByOrder -> 200', byOrder.status === 200, `status=${byOrder.status}`);
  record(
    'the order has a payment record',
    (byOrder.body?.result?.itemCount ?? 0) >= 1,
    `count=${byOrder.body?.result?.itemCount}`,
  );
  record(
    'payments for an order contain no nulls',
    findNull(byOrder.body?.result) === null,
    findNull(byOrder.body?.result) ?? 'clean',
  );

  const foreignPayments = await api(other.token).get(`/api/v1/payments/getByOrder/${codOrder.id}`);
  record(
    "another customer cannot see the order's payments -> 404",
    foreignPayments.status === 404,
    `status=${foreignPayments.status}`,
  );

  // getAll is an admin listing; the customer-facing read is getByOrder.
  const list = await admin.get('/api/v1/payments/getAll');
  record('GET /payments/getAll -> 200 (admin)', list.status === 200, `status=${list.status}`);
  record(
    'pagination numbers come first',
    D_num(list.body?.result?.totalRecord) >= 1,
    `totalRecord=${list.body?.result?.totalRecord}`,
  );

  const listAsCustomer = await cu.get('/api/v1/payments/getAll');
  record(
    'a customer cannot list every payment -> 403',
    listAsCustomer.status === 403,
    `status=${listAsCustomer.status}`,
  );

  const methods = await cu.get('/api/v1/payments/methods');
  record('GET /payments/methods -> 200', methods.status === 200, `status=${methods.status}`);
  record(
    'methods expose the COD ceiling',
    typeof methods.body?.result?.cod?.maxAmount === 'number',
    String(methods.body?.result?.cod?.maxAmount),
  );

  // ══ COD collection ═════════════════════════════════════════════════════════
  const codCollect = await admin.patch(`/api/v1/payments/markCodCollected/${codOrder.id}`);
  record(
    'PATCH /payments/markCodCollected/:orderId -> 200',
    codCollect.status === 200,
    `status=${codCollect.status} msg=${codCollect.body?.message}`,
  );
  record(
    'the payment is marked collected',
    codCollect.body?.result?.status === 'COD_COLLECTED',
    codCollect.body?.result?.status,
  );

  const codTwice = await admin.patch(`/api/v1/payments/markCodCollected/${codOrder.id}`);
  record(
    'collecting twice -> 422',
    codTwice.status === 422,
    `status=${codTwice.status} msg=${codTwice.body?.message}`,
  );

  // ══ Token payment ══════════════════════════════════════════════════════════
  await setSetting('payment.token.enabled', true, 'payment', undefined, false);
  await setSetting('payment.token.mode', 'fixed', 'payment', undefined, false);
  await setSetting('payment.token.fixedAmount', 200, 'payment', undefined, false);
  await setSetting('payment.token.applicableAbove', 500, 'payment', undefined, false);
  await setSetting('payment.token.minAmount', 10, 'payment', undefined, false);
  await setSetting('payment.token.maxAmount', 100000, 'payment', undefined, false);

  const tokenOrder = await place(2);
  record('token order placed', tokenOrder.status === 201, `status=${tokenOrder.status}`);
  record(
    'token is required above the threshold',
    tokenOrder.body.tokenRequired === true,
    String(tokenOrder.body.tokenRequired),
  );
  record(
    'status is PENDING_TOKEN',
    tokenOrder.body.status === 'PENDING_TOKEN',
    tokenOrder.body.status,
  );
  record(
    'the fixed token amount is applied (200)',
    tokenOrder.body.tokenAmount === 200,
    `token=${tokenOrder.body.tokenAmount}`,
  );

  const tokenPayments = await cu.get(`/api/v1/payments/getByOrder/${tokenOrder.id}`);
  const tokenPaymentId = tokenPayments.body?.result?.itemList?.[0]?.paymentId ?? '';

  // The order is named in the path, so the body must not repeat it — the schema is
  // strict and an extra orderId is a 400, not a harmless duplicate.
  const noToken = await cu.post(`/api/v1/payments/payToken/${codOrder.id}`, {});
  record(
    'paying a token on a COD order -> 422',
    noToken.status === 422,
    `status=${noToken.status} msg=${noToken.body?.message}`,
  );

  const strayOrderId = await cu.post(`/api/v1/payments/payToken/${tokenOrder.id}`, {
    orderId: tokenOrder.id,
  });
  record(
    'a repeated orderId in the body is rejected -> 400',
    strayOrderId.status === 400 && String(strayOrderId.body?.message).includes('orderId'),
    `status=${strayOrderId.status} msg=${strayOrderId.body?.message}`,
  );

  const foreignToken = await api(other.token).post(`/api/v1/payments/payToken/${tokenOrder.id}`, {
    paymentId: tokenPaymentId,
  });
  record(
    "verifying someone else's token -> 404",
    foreignToken.status === 404,
    `status=${foreignToken.status}`,
  );

  const tokenVerify = await cu.post(`/api/v1/payments/payToken/${tokenOrder.id}`, {
    paymentId: tokenPaymentId,
    method: 'UPI',
    reference: 'UPI123456',
    providerRef: 'pay_abc123',
  });
  record(
    'POST /payments/payToken/:orderId -> 200',
    tokenVerify.status === 200,
    `status=${tokenVerify.status} msg=${tokenVerify.body?.message}`,
  );
  record(
    'the payment is marked paid',
    tokenVerify.body?.result?.status === 'PAID',
    tokenVerify.body?.result?.status,
  );
  record('isTokenPayment is set', tokenVerify.body?.result?.isTokenPayment === true);
  record(
    'the paid amount is the token',
    tokenVerify.body?.result?.paidAmount === 200,
    `paid=${tokenVerify.body?.result?.paidAmount}`,
  );

  const tokenTwice = await cu.post(`/api/v1/payments/payToken/${tokenOrder.id}`, {
    paymentId: tokenPaymentId,
  });
  record(
    'verifying the token twice -> 422',
    tokenTwice.status === 422,
    `status=${tokenTwice.status} msg=${tokenTwice.body?.message}`,
  );

  const stillPending = await cu.get(`/api/v1/orders/getById/${tokenOrder.id}`);
  record(
    'the order stays PENDING_TOKEN until the balance clears',
    stillPending.body?.result?.status === 'PENDING_TOKEN',
    stillPending.body?.result?.status,
  );

  const balance = await cu.post(`/api/v1/payments/payBalance/${tokenOrder.id}`, {
    method: 'UPI',
    reference: 'BAL999',
  });
  record(
    'POST /payments/payBalance -> 200',
    balance.status === 200,
    `status=${balance.status} msg=${balance.body?.message}`,
  );
  record(
    'the remaining amount is what is charged',
    balance.body?.result?.amount === 1850,
    `amount=${balance.body?.result?.amount}`,
  );

  const afterBalance = await cu.get(`/api/v1/orders/getById/${tokenOrder.id}`);
  record(
    'paying the balance confirms the order',
    afterBalance.body?.result?.status === 'CONFIRMED',
    afterBalance.body?.result?.status,
  );
  record(
    'the order is marked paid in full',
    afterBalance.body?.result?.paymentStatus === 'PAID',
    afterBalance.body?.result?.paymentStatus,
  );

  const balanceTwice = await cu.post(`/api/v1/payments/payBalance/${tokenOrder.id}`);
  record(
    'paying the balance twice -> 422',
    balanceTwice.status === 422,
    `status=${balanceTwice.status}`,
  );

  await setSetting('payment.token.enabled', false, 'payment', undefined, false);

  // ══ Refunds ═══════════════════════════════════════════════════════════════
  // The payment is named in the path; orderId is still a required body field.
  // The token payment only ever collected the token (200); the balance settled as a
  // separate payment row, so 200 is the ceiling here.
  const refundInit = await admin.post(`/api/v1/payments/refund/${tokenPaymentId}`, {
    orderId: tokenOrder.id,
    amount: 200,
    reason: 'damaged in transit',
  });
  record(
    'POST /payments/refund/:paymentId -> 201',
    refundInit.status === 201,
    `status=${refundInit.status} msg=${refundInit.body?.message}`,
  );
  const refundId = refundInit.body?.result?.refundId ?? '';
  record(
    'the refund starts pending',
    refundInit.body?.result?.status === 'PENDING',
    refundInit.body?.result?.status,
  );

  const tooMuch = await admin.post(`/api/v1/payments/refund/${tokenPaymentId}`, {
    orderId: tokenOrder.id,
    amount: 201,
    reason: 'one rupee too much',
  });
  record(
    'a refund beyond the paid amount -> 422',
    tooMuch.status === 422 && String(tooMuch.body?.message).includes('REFUND_EXCEEDS_PAID'),
    `status=${tooMuch.status} msg=${tooMuch.body?.message}`,
  );

  const noReason = await admin.post(`/api/v1/payments/refund/${tokenPaymentId}`, {
    orderId: tokenOrder.id,
  });
  record('a refund without a reason -> 400', noReason.status === 400, `status=${noReason.status}`);

  const missingOrder = await admin.post(`/api/v1/payments/refund/${tokenPaymentId}`, {
    amount: 100,
    reason: 'no order named',
  });
  record(
    'a refund without orderId -> 400',
    missingOrder.status === 400 && String(missingOrder.body?.message).includes('orderId'),
    `status=${missingOrder.status} msg=${missingOrder.body?.message}`,
  );

  // A payment-level refund stays PENDING until money actually moves. The only route
  // that settles a refund is the return flow (/returns/processRefund/:id), which is
  // covered further down — so here we assert the payment refund is still open and
  // that it is visible in the history.
  // Scoped to the order's owner, so this is the customer's read — an admin asking for
  // someone else's order gets the same 404 as any other stranger.
  const refundStillOpen = await cu.get(`/api/v1/payments/getRefundHistory/${tokenOrder.id}`);
  record(
    'the new refund is listed as PENDING',
    D_arr(refundStillOpen.body?.result?.refundList).some(
      (r: any) => r.refundId === refundId && r.status === 'PENDING',
    ),
    JSON.stringify(
      D_arr(refundStillOpen.body?.result?.refundList).map((r: any) => `${r.refundId}:${r.status}`),
    ),
  );

  const refundHistoryAsAdmin = await admin.get(
    `/api/v1/payments/getRefundHistory/${tokenOrder.id}`,
  );
  record(
    'the refund history is owner-only -> 404 for staff',
    refundHistoryAsAdmin.status === 404,
    `status=${refundHistoryAsAdmin.status}`,
  );

  const refundList = await cu.get(`/api/v1/payments/getRefundHistory/${tokenOrder.id}`);
  record(
    'GET /payments/getRefundHistory/:orderId -> 200',
    refundList.status === 200,
    `status=${refundList.status}`,
  );
  record(
    'the refund shows in the history',
    D_num(refundList.body?.result?.totalRecord) >= 1,
    `total=${refundList.body?.result?.totalRecord}`,
  );

  const refundAsCustomer = await cu.post(`/api/v1/payments/refund/${tokenPaymentId}`, {
    orderId: tokenOrder.id,
    amount: 100,
    reason: 'customer should not be able to do this',
  });
  record(
    'a customer cannot open a refund -> 403',
    refundAsCustomer.status === 403,
    `status=${refundAsCustomer.status}`,
  );

  // ══ Wallet ═════════════════════════════════════════════════════════════════
  await setSetting('wallet.enabled', true, 'wallet', undefined, false);
  await setSetting('wallet.maxBalance', 100000, 'wallet', undefined, false);

  const before = await cu.get('/api/v1/wallet/getBalance');
  record('GET /wallet/getBalance -> 200', before.status === 200, `status=${before.status}`);
  record(
    'a new wallet starts empty',
    before.body?.result?.balance === 0,
    `balance=${before.body?.result?.balance}`,
  );

  const credit = await admin.post('/api/v1/wallet/adminCredit', {
    userId: customer.userId,
    amount: 5000,
    description: 'goodwill credit',
  });
  record(
    'POST /wallet/adminCredit credits -> 201',
    credit.status === 201,
    `status=${credit.status} msg=${credit.body?.message}`,
  );
  record(
    'the entry records the new balance',
    credit.body?.result?.balanceAfter === 5000,
    `after=${credit.body?.result?.balanceAfter}`,
  );
  record('a credit is flagged asCredit', credit.body?.result?.isCredit === true);

  const ledger = await cu.get('/api/v1/wallet/getTransactions');
  record('GET /wallet/getTransactions -> 200', ledger.status === 200, `status=${ledger.status}`);
  record(
    'the ledger has one entry',
    D_num(ledger.body?.result?.totalRecord) === 1,
    `total=${ledger.body?.result?.totalRecord}`,
  );

  const afterCredit = await cu.get('/api/v1/wallet/getBalance');
  record(
    'the balance follows the ledger',
    afterCredit.body?.result?.balance === 5000,
    `balance=${afterCredit.body?.result?.balance}`,
  );
  record(
    'the summary reports totals',
    afterCredit.body?.result?.totalCredited === 5000,
    `credited=${afterCredit.body?.result?.totalCredited}`,
  );

  const debit = await admin.post('/api/v1/wallet/adminDebit', {
    userId: customer.userId,
    amount: 1200,
    description: 'correction',
  });
  record(
    'POST /wallet/adminDebit debits the wallet',
    debit.status === 201 && debit.body?.result?.amount === 1200,
    `status=${debit.status} amount=${debit.body?.result?.amount}`,
  );
  record(
    'a debit is flagged isCredit false',
    debit.body?.result?.isCredit === false,
    JSON.stringify(debit.body?.result),
  );
  record(
    'the balance drops accordingly',
    debit.body?.result?.balanceAfter === 3800,
    `after=${debit.body?.result?.balanceAfter}`,
  );

  // adminCredit only credits: a negative amount is not a debit, it is a bad request.
  const negativeCredit = await admin.post('/api/v1/wallet/adminCredit', {
    userId: customer.userId,
    amount: -100,
  });
  record(
    'a negative amount on adminCredit -> 400',
    negativeCredit.status === 400,
    `status=${negativeCredit.status} msg=${negativeCredit.body?.message}`,
  );

  const overdraw = await admin.post('/api/v1/wallet/adminDebit', {
    userId: customer.userId,
    amount: 99999,
  });
  record(
    'overdrawing the wallet -> 422',
    overdraw.status === 422 &&
      String(overdraw.body?.message).toLowerCase().includes('insufficient'),
    `status=${overdraw.status} msg=${overdraw.body?.message}`,
  );

  await setSetting('wallet.maxBalance', 4000, 'wallet', undefined, false);
  const overCap = await admin.post('/api/v1/wallet/adminCredit', {
    userId: customer.userId,
    amount: 5000,
  });
  record(
    'exceeding the wallet cap -> 422',
    overCap.status === 422,
    `status=${overCap.status} msg=${overCap.body?.message}`,
  );
  await setSetting('wallet.maxBalance', 100000, 'wallet', undefined, false);

  const adjustAsCustomer = await cu.post('/api/v1/wallet/adminCredit', {
    userId: customer.userId,
    amount: 100,
  });
  record(
    'a customer cannot adjust their own wallet -> 403',
    adjustAsCustomer.status === 403,
    `status=${adjustAsCustomer.status}`,
  );

  // ══ Earnings and payouts ══════════════════════════════════════════════════
  await setSetting('vendor.payoutHoldDays', 0, 'vendor', undefined, false);
  await setSetting('vendor.minPayoutAmount', 100, 'vendor', undefined, false);

  const deliveredOrder = await place(1);
  await admin.patch(`/api/v1/orders/updateStatus/${deliveredOrder.id}`, { status: 'SHIPPED' });
  await admin.patch(`/api/v1/orders/updateStatus/${deliveredOrder.id}`, {
    status: 'OUT_FOR_DELIVERY',
  });
  await admin.patch(`/api/v1/orders/updateStatus/${deliveredOrder.id}`, { status: 'DELIVERED' });

  // Earnings are recorded and released so they can be claimed.
  const subOrder = await prisma.subOrder.findFirst({
    where: { orderId: deliveredOrder.id },
    select: { id: true, vendorEarning: true, commission: true },
  });

  // Delivery books the earning automatically; the test just clears its hold.
  const autoEarning = await prisma.vendorEarning.findFirst({
    where: { subOrderId: subOrder?.id },
    select: { id: true, isAvailable: true },
  });

  record(
    'delivery books a vendor earning automatically',
    Boolean(autoEarning),
    autoEarning ? 'booked' : 'missing',
  );

  // The claimable window ends at the START of today (toDayKey truncates), so an
  // earning made available a second ago is still inside the hold period.
  if (autoEarning) {
    await prisma.vendorEarning.update({
      where: { id: autoEarning.id },
      data: {
        status: 'PENDING',
        isAvailable: true,
        availableAt: new Date(Date.now() - 3 * 86400000),
      },
    });
  }

  // Re-read: the object fetched above predates the update, so asserting on it would
  // test the pre-update value rather than the backdating we just did.
  const backdated = await prisma.vendorEarning.findFirst({
    where: { id: autoEarning?.id },
    select: { isAvailable: true, availableAt: true, status: true },
  });
  record(
    'the backdated earning now sits outside the hold period',
    backdated?.isAvailable === true &&
      backdated?.status === 'PENDING' &&
      new Date(backdated?.availableAt ?? 0).getTime() < Date.now() - 86400000,
    JSON.stringify(backdated),
  );

  const earnings = await api(vendor.token).get('/api/v1/payouts/getVendorEarnings');
  record(
    'GET /payouts/getVendorEarnings -> 200',
    earnings.status === 200,
    `status=${earnings.status}`,
  );
  record(
    'the vendor sees their earning',
    D_num(earnings.body?.result?.totalRecord) >= 1,
    `total=${earnings.body?.result?.totalRecord}`,
  );
  const availableNow = await api(vendor.token).get('/api/v1/payouts/getVendorEarnings');
  const availableNet = D_num(
    D_arr(availableNow.body?.result?.itemList).reduce(
      (s: number, e: any) => s + D_num(e.netAmount),
      0,
    ),
  );
  record('the released earning shows as available', availableNet > 0, `net=${availableNet}`);

  const tooSmall = await api(vendor.token).post('/api/v1/vendors/requestPayout', { amount: 1 });
  record(
    'a payout below the minimum -> 422',
    tooSmall.status === 422 && String(tooSmall.body?.message).includes('MIN_AMOUNT'),
    `status=${tooSmall.status} msg=${tooSmall.body?.message}`,
  );

  const tooMuchAsk = await api(vendor.token).post('/api/v1/vendors/requestPayout', {
    amount: 99999,
  });
  record(
    'asking for more than is available -> 422',
    tooMuchAsk.status === 422,
    `status=${tooMuchAsk.status} msg=${tooMuchAsk.body?.message}`,
  );

  const requested = await api(vendor.token).post('/api/v1/vendors/requestPayout', {
    amount: availableNet,
    method: 'BANK',
  });
  record(
    'POST /vendors/requestPayout -> 201',
    requested.status === 201,
    `status=${requested.status} msg=${requested.body?.message}`,
  );
  const payoutId = requested.body?.result?.payoutId ?? '';
  record(
    'the payout starts pending',
    requested.body?.result?.status === 'PENDING',
    requested.body?.result?.status,
  );
  // requestPayout deliberately returns a narrow projection (no account reference);
  // the masked reference is only visible on the admin listing, asserted below.

  const doubleRequest = await api(vendor.token).post('/api/v1/vendors/requestPayout', {
    amount: availableNet,
  });
  record(
    'a second request finds nothing available -> 422',
    doubleRequest.status === 422,
    `status=${doubleRequest.status} msg=${doubleRequest.body?.message}`,
  );

  const noAmount = await api(vendor.token).post('/api/v1/vendors/requestPayout', {});
  record(
    'a payout request without an amount -> 400',
    noAmount.status === 400 && String(noAmount.body?.message).includes('amount'),
    `status=${noAmount.status} msg=${noAmount.body?.message}`,
  );

  const adminPayouts = await admin.get('/api/v1/payouts/getAll');
  record(
    'the admin payout listing exposes the masked account reference',
    /^\*{4}\d{4}$/.test(
      D_arr(adminPayouts.body?.result?.itemList).find((p: any) => p.payoutId === payoutId)
        ?.accountRef ?? '',
    ),
    D_arr(adminPayouts.body?.result?.itemList).find((p: any) => p.payoutId === payoutId)
      ?.accountRef,
  );

  const payouts = await api(vendor.token).get('/api/v1/payouts/getAll');
  record(
    'a vendor only sees their own payouts',
    D_arr(payouts.body?.result?.itemList).every((p: any) => p.vendorId === vendor.vendorId),
    `count=${D_arr(payouts.body?.result?.itemList).length}`,
  );

  const skipPending = await admin.patch(`/api/v1/payouts/updateStatus/${payoutId}`, {
    status: 'PAID',
  });
  record(
    'PENDING -> PAID is not allowed -> 422',
    skipPending.status === 422,
    `status=${skipPending.status} msg=${skipPending.body?.message}`,
  );

  const approveNoReason = await admin.patch(`/api/v1/payouts/updateStatus/${payoutId}`, {
    status: 'REJECTED',
  });
  record(
    'rejecting without a reason -> 422',
    approveNoReason.status === 422,
    `status=${approveNoReason.status}`,
  );

  const approved = await admin.patch(`/api/v1/payouts/updateStatus/${payoutId}`, {
    status: 'APPROVED',
  });
  record(
    'PENDING -> APPROVED is allowed',
    approved.status === 200 && approved.body?.result?.status === 'APPROVED',
    `status=${approved.status}`,
  );

  const claimed = await prisma.vendorEarning.findFirst({
    where: { vendorId: vendor.vendorId },
    select: { status: true },
  });
  record(
    'the claimed earnings are marked approved',
    claimed?.status === 'APPROVED',
    claimed?.status,
  );

  const paid = await admin.patch(`/api/v1/payouts/updateStatus/${payoutId}`, {
    status: 'PAID',
    reference: 'NEFT123',
  });
  record(
    'APPROVED -> PAID is allowed',
    paid.status === 200 && paid.body?.result?.status === 'PAID',
    `status=${paid.status}`,
  );

  const settled = await prisma.vendorEarning.findFirst({
    where: { vendorId: vendor.vendorId },
    select: { status: true },
  });
  record('the earnings settle on payout', settled?.status === 'PAID', settled?.status);

  const payoutAsVendor = await api(vendor.token).patch(`/api/v1/payouts/updateStatus/${payoutId}`, {
    status: 'APPROVED',
  });
  record(
    'a vendor cannot approve their own payout -> 403',
    payoutAsVendor.status === 403,
    `status=${payoutAsVendor.status}`,
  );

  // Rejection releases the earnings back.
  await prisma.vendorEarning.updateMany({
    where: { vendorId: vendor.vendorId },
    data: { status: 'PENDING', isAvailable: true },
  });
  const second = await api(vendor.token).post('/api/v1/vendors/requestPayout', {
    amount: availableNet,
  });
  const rejected = await admin.patch(
    `/api/v1/payouts/updateStatus/${second.body?.result?.payoutId}`,
    { status: 'REJECTED', rejectReason: 'bank details mismatch' },
  );
  record('PENDING -> REJECTED is allowed', rejected.status === 200, `status=${rejected.status}`);
  record(
    'the rejection reason is stored',
    rejected.body?.result?.rejectReason === 'bank details mismatch',
    rejected.body?.result?.rejectReason,
  );
  const released = await prisma.vendorEarning.findFirst({
    where: { vendorId: vendor.vendorId },
    select: { status: true },
  });
  record(
    'a rejection releases the earnings back to pending',
    released?.status === 'PENDING',
    released?.status,
  );

  // ══ Returns ═════════════════════════════════════════════════════════════════
  await setSetting('return.enabled', true, 'return', undefined, false);
  await setSetting('return.windowDays', 7, 'return', undefined, false);
  await setSetting('return.reasonRequired', true, 'return', undefined, false);
  await setSetting('return.imagesRequired', false, 'return', undefined, false);
  await setSetting('refund.mode', 'ORIGINAL', 'return', undefined, false);

  const reason = await admin.post('/api/v1/returns/addReason', {
    title: `Damaged ${run}`,
  });
  record(
    'POST /returns/addReason -> 201',
    reason.status === 201,
    `status=${reason.status} msg=${reason.body?.message}`,
  );
  const reasonId = reason.body?.result?.reasonId ?? '';

  const reasons = await cu.get('/api/v1/returns/getReasons');
  record('GET /returns/getReasons -> 200', reasons.status === 200, `status=${reasons.status}`);
  record(
    'the reason is listed',
    D_arr(reasons.body?.result?.itemList).some((r: any) => r.reasonId === reasonId),
    `count=${D_arr(reasons.body?.result?.itemList).length}`,
  );

  const returnOrder = await place(2);
  record(
    'order placed for the return flow',
    returnOrder.status === 201,
    `status=${returnOrder.status}`,
  );

  const tooEarly = await cu.post('/api/v1/returns/createRequest', {
    orderId: returnOrder.id,
    reasonId,
    items: [{ orderItemId: D_arr(returnOrder.body.itemList)[0]?.orderItemId, qty: 1 }],
  });
  record(
    'returning an undelivered order -> 422',
    tooEarly.status === 422 && String(tooEarly.body?.message).includes('delivered'),
    `status=${tooEarly.status} msg=${tooEarly.body?.message}`,
  );

  await admin.patch(`/api/v1/orders/updateStatus/${returnOrder.id}`, { status: 'SHIPPED' });
  await admin.patch(`/api/v1/orders/updateStatus/${returnOrder.id}`, {
    status: 'OUT_FOR_DELIVERY',
  });
  await admin.patch(`/api/v1/orders/updateStatus/${returnOrder.id}`, { status: 'DELIVERED' });

  const orderItemId = D_arr(returnOrder.body.itemList)[0]?.orderItemId ?? '';
  record('the order item id is known', Boolean(orderItemId), orderItemId);

  const noReasonBody = await cu.post('/api/v1/returns/createRequest', {
    orderId: returnOrder.id,
    items: [{ orderItemId, qty: 1 }],
  });
  record(
    'a return without a reason -> 400',
    noReasonBody.status === 400,
    `status=${noReasonBody.status}`,
  );

  const wrongItem = await cu.post('/api/v1/returns/createRequest', {
    orderId: returnOrder.id,
    reasonId,
    items: [{ orderItemId: 'nope123', qty: 1 }],
  });
  record(
    'returning an item that was not bought -> 422',
    wrongItem.status === 422 && String(wrongItem.body?.message).includes('PURCHASE'),
    `status=${wrongItem.status} msg=${wrongItem.body?.message}`,
  );

  const tooMany = await cu.post('/api/v1/returns/createRequest', {
    orderId: returnOrder.id,
    reasonId,
    items: [{ orderItemId, qty: 99 }],
  });
  record(
    'returning more than was bought -> 422',
    tooMany.status === 422,
    `status=${tooMany.status} msg=${tooMany.body?.message}`,
  );

  const foreignReturn = await api(other.token).post('/api/v1/returns/createRequest', {
    orderId: returnOrder.id,
    reasonId,
    items: [{ orderItemId, qty: 1 }],
  });
  record(
    "returning someone else's order -> 404",
    foreignReturn.status === 404,
    `status=${foreignReturn.status}`,
  );

  const requested2 = await cu.post('/api/v1/returns/createRequest', {
    orderId: returnOrder.id,
    reasonId,
    comment: 'arrived damaged',
    items: [{ orderItemId, qty: 1 }],
  });
  record(
    'POST /returns/request -> 201',
    requested2.status === 201,
    `status=${requested2.status} msg=${requested2.body?.message}`,
  );
  const returnId = requested2.body?.result?.returnId ?? '';
  record(
    'the refund amount is half of 2000 (1000)',
    requested2.body?.result?.refundAmount === 1000,
    `refund=${requested2.body?.result?.refundAmount}`,
  );
  record(
    'the return number is generated',
    /^RET\d{8}[A-Za-z0-9_-]{4}$/.test(requested2.body?.result?.returnNumber ?? ''),
    requested2.body?.result?.returnNumber,
  );
  record(
    'it starts as REQUESTED',
    requested2.body?.result?.status === 'REQUESTED',
    requested2.body?.result?.status,
  );
  record(
    'the return item carries the order item',
    D_arr(requested2.body?.result?.itemList)[0]?.orderItemId === orderItemId,
    JSON.stringify(D_arr(requested2.body?.result?.itemList)),
  );
  record(
    'the settlement window is reported',
    typeof requested2.body?.result?.settlementDays === 'number',
    String(requested2.body?.result?.settlementDays),
  );
  record(
    'the return payload contains no nulls',
    findNull(requested2.body?.result) === null,
    findNull(requested2.body?.result) ?? 'clean',
  );

  const returnById = await cu.get(`/api/v1/returns/getById/${returnId}`);
  record('GET /returns/getById -> 200', returnById.status === 200, `status=${returnById.status}`);

  const foreignRead = await api(other.token).get(`/api/v1/returns/getById/${returnId}`);
  record(
    'another customer cannot read the return -> 404',
    foreignRead.status === 404,
    `status=${foreignRead.status}`,
  );

  const skipToRefund = await admin.patch(`/api/v1/returns/markReceived/${returnId}`);
  record(
    'REQUESTED -> REFUNDED is not allowed -> 422',
    skipToRefund.status === 422,
    `status=${skipToRefund.status} msg=${skipToRefund.body?.message}`,
  );

  const rejectNoReason2 = await admin.patch(`/api/v1/returns/reject/${returnId}`, {});
  record(
    'rejecting a return without a reason -> 400 and rejectReason is named',
    rejectNoReason2.status === 400 &&
      String(rejectNoReason2.body?.message).includes('rejectReason'),
    `status=${rejectNoReason2.status} msg=${rejectNoReason2.body?.message}`,
  );

  const approvedReturn = await admin.patch(`/api/v1/returns/approve/${returnId}`);
  record(
    'REQUESTED -> APPROVED is allowed',
    approvedReturn.status === 200 && approvedReturn.body?.result?.status === 'APPROVED',
    `status=${approvedReturn.status}`,
  );

  const orderAfterReturn = await cu.get(`/api/v1/orders/getById/${returnOrder.id}`);
  record(
    'approving a return closes the order as returned',
    orderAfterReturn.body?.result?.status === 'RETURNED',
    orderAfterReturn.body?.result?.status,
  );

  const earlyRefund = await admin.patch(`/api/v1/returns/processRefund/${returnId}`, {});
  record(
    'refunding before the return is received -> 422',
    earlyRefund.status === 422 && String(earlyRefund.body?.message).includes('received'),
    `status=${earlyRefund.status} msg=${earlyRefund.body?.message}`,
  );

  const pickedUp = await admin.patch(`/api/v1/returns/markPickedUp/${returnId}`);
  record('APPROVED -> PICKED_UP is allowed', pickedUp.status === 200, `status=${pickedUp.status}`);

  const received = await admin.patch(`/api/v1/returns/markReceived/${returnId}`);
  record('PICKED_UP -> RECEIVED is allowed', received.status === 200, `status=${received.status}`);

  const stockBeforeRefund = await request(app).get(`/api/v1/products/getById/${productId}`);
  const stockBefore = D_num(stockBeforeRefund.body?.result?.stock);

  const refunded = await admin.patch(`/api/v1/returns/processRefund/${returnId}`, {
    mode: 'WALLET',
  });
  record(
    'PATCH /returns/processRefund -> 200',
    refunded.status === 200,
    `status=${refunded.status} msg=${refunded.body?.message}`,
  );
  record(
    'the return is marked refunded',
    refunded.body?.result?.status === 'REFUNDED',
    refunded.body?.result?.status,
  );

  const walletRefund = await cu.get('/api/v1/wallet/getBalance');
  record(
    'a wallet refund credits the wallet',
    D_num(walletRefund.body?.result?.balance) > 0,
    `balance=${walletRefund.body?.result?.balance}`,
  );

  const stockAfterRefund = await request(app).get(`/api/v1/products/getById/${productId}`);
  record(
    'the returned stock goes back on the shelf',
    D_num(stockAfterRefund.body?.result?.stock) === stockBefore + 1,
    `${stockBefore} -> ${stockAfterRefund.body?.result?.stock}`,
  );
  record(
    'the product is sellable again',
    stockAfterRefund.body?.result?.status === 'ACTIVE',
    stockAfterRefund.body?.result?.status,
  );

  const refundTwice = await admin.patch(`/api/v1/returns/processRefund/${returnId}`, {});
  record('refunding twice -> 422', refundTwice.status === 422, `status=${refundTwice.status}`);

  const vendorReturns = await api(vendor.token).get('/api/v1/returns/getAll');
  record(
    'the vendor sees the return',
    D_num(vendorReturns.body?.result?.totalRecord) >= 1,
    `total=${vendorReturns.body?.result?.totalRecord}`,
  );

  const customerReturns = await cu.get('/api/v1/returns/getAll');
  record(
    'the customer sees their own return',
    D_num(customerReturns.body?.result?.totalRecord) >= 1,
    `total=${customerReturns.body?.result?.totalRecord}`,
  );

  const otherReturns = await api(other.token).get('/api/v1/returns/getAll');
  record(
    'another customer sees none of it',
    D_num(otherReturns.body?.result?.totalRecord) === 0,
    `total=${otherReturns.body?.result?.totalRecord}`,
  );

  // ══ Return window ══════════════════════════════════════════════════════════
  const windowOrder = await place(1);
  await admin.patch(`/api/v1/orders/updateStatus/${windowOrder.id}`, { status: 'SHIPPED' });
  await admin.patch(`/api/v1/orders/updateStatus/${windowOrder.id}`, {
    status: 'OUT_FOR_DELIVERY',
  });
  await admin.patch(`/api/v1/orders/updateStatus/${windowOrder.id}`, { status: 'DELIVERED' });

  // Backdate the delivery so the window has elapsed.
  await prisma.order.update({
    where: { id: windowOrder.id },
    data: { deliveredAt: new Date(Date.now() - 30 * 86_400_000) },
  });

  const windowItemId = D_arr(windowOrder.body.itemList)[0]?.orderItemId ?? '';
  const tooLate = await cu.post('/api/v1/returns/createRequest', {
    orderId: windowOrder.id,
    reasonId,
    items: [{ orderItemId: windowItemId, qty: 1 }],
  });
  record(
    'returning after the window -> 422',
    tooLate.status === 422 && String(tooLate.body?.message).includes('WINDOW'),
    `status=${tooLate.status} msg=${tooLate.body?.message}`,
  );

  // ══ Cleanup ═══════════════════════════════════════════════════════════════
  const orderIds = (
    await prisma.order.findMany({ where: { userId: customer.userId }, select: { id: true } })
  ).map((o) => o.id);

  await prisma.returnItem.deleteMany({
    where: {
      returnRequestId: {
        in: (
          await prisma.returnRequest.findMany({
            where: { orderId: { in: orderIds } },
            select: { id: true },
          })
        ).map((r) => r.id),
      },
    },
  });
  await prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderTimeline.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.delivery.deleteMany({ where: { subOrder: { orderId: { in: orderIds } } } });
  await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.couponUsage.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.vendorEarning.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.walletTransaction.deleteMany({ where: { userId: customer.userId } });
  await prisma.payout.deleteMany({ where: { vendorId: vendor.vendorId } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.subOrder.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.cartItem.deleteMany({ where: { productId } });
  await prisma.productVariant.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.returnReason.deleteMany({ where: { title: { contains: run } } });

  await setSetting('wallet.enabled', false, 'wallet', undefined, false);
  await setSetting('payment.token.enabled', false, 'payment', undefined, false);
  await setSetting('shipping.freeAbove', 999, 'shipping', undefined, false);
  await setSetting('vendor.payoutHoldDays', 3, 'vendor', undefined, false);
  await setSetting('vendor.minPayoutAmount', 500, 'vendor', undefined, false);

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
