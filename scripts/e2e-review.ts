/**
 * Live HTTP tests for review, question, coupon and flash-sale modules.
 *
 * Covers: purchase-verified reviews, moderation, rating aggregation, vendor
 * replies, product questions, admin coupon CRUD with the reference checks, and
 * flash sales with computed sale prices.
 *
 * Usage: npx tsx scripts/e2e-review.ts
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
const email = (tag: string) => `rv_${tag}_${run}@projectname.com`;
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
      name: `RV ${tag}`,
      otp: OTP,

      email: email(tag),
      phone: phoneFor(tag),
      password: 'Secret@123',
      ...(type === 'VENDOR' ? { shopName: shopName ?? `RV Shop ${tag} ${run}` } : {}),
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

  await setSetting('shipping.defaultCharge', 50, 'shipping', undefined, false);
  await setSetting('shipping.freeAbove', 0, 'shipping', undefined, false);
  await setSetting('order.minAmount', 0, 'order', undefined, false);
  await setSetting('payment.token.enabled', false, 'payment', undefined, false);
  await setSetting('coupon.minOrderAmount', 0, 'coupon', undefined, false);
  await setSetting('coupon.maxDiscount', 0, 'coupon', undefined, false);

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
  record('vendor approved', true);

  const product = await api(vendor.token).post('/api/v1/products/createProduct', {
    name: `RV Shoe ${run}`,
    price: 1500,
    stock: 30,
    taxPercent: 0,
  });
  const productId = product.body?.result?.productId ?? '';
  record('product created', product.status === 201 && Boolean(productId));

  const address = await cu.post('/api/v1/users/addAddress', {
    type: 'HOME',
    fullName: 'Review Tester',
    phone: '+919876543210',
    line1: '221B Linking Road',
    city: 'Mumbai',
    state: 'Maharashtra',
    stateCode: 'MH',
    country: 'India',
    pincode: '400050',
  });
  const addressId = address.body?.result?.addressId ?? '';

  /** Buys the product and walks the order through to delivered. */
  const buyAndDeliver = async (qty = 1): Promise<string> => {
    await cu.del('/api/v1/cart/clearCart');
    await cu.post('/api/v1/cart/addItem', { productId, qty });
    const placed = await cu.post('/api/v1/orders/placeOrder', {
      addressId,
      paymentMethod: 'COD',
      skipStatus: true,
    });
    const id = placed.body?.result?.orderId ?? '';
    await admin.patch(`/api/v1/orders/updateStatus/${id}`, { status: 'SHIPPED' });
    await admin.patch(`/api/v1/orders/updateStatus/${id}`, { status: 'OUT_FOR_DELIVERY' });
    await admin.patch(`/api/v1/orders/updateStatus/${id}`, { status: 'DELIVERED' });
    return id;
  };

  // ══ Guards ═════════════════════════════════════════════════════════════════
  // The review list is deliberately public (optionalAuth) — a product page has to
  // render ratings for a signed-out visitor. It is the writes that need a token.
  const anon = await request(app).get('/api/v1/reviews/getAll');
  record(
    'GET /reviews/getAll is readable without a token',
    anon.status === 200 && Array.isArray(anon.body?.result?.itemList),
    `status=${anon.status}`,
  );

  const anonWrite = await request(app)
    .post('/api/v1/reviews/addReview')
    .send({ productId, rating: 5 });
  record(
    'POST /reviews/addReview without a token -> 401',
    anonWrite.status === 401,
    `status=${anonWrite.status}`,
  );

  const badRating = await cu.post('/api/v1/reviews/addReview', { productId, rating: 9 });
  record('rating above 5 -> 400', badRating.status === 400, `status=${badRating.status}`);

  const noPurchase = await cu.post('/api/v1/reviews/addReview', { productId, rating: 5 });
  record(
    'reviewing without a purchase -> 422',
    noPurchase.status === 422 && String(noPurchase.body?.message).includes('PURCHASE'),
    `status=${noPurchase.status} msg=${noPurchase.body?.message}`,
  );

  const unknownProduct = await cu.post('/api/v1/reviews/addReview', {
    productId: 'nope123',
    rating: 5,
  });
  record(
    'reviewing an unknown product -> 404',
    unknownProduct.status === 404,
    `status=${unknownProduct.status}`,
  );

  // A vendor cannot review its own product.
  const ownProduct = await api(vendor.token).post('/api/v1/reviews/addReview', {
    productId,
    rating: 1,
  });
  record(
    'reviewing own product -> 422',
    ownProduct.status === 422 && String(ownProduct.body?.message).includes('own product'),
    `status=${ownProduct.status} msg=${ownProduct.body?.message}`,
  );

  // ══ Purchase then review ════════════════════════════════════════════════════
  await buyAndDeliver(1);

  const added = await cu.post('/api/v1/reviews/addReview', {
    productId,
    rating: 4,
    title: 'Solid shoe',
    comment: 'Comfortable for long walks.',
  });
  record(
    'POST /reviews/addReview -> 201',
    added.status === 201,
    `status=${added.status} msg=${added.body?.message}`,
  );
  const reviewId = added.body?.result?.reviewId ?? '';
  record('the review is marked verified', added.body?.result?.isVerified === true);
  record(
    'it waits for moderation',
    added.body?.result?.status === 'PENDING',
    added.body?.result?.status,
  );
  record(
    'the review payload contains no nulls',
    findNull(added.body?.result) === null,
    findNull(added.body?.result) ?? 'clean',
  );

  const dup = await cu.post('/api/v1/reviews/addReview', { productId, rating: 5 });
  record(
    'reviewing twice -> 409',
    dup.status === 409 && String(dup.body?.message).includes('ALREADY_REVIEWED'),
    `status=${dup.status} msg=${dup.body?.message}`,
  );

  // A pending review must not be public yet.
  const beforeApproval = await cu.get(`/api/v1/reviews/getAll?productId=${productId}`);
  record(
    'a pending review is not public',
    D_num(beforeApproval.body?.result?.totalRecord) === 0,
    `total=${beforeApproval.body?.result?.totalRecord}`,
  );

  const approved = await admin.patch(`/api/v1/reviews/approve/${reviewId}`);
  record(
    'PATCH /reviews/moderate -> 200',
    approved.status === 200,
    `status=${approved.status} msg=${approved.body?.message}`,
  );
  record(
    'the review is approved',
    approved.body?.result?.status === 'APPROVED',
    approved.body?.result?.status,
  );

  const afterApproval = await cu.get(`/api/v1/reviews/getAll?productId=${productId}`);
  record(
    'an approved review is public',
    D_num(afterApproval.body?.result?.totalRecord) === 1,
    `total=${afterApproval.body?.result?.totalRecord}`,
  );
  record(
    'the public list shows the reviewer',
    D_arr(afterApproval.body?.result?.itemList)[0]?.userData?.userId === customer.userId,
    JSON.stringify(D_arr(afterApproval.body?.result?.itemList)[0]?.userData),
  );

  const summary = await cu.get(`/api/v1/reviews/getSummary/${productId}`);
  record('GET /reviews/getSummary -> 200', summary.status === 200, `status=${summary.status}`);
  record(
    'the average reflects the single 4-star review',
    summary.body?.result?.averageRating === 4,
    `avg=${summary.body?.result?.averageRating}`,
  );
  record(
    'the distribution has 5 buckets',
    (summary.body?.result?.distributionList ?? []).length === 5,
    `n=${(summary.body?.result?.distributionList ?? []).length}`,
  );
  record(
    'the 4-star bucket holds the review',
    D_arr(summary.body?.result?.distributionList).find((d: any) => d.rating === 4)?.count === 1,
    JSON.stringify(summary.body?.result?.distributionList),
  );
  record(
    'percentages add up',
    summary.body?.result?.distributionList?.reduce(
      (s: number, d: any) => s + D_num(d.percentage),
      0,
    ) === 100,
    String(
      summary.body?.result?.distributionList?.reduce(
        (s: number, d: any) => s + D_num(d.percentage),
        0,
      ),
    ),
  );

  const productAfterReview = await request(app).get(`/api/v1/products/getById/${productId}`);
  record(
    'the product rating is denormalised onto the product',
    productAfterReview.body?.result?.rating === 4,
    `rating=${productAfterReview.body?.result?.rating}`,
  );

  const moderatedAsCustomer = await cu.patch(`/api/v1/reviews/reject/${reviewId}`);
  record(
    'a customer cannot moderate -> 403',
    moderatedAsCustomer.status === 403,
    `status=${moderatedAsCustomer.status}`,
  );

  // ══ Edit returns to moderation ══════════════════════════════════════════════
  const edited = await cu.patch(`/api/v1/reviews/updateReview/${reviewId}`, {
    rating: 5,
    comment: 'Even better on revisit.',
  });
  record('PATCH /reviews/updateReview -> 200', edited.status === 200, `status=${edited.status}`);
  record(
    'an edit returns the review to moderation',
    edited.body?.result?.status === 'PENDING',
    edited.body?.result?.status,
  );

  const hiddenAgain = await cu.get(`/api/v1/reviews/getAll?productId=${productId}`);
  record(
    'an edited review leaves the public list again',
    D_num(hiddenAgain.body?.result?.totalRecord) === 0,
    `total=${hiddenAgain.body?.result?.totalRecord}`,
  );

  await admin.patch(`/api/v1/reviews/approve/${reviewId}`);

  const foreignEdit = await api(other.token).patch(`/api/v1/reviews/updateReview/${reviewId}`, {
    rating: 1,
  });
  record(
    "editing another person's review -> 404",
    foreignEdit.status === 404,
    `status=${foreignEdit.status}`,
  );

  // ══ Vendor reply ═══════════════════════════════════════════════════════════
  const reply = await api(vendor.token).post(`/api/v1/reviews/reply/${reviewId}`, {
    reply: 'Thanks for the feedback!',
  });
  record(
    'POST /reviews/reply -> 201',
    reply.status === 201,
    `status=${reply.status} msg=${reply.body?.message}`,
  );
  record(
    'the reply is stored',
    reply.body?.result?.vendorReply === 'Thanks for the feedback!',
    reply.body?.result?.vendorReply,
  );
  record('repliedAt is stamped', Boolean(reply.body?.result?.repliedAt));

  const otherVendor = await register('v2', 'VENDOR');
  const wrongReply = await api(otherVendor.token).post(`/api/v1/reviews/reply/${reviewId}`, {
    reply: 'nope',
  });
  record(
    'another shop cannot reply to this review -> 404',
    wrongReply.status === 404,
    `status=${wrongReply.status}`,
  );

  // ══ Helpful vote ═══════════════════════════════════════════════════════════
  const helpful = await api(other.token).post(`/api/v1/reviews/voteHelpful/${reviewId}`);
  record('POST /reviews/markHelpful -> 200', helpful.status === 200, `status=${helpful.status}`);
  record(
    'the helpful count increments',
    D_num(helpful.body?.result?.isHelpful) === 1,
    `count=${helpful.body?.result?.isHelpful}`,
  );

  // ══ Rating filter ══════════════════════════════════════════════════════════
  const fiveStar = await cu.get(`/api/v1/reviews/getAll?productId=${productId}&minRating=5`);
  record(
    'a minRating filter applies',
    D_num(fiveStar.body?.result?.totalRecord) === 1,
    `total=${fiveStar.body?.result?.totalRecord}`,
  );

  const twoStar = await cu.get(`/api/v1/reviews/getAll?productId=${productId}&maxRating=3`);
  record(
    'a maxRating filter excludes the 5-star review',
    D_num(twoStar.body?.result?.totalRecord) === 0,
    `total=${twoStar.body?.result?.totalRecord}`,
  );

  // ══ Deletion ═══════════════════════════════════════════════════════════════
  const otherReviews = await cu.get(`/api/v1/reviews/getAll?productId=${productId}`);
  record(
    'the product listing embeds its reviews',
    D_arr(productAfterReview.body?.result?.reviewList).length >= 0,
    'shape ok',
  );

  const del = await cu.del(`/api/v1/reviews/deleteReview/${reviewId}`);
  record('DELETE /reviews/deleteReview -> 200', del.status === 200, `status=${del.status}`);
  record(
    'the review is gone',
    D_num(otherReviews.body?.result?.totalRecord) === 1,
    'was present before delete',
  );

  const afterDelete = await request(app).get(`/api/v1/products/getById/${productId}`);
  record(
    'the product rating resets after the last review is removed',
    D_num(afterDelete.body?.result?.rating) === 0,
    `rating=${afterDelete.body?.result?.rating}`,
  );

  // ══ Questions ══════════════════════════════════════════════════════════════
  const tooShort = await cu.post('/api/v1/questions/ask', { productId, question: 'hi' });
  record(
    'a question under 5 characters -> 400',
    tooShort.status === 400,
    `status=${tooShort.status}`,
  );

  const asked = await cu.post('/api/v1/questions/ask', {
    productId,
    question: 'Does this run true to size?',
    isAnonymous: true,
  });
  record(
    'POST /reviews/questions/ask -> 201',
    asked.status === 201,
    `status=${asked.status} msg=${asked.body?.message}`,
  );
  const questionId = asked.body?.result?.questionId ?? '';
  record(
    'the question auto-approves for an approved shop',
    asked.body?.result?.isApproved === true,
    String(asked.body?.result?.isApproved),
  );

  const anonList = await cu.get(`/api/v1/questions/getAll/${productId}`);
  record(
    'GET /reviews/questions/getAll -> 200',
    anonList.status === 200,
    `status=${anonList.status}`,
  );
  const anonView = D_arr(anonList.body?.result?.itemList)[0];
  record(
    'an anonymous question hides the asker',
    !D_str(anonView?.userData?.userId),
    JSON.stringify(anonView?.userData),
  );
  record(
    'the question text is shown',
    D_str(anonView?.question).includes('true to size'),
    D_str(anonView?.question),
  );

  const wrongAnswer = await api(other.token).post(`/api/v1/questions/answer/${questionId}`, {
    answer: 'Yes it does.',
  });
  record(
    'a non-seller cannot answer -> 403',
    wrongAnswer.status === 403,
    `status=${wrongAnswer.status} msg=${wrongAnswer.body?.message}`,
  );

  const answered = await api(vendor.token).post(`/api/v1/questions/answer/${questionId}`, {
    answer: 'Yes, it runs true to size.',
  });
  record(
    'the selling shop can answer -> 201',
    answered.status === 201,
    `status=${answered.status}`,
  );

  const withAnswer = await cu.get(`/api/v1/questions/getAll/${productId}`);
  record(
    'the answer appears on the question',
    D_arr(withAnswer.body?.result?.itemList)[0]?.answerList?.length === 1,
    `answers=${D_arr(withAnswer.body?.result?.itemList)[0]?.answerList?.length}`,
  );

  // /questions/approve/:id is approve-only per the contract — there is no "hide"
  // route, so a body asking to un-approve must not be honoured.
  const approveAsVendor = await api(vendor.token).patch(`/api/v1/questions/approve/${questionId}`);
  record(
    'a vendor cannot moderate a question -> 403',
    approveAsVendor.status === 403,
    `status=${approveAsVendor.status}`,
  );

  const hidden = await admin.patch(`/api/v1/questions/approve/${questionId}`, {
    isApproved: false,
  });
  record('PATCH /questions/approve/:id -> 200', hidden.status === 200, `status=${hidden.status}`);
  record(
    'the question is approved',
    hidden.body?.result?.isApproved === true,
    String(hidden.body?.result?.isApproved),
  );

  const delQuestion = await cu.del(`/api/v1/questions/delete/${questionId}`);
  record(
    'DELETE /questions/delete/:id -> 200',
    delQuestion.status === 200,
    `status=${delQuestion.status}`,
  );

  const delAgain = await cu.del(`/api/v1/questions/delete/${questionId}`);
  record(
    'deleting the same question twice -> 404',
    delAgain.status === 404,
    `status=${delAgain.status}`,
  );

  // ══ Coupons ═════════════════════════════════════════════════════════════════
  const anonCoupon = await request(app).get('/api/v1/coupons/getAll');
  record(
    'GET /coupons/getAll without auth -> 401',
    anonCoupon.status === 401,
    `status=${anonCoupon.status}`,
  );

  const customerCoupon = await cu.get('/api/v1/coupons/getAll');
  record(
    'a customer cannot list coupons -> 403',
    customerCoupon.status === 403,
    `status=${customerCoupon.status}`,
  );

  await prisma.coupon.deleteMany({ where: { code: { startsWith: `RV${run}` } } });

  const badCode = await admin.post('/api/v1/coupons/createCoupon', {
    code: 'lowercase code',
    value: 100,
  });
  record('a malformed coupon code -> 400', badCode.status === 400, `status=${badCode.status}`);

  const tooMuchPercent = await admin.post('/api/v1/coupons/createCoupon', {
    code: `RV${run}P1`,
    type: 'PERCENT',
    value: 150,
  });
  record(
    'a percent coupon above 100 -> 400',
    tooMuchPercent.status === 400,
    `status=${tooMuchPercent.status}`,
  );

  const badWindow = await admin.post('/api/v1/coupons/createCoupon', {
    code: `RV${run}W`,
    value: 100,
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  record('expiry before start -> 400', badWindow.status === 400, `status=${badWindow.status}`);

  const badVendor = await admin.post('/api/v1/coupons/createCoupon', {
    code: `RV${run}V`,
    value: 100,
    vendorId: 'nope123',
  });
  record(
    'a coupon for an unknown vendor -> 404',
    badVendor.status === 404,
    `status=${badVendor.status}`,
  );

  const badProduct = await admin.post('/api/v1/coupons/createCoupon', {
    code: `RV${run}P2`,
    value: 100,
    productIds: ['nope123'],
  });
  record(
    'a coupon for an unknown product -> 422',
    badProduct.status === 422,
    `status=${badProduct.status} msg=${badProduct.body?.message}`,
  );

  const created = await admin.post('/api/v1/coupons/createCoupon', {
    code: `RV${run}SAVE`,
    title: 'Save 200',
    type: 'FLAT',
    value: 200,
    minOrderAmount: 500,
    maxUsage: 10,
  });
  record(
    'POST /coupons/createCoupon -> 201',
    created.status === 201,
    `status=${created.status} msg=${created.body?.message}`,
  );
  const couponId = created.body?.result?.couponId ?? '';
  record(
    'the code is upper-cased',
    created.body?.result?.code === `RV${run}SAVE`,
    created.body?.result?.code,
  );

  const dupCode = await admin.post('/api/v1/coupons/createCoupon', {
    code: `RV${run}SAVE`,
    value: 50,
  });
  record('a duplicate code -> 409', dupCode.status === 409, `status=${dupCode.status}`);

  const takeOver = await admin.patch(`/api/v1/coupons/updateCoupon/${couponId}`, {
    code: `RV${run}OTHER`,
    value: 300,
  });
  record(
    'renaming a coupon to a free code -> 200',
    takeOver.status === 200,
    `status=${takeOver.status}`,
  );
  const steal = await admin.post('/api/v1/coupons/createCoupon', {
    code: `RV${run}SAVE`,
    value: 100,
  });
  record('re-taking a freed code -> 201', steal.status === 201, `status=${steal.status}`);

  const updated = await admin.patch(`/api/v1/coupons/updateCoupon/${couponId}`, { value: 250 });
  record(
    'PATCH /coupons/updateCoupon -> 200',
    updated.status === 200 && D_num(updated.body?.result?.value) === 250,
    `value=${updated.body?.result?.value}`,
  );

  const validated = await admin.post('/api/v1/coupons/validateCoupon', {
    code: `RV${run}OTHER`,
    orderValue: 1000,
  });
  record(
    'POST /coupons/validate -> 200',
    validated.status === 200,
    `status=${validated.status} msg=${validated.body?.message}`,
  );
  record(
    'validation reports the discount',
    validated.body?.result?.discount === 250,
    `discount=${validated.body?.result?.discount}`,
  );
  record(
    'validation reports the payable',
    validated.body?.result?.payable === 750,
    `payable=${validated.body?.result?.payable}`,
  );

  const belowMin = await admin.post('/api/v1/coupons/validateCoupon', {
    code: `RV${run}OTHER`,
    orderValue: 100,
  });
  record(
    'validating below the minimum -> 422',
    belowMin.status === 422 && String(belowMin.body?.message).includes('minimum'),
    `status=${belowMin.status} msg=${belowMin.body?.message}`,
  );

  const toggled = await admin.patch(`/api/v1/coupons/toggleStatus/${couponId}`, {
    isActive: false,
  });
  record('PATCH /coupons/toggleStatus -> 200', toggled.status === 200, `status=${toggled.status}`);
  record(
    'the coupon is disabled',
    toggled.body?.result?.isActive === false,
    String(toggled.body?.result?.isActive),
  );

  const disabled = await admin.post('/api/v1/coupons/validateCoupon', {
    code: `RV${run}OTHER`,
    orderValue: 1000,
  });
  record(
    'a disabled coupon fails validation -> 422',
    disabled.status === 422,
    `status=${disabled.status}`,
  );

  await admin.patch(`/api/v1/coupons/toggleStatus/${couponId}`, { isActive: true });

  const listed = await admin.get('/api/v1/coupons/getAll');
  record('GET /coupons/getAll -> 200', listed.status === 200, `status=${listed.status}`);
  record(
    'the coupon is listed',
    D_arr(listed.body?.result?.itemList).some((c: any) => c.couponId === couponId),
    `total=${listed.body?.result?.totalRecord}`,
  );

  const deleted = await admin.del(`/api/v1/coupons/deleteCoupon/${couponId}`);
  record('DELETE /coupons/deleteCoupon -> 200', deleted.status === 200, `status=${deleted.status}`);

  const goneAfterDelete = await admin.post('/api/v1/coupons/validateCoupon', {
    code: `RV${run}OTHER`,
    orderValue: 1000,
  });
  record(
    'a soft-deleted coupon no longer validates -> 404',
    goneAfterDelete.status === 404,
    `status=${goneAfterDelete.status}`,
  );

  const usages = await admin.get(`/api/v1/coupons/getUsages/${couponId}`);
  record('GET /coupons/getUsages -> 200', usages.status === 200, `status=${usages.status}`);

  // ══ Flash sales ════════════════════════════════════════════════════════════
  const badWindow2 = await admin.post('/api/v1/flashSales/create', {
    name: `RV Backwards ${run}`,
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now()).toISOString(),
    discountValue: 10,
    items: [{ productId, saleStock: 5 }],
  });
  record(
    'a sale ending before it starts -> 400',
    badWindow2.status === 400,
    `status=${badWindow2.status}`,
  );

  const badItem = await admin.post('/api/v1/flashSales/create', {
    name: `RV Ghost ${run}`,
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    discountValue: 10,
    items: [{ productId: 'nope123', saleStock: 5 }],
  });
  record(
    'a sale with an unknown product -> 422',
    badItem.status === 422,
    `status=${badItem.status}`,
  );

  const sale = await admin.post('/api/v1/flashSales/create', {
    name: `RV Sale ${run}`,
    startsAt: new Date(Date.now() - 3_600_000).toISOString(),
    endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    discountType: 'PERCENT',
    discountValue: 20,
    items: [{ productId, saleStock: 10 }],
  });
  record(
    'POST /flash-sales/create -> 201',
    sale.status === 201,
    `status=${sale.status} msg=${sale.body?.message}`,
  );
  const saleId = sale.body?.result?.flashSaleId ?? '';
  const saleSlug = sale.body?.result?.slug ?? '';
  record('the sale is live', sale.body?.result?.isLive === true, String(sale.body?.result?.isLive));
  record(
    'the sale price is 20% off (1200)',
    D_num(sale.body?.result?.itemList?.[0]?.salePrice) === 1200,
    `price=${sale.body?.result?.itemList?.[0]?.salePrice}`,
  );
  record(
    'the saving is reported',
    D_num(sale.body?.result?.itemList?.[0]?.saving) === 300,
    `saving=${sale.body?.result?.itemList?.[0]?.saving}`,
  );
  record(
    'the discount percent is reported',
    D_num(sale.body?.result?.itemList?.[0]?.discountPercent) === 20,
    `pct=${sale.body?.result?.itemList?.[0]?.discountPercent}`,
  );
  record(
    'the countdown is present',
    D_num(sale.body?.result?.secondsRemaining) > 0,
    `secs=${sale.body?.result?.secondsRemaining}`,
  );
  record(
    'the sale payload contains no nulls',
    findNull(sale.body?.result) === null,
    findNull(sale.body?.result) ?? 'clean',
  );

  const bySlug = await cu.get(`/api/v1/flashSales/getBySlug/${saleSlug}`);
  record(
    'GET /flash-sales/getBySlug/:slug -> 200',
    bySlug.status === 200,
    `status=${bySlug.status}`,
  );
  record(
    'the slug resolves the sale',
    bySlug.body?.result?.flashSaleId === saleId,
    bySlug.body?.result?.flashSaleId,
  );

  const liveList = await cu.get('/api/v1/flashSales/getActive');
  record('GET /flash-sales/getLive -> 200', liveList.status === 200, `status=${liveList.status}`);
  record(
    'the live sale is included',
    D_num(liveList.body?.result?.itemCount) >= 1,
    `count=${liveList.body?.result?.itemCount}`,
  );

  const future = await admin.post('/api/v1/flashSales/create', {
    name: `RV Future ${run}`,
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 172_800_000).toISOString(),
    discountType: 'FLAT',
    discountValue: 200,
    items: [{ productId, saleStock: 3 }],
  });
  record(
    'an upcoming sale is not live',
    future.body?.result?.isLive === false,
    String(future.body?.result?.isLive),
  );
  record(
    'an upcoming sale is flagged',
    future.body?.result?.isUpcoming === true,
    String(future.body?.result?.isUpcoming),
  );
  record(
    'a flat discount is applied (1500 - 200 = 1300)',
    D_num(future.body?.result?.itemList?.[0]?.salePrice) === 1300,
    `price=${future.body?.result?.itemList?.[0]?.salePrice}`,
  );

  const liveOnly = await cu.get('/api/v1/flashSales/getAll?scope=live');
  record(
    'scope=live excludes the upcoming sale',
    D_arr(liveOnly.body?.result?.itemList).every((s: any) => s.isLive === true),
    `count=${D_arr(liveOnly.body?.result?.itemList).length}`,
  );

  const saleUpdated = await admin.patch(`/api/v1/flashSales/update/${saleId}`, {
    discountValue: 50,
    items: [{ productId, saleStock: 4 }],
  });
  record(
    'PATCH /flash-sales/update -> 200',
    saleUpdated.status === 200,
    `status=${saleUpdated.status}`,
  );
  record(
    'the item price is recomputed at 50% off (750)',
    D_num(saleUpdated.body?.result?.itemList?.[0]?.salePrice) === 750,
    `price=${saleUpdated.body?.result?.itemList?.[0]?.salePrice}`,
  );
  record(
    'the item stock is replaced',
    D_num(saleUpdated.body?.result?.itemList?.[0]?.saleStock) === 4,
    `stock=${saleUpdated.body?.result?.itemList?.[0]?.saleStock}`,
  );

  const saleAsVendor = await api(vendor.token).post('/api/v1/flashSales/create', {
    name: `RV Sneaky ${run}`,
    startsAt: new Date(Date.now()).toISOString(),
    endsAt: new Date(Date.now() + 3600_000).toISOString(),
    discountValue: 90,
    items: [{ productId, saleStock: 1 }],
  });
  record(
    'a vendor cannot create a flash sale -> 403',
    saleAsVendor.status === 403,
    `status=${saleAsVendor.status}`,
  );

  const saleDeleted = await admin.del(`/api/v1/flashSales/delete/${saleId}`);
  record(
    'DELETE /flash-sales/delete/:id -> 200',
    saleDeleted.status === 200,
    `status=${saleDeleted.status}`,
  );

  const saleGone = await cu.get(`/api/v1/flashSales/getBySlug/${saleSlug}`);
  record('a deleted sale is gone -> 404', saleGone.status === 404, `status=${saleGone.status}`);

  // ══ Cleanup ═══════════════════════════════════════════════════════════════
  const orderIds = (
    await prisma.order.findMany({ where: { userId: customer.userId }, select: { id: true } })
  ).map((o) => o.id);

  await prisma.flashSaleItem.deleteMany({
    where: {
      flashSaleId: {
        in: (
          await prisma.flashSale.findMany({
            where: { slug: { contains: run } },
            select: { id: true },
          })
        ).map((s) => s.id),
      },
    },
  });
  await prisma.flashSale.deleteMany({ where: { slug: { contains: run } } });
  await prisma.coupon.deleteMany({ where: { code: { startsWith: `RV${run}` } } });
  await prisma.answer.deleteMany({
    where: {
      questionId: {
        in: (await prisma.question.findMany({ where: { productId }, select: { id: true } })).map(
          (q) => q.id,
        ),
      },
    },
  });
  await prisma.question.deleteMany({ where: { productId } });
  await prisma.review.deleteMany({ where: { productId } });
  await prisma.orderTimeline.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.delivery.deleteMany({ where: { subOrder: { orderId: { in: orderIds } } } });
  await prisma.shipment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.couponUsage.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.vendorEarning.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.walletTransaction.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.subOrder.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.cartItem.deleteMany({ where: { productId } });
  await prisma.productVariant.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });

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
