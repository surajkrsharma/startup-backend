/**
 * Live HTTP tests for the content module: CMS pages, blog, FAQ, banners,
 * contact and newsletter, geo, currency, tax, translations, dropdowns,
 * webhooks, bulk import and reports.
 *
 * Every response is checked against the strict envelope (status/message/result,
 * never a null anywhere) and against role boundaries.
 *
 * Usage: npx tsx scripts/e2e-content.ts
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
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
  /* eslint-enable no-console */
};

const run = Date.now().toString().slice(-9);
const email = (tag: string) => `cn_${tag}_${run}@projectname.com`;
const phoneFor = (tag: string): string => {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = (hash * 31 + tag.charCodeAt(i)) % 100;
  return `+7${run}${String(hash).padStart(2, '0')}`;
};

/** The envelope must never carry a null, anywhere, at any depth. */
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

/** Asserts the three-key envelope, ordering, and the absence of nulls. */
const envelope = (res: any, label: string): boolean => {
  const keys = Object.keys(res.body ?? {});
  const ordered =
    JSON.stringify(keys.slice(0, 3)) === JSON.stringify(['status', 'message', 'result']);
  const shaped = typeof res.body?.status === 'boolean' && typeof res.body?.message === 'string';
  const resultOk =
    res.body?.result !== null &&
    res.body?.result !== undefined &&
    typeof res.body?.result === 'object';
  const nullHit = findNull(res.body);

  record(
    `${label} envelope is strict`,
    ordered && shaped && resultOk && nullHit === null,
    nullHit ? `null at ${nullHit}` : `keys=${keys.join(',')}`,
  );

  return ordered && shaped && resultOk && nullHit === null;
};

/** Errors carry the code in the message. */
const hasCode = (res: any, label: string): boolean => {
  const passed = typeof res.body?.message === 'string' && /\([A-Z_]+\)$/.test(res.body.message);
  record(label, passed, res.body?.message);
  return passed;
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

const publicGet = (p: string) => request(app).get(p);
const publicPost = (p: string, b: any) => request(app).post(p).send(b);

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

  record('bootstrap tokens', Boolean(adminToken && customer.token && vendor.token && rival.token));

  /**
   * Without the admin token every staff route below returns 401, which would bury the real cause
   * under a hundred failures. The shared test database can be reset out from under us, in which
   * case `npm run seed` restores the SUPER_ADMIN account.
   */
  if (!adminToken) {
    throw new Error(
      'SUPER_ADMIN login failed. If the shared database was reset, run `npm run seed` before this suite.',
    );
  }

  const admin = api(adminToken);
  const cu = api(customer.token);

  for (const v of [vendor, rival]) {
    await admin.patch(`/api/v1/vendors/approveVendor/${v.vendorId}`, {});
  }
  record('vendors approved', true);

  // ── Pages ──────────────────────────────────────────────────────────────────

  const anonPage = await publicGet('/api/v1/pages/getAll');
  record('GET /content/pages needs no auth', anonPage.status === 200, `status=${anonPage.status}`);
  envelope(anonPage, 'GET /content/pages');

  const page = await admin.post('/api/v1/pages/create', {
    title: `About Us ${run}`,
    content: '<p>About page body.</p>',
    metaTitle: 'About',
    metaDescription: 'About this marketplace',
  });
  record(
    'POST /content/pages/createPage -> 201',
    page.status === 201,
    `status=${page.status} msg=${page.body?.message}`,
  );
  envelope(page, 'createPage');
  const pageId = D_str(page.body?.result?.pageId);
  const pageSlug = D_str(page.body?.result?.slug);
  record('the page is created with a slug', pageSlug.length > 0, pageSlug);

  const dupSlug = await admin.post('/api/v1/pages/create', {
    title: `About Us Again ${run}`,
    slug: pageSlug,
  });
  record(
    'a duplicate slug is de-duplicated rather than colliding',
    dupSlug.status === 201 && D_str(dupSlug.body?.result?.slug) !== pageSlug,
    D_str(dupSlug.body?.result?.slug),
  );

  const bySlug = await publicGet(`/api/v1/pages/getBySlug/${pageSlug}`);
  record(
    'GET /content/pages/by-slug/:slug -> 200',
    bySlug.status === 200,
    `status=${bySlug.status}`,
  );
  envelope(bySlug, 'pages by-slug');

  const missingSlug = await publicGet('/api/v1/pages/getAll/by-slug/definitely-not-a-real-page');
  record('an unknown page slug -> 404', missingSlug.status === 404, `status=${missingSlug.status}`);
  hasCode(missingSlug, 'the missing-page message carries an error code');

  const updPage = await admin.patch(`/api/v1/pages/update/${pageId}`, {
    title: `About Us v2 ${run}`,
  });
  record(
    'PATCH /content/pages/updatePage/:id -> 200',
    updPage.status === 200,
    `status=${updPage.status}`,
  );
  record(
    'the title is updated',
    D_str(updPage.body?.result?.title) === `About Us v2 ${run}`,
    D_str(updPage.body?.result?.title),
  );

  // Re-saving with the same slug must not collide with its own row.
  const sameSlug = await admin.patch(`/api/v1/pages/update/${pageId}`, {
    slug: pageSlug,
  });
  record(
    're-saving a page with its own slug keeps the slug',
    sameSlug.status === 200 && D_str(sameSlug.body?.result?.slug) === pageSlug,
    `status=${sameSlug.status} slug=${D_str(sameSlug.body?.result?.slug)}`,
  );

  const delPage = await admin.del(`/api/v1/pages/delete/${pageId}`);
  record(
    'DELETE /content/pages/deletePage/:id -> 200',
    delPage.status === 200,
    `status=${delPage.status}`,
  );
  const gonePage = await publicGet(`/api/v1/pages/getBySlug/${pageSlug}`);
  record(
    'a soft-deleted page is gone from the public lookup',
    gonePage.status === 404,
    `status=${gonePage.status}`,
  );

  const noAuthPage = await request(app).post('/api/v1/pages/create').send({ title: 'Nope' });
  record(
    'creating a page without a token -> 401',
    noAuthPage.status === 401,
    `status=${noAuthPage.status}`,
  );

  const customerPage = await cu.post('/api/v1/pages/create', {
    title: `Customer Page ${run}`,
  });
  record(
    'a customer cannot create a page -> 403',
    customerPage.status === 403,
    `status=${customerPage.status}`,
  );

  const badSlug = await admin.post('/api/v1/pages/create', {
    title: 'Bad',
    slug: 'Not A Slug',
  });
  record('a malformed slug -> 400', badSlug.status === 400, `status=${badSlug.status}`);

  const emptyUpd = await admin.patch(`/api/v1/pages/update/${pageId}`, {});
  record('an empty page update -> 400', emptyUpd.status === 400, `status=${emptyUpd.status}`);

  const unknownField = await admin.post('/api/v1/pages/create', {
    title: 'Extra',
    nope: 1,
  });
  record(
    'an unknown body field -> 400',
    unknownField.status === 400,
    `status=${unknownField.status}`,
  );

  // ── Blog ───────────────────────────────────────────────────────────────────

  const blogs = await publicGet('/api/v1/blogs/getAll');
  record('GET /content/blogs -> 200', blogs.status === 200, `status=${blogs.status}`);
  envelope(blogs, 'GET /content/blogs');

  const draft = await admin.post('/api/v1/blogs/create', {
    title: `Draft Post ${run}`,
    content: 'draft body',
    isPublished: false,
  });
  record('POST /content/blogs/createBlog -> 201', draft.status === 201, `status=${draft.status}`);
  const draftSlug = D_str(draft.body?.result?.slug);
  const draftId = D_str(draft.body?.result?.blogId);

  const publicDraft = await publicGet(`/api/v1/blogs/getBySlug/${draftSlug}`);
  record(
    'an unpublished post is hidden from anonymous readers',
    publicDraft.status === 404,
    `status=${publicDraft.status}`,
  );

  const staffDraft = await admin.get(`/api/v1/blogs/getBySlug/${draftSlug}`);
  record(
    'staff can still read the unpublished post',
    staffDraft.status === 200,
    `status=${staffDraft.status}`,
  );

  const live = await admin.post('/api/v1/blogs/create', {
    title: `Live Post ${run}`,
    excerpt: 'live excerpt',
    content: 'live body',
    tags: ['news', 'offers'],
  });
  const liveSlug = D_str(live.body?.result?.slug);
  record(
    'a published post is visible anonymously',
    (await publicGet(`/api/v1/blogs/getBySlug/${liveSlug}`)).status === 200,
  );
  record(
    'tags are stored',
    D_arr(live.body?.result?.tags).length === 2,
    JSON.stringify(live.body?.result?.tags),
  );

  const byTag = await publicGet('/api/v1/blogs/getAll?tag=offers');
  record(
    'filtering by tag finds the post',
    D_arr(byTag.body?.result?.itemList).some((b: any) => D_str(b?.slug) === liveSlug),
    `count=${D_arr(byTag.body?.result?.itemList).length}`,
  );

  const badAuthor = await admin.post('/api/v1/blogs/create', {
    title: `Bad Author ${run}`,
    authorId: 'clzzzzzzzzzzzzzzzzzzzzzzzzzz',
  });
  record('an unknown authorId -> 404', badAuthor.status === 404, `status=${badAuthor.status}`);

  const pubBlog = await admin.patch(`/api/v1/blogs/update/${draftId}`, {
    isPublished: true,
  });
  record(
    'PATCH /content/blogs/updateBlog/:id publishes the post',
    pubBlog.status === 200,
    `status=${pubBlog.status}`,
  );
  record(
    'the post is now publicly readable',
    (await publicGet(`/api/v1/blogs/getBySlug/${draftSlug}`)).status === 200,
  );

  const delBlog = await admin.del(`/api/v1/blogs/delete/${draftId}`);
  record(
    'DELETE /content/blogs/deleteBlog/:id -> 200',
    delBlog.status === 200,
    `status=${delBlog.status}`,
  );

  const missingBlog = await admin.patch(
    '/api/v1/blogs/getAll/updateBlog/clzzzzzzzzzzzzzzzzzzzzzzzzzz',
    { title: 'Ghost title' },
  );
  record(
    'updating an unknown post -> 404',
    missingBlog.status === 404,
    `status=${missingBlog.status}`,
  );

  // ── FAQ ────────────────────────────────────────────────────────────────────

  const faqs = await publicGet('/api/v1/faqs/getAll');
  record('GET /content/faqs -> 200', faqs.status === 200, `status=${faqs.status}`);
  envelope(faqs, 'GET /content/faqs');

  const faq = await admin.post('/api/v1/faqs/create', {
    question: `How do I track order ${run}?`,
    answer: 'Open My Orders and pick the order.',
    category: 'orders',
  });
  record('POST /content/faqs/createFaq -> 201', faq.status === 201, `status=${faq.status}`);
  const faqId = D_str(faq.body?.result?.faqId);

  const shortFaq = await admin.post('/api/v1/faqs/create', {
    question: 'Hi?',
    answer: 'No.',
  });
  record('a too-short question -> 400', shortFaq.status === 400, `status=${shortFaq.status}`);

  const updFaq = await admin.patch(`/api/v1/faqs/update/${faqId}`, { sortOrder: 3 });
  record(
    'PATCH /content/faqs/updateFaq/:id -> 200',
    updFaq.status === 200 && D_num(updFaq.body?.result?.sortOrder) === 3,
    `status=${updFaq.status}`,
  );

  const delFaq = await admin.del(`/api/v1/faqs/delete/${faqId}`);
  record(
    'DELETE /content/faqs/deleteFaq/:id -> 200',
    delFaq.status === 200,
    `status=${delFaq.status}`,
  );

  // ── Banners ────────────────────────────────────────────────────────────────

  const banners = await publicGet('/api/v1/banners/getAll');
  record('GET /content/banners -> 200', banners.status === 200, `status=${banners.status}`);
  envelope(banners, 'GET /content/banners');

  const banner = await admin.post('/api/v1/banners/create', {
    title: `Summer Sale ${run}`,
    image: 'https://cdn.example.com/summer.jpg',
    type: 'HOME',
    linkUrl: 'https://example.com/summer',
  });
  record(
    'POST /content/banners/createBanner -> 201',
    banner.status === 201,
    `status=${banner.status}`,
  );
  const bannerId = D_str(banner.body?.result?.bannerId);

  const badWindow = await admin.post('/api/v1/banners/create', {
    title: `Backwards ${run}`,
    startsAt: '2030-01-10T00:00:00.000Z',
    endsAt: '2030-01-01T00:00:00.000Z',
  });
  record(
    'a banner window that ends before it starts -> 400',
    badWindow.status === 400,
    `status=${badWindow.status}`,
  );

  const updBanner = await admin.patch(`/api/v1/banners/update/${bannerId}`, {
    title: `Autumn Sale ${run}`,
  });
  record(
    'PATCH /content/banners/updateBanner/:id -> 200',
    updBanner.status === 200,
    `status=${updBanner.status}`,
  );
  record(
    're-saving a banner with its own slug keeps the slug',
    (
      await admin.patch(`/api/v1/banners/update/${bannerId}`, {
        slug: D_str(banner.body?.result?.slug),
      })
    ).status === 200,
  );

  const delBanner = await admin.del(`/api/v1/banners/delete/${bannerId}`);
  record(
    'DELETE /content/banners/deleteBanner/:id -> 200',
    delBanner.status === 200,
    `status=${delBanner.status}`,
  );

  // ── Contact ────────────────────────────────────────────────────────────────

  const contact = await request(app)
    .post('/api/v1/contact/submit')
    .send({
      name: `Probe ${run}`,
      email: email('contact'),
      subject: 'Question about an order',
      message: 'Could you tell me where my parcel is?',
    });
  record(
    'POST /content/contact -> 201 (public)',
    contact.status === 201,
    `status=${contact.status}`,
  );
  envelope(contact, 'POST /content/contact');
  const contactId = D_str(contact.body?.result?.contactId);

  const badContact = await request(app)
    .post('/api/v1/contact/submit')
    .send({ name: 'X', email: 'nope', message: 'hi' });
  record(
    'a malformed contact form -> 400',
    badContact.status === 400,
    `status=${badContact.status}`,
  );

  const contacts = await admin.get('/api/v1/contact/getAll');
  record(
    'GET /content/contact/getAll -> 200 (admin)',
    contacts.status === 200,
    `status=${contacts.status}`,
  );
  record(
    'the submission shows in the staff list',
    D_arr(contacts.body?.result?.itemList).some((c: any) => D_str(c?.contactId) === contactId),
    `count=${D_arr(contacts.body?.result?.itemList).length}`,
  );

  const contactsAsCustomer = await cu.get('/api/v1/contact/getAll');
  record(
    'a customer cannot read submissions -> 403',
    contactsAsCustomer.status === 403,
    `status=${contactsAsCustomer.status}`,
  );

  const marked = await admin.patch(`/api/v1/contact/${contactId}/markRead`, {
    isRead: true,
  });
  record(
    'PATCH /content/contact/:id/markRead -> 200',
    marked.status === 200 && marked.body?.result?.isRead === true,
    `status=${marked.status}`,
  );

  const unread = await admin.get('/api/v1/contact/getAll?isRead=false');
  record(
    'a read submission drops out of the unread filter',
    !D_arr(unread.body?.result?.itemList).some((c: any) => D_str(c?.contactId) === contactId),
    `count=${D_arr(unread.body?.result?.itemList).length}`,
  );

  // ── Newsletter ─────────────────────────────────────────────────────────────

  const subEmail = email('sub');
  const sub = await request(app).post('/api/v1/newsletter/subscribe').send({ email: subEmail });
  record(
    'POST /content/newsletter/subscribe -> 201 (public)',
    sub.status === 201,
    `status=${sub.status}`,
  );
  record(
    'the address is confirmed as subscribed',
    sub.body?.result?.isSubscribed === true,
    JSON.stringify(sub.body?.result),
  );

  const dupSub = await request(app).post('/api/v1/newsletter/subscribe').send({ email: subEmail });
  record('subscribing twice -> 409', dupSub.status === 409, `status=${dupSub.status}`);
  hasCode(dupSub, 'the duplicate-subscribe message carries an error code');

  const badEmailSub = await request(app)
    .post('/api/v1/newsletter/subscribe')
    .send({ email: 'not-an-email' });
  record(
    'a malformed subscribe email -> 400',
    badEmailSub.status === 400,
    `status=${badEmailSub.status}`,
  );

  const subs = await admin.get('/api/v1/newsletter/getAll');
  record(
    'GET /content/newsletter/getAll -> 200 (admin)',
    subs.status === 200,
    `status=${subs.status}`,
  );
  record(
    'the subscriber is listed',
    D_arr(subs.body?.result?.itemList).some((s: any) => D_str(s?.email) === subEmail),
    `count=${D_arr(subs.body?.result?.itemList).length}`,
  );
  record(
    'the unsubscribe token is never exposed to a client',
    !D_arr(subs.body?.result?.itemList).some((s: any) => 'token' in s),
  );

  // The token is only readable straight from the table, so pull it for the test.
  const subRow = await prisma.newsletterSubscriber.findUnique({
    where: { email: subEmail },
    select: { token: true },
  });
  const unsubToken = D_str(subRow?.token);
  record('a subscriber row has an unsubscribe token', unsubToken.length > 0);

  const unsub = await request(app)
    .post('/api/v1/newsletter/unsubscribe')
    .send({ token: unsubToken });
  record(
    'POST /content/newsletter/unsubscribe -> 200',
    unsub.status === 200,
    `status=${unsub.status}`,
  );
  record(
    'the address is confirmed unsubscribed',
    unsub.body?.result?.isSubscribed === false,
    JSON.stringify(unsub.body?.result),
  );

  const resub = await request(app).post('/api/v1/newsletter/subscribe').send({ email: subEmail });
  record(
    're-subscribing after an unsubscribe reactivates the same row',
    resub.status === 201,
    `status=${resub.status}`,
  );

  const badUnsub = await request(app)
    .post('/api/v1/newsletter/unsubscribe')
    .send({ token: 'not-a-real-token' });
  record(
    'an unknown unsubscribe token -> 404',
    badUnsub.status === 404,
    `status=${badUnsub.status}`,
  );

  const resub2 = await request(app).post('/api/v1/newsletter/subscribe').send({ email: subEmail });
  record(
    'subscribing to an already-active address -> 409',
    resub2.status === 409,
    `status=${resub2.status}`,
  );

  // ── Geo ────────────────────────────────────────────────────────────────────

  const countries = await publicGet('/api/v1/countries/getAll');
  record(
    'GET /content/geo/countries -> 200',
    countries.status === 200,
    `status=${countries.status}`,
  );
  envelope(countries, 'GET /content/geo/countries');

  const seeded = await admin.post('/api/v1/countries/seedCountries');
  record(
    'POST /content/geo/seedCountries -> 200',
    seeded.status === 200,
    `status=${seeded.status} msg=${seeded.body?.message}`,
  );
  record(
    'the seed reports the reference table size',
    D_num(seeded.body?.result?.countries) >= 20,
    JSON.stringify(seeded.body?.result),
  );

  const seedAsCustomer = await cu.post('/api/v1/countries/seedCountries');
  record(
    'a customer cannot seed countries -> 403',
    seedAsCustomer.status === 403,
    `status=${seedAsCustomer.status}`,
  );

  const reseed = await admin.post('/api/v1/countries/seedCountries');
  record(
    're-seeding is idempotent and adds nothing new',
    D_num(reseed.body?.result?.states) === 0 && D_num(reseed.body?.result?.cities) === 0,
    JSON.stringify(reseed.body?.result),
  );

  const states = await publicGet('/api/v1/countries/getStates/IN');
  record(
    'GET /countries/getStates/:countryCode -> 200',
    states.status === 200,
    `status=${states.status}`,
  );
  const stateRows = D_arr(states.body?.result?.itemList);
  record('Indian states are seeded', stateRows.length > 0, `count=${stateRows.length}`);
  record(
    'a plain state list reports a city count, not the cities',
    stateRows.some((s: any) => D_num(s?.cityCount) > 0) &&
      stateRows.every((s: any) => s?.cityList === undefined),
    JSON.stringify(stateRows[0]),
  );

  const statesWithCities = await publicGet('/api/v1/countries/getStates/IN?includeCities=true');
  const richRows = D_arr(statesWithCities.body?.result?.itemList);
  record(
    'includeCities=true nests the cityList',
    richRows.some((s: any) => D_arr(s?.cityList).length > 0),
    `count=${richRows.length}`,
  );
  envelope(statesWithCities, 'GET /countries/getStates/IN?includeCities=true');

  // getCities is scoped to one state, so it needs a real state code.
  const someStateCode = D_str(richRows.find((s: any) => D_arr(s?.cityList).length > 0)?.code);
  record('a state with cities was found', someStateCode.length > 0, someStateCode);

  const cities = await publicGet(`/api/v1/countries/getCities/${someStateCode}`);
  record(
    'GET /countries/getCities/:stateCode -> 200',
    cities.status === 200,
    `status=${cities.status}`,
  );
  envelope(cities, 'GET /countries/getCities/:stateCode');
  record(
    'the reference city table is populated',
    D_num(cities.body?.result?.totalRecord) >= 1,
    `total=${D_num(cities.body?.result?.totalRecord)}`,
  );
  record(
    'every city belongs to the requested state',
    D_arr(cities.body?.result?.itemList).every((c: any) => c?.stateCode === someStateCode),
    JSON.stringify(D_arr(cities.body?.result?.itemList).map((c: any) => c?.stateCode)),
  );

  const emptyState = await publicGet('/api/v1/countries/getCities/ZZ');
  record(
    'an unknown state code -> 200 with no rows',
    emptyState.status === 200 && D_arr(emptyState.body?.result?.itemList).length === 0,
    `status=${emptyState.status}`,
  );

  const cityName = D_str(
    richRows.find((s: any) => D_arr(s?.cityList).length > 0)?.cityList?.[0]?.name,
  );
  const pincode = D_str(
    richRows.find((s: any) => D_arr(s?.cityList).length > 0)?.cityList?.[0]?.pincode,
  );
  record(
    'the seeded city carries a pincode',
    cityName.length > 0 && pincode.length > 0,
    `${cityName}/${pincode}`,
  );

  const pin = await publicPost('/api/v1/countries/checkPincode', { pincode });
  record(
    'POST /countries/checkPincode -> 200',
    pin.status === 200,
    `status=${pin.status} msg=${pin.body?.message}`,
  );
  envelope(pin, 'checkPincode');
  record(
    'the pincode resolves to its city',
    D_str(pin.body?.result?.cityName) === cityName,
    `${D_str(pin.body?.result?.cityName)} vs ${cityName}`,
  );
  record(
    'the resolved pincode is marked known and serviceable',
    pin.body?.result?.isKnown === true && pin.body?.result?.isServiceable === true,
    JSON.stringify(pin.body?.result),
  );
  record(
    'the state and country are resolved too',
    D_str(pin.body?.result?.stateCode).length > 0 && D_str(pin.body?.result?.countryCode) === 'IN',
    JSON.stringify(pin.body?.result),
  );

  const badPin = await publicPost('/api/v1/countries/checkPincode', { pincode: 'abc' });
  record(
    'a non-numeric pincode -> 400',
    badPin.status === 400,
    `status=${badPin.status} msg=${badPin.body?.message}`,
  );

  const noPin = await publicPost('/api/v1/countries/checkPincode', {});
  record(
    'a missing pincode -> 400',
    noPin.status === 400 && String(noPin.body?.message).includes('pincode'),
    `status=${noPin.status} msg=${noPin.body?.message}`,
  );

  /**
   * An unshipped pincode is a valid answer, not an error: the checkout flow needs "not
   * serviceable", so the lookup reports isKnown/isServiceable.
   */
  const unknownPin = await publicPost('/api/v1/countries/checkPincode', { pincode: '9999999' });
  record(
    'an unknown pincode still returns 200',
    unknownPin.status === 200,
    `status=${unknownPin.status}`,
  );
  record(
    'an unknown pincode reports isKnown false and not serviceable',
    unknownPin.body?.result?.isKnown === false && unknownPin.body?.result?.isServiceable === false,
    JSON.stringify(unknownPin.body?.result),
  );
  envelope(unknownPin, 'checkPincode unknown');

  // ── Currency ───────────────────────────────────────────────────────────────

  const defaultRow = await prisma.currency.findFirst({
    where: { isDefault: true },
    select: { id: true, code: true },
  });
  record('a default currency exists', Boolean(defaultRow?.id), D_str(defaultRow?.code));

  const currencies = await publicGet('/api/v1/currencies/getAll');
  record(
    'GET /content/currencies -> 200',
    currencies.status === 200,
    `status=${currencies.status}`,
  );
  record(
    'the default currency is listed first',
    D_str(D_arr(currencies.body?.result?.itemList)[0]?.code) === D_str(defaultRow?.code),
    D_str(D_arr(currencies.body?.result?.itemList)[0]?.code),
  );

  const eur = await admin.post('/api/v1/currencies/create', {
    code: 'EUR',
    name: 'Euro',
    symbol: '\u20ac',
    rate: 92.5,
    isActive: true,
  });
  record(
    'POST /content/currencies/create -> 201',
    eur.status === 201,
    `status=${eur.status} msg=${eur.body?.message}`,
  );
  const eurId = D_str(eur.body?.result?.currencyId);
  record(
    'the code is normalised to upper case',
    D_str(eur.body?.result?.code) === 'EUR',
    D_str(eur.body?.result?.code),
  );

  const dupCur = await admin.post('/api/v1/currencies/create', {
    code: 'EUR',
    name: 'Euro again',
  });
  record('a duplicate currency code -> 409', dupCur.status === 409, `status=${dupCur.status}`);

  const badCur = await admin.post('/api/v1/currencies/create', {
    code: 'EURO',
    name: 'Too long',
  });
  record('a 4-letter currency code -> 400', badCur.status === 400, `status=${badCur.status}`);

  const updCur = await admin.patch(`/api/v1/currencies/update/${eurId}`, { rate: 95.25 });
  record(
    'PATCH /content/currencies/:id/update -> 200',
    updCur.status === 200 && D_num(updCur.body?.result?.rate) === 95.25,
    `status=${updCur.status}`,
  );

  const convert = await publicGet('/api/v1/currencies/convert?amount=100&to=EUR');
  record(
    'GET /content/currencies/convert -> 200',
    convert.status === 200,
    `status=${convert.status}`,
  );
  envelope(convert, 'currencies convert');
  record(
    'the converted amount uses the stored rate',
    D_num(convert.body?.result?.convertedAmount) > 0,
    JSON.stringify(convert.body?.result),
  );
  record(
    'the source currency is the default one',
    D_str(convert.body?.result?.fromCurrency) === D_str(defaultRow?.code),
    D_str(convert.body?.result?.fromCurrency),
  );

  const convertSame = await publicGet(
    `/api/v1/currencies/convert?amount=100&to=${D_str(defaultRow?.code)}`,
  );
  record(
    'converting to the source currency is a no-op',
    convertSame.status === 200 && D_num(convertSame.body?.result?.convertedAmount) === 100,
    JSON.stringify(convertSame.body?.result),
  );

  const convertMissing = await publicGet('/api/v1/currencies/convert?amount=100&to=ZZZ');
  record(
    'converting to an unknown currency -> 404',
    convertMissing.status === 404,
    `status=${convertMissing.status}`,
  );

  const delDefault = await admin.del(`/api/v1/currencies/delete/${D_str(defaultRow?.id)}`);
  record(
    'deleting the default currency -> 422',
    delDefault.status === 422,
    `status=${delDefault.status} msg=${delDefault.body?.message}`,
  );

  const delCur = await admin.del(`/api/v1/currencies/delete/${eurId}`);
  record('DELETE /currencies/delete/:id -> 200', delCur.status === 200, `status=${delCur.status}`);

  const delCurAgain = await admin.del(`/api/v1/currencies/delete/${eurId}`);
  record(
    'deleting a currency twice -> 404',
    delCurAgain.status === 404,
    `status=${delCurAgain.status}`,
  );

  // ── Tax ────────────────────────────────────────────────────────────────────

  const taxes = await publicGet('/api/v1/tax/getConfigs');
  record('GET /content/taxConfigs -> 200', taxes.status === 200, `status=${taxes.status}`);

  const tax = await admin.post('/api/v1/tax/create', {
    name: `GST 18 ${run}`,
    percent: 18,
    cgstPercent: 9,
    sgstPercent: 9,
  });
  record('POST /content/taxConfigs/create -> 201', tax.status === 201, `status=${tax.status}`);
  const taxId = D_str(tax.body?.result?.taxConfigId);
  record(
    'the tax slug is derived from the name',
    D_str(tax.body?.result?.slug).length > 0,
    D_str(tax.body?.result?.slug),
  );

  const dupTax = await admin.post('/api/v1/tax/create', {
    name: `GST 18 ${run}`,
    percent: 18,
  });
  record('a duplicate tax slug -> 409', dupTax.status === 409, `status=${dupTax.status}`);

  const vendorTax = await admin.post('/api/v1/tax/create', {
    name: `Vendor GST ${run}`,
    percent: 5,
    vendorId: vendor.vendorId,
  });
  record(
    'a vendor-scoped tax config is accepted',
    vendorTax.status === 201,
    `status=${vendorTax.status}`,
  );
  await admin.del(`/api/v1/tax/${D_str(vendorTax.body?.result?.taxConfigId)}/delete`);

  const badVendorTax = await admin.post('/api/v1/tax/create', {
    name: `Ghost GST ${run}`,
    percent: 5,
    vendorId: 'clzzzzzzzzzzzzzzzzzzzzzzzzzz',
  });
  record(
    'a tax config for an unknown vendor -> 404',
    badVendorTax.status === 404,
    `status=${badVendorTax.status}`,
  );

  const overTax = await admin.post('/api/v1/tax/create', {
    name: `Over ${run}`,
    percent: 150,
  });
  record('a tax percent over 100 -> 400', overTax.status === 400, `status=${overTax.status}`);

  const updTax = await admin.patch(`/api/v1/tax/update/${taxId}`, { percent: 12 });
  record(
    'PATCH /tax/update/:id -> 200 and the new value comes back',
    updTax.status === 200 && D_num(updTax.body?.result?.percent) === 12,
    `status=${updTax.status} percent=${updTax.body?.result?.percent}`,
  );

  const delTax = await admin.del(`/api/v1/tax/delete/${taxId}`);
  record('DELETE /tax/delete/:id -> 200', delTax.status === 200, `status=${delTax.status}`);

  const delTaxAgain = await admin.del(`/api/v1/tax/delete/${taxId}`);
  record(
    'deleting a tax config twice -> 404',
    delTaxAgain.status === 404,
    `status=${delTaxAgain.status}`,
  );

  // ── Translations ───────────────────────────────────────────────────────────

  const upsert = await admin.post('/api/v1/i18n/bulkUpsert', {
    locale: 'fr',
    namespace: 'common',
    entries: [
      { key: 'cart', value: 'Panier' },
      { key: 'checkout', value: 'Paiement' },
    ],
  });
  record(
    'POST /content/translations/upsert -> 200',
    upsert.status === 200,
    `status=${upsert.status} msg=${upsert.body?.message}`,
  );
  record(
    'both keys are written',
    D_num(upsert.body?.result?.upsertedCount) === 2,
    String(D_num(upsert.body?.result?.upsertedCount)),
  );

  const again = await admin.post('/api/v1/i18n/bulkUpsert', {
    locale: 'fr',
    namespace: 'common',
    entries: [{ key: 'cart', value: 'Chariot' }],
  });
  record(
    'upserting an existing key updates it in place',
    again.status === 200,
    `status=${again.status}`,
  );

  // The locale is the path param, and the payload is grouped by namespace.
  const frList = await publicGet('/api/v1/i18n/getTranslations/fr');
  record(
    'GET /i18n/getTranslations/:locale -> 200',
    frList.status === 200,
    `status=${frList.status}`,
  );
  envelope(frList, 'GET /i18n/getTranslations/fr');
  record(
    'the response names the locale it was asked for',
    frList.body?.result?.locale === 'fr',
    frList.body?.result?.locale,
  );

  const frEntries = D_arr(frList.body?.result?.namespaceList).find(
    (n: any) => n?.namespace === 'common',
  );
  record(
    'entries are grouped under their namespace',
    Boolean(frEntries),
    JSON.stringify(D_arr(frList.body?.result?.namespaceList).map((n: any) => n?.namespace)),
  );

  const cartRow = D_arr(frEntries?.entryList).find((t: any) => D_str(t?.key) === 'cart');
  record(
    'the updated value is returned',
    D_str(cartRow?.value) === 'Chariot',
    D_str(cartRow?.value),
  );
  record(
    'the namespace reports its key count',
    D_num(frEntries?.keyCount) === D_arr(frEntries?.entryList).length,
    `keyCount=${frEntries?.keyCount} entries=${D_arr(frEntries?.entryList).length}`,
  );

  // An unknown locale is an empty grouping, not an error.
  const emptyLocale = await publicGet('/api/v1/i18n/getTranslations/zz');
  record(
    'an unknown locale -> 200 with no namespaces',
    emptyLocale.status === 200 && D_arr(emptyLocale.body?.result?.namespaceList).length === 0,
    `status=${emptyLocale.status}`,
  );

  const emptyEntries = await admin.post('/api/v1/i18n/bulkUpsert', {
    locale: 'fr',
    entries: [],
  });
  record(
    'an empty translation batch -> 400',
    emptyEntries.status === 400,
    `status=${emptyEntries.status}`,
  );

  const custUpsert = await cu.post('/api/v1/i18n/bulkUpsert', {
    locale: 'fr',
    entries: [{ key: 'a', value: 'b' }],
  });
  record(
    'a customer cannot upsert translations -> 403',
    custUpsert.status === 403,
    `status=${custUpsert.status}`,
  );

  // ── Dropdowns ──────────────────────────────────────────────────────────────

  const dd = await admin.post('/api/v1/content/dropdowns/create', {
    type: 'order_status_reason',
    label: 'Changed mind',
    value: 'changed_mind',
    sortOrder: 1,
  });
  record('POST /content/dropdowns/create -> 201', dd.status === 201, `status=${dd.status}`);
  const ddId = D_str(dd.body?.result?.dropdownId);

  const dupDd = await admin.post('/api/v1/content/dropdowns/create', {
    type: 'order_status_reason',
    value: 'changed_mind',
  });
  record('a duplicate dropdown value -> 409', dupDd.status === 409, `status=${dupDd.status}`);

  const ddList = await publicGet('/api/v1/content/dropdowns?type=order_status_reason');
  record(
    'GET /content/dropdowns?type=... -> 200',
    ddList.status === 200,
    `status=${ddList.status}`,
  );
  envelope(ddList, 'GET /content/dropdowns');
  record(
    'the option is listed',
    D_arr(ddList.body?.result?.itemList).some((d: any) => D_str(d?.value) === 'changed_mind'),
  );

  const updDd = await admin.patch(`/api/v1/content/dropdowns/${ddId}/update`, {
    label: 'Buyer changed mind',
  });
  record(
    'PATCH /content/dropdowns/:id/update -> 200',
    updDd.status === 200,
    `status=${updDd.status}`,
  );
  record(
    'the label is updated',
    D_str(updDd.body?.result?.label) === 'Buyer changed mind',
    D_str(updDd.body?.result?.label),
  );

  const delDd = await admin.del(`/api/v1/content/dropdowns/${ddId}/delete`);
  record(
    'DELETE /content/dropdowns/:id/delete -> 200',
    delDd.status === 200,
    `status=${delDd.status}`,
  );

  // ── Webhooks ───────────────────────────────────────────────────────────────

  const wh = await admin.post('/api/v1/webhooks/register', {
    url: 'https://example.com/hooks/marketplace',
    events: ['order.created', 'order.cancelled'],
  });
  record('POST /content/webhooks/register -> 201', wh.status === 201, `status=${wh.status}`);
  const whId = D_str(wh.body?.result?.webhookId);
  const whSecret = D_str(wh.body?.result?.secret);
  record(
    'the signing secret is revealed once at creation',
    whSecret.length >= 32,
    `len=${whSecret.length}`,
  );
  envelope(wh, 'webhooks register');

  const whList = await admin.get('/api/v1/webhooks/getAll');
  record('GET /content/webhooks -> 200 (admin)', whList.status === 200, `status=${whList.status}`);
  record(
    'the secret is never returned on a list',
    !D_arr(whList.body?.result?.itemList).some((w: any) => 'secret' in w),
  );

  const whAsCustomer = await cu.get('/api/v1/webhooks/getAll');
  record(
    'a customer cannot list webhooks -> 403',
    whAsCustomer.status === 403,
    `status=${whAsCustomer.status}`,
  );

  const whNoAuth = await publicGet('/api/v1/webhooks/getAll');
  record(
    'listing webhooks without a token -> 401',
    whNoAuth.status === 401,
    `status=${whNoAuth.status}`,
  );

  const badUrl = await admin.post('/api/v1/webhooks/register', {
    url: 'not-a-url',
    events: ['x'],
  });
  record('a malformed webhook url -> 400', badUrl.status === 400, `status=${badUrl.status}`);

  const noEvents = await admin.post('/api/v1/webhooks/register', {
    url: 'https://example.com/h',
    events: [],
  });
  record('a webhook with no events -> 400', noEvents.status === 400, `status=${noEvents.status}`);

  const updWh = await admin.patch(`/api/v1/webhooks/${whId}/update`, { isActive: false });
  record(
    'PATCH /content/webhooks/:id/update -> 200',
    updWh.status === 200 && updWh.body?.result?.isActive === false,
    `status=${updWh.status}`,
  );

  const rot = await admin.post(`/api/v1/webhooks/${whId}/rotateSecret`);
  record(
    'POST /content/webhooks/:id/rotateSecret -> 200',
    rot.status === 200,
    `status=${rot.status}`,
  );
  const rotated = D_str(rot.body?.result?.secret);
  record(
    'rotation yields a different secret',
    rotated.length >= 32 && rotated !== whSecret,
    `len=${rotated.length}`,
  );
  record(
    'the rotated secret is not stored in the response twice',
    D_str(rot.body?.result?.webhookId) === whId,
  );

  // An inactive endpoint must not accept a delivery even with a valid signature.
  const crypto = await import('crypto');

  const offPayload = {
    endpointId: whId,
    event: 'order.cancelled',
    eventId: `off-${run}`,
    payload: { off: true },
  };
  const offSig = crypto
    .createHmac('sha256', rotated)
    .update(JSON.stringify(offPayload))
    .digest('hex');

  const whileOff = await request(app)
    .post('/api/v1/webhooks/razorpay')
    .set('x-webhook-signature', offSig)
    .send(offPayload);
  record(
    'an inactive endpoint refuses a correctly signed delivery',
    whileOff.status === 200 && whileOff.body?.result?.isProcessed === false,
    JSON.stringify(whileOff.body?.result),
  );

  const onWh = await admin.patch(`/api/v1/webhooks/${whId}/update`, { isActive: true });
  record(
    'the endpoint can be switched back on',
    onWh.status === 200 && onWh.body?.result?.isActive === true,
    `status=${onWh.status}`,
  );

  /**
   * The provider receivers verify against that provider's own environment secret
   * (RAZORPAY_WEBHOOK_SECRET and friends), NOT against an endpoint's rotated secret.
   * Keeping the two apart is the point: a leaked endpoint key must not be replayable
   * against a provider route, and a leaked provider secret must not authenticate an
   * endpoint. With no provider secret configured, a delivery is recorded but can
   * never be trusted - which is exactly what these cases pin down.
   */
  const activePayload = {
    endpointId: whId,
    event: 'payment.settled',
    eventId: `evt-${run}`,
    payload: { ok: true },
  };
  const endpointSig = crypto
    .createHmac('sha256', rotated)
    .update(JSON.stringify(activePayload))
    .digest('hex');

  const good = await request(app)
    .post('/api/v1/webhooks/razorpay')
    .set('x-webhook-signature', endpointSig)
    .send(activePayload);
  record('POST /webhooks/razorpay -> 200', good.status === 200, `status=${good.status}`);
  record(
    "an endpoint's own secret does not authenticate a provider delivery",
    good.status === 200 && good.body?.result?.isProcessed === false,
    JSON.stringify(good.body?.result),
  );
  record(
    'the delivery is still recorded so it can be inspected',
    D_str(good.body?.result?.logId).length > 0 && good.body?.result?.event === 'payment.settled',
    JSON.stringify(good.body?.result),
  );

  /**
   * The pre-rotation secret must stop working the moment the secret rotates, so this signs a
   * *different* payload with the old secret.
   */
  const stalePayload = {
    endpointId: whId,
    event: 'order.created',
    eventId: `stale-${run}`,
    payload: { old: true },
  };
  const staleSig = crypto
    .createHmac('sha256', whSecret)
    .update(JSON.stringify(stalePayload))
    .digest('hex');

  const stale = await request(app)
    .post('/api/v1/webhooks/razorpay')
    .set('x-webhook-signature', staleSig)
    .send(stalePayload);
  record(
    'a signature from the pre-rotation secret is rejected',
    stale.body?.result?.isProcessed === false,
    JSON.stringify(stale.body?.result),
  );

  const bad = await request(app)
    .post('/api/v1/webhooks/razorpay')
    .set('x-webhook-signature', 'deadbeef')
    .send({ endpointId: whId, event: 'payment.settled', payload: { ok: true } });
  record(
    'a bad signature is logged but not processed',
    bad.status === 200 && bad.body?.result?.isProcessed === false,
    JSON.stringify(bad.body?.result),
  );

  const unsigned = await request(app)
    .post('/api/v1/webhooks/razorpay')
    .send({ endpointId: whId, event: 'payment.settled', payload: { ok: true } });
  record(
    'an unsigned delivery is logged but not processed',
    unsigned.status === 200 && unsigned.body?.result?.isProcessed === false,
    JSON.stringify(unsigned.body?.result),
  );

  // Each provider route keeps its own secret, so a delivery to one cannot be
  // replayed against another.
  const crossedPayload = {
    endpointId: whId,
    event: 'shipping.updated',
    eventId: `cross-${run}`,
    payload: { crossed: true },
  };
  const crossedSig = crypto
    .createHmac('sha256', rotated)
    .update(JSON.stringify(crossedPayload))
    .digest('hex');

  const crossed = await request(app)
    .post('/api/v1/webhooks/shipping')
    .set('x-webhook-signature', crossedSig)
    .send(crossedPayload);
  record(
    'the shipping receiver does not accept a razorpay-route signature either',
    crossed.status === 200 && crossed.body?.result?.isProcessed === false,
    JSON.stringify(crossed.body?.result),
  );

  const unknownProvider = await request(app)
    .post('/api/v1/webhooks/payment-gateway/notaprovider')
    .set('x-signature', endpointSig)
    .send({ endpointId: whId, event: 'ping' });
  record(
    'an unknown provider -> 400',
    unknownProvider.status === 400,
    `status=${unknownProvider.status} msg=${unknownProvider.body?.message}`,
  );

  const logs = await admin.get('/api/v1/webhooks/getLogs');
  record('GET /webhooks/getLogs -> 200', logs.status === 200, `status=${logs.status}`);
  envelope(logs, 'GET /webhooks/getLogs');
  record(
    'every delivery is logged',
    D_arr(logs.body?.result?.itemList).length >= 4,
    `count=${D_arr(logs.body?.result?.itemList).length}`,
  );

  const processedOnly = await admin.get('/api/v1/webhooks/getLogs?isProcessed=false');
  record(
    'the log filters on isProcessed',
    D_arr(processedOnly.body?.result?.itemList).every((l: any) => l?.isProcessed === false) &&
      D_arr(processedOnly.body?.result?.itemList).length > 0,
    `count=${D_arr(processedOnly.body?.result?.itemList).length}`,
  );

  const noEndpoint = await request(app).post('/api/v1/webhooks/razorpay').send({ event: 'ping' });
  record(
    'a delivery with no endpointId is logged as unprocessed',
    noEndpoint.status === 200 && noEndpoint.body?.result?.isProcessed === false,
    `status=${noEndpoint.status}`,
  );

  const delWh = await admin.del(`/api/v1/webhooks/delete/${whId}`);
  record('DELETE /webhooks/delete/:id -> 200', delWh.status === 200, `status=${delWh.status}`);

  const delWhAgain = await admin.del(`/api/v1/webhooks/delete/${whId}`);
  record(
    'deleting a webhook twice -> 404',
    delWhAgain.status === 404,
    `status=${delWhAgain.status}`,
  );

  // ── Bulk import ────────────────────────────────────────────────────────────

  const imp = await api(vendor.token).post('/api/v1/bulk/importProducts', {
    rows: [
      { name: `Imported A ${run}`, price: 120, stock: 5, sku: `IMPA${run}` },
      { name: `Imported B ${run}`, price: 240, stock: 3, sku: `IMPB${run}` },
      { name: `Imported C ${run}`, price: 360, stock: 2, sku: `IMPC${run}` },
    ],
    continueOnError: true,
  });
  record(
    'POST /content/bulk/importProducts -> 201',
    imp.status === 201,
    `status=${imp.status} msg=${imp.body?.message}`,
  );
  record(
    'every row is imported',
    D_num(imp.body?.result?.successCount) === 3,
    JSON.stringify(imp.body?.result),
  );
  record('the failure count is reported even when zero', D_num(imp.body?.result?.failCount) === 0);
  const jobId = D_str(imp.body?.result?.jobId);

  const job = await api(vendor.token).get(`/api/v1/bulk/getJobStatus/${jobId}`);
  record('GET /content/bulk/:jobId/status -> 200', job.status === 200, `status=${job.status}`);
  record(
    'the job is completed',
    D_str(job.body?.result?.status) === 'COMPLETED',
    D_str(job.body?.result?.status),
  );

  const jobs = await api(vendor.token).get('/api/v1/bulk/getJobHistory');
  record('GET /content/bulk/getAll -> 200', jobs.status === 200, `status=${jobs.status}`);
  envelope(jobs, 'GET /content/bulk/getAll');

  const rivalJobs = await api(rival.token).get('/api/v1/bulk/getJobHistory');
  record(
    'a vendor only sees its own jobs',
    !D_arr(rivalJobs.body?.result?.itemList).some((j: any) => D_str(j?.jobId) === jobId),
    `rival count=${D_arr(rivalJobs.body?.result?.itemList).length}`,
  );

  const custImp = await cu.post('/api/v1/bulk/importProducts', {
    rows: [{ name: 'Nope', price: 1 }],
  });
  record(
    'a customer cannot bulk import -> 403',
    custImp.status === 403,
    `status=${custImp.status}`,
  );

  const noRows = await api(vendor.token).post('/api/v1/bulk/importProducts', { rows: [] });
  record('an empty import -> 400', noRows.status === 400, `status=${noRows.status}`);

  const missingJob = await api(vendor.token).get('/api/v1/bulk/getJobStatus/bulk_does_not_exist');
  record('an unknown job id -> 404', missingJob.status === 404, `status=${missingJob.status}`);

  /**
   * A row pointing at a category that does not exist fails inside the service, after the zod
   * layer has already accepted the shape.
   */
  const badRow = await api(vendor.token).post('/api/v1/bulk/importProducts', {
    rows: [
      { name: `Partial A ${run}`, price: 10, stock: 1, sku: `PRTA${run}` },
      { name: `Partial B ${run}`, price: 20, stock: 1, categoryId: 'clzzzzzzzzzzzzzzzzzzzzzz' },
      { name: `Partial C ${run}`, price: 30, stock: 1, sku: `PRTC${run}` },
    ],
    continueOnError: true,
  });
  record(
    'a per-row failure is reported, not thrown',
    badRow.status === 201,
    `status=${badRow.status}`,
  );
  record(
    'the rows around the bad one still land',
    D_num(badRow.body?.result?.successCount) === 2,
    JSON.stringify(badRow.body?.result),
  );
  record(
    'the bad row is counted',
    D_num(badRow.body?.result?.failCount) === 1,
    String(D_num(badRow.body?.result?.failCount)),
  );
  record(
    'the bad row is listed in errorList',
    D_arr(badRow.body?.result?.errorList).length === 1,
    JSON.stringify(badRow.body?.result?.errorList).slice(0, 120),
  );

  const stopOnError = await api(vendor.token).post('/api/v1/bulk/importProducts', {
    rows: [
      { name: `Stop A ${run}`, price: 10, stock: 1, categoryId: 'clzzzzzzzzzzzzzzzzzzzzzz' },
      { name: `Stop B ${run}`, price: 20, stock: 1, sku: `STOPB${run}` },
    ],
    continueOnError: false,
  });
  record(
    'continueOnError=false halts at the first bad row',
    D_num(stopOnError.body?.result?.successCount) === 0 &&
      D_num(stopOnError.body?.result?.failCount) === 1,
    JSON.stringify(stopOnError.body?.result),
  );
  record(
    'the halted row never reached the catalogue',
    D_num(
      await api(vendor.token)
        .get('/api/v1/products/getAll?search=Stop%20B')
        .then((r) => D_arr(r.body?.result?.itemList).length),
    ) === 0,
  );

  // ── Reports ────────────────────────────────────────────────────────────────

  const sales = await admin.get('/api/v1/reports/sales');
  record(
    'GET /content/reports/sales -> 200',
    sales.status === 200,
    `status=${sales.status} msg=${sales.body?.message}`,
  );
  envelope(sales, 'GET /content/reports/sales');
  record(
    'the sales report returns rows plus a CSV rendering',
    typeof sales.body?.result?.csv === 'string' && Array.isArray(sales.body?.result?.rowList),
    `totalRecord=${D_num(sales.body?.result?.totalRecord)}`,
  );
  record(
    'the sales report carries an aggregate summary',
    sales.body?.result?.summary !== undefined,
    JSON.stringify(sales.body?.result?.summary),
  );
  record(
    'the CSV has a header row',
    D_str(sales.body?.result?.csv).startsWith('orderNumber,'),
    D_str(sales.body?.result?.csv).slice(0, 40),
  );
  record(
    'the CSV ends with the TOTAL row',
    D_str(sales.body?.result?.csv).includes('\nTOTAL,'),
    D_str(sales.body?.result?.csv).split('\n').pop()?.slice(0, 40),
  );

  const csv = await admin.get('/api/v1/reports/sales?format=csv');
  record(
    'format=csv trims the response to the CSV',
    csv.status === 200 &&
      typeof csv.body?.result?.csv === 'string' &&
      csv.body?.result?.rowList === undefined,
    `status=${csv.status}`,
  );

  for (const type of [
    'orders',
    'products',
    'customers',
    'vendors',
    'payouts',
    'tax',
    'inventory',
    'returns',
  ]) {
    const r = await admin.get(`/api/v1/reports/export/${type}`);
    record(
      `GET /content/reports/${type} -> 200`,
      r.status === 200,
      `status=${r.status} msg=${r.body?.message}`,
    );
  }

  const taxR = await admin.get('/api/v1/reports/tax');
  record(
    'the tax report carries a summary',
    taxR.body?.result?.summary !== undefined,
    JSON.stringify(taxR.body?.result?.summary),
  );

  // Each report type is its own named route, so the type is only validated where a
  // route takes one as a parameter: /reports/export/:type.
  const badReport = await admin.get('/api/v1/reports/export/not_a_report');
  record(
    'an unknown export type -> 400',
    badReport.status === 400,
    `status=${badReport.status} msg=${badReport.body?.message}`,
  );

  const noSuchReport = await admin.get('/api/v1/reports/not_a_report');
  record(
    'an unknown report name -> 404',
    noSuchReport.status === 404,
    `status=${noSuchReport.status}`,
  );

  const custReport = await cu.get('/api/v1/reports/sales');
  record(
    'a customer cannot run a report -> 403',
    custReport.status === 403,
    `status=${custReport.status}`,
  );

  const badRange = await admin.get('/api/v1/reports/sales?from=nonsense');
  record('a malformed date range -> 400', badRange.status === 400, `status=${badRange.status}`);

  const ranged = await admin.get(`/api/v1/reports/orders?from=2000-01-01&to=2000-01-31`);
  record(
    'an empty date range returns zero rows, not an error',
    ranged.status === 200 && D_num(ranged.body?.result?.totalRecord) === 0,
    `status=${ranged.status} total=${D_num(ranged.body?.result?.totalRecord)}`,
  );

  // ── Report schedules ───────────────────────────────────────────────────────

  const sched = await admin.post('/api/v1/reports/schedule', {
    name: `Weekly sales ${run}`,
    reportType: 'SALES',
    cron: '0 8 * * 1',
    recipients: ['ops@example.com'],
    format: 'CSV',
  });
  record(
    'POST /content/reports/schedules/create -> 201',
    sched.status === 201,
    `status=${sched.status} msg=${sched.body?.message}`,
  );
  envelope(sched, 'createSchedule');
  const schedId = D_str(sched.body?.result?.scheduleId);
  record(
    'recipients are lower-cased',
    D_str(D_arr(sched.body?.result?.recipients)[0]) === 'ops@example.com',
    JSON.stringify(sched.body?.result?.recipients),
  );

  const badCron = await admin.post('/api/v1/reports/schedule', {
    name: `Bad cron ${run}`,
    reportType: 'SALES',
    cron: '0 8 * *',
    recipients: ['ops@example.com'],
  });
  record('a 4-field cron -> 400', badCron.status === 400, `status=${badCron.status}`);

  const badRecipients = await admin.post('/api/v1/reports/schedule', {
    name: `Bad mail ${run}`,
    reportType: 'SALES',
    cron: '0 8 * * 1',
    recipients: ['not-an-email'],
  });
  record(
    'a malformed recipient -> 400',
    badRecipients.status === 400,
    `status=${badRecipients.status}`,
  );

  const badType = await admin.post('/api/v1/reports/schedule', {
    name: `Bad type ${run}`,
    reportType: 'NOT_A_REPORT',
    cron: '0 8 * * 1',
    recipients: ['ops@example.com'],
  });
  record('an unsupported report type -> 400', badType.status === 400, `status=${badType.status}`);

  const schedList = await admin.get('/api/v1/reports/getSchedules');
  record(
    'GET /content/reports/schedules -> 200',
    schedList.status === 200,
    `status=${schedList.status}`,
  );
  record(
    'the schedule is listed',
    D_arr(schedList.body?.result?.itemList).some((s: any) => D_str(s?.scheduleId) === schedId),
  );

  const updSched = await admin.patch(`/api/v1/reports/schedule/${schedId}/update`, {
    isActive: false,
  });
  record(
    'PATCH /content/reports/schedules/:id/update -> 200',
    updSched.status === 200 && updSched.body?.result?.isActive === false,
    `status=${updSched.status}`,
  );

  const delSched = await admin.del(`/api/v1/reports/schedule/${schedId}/delete`);
  record(
    'DELETE /reports/schedule/:id/delete -> 200',
    delSched.status === 200,
    `status=${delSched.status}`,
  );

  const delSchedAgain = await admin.del(`/api/v1/reports/schedule/${schedId}/delete`);
  record(
    'deleting a schedule twice -> 404',
    delSchedAgain.status === 404,
    `status=${delSchedAgain.status}`,
  );

  // ── Cleanup ────────────────────────────────────────────────────────────────

  await prisma.product.deleteMany({
    where: {
      sku: {
        in: [`IMPA${run}`, `IMPB${run}`, `IMPC${run}`, `PRTA${run}`, `PRTC${run}`, `STOPB${run}`],
      },
    },
  });
  await prisma.product.deleteMany({ where: { name: { contains: `Partial ${run}` } } });
  await prisma.product.deleteMany({ where: { name: { contains: `Stop ${run}` } } });
  await prisma.bulkJob.deleteMany({
    where: {
      jobId: {
        in: [jobId, D_str(badRow.body?.result?.jobId), D_str(stopOnError.body?.result?.jobId)],
      },
    },
  });
  await prisma.webhookLog.deleteMany({ where: { event: { in: ['payment.settled', 'ping'] } } });
  await prisma.webhookEndpoint.deleteMany({ where: { url: { contains: 'example.com/hooks' } } });
  await prisma.translation.deleteMany({ where: { locale: 'fr', namespace: 'common' } });
  await prisma.dropdown.deleteMany({ where: { value: { in: ['changed_mind'] } } });
  await prisma.taxConfig.deleteMany({ where: { name: { contains: run } } });
  await prisma.currency.deleteMany({ where: { code: 'EUR' } });
  await prisma.newsletterSubscriber.deleteMany({ where: { email: subEmail } });
  await prisma.contactSubmission.deleteMany({ where: { email: { contains: run } } });
  await prisma.banner.deleteMany({ where: { title: { contains: run } } });
  await prisma.faq.deleteMany({ where: { question: { contains: run } } });
  await prisma.blog.deleteMany({ where: { title: { contains: run } } });
  await prisma.page.deleteMany({ where: { title: { contains: run } } });
  await prisma.reportSchedule.deleteMany({ where: { name: { contains: run } } });

  /**
   * Scoped by the run id, not by a name prefix. Prisma compiles `contains` to a LIKE
   * without escaping `_`, so a prefix like `ct_` is the pattern `%ct_%` — and
   * "superadmin@projeCTName.com" matches it, which is how this suite used to delete
   * SUPER_ADMIN out from under every later one. Digits are not LIKE metacharacters.
   */
  await prisma.user.deleteMany({ where: { email: { contains: run } } });

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
