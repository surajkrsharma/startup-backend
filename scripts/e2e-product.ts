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
const email = (tag: string) => `pr_${tag}_${run}@projectname.com`;
const phoneFor = (tag: string): string => {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) % 100;
  return `+7${run}${String(hash).padStart(2, '0')}`;
};

const register = async (
  tag: string,
  type: 'CUSTOMER' | 'VENDOR',
  shopName?: string,
): Promise<{ token: string; userId: string; vendorId: string; status: number }> => {
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
      name: `PR ${tag}`,
      verificationToken: verified.body?.result?.verificationToken ?? '',
      email: email(tag),
      phone: phoneFor(tag),
      password: 'Secret@123',
      ...(type === 'VENDOR' ? { shopName: shopName ?? `PR Shop ${tag} ${run}` } : {}),
    });

  return {
    token: res.body?.result?.accessToken ?? '',
    userId: res.body?.result?.userData?.userId ?? '',
    vendorId: res.body?.result?.vendorData?.vendorId ?? '',
    status: res.status,
  };
};

const login = async (addr: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: email(addr), password: 'Secret@123' });
  return res.body?.result?.accessToken ?? '';
};

const main = async (): Promise<void> => {
  /* eslint-disable no-console */
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

  record('bootstrap tokens', Boolean(adminToken && vendorA.token && vendorB.token));

  const earlyCreate = await request(app)
    .post('/api/v1/products/createProduct')
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ name: 'Too Early', price: 100 });

  record(
    'createProduct while PENDING -> 403 VENDOR_NOT_APPROVED',
    earlyCreate.status === 403 && String(earlyCreate.body?.message).includes('VENDOR_NOT_APPROVED'),
    `status=${earlyCreate.status} msg=${earlyCreate.body?.message}`,
  );

  for (const v of [vendorA, vendorB]) {
    await request(app)
      .patch(`/api/v1/vendors/approveVendor/${v.vendorId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
  }
  record('both vendors approved', true);

  const created = await request(app)
    .post('/api/v1/products/createProduct')
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({
      name: 'Test Cotton Shirt',
      description: 'A comfortable cotton shirt.',
      price: 799,
      mrpPrice: 1299,
      stock: 25,
      sku: `SKU-${run}-A`,
      taxPercent: 18,
    });

  record(
    'POST /products/createProduct -> 201',
    created.status === 201,
    `status=${created.status} msg=${created.body?.message}`,
  );

  const productId = created.body?.result?.productId ?? '';
  const productSlug = created.body?.result?.slug ?? '';
  record(
    'create returns productId + slug',
    Boolean(productId && productSlug),
    `${productId} / ${productSlug}`,
  );
  record(
    'status defaults to ACTIVE when stock > 0',
    created.body?.result?.status === 'ACTIVE',
    created.body?.result?.status,
  );
  record(
    'create envelope is strict',
    JSON.stringify(Object.keys(created.body ?? {})) === '["status","message","result"]',
  );

  const draft = await request(app)
    .post('/api/v1/products/createProduct')
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ name: 'Out Of Stock Item', price: 99, stock: 0 });
  record(
    'zero-stock product defaults to DRAFT',
    draft.body?.result?.status === 'DRAFT',
    draft.body?.result?.status,
  );
  const draftId = draft.body?.result?.productId ?? '';

  const dup = await request(app)
    .post('/api/v1/products/createProduct')
    .set('Authorization', `Bearer ${vendorB.token}`)
    .send({ name: 'Test Cotton Shirt', price: 899, stock: 10 });

  const dupSlug = dup.body?.result?.slug ?? '';
  const baseSlug = productSlug.replace(/-\d+$/, '');
  const suffix = dupSlug.startsWith(`${baseSlug}-`)
    ? Number(dupSlug.slice(baseSlug.length + 1))
    : 0;

  record(
    'duplicate product name -> slug auto-suffixed',
    dup.status === 201 &&
      dupSlug !== productSlug &&
      dupSlug.startsWith(`${baseSlug}-`) &&
      suffix >= 2,
    `first=${productSlug} second=${dupSlug}`,
  );
  const dupId = dup.body?.result?.productId ?? '';

  const badPrice = await request(app)
    .post('/api/v1/products/createProduct')
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ name: 'Bad Price', price: -5 });
  record('negative price -> 400', badPrice.status === 400, `status=${badPrice.status}`);

  const badStock = await request(app)
    .post('/api/v1/products/createProduct')
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ name: 'Bad Stock', price: 100, stock: -3 });
  record('negative stock -> 400', badStock.status === 400, `status=${badStock.status}`);

  const missingPrice = await request(app)
    .post('/api/v1/products/createProduct')
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ name: 'No Price' });
  record('missing price -> 400', missingPrice.status === 400, `status=${missingPrice.status}`);

  const customerCreate = await request(app)
    .post('/api/v1/products/createProduct')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ name: 'Nope', price: 100 });
  record(
    'customer cannot create products -> 403',
    customerCreate.status === 403,
    `status=${customerCreate.status}`,
  );

  const anonCreate = await request(app)
    .post('/api/v1/products/createProduct')
    .send({ name: 'Nope', price: 100 });
  record('anonymous create -> 401', anonCreate.status === 401, `status=${anonCreate.status}`);

  const byId = await request(app).get(`/api/v1/products/getById/${productId}`);
  record('GET /products/getById/:id -> 200', byId.status === 200, `status=${byId.status}`);
  record(
    'getById returns nested vendorData + imageList',
    Boolean(byId.body?.result?.vendorData?.shopName) && Array.isArray(byId.body?.result?.imageList),
    Object.keys(byId.body?.result ?? {}).join(','),
  );

  const bySlug = await request(app).get(`/api/v1/products/getBySlug/${productSlug}`);
  record('GET /products/getBySlug/:slug -> 200', bySlug.status === 200, `status=${bySlug.status}`);
  record(
    'slug lookup returns the same product',
    bySlug.body?.result?.productId === productId,
    bySlug.body?.result?.productId,
  );

  const badSlug = await request(app).get('/api/v1/products/getBySlug/no-such-slug-xyz');
  record('unknown slug -> 404', badSlug.status === 404, `status=${badSlug.status}`);

  const publicList = await request(app).get('/api/v1/products/getAll?limit=50');
  record('GET /products/getAll -> 200', publicList.status === 200, `status=${publicList.status}`);
  record(
    'pagination fields come first',
    Object.keys(publicList.body?.result ?? {})[0] === 'totalRecord',
    Object.keys(publicList.body?.result ?? {})
      .slice(0, 3)
      .join(','),
  );
  record(
    'draft product hidden from anonymous list',
    !(publicList.body?.result?.productList ?? []).some((p: any) => p.productId === draftId),
  );
  record(
    'active product visible to anonymous',
    (publicList.body?.result?.productList ?? []).some((p: any) => p.productId === productId),
  );

  const vendorList = await request(app)
    .get('/api/v1/products/getAll?limit=50')
    .set('Authorization', `Bearer ${vendorA.token}`);
  record(
    'vendor sees own DRAFT products',
    (vendorList.body?.result?.productList ?? []).some((p: any) => p.productId === draftId),
    `count=${(vendorList.body?.result?.productList ?? []).length}`,
  );

  const vendorListB = await request(app)
    .get('/api/v1/products/getAll?limit=50')
    .set('Authorization', `Bearer ${vendorB.token}`);
  record(
    "vendor B does NOT see vendor A's products",
    !(vendorListB.body?.result?.productList ?? []).some((p: any) => p.productId === productId),
  );

  const searchList = await request(app).get(
    `/api/v1/products/getAll?search=Cotton%20Shirt&limit=20`,
  );
  record(
    'search filter matches on name',
    (searchList.body?.result?.productList ?? []).some((p: any) => p.productId === productId),
    `found=${(searchList.body?.result?.productList ?? []).length}`,
  );

  const priceFilter = await request(app).get('/api/v1/products/getAll?minPrice=1000&limit=20');
  record(
    'minPrice filter excludes cheaper products',
    !(priceFilter.body?.result?.productList ?? []).some((p: any) => p.productId === productId),
    `found=${(priceFilter.body?.result?.productList ?? []).length}`,
  );

  const vendorFilter = await request(app).get(
    `/api/v1/products/getAll?vendorId=${vendorA.vendorId}&limit=20`,
  );
  record(
    'vendorId filter narrows correctly',
    (vendorFilter.body?.result?.productList ?? []).every(
      (p: any) => p.vendorData?.vendorId === vendorA.vendorId,
    ),
    `found=${(vendorFilter.body?.result?.productList ?? []).length}`,
  );

  const facets = await request(app).get('/api/v1/products/getFilters');
  record('GET /products/getFilters -> 200', facets.status === 200, `status=${facets.status}`);
  record(
    'facets include categoryList, brandList, vendorList, priceRange',
    Array.isArray(facets.body?.result?.categoryList) &&
      Array.isArray(facets.body?.result?.vendorList) &&
      typeof facets.body?.result?.priceRange === 'object',
    Object.keys(facets.body?.result ?? {}).join(','),
  );
  record(
    'priceRange has min and max',
    typeof facets.body?.result?.priceRange?.minPrice === 'number' &&
      typeof facets.body?.result?.priceRange?.maxPrice === 'number',
    JSON.stringify(facets.body?.result?.priceRange ?? {}),
  );

  const updated = await request(app)
    .patch(`/api/v1/products/updateProduct/${productId}`)
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ name: 'Updated Shirt Name', price: 899 });

  record('PATCH updateProduct -> 200', updated.status === 200, `status=${updated.status}`);
  record(
    'update applies new price',
    updated.body?.result?.price === 899,
    String(updated.body?.result?.price),
  );

  const emptyUpdate = await request(app)
    .patch(`/api/v1/products/updateProduct/${productId}`)
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({});
  record('empty update -> 400', emptyUpdate.status === 400, `status=${emptyUpdate.status}`);

  const foreignUpdate = await request(app)
    .patch(`/api/v1/products/updateProduct/${productId}`)
    .set('Authorization', `Bearer ${vendorB.token}`)
    .send({ name: 'Hijacked' });
  record(
    "vendor B cannot edit vendor A's product -> 403",
    foreignUpdate.status === 403,
    `status=${foreignUpdate.status}`,
  );

  const adminUpdate = await request(app)
    .patch(`/api/v1/products/updateProduct/${productId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ isFeatured: true });
  record('admin can edit any product', adminUpdate.status === 200, `status=${adminUpdate.status}`);

  const stock = await request(app)
    .patch(`/api/v1/products/updateStock/${productId}`)
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ stock: 7, lowStockThreshold: 10 });

  record('PATCH updateStock -> 200', stock.status === 200, `status=${stock.status}`);
  record(
    'stock reports previous and new value',
    stock.body?.result?.previousStock === 25 && stock.body?.result?.stock === 7,
    `${stock.body?.result?.previousStock} -> ${stock.body?.result?.stock}`,
  );
  record(
    'low-stock flag computed',
    stock.body?.result?.isLowStock === true,
    String(stock.body?.result?.isLowStock),
  );

  const badStockUpdate = await request(app)
    .patch(`/api/v1/products/updateStock/${productId}`)
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ stock: -1 });
  record(
    'negative stock update -> 400',
    badStockUpdate.status === 400,
    `status=${badStockUpdate.status}`,
  );

  const toggled = await request(app)
    .patch(`/api/v1/products/toggleStatus/${productId}`)
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ status: 'INACTIVE' });
  record(
    'PATCH toggleStatus -> INACTIVE',
    toggled.status === 200 && toggled.body?.result?.status === 'INACTIVE',
    `status=${toggled.status} state=${toggled.body?.result?.status}`,
  );

  const hiddenList = await request(app).get('/api/v1/products/getAll?limit=50');
  record(
    'INACTIVE product drops out of the public list',
    !(hiddenList.body?.result?.productList ?? []).some((p: any) => p.productId === productId),
  );

  const badStatus = await request(app)
    .patch(`/api/v1/products/toggleStatus/${productId}`)
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ status: 'NOT_A_STATUS' });
  record('invalid status -> 400', badStatus.status === 400, `status=${badStatus.status}`);

  await request(app)
    .patch(`/api/v1/products/toggleStatus/${productId}`)
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ status: 'ACTIVE' });

  const related = await request(app).get(`/api/v1/products/getRelated/${productId}?limit=10`);
  record('GET /products/getRelated/:id -> 200', related.status === 200, `status=${related.status}`);
  record(
    'related list excludes the product itself',
    !(related.body?.result?.productList ?? []).some((p: any) => p.productId === productId),
  );

  const frequently = await request(app).get(`/api/v1/products/getFrequentlyBought/${productId}`);
  record(
    'GET /products/getFrequentlyBought/:id -> 200',
    frequently.status === 200,
    `status=${frequently.status}`,
  );

  const recommended = await request(app)
    .get('/api/v1/products/getRecommended')
    .set('Authorization', `Bearer ${customer.token}`);
  record(
    'GET /products/getRecommended -> 200',
    recommended.status === 200,
    `status=${recommended.status}`,
  );

  const track = await request(app).post(`/api/v1/products/trackView/${productId}`);
  record(
    'POST /products/trackView/:id -> 200',
    track.status === 200 && typeof track.body?.result?.viewCount === 'number',
    `status=${track.status} views=${track.body?.result?.viewCount}`,
  );

  const trackMissing = await request(app).post('/api/v1/products/trackView/does-not-exist');
  record(
    'trackView unknown product -> 404',
    trackMissing.status === 404,
    `status=${trackMissing.status}`,
  );

  const bulkCreated = await request(app)
    .post('/api/v1/products/bulkCreate')
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({
      products: [
        { name: `Bulk One ${run}`, price: 100, stock: 5 },
        { name: `Bulk Two ${run}`, price: 200, stock: 3 },
        { name: 'Bad Row', price: -1 },
      ],
      continueOnError: true,
    });

  record(
    'POST /products/bulkCreate -> 201',
    bulkCreated.status === 201,
    `status=${bulkCreated.status}`,
  );
  record(
    'partial success reported with successCount + failCount',
    bulkCreated.body?.result?.successCount === 2 && bulkCreated.body?.result?.failCount === 1,
    `ok=${bulkCreated.body?.result?.successCount} fail=${bulkCreated.body?.result?.failCount}`,
  );
  record(
    'errors carry the failing row number',
    (bulkCreated.body?.result?.errorList ?? [])[0]?.row === 3,
    JSON.stringify(bulkCreated.body?.result?.errorList ?? []),
  );

  const bulkIds = (bulkCreated.body?.result?.productList ?? []).map((p: any) => p.productId);

  const bulkUpdated = await request(app)
    .patch('/api/v1/products/bulkUpdate')
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ productIds: bulkIds, updates: { isFeatured: true, status: 'ACTIVE' } });

  record(
    'PATCH /products/bulkUpdate -> 200',
    bulkUpdated.status === 200 && bulkUpdated.body?.result?.successCount === 2,
    `status=${bulkUpdated.status} ok=${bulkUpdated.body?.result?.successCount}`,
  );

  const bulkForeign = await request(app)
    .patch('/api/v1/products/bulkUpdate')
    .set('Authorization', `Bearer ${vendorB.token}`)
    .send({ productIds: bulkIds, updates: { isFeatured: false } });
  record(
    "bulkUpdate refuses another vendor's ids",
    bulkForeign.body?.result?.successCount === 0 &&
      bulkForeign.body?.result?.failCount === bulkIds.length,
    `ok=${bulkForeign.body?.result?.successCount} fail=${bulkForeign.body?.result?.failCount}`,
  );

  const bulkPrice = await request(app)
    .post('/api/v1/products/bulkPriceUpdate')
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ productIds: bulkIds, type: 'PERCENT_DOWN', value: 10 });

  record(
    'POST /products/bulkPriceUpdate -> 200',
    bulkPrice.status === 200,
    `status=${bulkPrice.status}`,
  );
  record(
    'price update reports previous and new price',
    (bulkPrice.body?.result?.productList ?? []).every(
      (p: any) => p.price > 0 && p.previousPrice > 0,
    ),
    JSON.stringify(
      (bulkPrice.body?.result?.productList ?? []).map((p: any) => `${p.previousPrice}->${p.price}`),
    ),
  );

  const bulkPriceFloor = await request(app)
    .post('/api/v1/products/bulkPriceUpdate')
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ productIds: bulkIds, type: 'PERCENT_DOWN', value: 99 });
  record(
    'price never falls to zero',
    (bulkPriceFloor.body?.result?.productList ?? []).every((p: any) => p.price >= 0.01),
    JSON.stringify((bulkPriceFloor.body?.result?.productList ?? []).map((p: any) => p.price)),
  );

  const bulkDeleted = await request(app)
    .patch('/api/v1/products/bulkDelete')
    .set('Authorization', `Bearer ${vendorA.token}`)
    .send({ productIds: bulkIds });

  record(
    'PATCH /products/bulkDelete soft-deletes',
    bulkDeleted.body?.result?.successCount === 2,
    `ok=${bulkDeleted.body?.result?.successCount}`,
  );

  const deleted = await request(app)
    .del(`/api/v1/products/deleteProduct/${dupId}`)
    .set('Authorization', `Bearer ${vendorB.token}`);
  record(
    'DELETE /products/deleteProduct/:id -> 200',
    deleted.status === 200,
    `status=${deleted.status}`,
  );
  record('delete reports soft delete', deleted.body?.result?.isSoftDelete === true);

  const afterDelete = await request(app).get(`/api/v1/products/getById/${dupId}`);
  record(
    'soft-deleted product -> 404 on read',
    afterDelete.status === 404,
    `status=${afterDelete.status}`,
  );

  const deleteForeign = await request(app)
    .del(`/api/v1/products/deleteProduct/${productId}`)
    .set('Authorization', `Bearer ${vendorB.token}`);
  record(
    "cannot delete another vendor's product -> 403",
    deleteForeign.status === 403,
    `status=${deleteForeign.status}`,
  );

  const failedChecks = checks.filter((c) => !c.passed);
  console.log(`\n${checks.length - failedChecks.length}/${checks.length} checks passed`);
  if (failedChecks.length) {
    console.log('\nFAILED:');
    for (const f of failedChecks) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
  /* eslint-enable no-console */
};

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[e2e-product] crashed:', err);
  process.exit(1);
});
