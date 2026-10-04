import request from 'supertest';
import { createApp } from '../src/app';
import { toSlug } from '../src/utils/slug';

const slugOf = (name: string): string => toSlug(name);

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
const email = (tag: string) => `nt_${tag}_${run}@projectname.com`;
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
      name: `NT ${tag}`,
      otp: OTP,
      email: email(tag),
      phone: phoneFor(tag),
      password: 'Secret@123',
      ...(type === 'VENDOR' ? { shopName: shopName ?? `NT Shop ${tag} ${run}` } : {}),
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

  const customer = await register('cu', 'CUSTOMER');
  const vendor = await register('v1', 'VENDOR');
  const bystander = await register('x', 'CUSTOMER');

  const adminToken = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@projectname.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperSecret@123',
    })
    .then((r) => r.body?.result?.accessToken ?? '');

  record('bootstrap tokens', Boolean(adminToken && customer.token && vendor.token));

  const cu = api(customer.token);
  const shop = api(vendor.token);
  const admin = api(adminToken);

  await admin.patch(`/api/v1/vendors/approveVendor/${vendor.vendorId}`, {});
  record('vendor approved', true);

  const anon = await request(app).get('/api/v1/notifications/getAll');
  record(
    'GET /notifications/getAll without token -> 401',
    anon.status === 401,
    `status=${anon.status}`,
  );

  const empty = await cu.get('/api/v1/notifications/getAll');
  record('GET /notifications/getAll -> 200', empty.status === 200, `status=${empty.status}`);
  record(
    'a new account has no notifications',
    D_num(empty.body?.result?.totalRecord) === 0,
    `total=${empty.body?.result?.totalRecord}`,
  );

  const broadcastAsCustomer = await cu.post('/api/v1/notifications/sendBulk', { title: 'nope' });
  record(
    'a customer cannot broadcast -> 403',
    broadcastAsCustomer.status === 403,
    `status=${broadcastAsCustomer.status}`,
  );

  const noTargets = await admin.post('/api/v1/notifications/sendBulk', { title: 'Nowhere' });
  record(
    'a broadcast with no targets -> 400',
    noTargets.status === 400,
    `status=${noTargets.status}`,
  );

  const blast = await admin.post('/api/v1/notifications/sendBulk', {
    userIds: [customer.userId, bystander.userId],
    type: 'PROMO',
    title: `Sale ${run}`,
    body: 'Everything must go',
  });
  record(
    'POST /notifications/broadcast -> 202',
    blast.status === 202,
    `status=${blast.status} msg=${blast.body?.message}`,
  );
  record(
    'it reports how many were sent',
    D_num(blast.body?.result?.sentCount) === 2,
    `sent=${blast.body?.result?.sentCount}`,
  );

  const listed = await cu.get('/api/v1/notifications/getAll');
  record(
    'the notification reaches the user',
    D_num(listed.body?.result?.totalRecord) >= 1,
    `total=${listed.body?.result?.totalRecord}`,
  );
  record(
    'the unread count matches',
    D_num(listed.body?.result?.unreadCount) >= 1,
    `unread=${listed.body?.result?.unreadCount}`,
  );
  record(
    'the payload contains no nulls',
    findNull(listed.body?.result) === null,
    findNull(listed.body?.result) ?? 'clean',
  );

  const notifId = D_arr(listed.body?.result?.itemList)[0]?.notificationId ?? '';
  record('the notification id is present', Boolean(notifId), notifId);

  const unread = await cu.get('/api/v1/notifications/getUnreadCount');
  record(
    'GET /notifications/getUnreadCount -> 200',
    unread.status === 200,
    `status=${unread.status}`,
  );
  record(
    'the total is reported',
    D_num(unread.body?.result?.total) >= 1,
    `total=${unread.body?.result?.total}`,
  );
  record(
    'a per-type breakdown is included',
    typeof unread.body?.result?.byType?.PROMO === 'number',
    JSON.stringify(unread.body?.result?.byType),
  );

  const typeFiltered = await cu.get('/api/v1/notifications/getAll?type=PROMO');
  record(
    'the type filter works',
    D_num(typeFiltered.body?.result?.totalRecord) >= 1,
    `total=${typeFiltered.body?.result?.totalRecord}`,
  );

  const wrongType = await cu.get('/api/v1/notifications/getAll?type=ORDER');
  record(
    'an unmatched type filter returns nothing',
    D_num(wrongType.body?.result?.totalRecord) === 0,
    `total=${wrongType.body?.result?.totalRecord}`,
  );

  const readOne = await cu.patch('/api/v1/notifications/markAllRead', { ids: [notifId] });
  record('POST /notifications/markRead -> 200', readOne.status === 200, `status=${readOne.status}`);
  record(
    'it reports how many were marked',
    D_num(readOne.body?.result?.markedCount) === 1,
    `marked=${readOne.body?.result?.markedCount}`,
  );

  const afterRead = await cu.get('/api/v1/notifications/getUnreadCount');
  record(
    'the unread count drops',
    D_num(afterRead.body?.result?.total) === 0,
    `unread=${afterRead.body?.result?.total}`,
  );

  const readAll = await cu.patch('/api/v1/notifications/markAllRead', {});
  record(
    'markRead with no ids marks everything',
    readAll.status === 200,
    `status=${readAll.status}`,
  );

  const delNotif = await cu.del(`/api/v1/notifications/delete/${notifId}`);
  record(
    'DELETE /notifications/delete/:id -> 200',
    delNotif.status === 200,
    `status=${delNotif.status}`,
  );

  const foreignNotif = await api(bystander.token).del(`/api/v1/notifications/delete/${notifId}`);
  record(
    'deleting another user notification -> 404',
    foreignNotif.status === 404,
    `status=${foreignNotif.status}`,
  );

  const prefs = await cu.get('/api/v1/notifications/getPreferences');
  record(
    'GET /notifications/getPreferences -> 200',
    prefs.status === 200,
    `status=${prefs.status}`,
  );
  record(
    'a new user has no stored preferences',
    D_num(prefs.body?.result?.itemCount) === 0,
    `n=${prefs.body?.result?.itemCount}`,
  );

  const setPrefs = await cu.patch('/api/v1/notifications/updatePreferences', {
    preferences: [
      { channel: 'EMAIL', eventType: 'ORDER', isEnabled: false },
      { channel: 'PUSH', eventType: 'ORDER', isEnabled: true },
    ],
  });
  record(
    'PATCH /notifications/preferences -> 200',
    setPrefs.status === 200,
    `status=${setPrefs.status}`,
  );
  record(
    'it reports how many were written',
    D_num(setPrefs.body?.result?.updatedCount) === 2,
    `count=${setPrefs.body?.result?.updatedCount}`,
  );

  const prefsAfter = await cu.get('/api/v1/notifications/getPreferences');
  record(
    'the preferences persist',
    D_num(prefsAfter.body?.result?.itemCount) === 2,
    `n=${prefsAfter.body?.result?.itemCount}`,
  );

  await cu.patch('/api/v1/notifications/updatePreferences', {
    preferences: [{ channel: 'EMAIL', eventType: 'ORDER', isEnabled: true }],
  });

  const prefsToggled = await cu.get('/api/v1/notifications/getPreferences');
  record(
    're-posting a preference updates in place',
    D_arr(prefsToggled.body?.result?.itemList).find((p: any) => p.channel === 'EMAIL')
      ?.isEnabled === true && D_num(prefsToggled.body?.result?.itemCount) === 2,
    JSON.stringify(D_arr(prefsToggled.body?.result?.itemList)),
  );

  const badChannel = await cu.patch('/api/v1/notifications/updatePreferences', {
    preferences: [{ channel: 'CARRIER_PIGEON', eventType: 'ORDER', isEnabled: true }],
  });
  record('an unknown channel -> 400', badChannel.status === 400, `status=${badChannel.status}`);

  const emptyPrefs = await cu.patch('/api/v1/notifications/updatePreferences', { preferences: [] });
  record(
    'an empty preference list -> 400',
    emptyPrefs.status === 400,
    `status=${emptyPrefs.status}`,
  );

  const selfChat = await shop.post('/api/v1/chat/startConversation', {
    vendorId: vendor.vendorId,
    message: 'hello me',
  });
  record(
    'starting a chat with your own shop -> 422',
    selfChat.status === 422 && String(selfChat.body?.message).includes('yourself'),
    `status=${selfChat.status} msg=${selfChat.body?.message}`,
  );

  const noMessage = await cu.post('/api/v1/chat/startConversation', { vendorId: vendor.vendorId });
  record('a chat without a message -> 400', noMessage.status === 400, `status=${noMessage.status}`);

  const badVendor = await cu.post('/api/v1/chat/startConversation', {
    vendorId: 'nope123',
    message: 'hi',
  });
  record(
    'a chat with an unknown shop -> 404',
    badVendor.status === 404,
    `status=${badVendor.status}`,
  );

  const started = await cu.post('/api/v1/chat/startConversation', {
    vendorId: vendor.vendorId,
    message: 'Is the blue one in stock?',
  });
  record(
    'POST /chat/startConversation -> 201',
    started.status === 201,
    `status=${started.status} msg=${started.body?.message}`,
  );
  const conversationId = started.body?.result?.conversation?.conversationId ?? '';
  record('the conversation is created', Boolean(conversationId), conversationId);
  record(
    'the opening message is attached',
    Boolean(started.body?.result?.lastMessage?.messageId),
    JSON.stringify(started.body?.result?.lastMessage),
  );
  record(
    'the chat payload contains no nulls',
    findNull(started.body?.result) === null,
    findNull(started.body?.result) ?? 'clean',
  );

  const again = await cu.post('/api/v1/chat/startConversation', {
    vendorId: vendor.vendorId,
    message: 'Any update?',
  });
  record(
    'reopening a chat reuses the same thread',
    again.body?.result?.conversation?.conversationId === conversationId,
    again.body?.result?.conversation?.conversationId,
  );

  const vendorList = await shop.get('/api/v1/chat/getConversations');
  record(
    'the shop sees the thread',
    D_num(vendorList.body?.result?.totalRecord) === 1,
    `total=${vendorList.body?.result?.totalRecord}`,
  );
  record(
    'it reports two unread messages',
    D_num(vendorList.body?.result?.itemList?.[0]?.unreadCount) === 2,
    `unread=${vendorList.body?.result?.itemList?.[0]?.unreadCount}`,
  );

  const vendorUnread = await shop.get('/api/v1/chat/getUnreadCount');
  record(
    'the shop unread badge counts both',
    D_num(vendorUnread.body?.result?.total) === 2,
    `total=${vendorUnread.body?.result?.total}`,
  );

  const intruder = await api(bystander.token).get(`/api/v1/chat/getMessages/${conversationId}`);
  record(
    'a non-participant cannot read the thread -> 404',
    intruder.status === 404,
    `status=${intruder.status}`,
  );

  const intruderSend = await api(bystander.token).post(`/api/v1/chat/sendMessage`, {
    conversationId,
    body: 'let me in',
  });
  record(
    'a non-participant cannot post -> 404',
    intruderSend.status === 404,
    `status=${intruderSend.status}`,
  );

  const noConversation = await shop.post(`/api/v1/chat/sendMessage`, {
    body: 'nowhere to put this',
  });
  record(
    'a message with no conversationId -> 400',
    noConversation.status === 400 &&
      String(noConversation.body?.message).includes('conversationId'),
    `status=${noConversation.status} msg=${noConversation.body?.message}`,
  );

  const reply = await shop.post(`/api/v1/chat/sendMessage`, {
    conversationId,
    body: 'Yes, plenty in stock.',
  });
  record(
    'POST /chat/sendMessage -> 201',
    reply.status === 201,
    `status=${reply.status} msg=${reply.body?.message}`,
  );
  record(
    'the reply records its sender',
    reply.body?.result?.senderData?.userId !== undefined,
    JSON.stringify(reply.body?.result?.senderData),
  );

  const emptyBody = await shop.post(`/api/v1/chat/sendMessage`, { conversationId, body: '   ' });
  record('an empty message -> 400', emptyBody.status === 400, `status=${emptyBody.status}`);

  const customerUnread = await cu.get('/api/v1/chat/getUnreadCount');
  record(
    'the customer now has 1 unread',
    D_num(customerUnread.body?.result?.total) === 1,
    `total=${customerUnread.body?.result?.total}`,
  );

  const messages = await cu.get(`/api/v1/chat/getMessages/${conversationId}`);
  record(
    'GET /chat/getMessages/:conversationId -> 200',
    messages.status === 200,
    `status=${messages.status}`,
  );
  record(
    'the thread holds three messages',
    D_num(messages.body?.result?.totalRecord) === 3,
    `total=${messages.body?.result?.totalRecord}`,
  );

  const readIt = await shop.patch(`/api/v1/chat/markRead/${conversationId}`);
  record(
    'PATCH /chat/markRead/:conversationId -> 200',
    readIt.status === 200,
    `status=${readIt.status}`,
  );
  record(
    'it reports how many were marked',
    D_num(readIt.body?.result?.markedCount) === 2,
    `marked=${readIt.body?.result?.markedCount}`,
  );

  const shopUnreadAfter = await shop.get('/api/v1/chat/getUnreadCount');
  record(
    'the shop unread badge clears',
    D_num(shopUnreadAfter.body?.result?.total) === 0,
    `total=${shopUnreadAfter.body?.result?.total}`,
  );

  const ownMessageId = reply.body?.result?.messageId ?? '';
  const delOther = await shop.del(`/api/v1/chat/deleteMessage/${ownMessageId}`);
  record(
    'the sender can delete their own message -> 200',
    delOther.status === 200,
    `status=${delOther.status}`,
  );

  const delMissing = await shop.del('/api/v1/chat/deleteMessage/nope123');
  record(
    'deleting an unknown message -> 404',
    delMissing.status === 404,
    `status=${delMissing.status}`,
  );

  const blockSelf = await cu.post(`/api/v1/chat/blockUser/${customer.userId}`);
  record('blocking yourself -> 422', blockSelf.status === 422, `status=${blockSelf.status}`);

  const blockUnknown = await cu.post('/api/v1/chat/blockUser/nope123');
  record(
    'blocking an unknown user -> 404',
    blockUnknown.status === 404,
    `status=${blockUnknown.status}`,
  );

  const blocked = await cu.post(`/api/v1/chat/blockUser/${bystander.userId}`, { reason: 'spam' });
  record(
    'POST /chat/blockUser/:userId -> 200',
    blocked.status === 200,
    `status=${blocked.status} msg=${blocked.body?.message}`,
  );
  record(
    'the block echoes the target',
    blocked.body?.result?.userId === bystander.userId && blocked.body?.result?.isBlocked === true,
    JSON.stringify(blocked.body?.result),
  );

  const blockedList = await cu.get('/api/v1/chat/getBlocked');
  record('GET /chat/getBlocked -> 200', blockedList.status === 200, `status=${blockedList.status}`);
  record(
    'the block is listed with the user',
    D_arr(blockedList.body?.result?.itemList).some((b: any) => b.userId === bystander.userId),
    `n=${blockedList.body?.result?.itemCount}`,
  );

  const unblocked = await cu.post(`/api/v1/chat/unblock/${bystander.userId}`);
  record(
    'POST /chat/unblock/:id -> 200',
    unblocked.status === 200,
    `status=${unblocked.status} msg=${unblocked.body?.message}`,
  );

  const blockedListAfter = await cu.get('/api/v1/chat/getBlocked');
  record(
    'unblocking clears the list',
    D_num(blockedListAfter.body?.result?.itemCount) === 0,
    `n=${blockedListAfter.body?.result?.itemCount}`,
  );

  const shopBlocks = await shop.post(`/api/v1/chat/blockUser/${customer.userId}`, {
    reason: 'abusive',
  });
  record(
    'the shop can block the customer',
    shopBlocks.status === 200,
    `status=${shopBlocks.status}`,
  );

  const blockedPost = await cu.post(`/api/v1/chat/sendMessage`, {
    conversationId,
    body: 'let me back in',
  });
  record(
    'a blocked customer cannot post to the open thread',
    blockedPost.status === 403,
    `status=${blockedPost.status} msg=${blockedPost.body?.message}`,
  );

  const blockedRestart = await cu.post('/api/v1/chat/startConversation', {
    vendorId: vendor.vendorId,
    message: 'starting over',
  });
  record(
    'a blocked customer cannot start a new thread',
    blockedRestart.status === 403,
    `status=${blockedRestart.status} msg=${blockedRestart.body?.message}`,
  );

  const shopUnblocks = await shop.post(`/api/v1/chat/unblock/${customer.userId}`);
  record(
    'the shop can unblock the customer',
    shopUnblocks.status === 200,
    `status=${shopUnblocks.status}`,
  );

  const afterUnblock = await cu.post(`/api/v1/chat/sendMessage`, {
    conversationId,
    body: 'thanks for clearing me',
  });
  record(
    'unblocking restores messaging',
    afterUnblock.status === 201,
    `status=${afterUnblock.status}`,
  );

  const anonTicket = await request(app).get('/api/v1/tickets/getAll');
  record(
    'GET /tickets/getAll without token -> 401',
    anonTicket.status === 401,
    `status=${anonTicket.status}`,
  );

  const seedCatAsCustomer = await cu.post('/api/v1/tickets/categories', { name: 'Nope' });
  record(
    'a customer cannot create a ticket category -> 403',
    seedCatAsCustomer.status === 403,
    `status=${seedCatAsCustomer.status}`,
  );

  const categoryName = `Refunds ${run}`;
  const created = await admin.post('/api/v1/tickets/categories', {
    name: categoryName,
    sortOrder: 1,
  });
  record(
    'POST /tickets/categories -> 201',
    created.status === 201,
    `status=${created.status} msg=${created.body?.message}`,
  );
  const categoryId = created.body?.result?.categoryId ?? '';
  record(
    'the category slug is generated from the name',
    created.body?.result?.slug === slugOf(categoryName),
    created.body?.result?.slug,
  );

  const dupCat = await admin.post('/api/v1/tickets/categories', { name: categoryName });
  record(
    'a duplicate category name is allowed with a suffixed slug',
    dupCat.status === 201 && dupCat.body?.result?.slug === `${slugOf(categoryName)}-2`,
    `status=${dupCat.status} slug=${dupCat.body?.result?.slug}`,
  );

  const categories = await admin.get('/api/v1/tickets/getCategories');
  record(
    'GET /tickets/getCategories is public',
    categories.status === 200,
    `status=${categories.status}`,
  );

  const anonCats = await request(app).get('/api/v1/tickets/getCategories');
  record(
    'GET /tickets/getCategories without a token -> 200',
    anonCats.status === 200 && Array.isArray(anonCats.body?.result?.itemList),
    `status=${anonCats.status}`,
  );

  const cats = await cu.get('/api/v1/tickets/getCategories');
  record('GET /tickets/getCategories -> 200', cats.status === 200, `status=${cats.status}`);
  record(
    'the category is listed',
    D_arr(cats.body?.result?.itemList).some((c: any) => c.categoryId === categoryId),
    `n=${cats.body?.result?.itemCount}`,
  );

  const badSubject = await cu.post('/api/v1/tickets/create', { subject: 'hi' });
  record('a short subject -> 400', badSubject.status === 400, `status=${badSubject.status}`);

  const badCategory = await cu.post('/api/v1/tickets/create', {
    subject: 'Refund please',
    categoryId: 'nope123',
  });
  record('an unknown category -> 404', badCategory.status === 404, `status=${badCategory.status}`);

  const ticket = await cu.post('/api/v1/tickets/create', {
    subject: `Refund not received ${run}`,
    description: 'It has been a week.',
    categoryId,
    priority: 'HIGH',
    attachments: ['https://cdn.example.com/a.png'],
  });
  record(
    'POST /tickets/create -> 201',
    ticket.status === 201,
    `status=${ticket.status} msg=${ticket.body?.message}`,
  );
  const ticketId = ticket.body?.result?.ticketId ?? '';
  record(
    'the ticket number is generated',
    D_str(ticket.body?.result?.ticketNumber).length >= 8,
    D_str(ticket.body?.result?.ticketNumber),
  );
  record('it opens as OPEN', ticket.body?.result?.status === 'OPEN', ticket.body?.result?.status);
  record(
    'the priority is kept',
    ticket.body?.result?.priority === 'HIGH',
    ticket.body?.result?.priority,
  );
  record(
    'the description becomes the first message',
    D_arr(ticket.body?.result?.messageList).length === 1,
    `n=${D_arr(ticket.body?.result?.messageList).length}`,
  );
  record(
    'the category is joined',
    ticket.body?.result?.categoryData?.categoryId === categoryId,
    JSON.stringify(ticket.body?.result?.categoryData),
  );

  const detail = await cu.get(`/api/v1/tickets/getById/${ticketId}`);
  record('GET /tickets/getById/:id -> 200', detail.status === 200, `status=${detail.status}`);

  const foreignTicket = await api(bystander.token).get(`/api/v1/tickets/getById/${ticketId}`);
  record(
    "reading another customer's ticket -> 404",
    foreignTicket.status === 404,
    `status=${foreignTicket.status}`,
  );

  const staffReply = await admin.post(`/api/v1/tickets/reply/${ticketId}`, {
    message: 'Looking into it now.',
  });
  record(
    'POST /tickets/:id/reply (staff) -> 201',
    staffReply.status === 201,
    `status=${staffReply.status}`,
  );

  const afterStaff = await admin.get(`/api/v1/tickets/getById/${ticketId}`);
  record(
    'a staff reply moves the ticket to IN_PROGRESS',
    afterStaff.body?.result?.status === 'IN_PROGRESS',
    afterStaff.body?.result?.status,
  );

  const internal = await admin.post(`/api/v1/tickets/reply/${ticketId}`, {
    message: 'Checked the gateway logs.',
    isInternal: true,
  });
  record(
    'an internal note is accepted from staff',
    internal.status === 201,
    `status=${internal.status}`,
  );

  const customerView = await cu.get(`/api/v1/tickets/getById/${ticketId}`);
  record(
    'the customer never sees the internal note',
    !D_arr(customerView.body?.result?.messageList).some((m: any) =>
      D_str(m.message).includes('gateway logs'),
    ),
    `messages=${D_arr(customerView.body?.result?.messageList).length}`,
  );

  const staffView = await admin.get(`/api/v1/tickets/getById/${ticketId}`);
  record(
    'staff do see the internal note',
    D_arr(staffView.body?.result?.messageList).some((m: any) =>
      D_str(m.message).includes('gateway logs'),
    ),
    `messages=${D_arr(staffView.body?.result?.messageList).length}`,
  );

  const customerInternal = await cu.post(`/api/v1/tickets/reply/${ticketId}`, {
    message: 'sneaky note',
    isInternal: true,
  });
  record(
    'a customer cannot post an internal note -> 403',
    customerInternal.status === 403,
    `status=${customerInternal.status}`,
  );

  const emptyReply = await admin.post(`/api/v1/tickets/reply/${ticketId}`, { message: '' });
  record('an empty reply -> 400', emptyReply.status === 400, `status=${emptyReply.status}`);

  const strangerReply = await api(bystander.token).post(`/api/v1/tickets/reply/${ticketId}`, {
    message: 'hello',
  });
  record(
    'a stranger cannot reply -> 403',
    strangerReply.status === 403,
    `status=${strangerReply.status}`,
  );

  const customerTickets = await cu.get('/api/v1/tickets/getAll');
  record(
    'a customer sees only their own ticket',
    D_num(customerTickets.body?.result?.totalRecord) === 1,
    `total=${customerTickets.body?.result?.totalRecord}`,
  );

  const adminTickets = await admin.get('/api/v1/tickets/getAll');
  record(
    'staff see every ticket',
    D_num(adminTickets.body?.result?.totalRecord) >= 1,
    `total=${adminTickets.body?.result?.totalRecord}`,
  );
  record(
    'the list carries no message bodies',
    D_arr(customerTickets.body?.result?.itemList).every(
      (t: any) => D_arr(t.messageList).length === 0,
    ),
    'stripped',
  );

  const filtered = await admin.get('/api/v1/tickets/getAll?status=IN_PROGRESS');
  record(
    'the status filter works',
    D_num(filtered.body?.result?.totalRecord) === 1,
    `total=${filtered.body?.result?.totalRecord}`,
  );

  const searched = await admin.get('/api/v1/tickets/getAll?search=Refund');
  record(
    'the search filter works',
    D_num(searched.body?.result?.totalRecord) >= 1,
    `total=${searched.body?.result?.totalRecord}`,
  );

  const badAssign = await admin.patch(`/api/v1/tickets/assign/${ticketId}`, {
    assignedToId: customer.userId,
  });
  record('assigning a non-admin -> 404', badAssign.status === 404, `status=${badAssign.status}`);

  const customerResolve = await cu.patch(`/api/v1/tickets/updateStatus/${ticketId}`, {
    status: 'RESOLVED',
  });
  record(
    'a customer cannot resolve a ticket -> 403',
    customerResolve.status === 403,
    `status=${customerResolve.status}`,
  );

  const illegalJump = await admin.patch(`/api/v1/tickets/updateStatus/${ticketId}`, {
    status: 'OPEN',
  });
  record(
    'moving back to OPEN is rejected',
    illegalJump.status === 422 &&
      String(illegalJump.body?.message).includes('INVALID_STATUS_TRANSITION'),
    `status=${illegalJump.status} msg=${illegalJump.body?.message}`,
  );

  const resolved = await admin.patch(`/api/v1/tickets/updateStatus/${ticketId}`, {
    status: 'RESOLVED',
    remark: 'Refund issued',
  });
  record(
    'IN_PROGRESS -> RESOLVED is allowed',
    resolved.status === 200 && resolved.body?.result?.status === 'RESOLVED',
    `status=${resolved.status}`,
  );
  record('resolvedAt is stamped', Boolean(resolved.body?.result?.resolvedAt));

  const closed = await admin.patch(`/api/v1/tickets/updateStatus/${ticketId}`, {
    status: 'CLOSED',
  });
  record(
    'RESOLVED -> CLOSED is allowed',
    closed.status === 200 && closed.body?.result?.status === 'CLOSED',
    `status=${closed.status}`,
  );
  record('closedAt is stamped', Boolean(closed.body?.result?.closedAt));

  const afterClose = await admin.post(`/api/v1/tickets/reply/${ticketId}`, {
    message: 'one more thing',
  });
  record(
    'replying to a closed ticket -> 422',
    afterClose.status === 422,
    `status=${afterClose.status} msg=${afterClose.body?.message}`,
  );

  const doubleClose = await admin.patch(`/api/v1/tickets/updateStatus/${ticketId}`, {
    status: 'CLOSED',
  });
  record('closing twice -> 422', doubleClose.status === 422, `status=${doubleClose.status}`);

  const stats = await admin.get('/api/v1/tickets/getStats');
  record('GET /tickets/getStats -> 200', stats.status === 200, `status=${stats.status}`);
  record(
    'the stats count every status',
    ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].every(
      (s) => typeof stats.body?.result?.[s] === 'number',
    ),
    JSON.stringify(stats.body?.result),
  );
  record(
    'the closed ticket is counted as CLOSED',
    D_num(stats.body?.result?.CLOSED) >= 1,
    `closed=${stats.body?.result?.CLOSED}`,
  );

  const statsAsCustomer = await cu.get('/api/v1/tickets/getStats');
  record(
    'a customer cannot read the stats -> 403',
    statsAsCustomer.status === 403,
    `status=${statsAsCustomer.status}`,
  );

  const ticketIds = (
    await prisma.ticket.findMany({ where: { userId: customer.userId }, select: { id: true } })
  ).map((t) => t.id);
  await prisma.ticketMessage.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  await prisma.ticketCategory.deleteMany({ where: { name: { contains: run } } });
  await prisma.notification.deleteMany({
    where: { userId: { in: [customer.userId, bystander.userId] } },
  });
  await prisma.notificationPreference.deleteMany({ where: { userId: customer.userId } });
  await prisma.message.deleteMany({ where: { conversationId } });
  await prisma.conversationParticipant.deleteMany({ where: { conversationId } });
  await prisma.conversation.deleteMany({ where: { id: conversationId } });
  await prisma.userBlock.deleteMany({ where: { blockerId: customer.userId } });

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
