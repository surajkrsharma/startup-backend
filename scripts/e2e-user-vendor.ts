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

const assertEnvelope = (body: any, expected: boolean): boolean => {
  const keys = Object.keys(body ?? {});
  return (
    keys.length === 3 &&
    keys[0] === 'status' &&
    keys[1] === 'message' &&
    keys[2] === 'result' &&
    body.status === expected &&
    typeof body.message === 'string' &&
    body.message.length > 0 &&
    body.result !== null &&
    typeof body.result === 'object' &&
    !Array.isArray(body.result)
  );
};

const run = Date.now().toString().slice(-9);
const email = (tag: string) => `uv_${tag}_${run}@projectname.com`;

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
      name: `UV ${tag}`,
      verificationToken: verified.body?.result?.verificationToken ?? '',
      email: email(tag),
      phone: phoneFor(tag),
      password: 'Secret@123',
      ...(type === 'VENDOR' ? { shopName: shopName ?? `UV Shop ${tag} ${run}` } : {}),
    });

  return {
    token: res.body?.result?.accessToken ?? '',
    userId: res.body?.result?.userData?.userId ?? '',
    vendorId: res.body?.result?.vendorData?.vendorId ?? '',
    status: res.status,
  };
};

const main = async (): Promise<void> => {
  /* eslint-disable no-console */
  const customer = await register('cu', 'CUSTOMER');
  const vendor = await register('ve', 'VENDOR');

  const adminLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@projectname.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperSecret@123',
    });
  const adminToken = adminLogin.body?.result?.accessToken ?? '';
  const adminUserId = adminLogin.body?.result?.userData?.userId ?? '';

  record('bootstrap SUPER_ADMIN token', Boolean(adminToken), adminLogin.body?.message);
  record(
    'seeded admin really is SUPER_ADMIN',
    adminLogin.body?.result?.rolesList?.[0] === 'SUPER_ADMIN',
    JSON.stringify(adminLogin.body?.result?.rolesList ?? []),
  );

  const profile = await request(app)
    .get('/api/v1/users/getProfile')
    .set('Authorization', `Bearer ${customer.token}`);

  record('GET /users/getProfile -> 200', profile.status === 200, `status=${profile.status}`);
  record('profile envelope is strict', assertEnvelope(profile.body, true));
  record(
    'profile returns userData.userId',
    profile.body?.result?.userData?.userId === customer.userId,
    profile.body?.result?.userData?.userId,
  );
  record('profile includes rolesList', Array.isArray(profile.body?.result?.rolesList));
  record('profile has no null values', JSON.stringify(profile.body).includes('null') === false);

  const noAuthProfile = await request(app).get('/api/v1/users/getProfile');
  record(
    'getProfile without token -> 401',
    noAuthProfile.status === 401,
    `status=${noAuthProfile.status}`,
  );

  const update = await request(app)
    .patch('/api/v1/users/updateProfile')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ name: 'UV Renamed Customer', phone: phoneFor('cu') });

  record(
    'PATCH /users/updateProfile -> 200',
    update.status === 200 && update.body?.result?.userData?.name === 'UV Renamed Customer',
    `status=${update.status} name=${update.body?.result?.userData?.name}`,
  );
  record(
    'phone change clears isPhoneVerified',
    update.body?.result?.userData?.isPhoneVerified === false,
    String(update.body?.result?.userData?.isPhoneVerified),
  );

  const emptyUpdate = await request(app)
    .patch('/api/v1/users/updateProfile')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({});
  record('empty updateProfile -> 400', emptyUpdate.status === 400, `status=${emptyUpdate.status}`);

  const unknownField = await request(app)
    .patch('/api/v1/users/updateProfile')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ name: 'X', role: 'SUPER_ADMIN' });
  record(
    'privilege escalation via unknown field -> 400',
    unknownField.status === 400,
    `status=${unknownField.status} msg=${unknownField.body?.message}`,
  );

  const addr1 = await request(app)
    .post('/api/v1/users/addAddress')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({
      type: 'HOME',
      fullName: 'UV Customer',
      phone: phoneFor('cu'),
      line1: '12 Test Street',
      city: 'New Delhi',
      state: 'Delhi',
      stateCode: 'DL',
      countryCode: 'IN',
      pincode: '110001',
    });

  record('POST /users/addAddress -> 201', addr1.status === 201, `status=${addr1.status}`);
  record(
    'first address auto-becomes default',
    addr1.body?.result?.isDefault === true,
    String(addr1.body?.result?.isDefault),
  );

  const addressId = addr1.body?.result?.addressId ?? '';

  const addr2 = await request(app)
    .post('/api/v1/users/addAddress')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({
      fullName: 'UV Customer Work',
      phone: phoneFor('cu'),
      line1: '34 Office Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      countryCode: 'IN',
      pincode: '400001',
      isDefault: true,
    });

  record('second address -> 201', addr2.status === 201, `status=${addr2.status}`);
  record(
    'isDefault:true demotes the previous default',
    addr2.body?.result?.isDefault === true,
    String(addr2.body?.result?.isDefault),
  );

  const listAddr = await request(app)
    .get('/api/v1/users/getAddresses')
    .set('Authorization', `Bearer ${customer.token}`);
  record(
    'GET /users/getAddresses lists both with pagination first',
    listAddr.status === 200 &&
      Array.isArray(listAddr.body?.result?.addressList) &&
      listAddr.body.result.addressList.length === 2 &&
      Object.keys(listAddr.body.result)[0] === 'totalRecord',
    `count=${listAddr.body?.result?.addressList?.length} firstKey=${Object.keys(listAddr.body?.result ?? {})[0]}`,
  );

  const badPincode = await request(app)
    .post('/api/v1/users/addAddress')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({
      fullName: 'X Y',
      line1: 'Z',
      city: 'A',
      state: 'B',
      countryCode: 'IN',
      pincode: 'abc',
    });
  record('invalid pincode -> 400', badPincode.status === 400, `status=${badPincode.status}`);

  const badCountry = await request(app)
    .post('/api/v1/users/addAddress')
    .set('Authorization', `Bearer ${customer.token}`)
    .send({
      fullName: 'X Y',
      line1: 'Z',
      city: 'A',
      state: 'B',
      countryCode: 'ZZ',
      pincode: '110001',
    });
  record('invalid countryCode -> 400', badCountry.status === 400, `status=${badCountry.status}`);

  const patchAddr = await request(app)
    .patch(`/api/v1/users/updateAddress/${addressId}`)
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ landmark: 'Near Metro' });
  record(
    'PATCH address -> 200',
    patchAddr.status === 200 && patchAddr.body?.result?.landmark === 'Near Metro',
  );

  const setDefault = await request(app)
    .patch(`/api/v1/users/setDefaultAddress/${addressId}`)
    .set('Authorization', `Bearer ${customer.token}`);
  record(
    'setDefaultAddress -> 200',
    setDefault.status === 200 && setDefault.body?.result?.isDefault === true,
  );

  const otherAddrId = addr2.body?.result?.addressId ?? '';
  const deleteAddr = await request(app)
    .del(`/api/v1/users/deleteAddress/${otherAddrId}`)
    .set('Authorization', `Bearer ${customer.token}`);
  record('DELETE address -> 200', deleteAddr.status === 200, `status=${deleteAddr.status}`);

  const otherCustomer = await register('ot', 'CUSTOMER');
  const foreignDelete = await request(app)
    .del(`/api/v1/users/deleteAddress/${addressId}`)
    .set('Authorization', `Bearer ${otherCustomer.token}`);
  record(
    "deleting another customer's address -> 404",
    foreignDelete.status === 404,
    `status=${foreignDelete.status}`,
  );

  const foreignList = await request(app)
    .get('/api/v1/users/getAddresses')
    .set('Authorization', `Bearer ${otherCustomer.token}`);
  record(
    "other customer's address list is empty (no leakage)",
    (foreignList.body?.result?.addressList ?? []).length === 0,
    `len=${(foreignList.body?.result?.addressList ?? []).length}`,
  );

  const listUsers = await request(app)
    .get('/api/v1/users/getAll?page=1&limit=5')
    .set('Authorization', `Bearer ${adminToken}`);

  record(
    'GET /users/getAll (admin) -> 200',
    listUsers.status === 200,
    `status=${listUsers.status}`,
  );
  record(
    'userList present and pagination ordered',
    Array.isArray(listUsers.body?.result?.userList) &&
      JSON.stringify(Object.keys(listUsers.body.result).slice(0, 8)) ===
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
    Object.keys(listUsers.body?.result ?? {})
      .slice(0, 9)
      .join(','),
  );

  const listDenied = await request(app)
    .get('/api/v1/users/getAll')
    .set('Authorization', `Bearer ${customer.token}`);
  record(
    'customer blocked from /users/getAll -> 403',
    listDenied.status === 403,
    `status=${listDenied.status}`,
  );

  const searchUsers = await request(app)
    .get(`/api/v1/users/getAll?search=${run}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    'search filter narrows results',
    searchUsers.status === 200 && (searchUsers.body?.result?.userList ?? []).length >= 3,
    `found=${searchUsers.body?.result?.userList?.length}`,
  );

  const getById = await request(app)
    .get(`/api/v1/users/getById/${customer.userId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record('GET /users/getById/:id -> 200', getById.status === 200, `status=${getById.status}`);
  record(
    'getById includes statsData',
    typeof getById.body?.result?.statsData === 'object',
    JSON.stringify(getById.body?.result?.statsData ?? {}),
  );

  const suspend = await request(app)
    .patch(`/api/v1/users/toggleStatus/${customer.userId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ isActive: false, reason: 'policy test' });

  record(
    'PATCH /users/toggleStatus deactivate -> 200',
    suspend.status === 200 && suspend.body?.result?.isActive === false,
    `status=${suspend.status} isActive=${suspend.body?.result?.isActive}`,
  );

  const suspendedLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: email('cu'), password: 'Secret@123' });
  record(
    'suspended user cannot log in -> 403',
    suspendedLogin.status === 403,
    `status=${suspendedLogin.status} msg=${suspendedLogin.body?.message}`,
  );

  const selfSuspend = await request(app)
    .patch(`/api/v1/users/toggleStatus/${adminUserId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ isActive: false });
  record(
    'admin cannot suspend self -> 403',
    selfSuspend.status === 403,
    `status=${selfSuspend.status}`,
  );

  await request(app)
    .patch(`/api/v1/users/toggleStatus/${customer.userId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ isActive: true, reason: 'reinstated' });

  const impersonate = await request(app)
    .post(`/api/v1/users/impersonate/${customer.userId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: 'support investigation', durationMin: 10 });

  record(
    'POST /users/impersonate -> 200 with token',
    impersonate.status === 200 && Boolean(impersonate.body?.result?.accessToken),
    `status=${impersonate.status}`,
  );
  record('impersonation flags isImpersonating', impersonate.body?.result?.isImpersonating === true);

  const impersonatedMe = await request(app)
    .get('/api/v1/auth/getMe')
    .set('Authorization', `Bearer ${impersonate.body?.result?.accessToken ?? ''}`);
  record(
    'impersonated token acts as the target user',
    impersonatedMe.body?.result?.userData?.userId === customer.userId,
    impersonatedMe.body?.result?.userData?.userId,
  );

  const impersonateDenied = await request(app)
    .post(`/api/v1/users/impersonate/${customer.userId}`)
    .set('Authorization', `Bearer ${vendor.token}`)
    .send({ reason: 'nope' });
  record(
    'vendor cannot impersonate -> 403',
    impersonateDenied.status === 403,
    `status=${impersonateDenied.status}`,
  );

  const impersonateNoReason = await request(app)
    .post(`/api/v1/users/impersonate/${customer.userId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});
  record(
    'impersonate without reason -> 400',
    impersonateNoReason.status === 400,
    `status=${impersonateNoReason.status}`,
  );

  const vProfile = await request(app)
    .get('/api/v1/vendors/getProfile')
    .set('Authorization', `Bearer ${vendor.token}`);

  record('GET /vendors/getProfile -> 200', vProfile.status === 200, `status=${vProfile.status}`);
  record('vendor profile envelope is strict', assertEnvelope(vProfile.body, true));
  record(
    'vendor starts PENDING (vendor.autoApprove=false)',
    vProfile.body?.result?.status === 'PENDING',
    vProfile.body?.result?.status,
  );
  record('vendorId matches', vProfile.body?.result?.vendorId === vendor.vendorId);

  const vByCustomer = await request(app)
    .get('/api/v1/vendors/getProfile')
    .set('Authorization', `Bearer ${customer.token}`);
  record(
    'customer cannot read /vendors/getProfile -> 403',
    vByCustomer.status === 403,
    `status=${vByCustomer.status}`,
  );

  const pendingProducts = await request(app).get(`/api/v1/vendors/getProducts/${vendor.vendorId}`);
  record(
    'unapproved vendor products -> 403 VENDOR_NOT_APPROVED',
    pendingProducts.status === 403 &&
      String(pendingProducts.body?.message).includes('VENDOR_NOT_APPROVED'),
    `status=${pendingProducts.status} msg=${pendingProducts.body?.message}`,
  );

  const bankWrongId = await request(app)
    .patch('/api/v1/vendors/updateBankDetails/some-other-vendor')
    .set('Authorization', `Bearer ${vendor.token}`)
    .send({ bankAccountNo: '1234567890', bankIfsc: 'HDFC0000001' });
  record(
    'vendor can only edit own bank details -> 403',
    bankWrongId.status === 403,
    `status=${bankWrongId.status}`,
  );

  const bank = await request(app)
    .patch(`/api/v1/vendors/updateBankDetails/${vendor.vendorId}`)
    .set('Authorization', `Bearer ${vendor.token}`)
    .send({ bankHolderName: 'UV Vendor', bankAccountNo: '000111222333', bankIfsc: 'HDFC0000001' });

  record('update own bank details -> 200', bank.status === 200, `status=${bank.status}`);
  record(
    'bank details echoed back',
    bank.body?.result?.bankIfsc === 'HDFC0000001',
    bank.body?.result?.bankIfsc,
  );

  const badIfsc = await request(app)
    .patch(`/api/v1/vendors/updateBankDetails/${vendor.vendorId}`)
    .set('Authorization', `Bearer ${vendor.token}`)
    .send({ bankAccountNo: '000111222333', bankIfsc: 'BAD' });
  record('invalid IFSC -> 400', badIfsc.status === 400, `status=${badIfsc.status}`);

  const payoutPending = await request(app)
    .post('/api/v1/vendors/requestPayout')
    .set('Authorization', `Bearer ${vendor.token}`)
    .send({ amount: 1000, method: 'BANK' });
  record(
    'payout while PENDING -> 403 VENDOR_NOT_APPROVED',
    payoutPending.status === 403 &&
      String(payoutPending.body?.message).includes('VENDOR_NOT_APPROVED'),
    `status=${payoutPending.status} msg=${payoutPending.body?.message}`,
  );

  const approveNoDocs = await request(app)
    .patch(`/api/v1/vendors/approveVendor/${vendor.vendorId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ remark: 'auto approved for test' });

  record(
    'PATCH /vendors/approveVendor -> 200',
    approveNoDocs.status === 200 && approveNoDocs.body?.result?.status === 'APPROVED',
    `status=${approveNoDocs.status} state=${approveNoDocs.body?.result?.status}`,
  );
  record(
    'approval assigns default commission',
    Number(approveNoDocs.body?.result?.commissionRate) === 10,
    String(approveNoDocs.body?.result?.commissionRate),
  );
  record('approvedAt set', Boolean(approveNoDocs.body?.result?.approvedAt));

  const reApprove = await request(app)
    .patch(`/api/v1/vendors/approveVendor/${vendor.vendorId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});
  record(
    're-approving -> 409 ALREADY_APPROVED',
    reApprove.status === 409,
    `status=${reApprove.status} msg=${reApprove.body?.message}`,
  );

  const badCommission = await request(app)
    .patch(`/api/v1/vendors/updateCommission/${vendor.vendorId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ commissionRate: 95 });
  record(
    'commission above maxPercent -> 422',
    badCommission.status === 422,
    `status=${badCommission.status} msg=${badCommission.body?.message}`,
  );

  const goodCommission = await request(app)
    .patch(`/api/v1/vendors/updateCommission/${vendor.vendorId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ commissionRate: 15 });
  record(
    'commission within bounds -> 200',
    goodCommission.status === 200 && goodCommission.body?.result?.commissionRate === 15,
    `status=${goodCommission.status} rate=${goodCommission.body?.result?.commissionRate}`,
  );

  const publicProducts = await request(app).get(`/api/v1/vendors/getProducts/${vendor.vendorId}`);
  record(
    'approved vendor products -> 200',
    publicProducts.status === 200,
    `status=${publicProducts.status} msg=${publicProducts.body?.message}`,
  );
  record(
    'public product list has vendorData and productList',
    Boolean(publicProducts.body?.result?.vendorData) &&
      Array.isArray(publicProducts.body?.result?.productList),
    Object.keys(publicProducts.body?.result ?? {}).join(','),
  );

  const ratings = await request(app).get(`/api/v1/vendors/getRatings/${vendor.vendorId}`);
  record('GET /vendors/getRatings/:id -> 200', ratings.status === 200, `status=${ratings.status}`);
  record(
    'rating breakdown has 5 stars',
    (ratings.body?.result?.breakdownList ?? []).length === 5,
    `len=${(ratings.body?.result?.breakdownList ?? []).length}`,
  );

  const ratingsMissing = await request(app).get('/api/v1/vendors/getRatings/does-not-exist');
  record(
    'ratings for unknown vendor -> 404',
    ratingsMissing.status === 404,
    `status=${ratingsMissing.status}`,
  );

  const payoutTooSmall = await request(app)
    .post('/api/v1/vendors/requestPayout')
    .set('Authorization', `Bearer ${vendor.token}`)
    .send({ amount: 100, method: 'BANK' });
  record(
    'payout below vendor.minPayoutAmount -> 422',
    payoutTooSmall.status === 422 &&
      String(payoutTooSmall.body?.message).includes('PAYOUT_MIN_AMOUNT'),
    `status=${payoutTooSmall.status} msg=${payoutTooSmall.body?.message}`,
  );

  const payoutNoEarnings = await request(app)
    .post('/api/v1/vendors/requestPayout')
    .set('Authorization', `Bearer ${vendor.token}`)
    .send({ amount: 5000, method: 'BANK' });
  record(
    'payout with no cleared earnings -> 422',
    payoutNoEarnings.status === 422,
    `status=${payoutNoEarnings.status} msg=${payoutNoEarnings.body?.message}`,
  );

  const payoutHistory = await request(app)
    .get('/api/v1/vendors/getPayoutHistory')
    .set('Authorization', `Bearer ${vendor.token}`);
  record(
    'GET /vendors/getPayoutHistory -> 200',
    payoutHistory.status === 200 && Array.isArray(payoutHistory.body?.result?.payoutList),
    `status=${payoutHistory.status}`,
  );

  const stats = await request(app)
    .get('/api/v1/vendors/getStats')
    .set('Authorization', `Bearer ${vendor.token}`);
  record('GET /vendors/getStats -> 200', stats.status === 200, `status=${stats.status}`);
  record(
    'stats has counters and no nulls',
    typeof stats.body?.result?.productCount === 'number' &&
      JSON.stringify(stats.body).includes('null') === false,
    JSON.stringify(stats.body?.result ?? {}).slice(0, 90),
  );

  const suspendVendor = await request(app)
    .patch(`/api/v1/vendors/suspendVendor/${vendor.vendorId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: 'compliance review' });
  record(
    'PATCH /vendors/suspendVendor -> 200',
    suspendVendor.status === 200 && suspendVendor.body?.result?.status === 'SUSPENDED',
    `status=${suspendVendor.status} state=${suspendVendor.body?.result?.status}`,
  );

  const suspendedNoReason = await request(app)
    .patch(`/api/v1/vendors/suspendVendor/${vendor.vendorId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});
  record(
    'suspend without reason -> 400',
    suspendedNoReason.status === 400,
    `status=${suspendedNoReason.status}`,
  );

  const vendor2 = await register('v2', 'VENDOR');
  const rejectVendor = await request(app)
    .patch(`/api/v1/vendors/rejectVendor/${vendor2.vendorId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ reason: 'incomplete documents' });

  record(
    'PATCH /vendors/rejectVendor -> 200',
    rejectVendor.status === 200 && rejectVendor.body?.result?.status === 'REJECTED',
    `status=${rejectVendor.status} state=${rejectVendor.body?.result?.status}`,
  );
  record(
    'rejection reason stored',
    rejectVendor.body?.result?.rejectedReason === 'incomplete documents',
  );

  const rejectNoReason = await request(app)
    .patch(`/api/v1/vendors/rejectVendor/${vendor2.vendorId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({});
  record(
    'reject without reason -> 400',
    rejectNoReason.status === 400,
    `status=${rejectNoReason.status}`,
  );

  const vendorList = await request(app)
    .get('/api/v1/vendors/getAll?limit=50')
    .set('Authorization', `Bearer ${adminToken}`);
  record('GET /vendors/getAll -> 200', vendorList.status === 200, `status=${vendorList.status}`);
  record(
    'vendorList includes filterData and vendorList',
    Boolean(vendorList.body?.result?.filterData) &&
      Array.isArray(vendorList.body?.result?.vendorList),
    Object.keys(vendorList.body?.result ?? {}).join(','),
  );

  const approvedOnly = await request(app)
    .get('/api/v1/vendors/getAll?status=APPROVED&limit=50')
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    'status filter applied',
    approvedOnly.status === 200 &&
      (approvedOnly.body?.result?.vendorList ?? []).every((v: any) => v.status === 'APPROVED'),
    `count=${approvedOnly.body?.result?.vendorList?.length}`,
  );

  const vendorListDenied = await request(app)
    .get('/api/v1/vendors/getAll')
    .set('Authorization', `Bearer ${customer.token}`);
  record('customer blocked from /vendors/getAll -> 403', vendorListDenied.status === 403);

  const docs = await request(app)
    .get('/api/v1/vendors/getDocuments?limit=10')
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    'GET /vendors/getDocuments -> 200',
    docs.status === 200 && Array.isArray(docs.body?.result?.documentList),
    `status=${docs.status}`,
  );

  const approveDenied = await request(app)
    .patch(`/api/v1/vendors/approveVendor/${vendor2.vendorId}`)
    .set('Authorization', `Bearer ${customer.token}`)
    .send({});
  record('customer cannot approve vendors -> 403', approveDenied.status === 403);

  const addNote = await request(app)
    .post(`/api/v1/users/addNote/${customer.userId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ note: 'Asked for a refund twice, then settled.' });
  record(
    'POST /users/addNote -> 200',
    addNote.status === 200 && assertEnvelope(addNote.body, true),
    `status=${addNote.status} detail=${addNote.body?.result?.note}`,
  );

  const noteId = addNote.body?.result?.noteId;
  record(
    'the note records who wrote it',
    addNote.body?.result?.createdBy === adminUserId,
    `createdBy=${addNote.body?.result?.createdBy}`,
  );

  const emptyNote = await request(app)
    .post(`/api/v1/users/addNote/${customer.userId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ note: '' });
  record('empty note rejected -> 400', emptyNote.status === 400, `status=${emptyNote.status}`);

  const noteForMissing = await request(app)
    .post('/api/v1/users/addNote/does-not-exist')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ note: 'orphan' });
  record(
    'note on unknown customer -> 404',
    noteForMissing.status === 404 && assertEnvelope(noteForMissing.body, false),
    `status=${noteForMissing.status}`,
  );

  const customerNoteDenied = await request(app)
    .post(`/api/v1/users/addNote/${customer.userId}`)
    .set('Authorization', `Bearer ${customer.token}`)
    .send({ note: 'should not work' });
  record('customer cannot write an internal note -> 403', customerNoteDenied.status === 403);

  const listNotes = await request(app)
    .get(`/api/v1/users/getNotes/${customer.userId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    'GET /users/getNotes -> 200',
    listNotes.status === 200 && Array.isArray(listNotes.body?.result?.noteList),
    `status=${listNotes.status}`,
  );

  const customerListDenied = await request(app)
    .get(`/api/v1/users/getNotes/${customer.userId}`)
    .set('Authorization', `Bearer ${customer.token}`);
  record('customer cannot read internal notes -> 403', customerListDenied.status === 403);

  const removeNote = await request(app)
    .delete(`/api/v1/users/removeNote/${customer.userId}/${noteId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    'DELETE /users/removeNote -> 200',
    removeNote.status === 200 && removeNote.body?.result?.isRemoved === true,
    `status=${removeNote.status}`,
  );

  const afterRemove = await request(app)
    .get(`/api/v1/users/getNotes/${customer.userId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    'the note is gone after removal',
    (afterRemove.body?.result?.noteList ?? []).every((n: any) => n.noteId !== noteId),
    `remaining=${(afterRemove.body?.result?.noteList ?? []).length}`,
  );

  const removeAgain = await request(app)
    .delete(`/api/v1/users/removeNote/${customer.userId}/${noteId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  record('removing it twice -> 404', removeAgain.status === 404);

  const timeline = await request(app)
    .get(`/api/v1/users/getTimeline/${customer.userId}?limit=50`)
    .set('Authorization', `Bearer ${adminToken}`);
  const timelineList = timeline.body?.result?.timelineList ?? [];
  record(
    'GET /users/getTimeline -> 200',
    timeline.status === 200 && assertEnvelope(timeline.body, true),
    `status=${timeline.status}`,
  );

  record(
    'the timeline carries pagination numbers first',
    timeline.body?.result?.totalRecord >= 0 &&
      timeline.body?.result?.timelineList !== undefined &&
      Object.keys(timeline.body?.result ?? {})[0] === 'totalRecord',
    JSON.stringify(Object.keys(timeline.body?.result ?? {})),
  );

  record(
    'a login is on the timeline',
    timelineList.some((e: any) => e.type === 'LOGIN'),
    `types=${[...new Set(timelineList.map((e: any) => e.type))].join(',')}`,
  );

  record(
    'the timeline is newest first',
    timelineList.every(
      (e: any, i: number) => i === 0 || timelineList[i - 1].occurredAt >= e.occurredAt,
    ),
  );

  record(
    'no timeline entry carries a null',
    timelineList.every((e: any) => Object.values(e).every((v) => v !== null)),
  );

  const timelineFiltered = await request(app)
    .get(`/api/v1/users/getTimeline/${customer.userId}?type=ORDER&limit=50`)
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    '?type= narrows to one stream',
    timelineFiltered.status === 200 &&
      (timelineFiltered.body?.result?.timelineList ?? []).every((e: any) => e.type === 'ORDER'),
    `types=${[...new Set((timelineFiltered.body?.result?.timelineList ?? []).map((e: any) => e.type))].join(',')}`,
  );

  const timelineBadType = await request(app)
    .get(`/api/v1/users/getTimeline/${customer.userId}?type=BOGUS`)
    .set('Authorization', `Bearer ${adminToken}`);
  record('unknown ?type -> 400', timelineBadType.status === 400);

  const timelineUnknownCustomer = await request(app)
    .get('/api/v1/users/getTimeline/does-not-exist')
    .set('Authorization', `Bearer ${adminToken}`);
  record(
    'timeline for an unknown customer -> 404',
    timelineUnknownCustomer.status === 404 && assertEnvelope(timelineUnknownCustomer.body, false),
  );

  const timelineDenied = await request(app)
    .get(`/api/v1/users/getTimeline/${customer.userId}`)
    .set('Authorization', `Bearer ${customer.token}`);
  record('customer cannot read the timeline -> 403', timelineDenied.status === 403);

  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
  /* eslint-enable no-console */
};

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[e2e-user-vendor] crashed:', err);
  process.exit(1);
});
