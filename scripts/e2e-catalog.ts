import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

const OTP = process.env.OTP_STATIC_CODE || '111111';

const sendOtp = async (identifier: string) => {
  await request(app).post('/api/v1/auth/register/sendOtp').send({ identifier });
  const verified = await request(app)
    .post('/api/v1/auth/register/verifyOtp')
    .send({ identifier, otp: OTP });
  return verified.body?.result?.verificationToken ?? '';
};

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
const phoneFor = (tag: string): string => {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) % 100;
  return `+7${run}${String(hash).padStart(2, '0')}`;
};

const main = async (): Promise<void> => {
  /* eslint-disable no-console */
  const adminToken = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@projectname.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperSecret@123',
    })
    .then((r) => r.body?.result?.accessToken ?? '');
  record('bootstrap admin token', Boolean(adminToken));

  const verificationToken = await sendOtp(`ct_${run}@projectname.com`);

  const customer = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type: 'CUSTOMER',
      name: 'CT Buyer',
      verificationToken,
      email: `ct_${run}@projectname.com`,
      phone: phoneFor('ct'),
      password: 'Secret@123',
    });
  const customerToken = customer.body?.result?.accessToken ?? '';
  record('bootstrap customer token', Boolean(customerToken));

  const vendorVerificationToken = await sendOtp(`ctv_${run}@projectname.com`);

  const vendor = await request(app)
    .post('/api/v1/auth/register')
    .send({
      type: 'VENDOR',
      name: 'CT Vendor',
      verificationToken: vendorVerificationToken,
      email: `ctv_${run}@projectname.com`,
      phone: phoneFor('ctv'),
      password: 'Secret@123',
      shopName: `CT Shop ${run}`,
    });
  const vendorToken = vendor.body?.result?.accessToken ?? '';
  const vendorId = vendor.body?.result?.vendorData?.vendorId ?? '';

  await request(app)
    .patch(`/api/v1/vendors/approveVendor/${vendorId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});

  const catRoot = await request(app)
    .post('/api/v1/categories/createCategory')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Root Cat ${run}`, description: 'Top level' });

  record(
    'POST /categories/createCategory -> 201',
    catRoot.status === 201,
    `status=${catRoot.status} msg=${catRoot.body?.message}`,
  );
  const rootId = catRoot.body?.result?.categoryId ?? '';
  record(
    'category slug auto-generated',
    Boolean(catRoot.body?.result?.slug),
    catRoot.body?.result?.slug,
  );
  record('new category is active', catRoot.body?.result?.isActive === true);

  const catChild = await request(app)
    .post('/api/v1/categories/createCategory')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Child Cat ${run}`, parentId: rootId });
  record(
    'child category with parentId -> 201',
    catChild.status === 201,
    `status=${catChild.status}`,
  );
  const childId = catChild.body?.result?.categoryId ?? '';

  const catNoAuth = await request(app)
    .post('/api/v1/categories/createCategory')
    .send({ name: 'Nope' });
  record(
    'anonymous create category -> 401',
    catNoAuth.status === 401,
    `status=${catNoAuth.status}`,
  );

  const catCustomer = await request(app)
    .post('/api/v1/categories/createCategory')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ name: 'Nope' });
  record(
    'customer create category -> 403',
    catCustomer.status === 403,
    `status=${catCustomer.status}`,
  );

  const badName = await request(app)
    .post('/api/v1/categories/createCategory')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'A' });
  record('too-short category name -> 400', badName.status === 400, `status=${badName.status}`);

  const badParent = await request(app)
    .post('/api/v1/categories/createCategory')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Orphan ${run}`, parentId: 'does-not-exist' });
  record('unknown parentId -> 404', badParent.status === 404, `status=${badParent.status}`);

  const catList = await request(app).get('/api/v1/categories/getAll?limit=50');
  record('GET /categories/getAll -> 200', catList.status === 200, `status=${catList.status}`);
  record(
    'categoryList present, pagination first',
    Array.isArray(catList.body?.result?.categoryList) &&
      Object.keys(catList.body?.result ?? {})[0] === 'totalRecord',
    Object.keys(catList.body?.result ?? {})
      .slice(0, 3)
      .join(','),
  );

  const catRoots = await request(app).get('/api/v1/categories/getAll?rootsOnly=1&limit=50');
  record(
    'rootsOnly returns only top-level rows',
    (catRoots.body?.result?.categoryList ?? []).every((c: any) => !D_str(c.parentId)),
    `count=${(catRoots.body?.result?.categoryList ?? []).length}`,
  );

  const catSearch = await request(app).get(
    `/api/v1/categories/getAll?search=Root%20Cat%20${run}&limit=20`,
  );
  record(
    'search matches category name',
    (catSearch.body?.result?.categoryList ?? []).some((c: any) => c.categoryId === rootId),
    `found=${(catSearch.body?.result?.categoryList ?? []).length}`,
  );

  const catTree = await request(app).get('/api/v1/categories/getAll?tree=1');
  record('tree=1 -> 200', catTree.status === 200, `status=${catTree.status}`);
  record(
    'tree returns nested childList, no pagination numbers',
    Array.isArray(catTree.body?.result?.categoryList) &&
      (catTree.body?.result?.categoryList ?? []).some(
        (c: any) => Array.isArray(c.childList) && c.childList.length > 0,
      ) &&
      catTree.body?.result?.totalRecord === undefined,
    Object.keys(catTree.body?.result ?? {}).join(','),
  );

  const catById = await request(app).get(`/api/v1/categories/getById/${rootId}`);
  record('GET /categories/getById/:id -> 200', catById.status === 200, `status=${catById.status}`);
  record(
    'getById includes childList',
    (catById.body?.result?.childList ?? []).some((c: any) => c.categoryId === childId),
    `children=${(catById.body?.result?.childList ?? []).length}`,
  );

  const catMissing = await request(app).get('/api/v1/categories/getById/nope');
  record('unknown category -> 404', catMissing.status === 404, `status=${catMissing.status}`);

  const catSlug = String(catById.body?.result?.slug ?? '');
  const catBySlug = await request(app).get(`/api/v1/categories/getBySlug/${catSlug}`);
  record(
    'GET /categories/getBySlug/:slug -> 200',
    catBySlug.status === 200 && catBySlug.body?.result?.categoryId === rootId,
    `status=${catBySlug.status} slug=${catSlug}`,
  );
  record(
    'getBySlug returns the same shape as getById',
    Array.isArray(catBySlug.body?.result?.childList) &&
      catBySlug.body?.result?.name === catById.body?.result?.name,
    JSON.stringify(Object.keys(catBySlug.body?.result ?? {})),
  );

  const catSlugMissing = await request(app).get('/api/v1/categories/getBySlug/no-such-slug-xyz');
  record(
    'unknown category slug -> 404',
    catSlugMissing.status === 404,
    `status=${catSlugMissing.status}`,
  );

  const catUpdated = await request(app)
    .patch(`/api/v1/categories/updateCategory/${rootId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Renamed Root ${run}` });
  record(
    'PATCH updateCategory -> 200',
    catUpdated.status === 200 && catUpdated.body?.result?.name === `Renamed Root ${run}`,
    `status=${catUpdated.status}`,
  );

  const selfParent = await request(app)
    .patch(`/api/v1/categories/updateCategory/${rootId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ parentId: rootId });
  record(
    'category cannot parent itself -> 400',
    selfParent.status === 400,
    `status=${selfParent.status}`,
  );

  const cycle = await request(app)
    .patch(`/api/v1/categories/updateCategory/${rootId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ parentId: childId });
  record(
    'category cannot nest under its own child -> 400',
    cycle.status === 400,
    `status=${cycle.status}`,
  );

  const delParent = await request(app)
    .del(`/api/v1/categories/deleteCategory/${rootId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    'delete category with children -> 409',
    delParent.status === 409,
    `status=${delParent.status} msg=${delParent.body?.message}`,
  );

  const brandRes = await request(app)
    .post('/api/v1/brands/createBrand')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `CT Brand ${run}` });
  const brandId = brandRes.body?.result?.brandId ?? '';

  const productRes = await request(app)
    .post('/api/v1/products/createProduct')
    .set('Authorization', `Bearer ${vendorToken}`)
    .send({
      name: `CT Product ${run}`,
      price: 500,
      stock: 10,
      categoryId: childId,
      brandId,
    });
  const productId = productRes.body?.result?.productId ?? '';
  record(
    'product created in child category',
    productRes.status === 201,
    `status=${productRes.status}`,
  );

  const delWithProduct = await request(app)
    .del(`/api/v1/categories/deleteCategory/${childId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    'delete category with products -> 409',
    delWithProduct.status === 409,
    `status=${delWithProduct.status} msg=${delWithProduct.body?.message}`,
  );

  const extraCats = await Promise.all(
    [1, 2].map(async (i) => {
      const r = await request(app)
        .post('/api/v1/categories/createCategory')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Order Cat ${i} ${run}` });
      return r.body?.result?.categoryId ?? '';
    }),
  );

  const reorder = await request(app)
    .post('/api/v1/categories/reorder')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ categoryIds: extraCats });
  record(
    'POST /categories/reorder -> 200',
    reorder.status === 200,
    `status=${reorder.status} count=${reorder.body?.result?.reorderedCount}`,
  );

  const reorderBad = await request(app)
    .post('/api/v1/categories/reorder')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ categoryIds: ['nope-1'] });
  record(
    'reorder with unknown id -> 404',
    reorderBad.status === 404,
    `status=${reorderBad.status}`,
  );

  const bulkCat = await request(app)
    .post('/api/v1/categories/bulkCreate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      categories: [
        { name: `Bulk A ${run}` },
        { name: `Bulk B ${run}` },
        { name: 'X', parentId: 'nope' },
      ],
      continueOnError: true,
    });
  record(
    'bulkCreate reports per-row failures',
    bulkCat.body?.result?.successCount === 2 && bulkCat.body?.result?.failCount === 1,
    `ok=${bulkCat.body?.result?.successCount} fail=${bulkCat.body?.result?.failCount}`,
  );

  for (const id of [...extraCats]) {
    await request(app)
      .del(`/api/v1/categories/deleteCategory/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
  }
  const delLeaf = await request(app)
    .del(`/api/v1/categories/deleteCategory/${childId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    'delete leaf category still referenced by a product -> 409',
    delLeaf.status === 409,
    `status=${delLeaf.status}`,
  );

  record('POST /brands/createBrand -> 201', brandRes.status === 201, `status=${brandRes.status}`);
  const brandList = await request(app).get('/api/v1/brands/getAll?limit=50');
  record(
    'GET /brands/getAll -> 200',
    brandList.status === 200 && Array.isArray(brandList.body?.result?.brandList),
    `status=${brandList.status}`,
  );

  const brandDup = await request(app)
    .post('/api/v1/brands/createBrand')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `CT Brand ${run}` });
  record(
    'duplicate brand name -> slug auto-suffixed',
    brandDup.status === 201 && brandDup.body?.result?.slug !== brandRes.body?.result?.slug,
    `${brandRes.body?.result?.slug} vs ${brandDup.body?.result?.slug}`,
  );

  const brandInUse = await request(app)
    .del(`/api/v1/brands/deleteBrand/${brandId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    'delete brand in use -> 409 BRAND_IN_USE',
    brandInUse.status === 409 && String(brandInUse.body?.message).includes('BRAND_IN_USE'),
    `status=${brandInUse.status} msg=${brandInUse.body?.message}`,
  );

  const brandById = await request(app).get(`/api/v1/brands/getById/${brandId}`);
  record('GET /brands/getById/:id -> 200', brandById.status === 200, `status=${brandById.status}`);
  record(
    'brand includes productCount',
    typeof brandById.body?.result?.productCount === 'number',
    String(brandById.body?.result?.productCount),
  );

  const brandBad = await request(app)
    .post('/api/v1/brands/createBrand')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'B', logo: 'not-a-url' });
  record('invalid logo url -> 400', brandBad.status === 400, `status=${brandBad.status}`);

  const tag = await request(app)
    .post('/api/v1/tags/createTag')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `CT Tag ${run}` });
  record('POST /tags/createTag -> 201', tag.status === 201, `status=${tag.status}`);
  const tagId = tag.body?.result?.tagId ?? '';

  const tagDup = await request(app)
    .post('/api/v1/tags/createTag')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `CT Tag ${run}` });
  record(
    'duplicate tag name -> slug auto-suffixed',
    tagDup.status === 201 && tagDup.body?.result?.slug !== tag.body?.result?.slug,
    `${tag.body?.result?.slug} vs ${tagDup.body?.result?.slug}`,
  );

  const tagList = await request(app).get('/api/v1/tags/getAll?limit=50');
  record(
    'GET /tags/getAll -> 200',
    tagList.status === 200 && Array.isArray(tagList.body?.result?.tagList),
    `status=${tagList.status}`,
  );

  const tagNoUse = await request(app)
    .del(`/api/v1/tags/deleteTag/${tagId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record('delete unused tag -> 200', tagNoUse.status === 200, `status=${tagNoUse.status}`);

  const bulkTags = await request(app)
    .post('/api/v1/tags/bulkCreate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ tags: [{ name: `BulkT1 ${run}` }, { name: `BulkT2 ${run}` }] });
  record(
    'POST /tags/bulkCreate -> 201',
    bulkTags.status === 201 && bulkTags.body?.result?.successCount === 2,
    `ok=${bulkTags.body?.result?.successCount}`,
  );

  const attr = await request(app)
    .post('/api/v1/attributes/createAttribute')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `CT Size ${run}`, type: 'SIZE', options: ['S', 'M', 'L'], isVariant: true });
  record(
    'POST /attributes/createAttribute -> 201',
    attr.status === 201,
    `status=${attr.status} msg=${attr.body?.message}`,
  );
  record(
    'attribute options stored',
    Array.isArray(attr.body?.result?.options) && attr.body.result.options.length === 3,
    JSON.stringify(attr.body?.result?.options ?? []),
  );
  const attrId = attr.body?.result?.attributeId ?? '';

  const attrBadVariant = await request(app)
    .post('/api/v1/attributes/createAttribute')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Bad Var ${run}`, type: 'TEXT', isVariant: true });
  record(
    'variant attribute with type TEXT -> 400',
    attrBadVariant.status === 400,
    `status=${attrBadVariant.status}`,
  );

  const attrBadType = await request(app)
    .post('/api/v1/attributes/createAttribute')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Bad Type ${run}`, type: 'NOPE' });
  record(
    'invalid attribute type -> 400',
    attrBadType.status === 400,
    `status=${attrBadType.status}`,
  );

  const attrList = await request(app).get('/api/v1/attributes/getAll?limit=50');
  record(
    'GET /attributes/getAll -> 200',
    attrList.status === 200 && Array.isArray(attrList.body?.result?.attributeList),
    `status=${attrList.status}`,
  );

  const variantOnly = await request(app).get('/api/v1/attributes/getAll?isVariant=1&limit=50');
  record(
    'isVariant filter works',
    (variantOnly.body?.result?.attributeList ?? []).every((a: any) => a.isVariant === true),
    `count=${(variantOnly.body?.result?.attributeList ?? []).length}`,
  );

  const attrUpdated = await request(app)
    .patch(`/api/v1/attributes/updateAttribute/${attrId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ options: ['S', 'M', 'L', 'XL'] });
  record(
    'PATCH updateAttribute -> 200',
    attrUpdated.status === 200 && (attrUpdated.body?.result?.options ?? []).length === 4,
    `status=${attrUpdated.status}`,
  );

  const attrDel = await request(app)
    .del(`/api/v1/attributes/deleteAttribute/${attrId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record('delete unused attribute -> 200', attrDel.status === 200, `status=${attrDel.status}`);

  const manual = await request(app)
    .post('/api/v1/collections/createCollection')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `CT Manual ${run}`, type: 'MANUAL', productIds: [productId] });
  record(
    'POST manual collection -> 201',
    manual.status === 201,
    `status=${manual.status} msg=${manual.body?.message}`,
  );
  const manualId = manual.body?.result?.collectionId ?? '';

  const manualNoProducts = await request(app)
    .post('/api/v1/collections/createCollection')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `CT Manual Empty ${run}`, type: 'MANUAL' });
  record(
    'manual collection without products -> 400',
    manualNoProducts.status === 400,
    `status=${manualNoProducts.status}`,
  );

  const dynamic = await request(app)
    .post('/api/v1/collections/createCollection')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: `CT Dynamic ${run}`,
      type: 'DYNAMIC',
      rules: { vendorIds: [vendorId], minPrice: 100, sortBy: 'price', sortDirection: 'asc' },
    });
  record('POST dynamic collection -> 201', dynamic.status === 201, `status=${dynamic.status}`);
  const dynamicId = dynamic.body?.result?.collectionId ?? '';

  const dynamicNoRules = await request(app)
    .post('/api/v1/collections/createCollection')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `CT Dyn Empty ${run}`, type: 'DYNAMIC' });
  record(
    'dynamic collection without rules -> 400',
    dynamicNoRules.status === 400,
    `status=${dynamicNoRules.status}`,
  );

  const collList = await request(app).get('/api/v1/collections/getAll?limit=50');
  record(
    'GET /collections/getAll -> 200',
    collList.status === 200 && Array.isArray(collList.body?.result?.collectionList),
    `status=${collList.status}`,
  );

  const manualProducts = await request(app).get(`/api/v1/collections/getProducts/${manualId}`);
  record(
    'GET manual collection products -> 200',
    manualProducts.status === 200,
    `status=${manualProducts.status}`,
  );
  record(
    'manual membership resolves the product',
    (manualProducts.body?.result?.productList ?? []).some((p: any) => p.productId === productId),
    `count=${(manualProducts.body?.result?.productList ?? []).length}`,
  );

  const dynamicProducts = await request(app).get(`/api/v1/collections/getProducts/${dynamicId}`);
  record(
    'dynamic collection resolves by rules',
    dynamicProducts.status === 200 &&
      (dynamicProducts.body?.result?.productList ?? []).some((p: any) => p.productId === productId),
    `count=${(dynamicProducts.body?.result?.productList ?? []).length}`,
  );

  const setProducts = await request(app)
    .post(`/api/v1/collections/setProducts/${manualId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ productIds: [productId], replace: true });
  record(
    'POST setProducts on manual collection -> 200',
    setProducts.status === 200,
    `status=${setProducts.status}`,
  );

  const setOnDynamic = await request(app)
    .post(`/api/v1/collections/setProducts/${dynamicId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ productIds: [productId] });
  record(
    'setProducts on DYNAMIC collection -> 400',
    setOnDynamic.status === 400,
    `status=${setOnDynamic.status}`,
  );

  const setBadProduct = await request(app)
    .post(`/api/v1/collections/setProducts/${manualId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ productIds: ['nope-product'] });
  record(
    'setProducts with unknown product -> 404',
    setBadProduct.status === 404,
    `status=${setBadProduct.status}`,
  );

  const collBySlug = await request(app).get(
    `/api/v1/collections/getBySlug/${manual.body?.result?.slug ?? ''}`,
  );
  record('GET collection by slug -> 200', collBySlug.status === 200, `status=${collBySlug.status}`);

  const collDel = await request(app)
    .del(`/api/v1/collections/deleteCollection/${manualId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record('DELETE collection -> 200', collDel.status === 200, `status=${collDel.status}`);

  const collAfterDel = await request(app).get(`/api/v1/collections/getById/${manualId}`);
  record(
    'soft-deleted collection -> 404',
    collAfterDel.status === 404,
    `status=${collAfterDel.status}`,
  );

  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
  /* eslint-enable no-console */
};

const D_str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[e2e-catalog] crashed:', err);
  process.exit(1);
});
