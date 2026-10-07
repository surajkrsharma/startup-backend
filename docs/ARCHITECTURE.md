# Architecture

What this API is built from and how each part behaves: the stack, the request
path, the modules, the endpoints, and every configuration value with its
default.

If you are here to **write or change code**, read
[CONVENTIONS.md](CONVENTIONS.md) instead — that is the rulebook. For commands
and setup, see the [README](../README.md).

## Contents

- [Tech Stack](#tech-stack)
- [What This API Does](#what-this-api-does)
- [Encrypted Request & Response](#encrypted-request--response)
- [Sample Endpoints](#sample-endpoints)
- [Sample Request / Response Pairs](#sample-request--response-pairs)
- [Configuration & Default Values](#configuration--default-values)
- [Folder Structure](#folder-structure)
- [Prisma Models](#prisma-models)
- [API Routes Outline](#api-routes-outline)
- [Missing / Planned Features](#missing--planned-features)

---

## Tech Stack

**Core**

- Node.js + Express.js
- TypeScript
- **Prisma ORM** (PostgreSQL ke saath best DX — type-safe queries)
- **Zod** (request body/query/params validation schema define karne ke liye; `/auth/register` me discriminated union for `type: CUSTOMER | VENDOR`)
- `dotenv` (`.env` file se env variables load karne ke liye)
- `cors` (cross-origin requests allow/block karne ke liye)
- `cookie-parser` (HttpOnly cookies read karne ke liye — refresh token)
- `helmet` (secure HTTP headers set karne ke liye)
- `pino-http` (har request ka structured log — production-ready logging)

**Database & Cache**

- **PostgreSQL** (main relational database)
- **Redis (Upstash)** — cart sessions, cache, rate-limit store, realtime analytics streams ke liye
- `ioredis` (Redis client — `redis` package nahi, ioredis use hota hai)

**Auth & Security**

- `jsonwebtoken` (access + refresh JWT banane/verify karne ke liye)
- `bcrypt` (passwords hash karne ke liye)
- `helmet` (XSS, clickjacking, MIME sniffing se bachata hai)
- `express-rate-limit` + `rate-limit-redis` (brute-force aur DDoS rokta hai; Redis store se server restart pe bhi count safe rehta hai)
- `hpp` (HTTP Parameter Pollution — duplicate query params se attack rokta hai)
- `cors` (whitelist: admin, vendor, store domains — wildcard allowed nahi)
- `qrcode` (2FA — TOTP QR generate karne ke liye; TOTP verify `src/utils/crypto.ts` me hai)
- `ua-parser-js` (device/browser/OS parse karne ke liye — device fingerprinting)
- `geoip-lite` (IP → country/state/city lookup — analytics)

**File & Media**

- `multer` (multipart form-data se file temp disk pe receive karne ke liye)
- `cloudinary` (permanent cloud storage + image transforms/CDN)
- `pdfkit` (invoice, packing slip, payout statement PDF generate karne ke liye)
- `xlsx` / `csv-parser` (bulk import/export — CSV/Excel)

**Realtime & Jobs**

- `socket.io` (chat, live order tracking, realtime analytics ke liye)
- `bullmq` — background jobs (email, payout calc, order status, analytics aggregation, notification blast) queue ke liye

**Utils**

- `pino` (structured logging, level-based) + `pino-http` (har request ka log)
- `compression` (gzip response — payload size kam)
- `nodemailer` (SMTP se transactional email) — provider `src/services/mail/mail.service.ts` me pluggable hai: Brevo HTTP API (`BREVO_API_KEY`) priority le ta hai, warna SMTP, warna sirf log
- `slugify` (product/vendor name → URL-safe slug)
- `nanoid` (request ID, invite tokens) — `uuid` nahi
- `dayjs` — lightweight date parse/format
- `swagger-jsdoc` + `swagger-ui-express` — auto OpenAPI docs generate + serve
- `razorpay` / `stripe` (optionalDependencies — online payments ke liye)
- `handlebars` (email/SMS template rendering — DB templates)
- `zod` (env schema + har request body/query/params validation)

**Dev/Test**

- `vitest` (unit tests)
- `supertest` (HTTP API integration tests)
- `eslint` + `prettier` + `husky` (code quality + pre-commit hooks)
- `dotenv-cli` (`.env` ke saath ek command chalana)
- `@electric-sql/pglite` (devDependency — in-process Postgres, `npm run db:up` ke liye; production me use nahi hota)

---

---

## What This API Does

| Item | Kaam |
| --- | --- |
| Refresh token strategy | Access 15m, Refresh 7d. Refresh ko DB/Redis mai store (revoke possible ho). |
| RBAC middleware | `SUPER_ADMIN`, `SUB_ADMIN`, `VENDOR`, `CUSTOMER`, `DELIVERY_BOY` — role ke hisaab se route protect. **VENDOR role `/auth/register` se assign hota hai (`type=VENDOR`).** |
| Multi-tenancy scoping | Har vendor query mai `vendorId` filter (Prisma `$extends`) — vendor sirf apna data dekhe |
| Rate limit Redis store | Server restart pe reset na ho — Redis-backed store use karo |
| CORS whitelist | 3 domains, wildcard `*` nahi — security ke liye |
| Central Error Handler | `AppError` class + `errorHandler` middleware — consistent JSON error shape |
| Async wrapper | `asyncHandler(fn)` — har controller mai try/catch repeat na karo |
| Request ID middleware | `nanoid` se `req.id` — ek request ke saare logs trace karne ke liye |
| Health route | `/api/v1/health` for Render — uptime check ke liye |
| Graceful shutdown | SIGTERM pe Prisma disconnect + Redis quit + Socket close — data loss na ho |
| BullMQ queue | Email, payout calc, order status, analytics aggregate, notification blast background mai — response fast rahe |
| Email templates | HTML templates (order confirm, reset password) — reusable |
| File upload validation | MIME + size check multer mai — malicious file reject |
| Pagination standard | `?page=1&limit=20&sort=-createdAt&search=` — sab list endpoints consistent |
| Soft Delete | `deletedAt` on Vendor/Product/Order — data recoverable rahe |
| Audit Logs | `AuditLog` table — kaun sub-admin ne kya kiya, record rahe. **SUPER_ADMIN self-edit bhi log ho.** |
| DB Indexes | email, slug, vendorId, status, createdAt pe index — queries fast |
| Seed script | Super Admin + demo data — fresh env setup 1 command mai |
| **OTP verification** | Contact proof before an account exists — `OTP_REQUIRED` env se poora system on/off |
| **OTP delivery** | Email (Brevo ya SMTP) + SMS (MSG91) — `src/services/mail/` + `src/services/sms/` |
| Migration in build | `prisma migrate deploy` in Render build — schema auto sync |
| Env validation | Zod env schema — missing/invalid env pe server early fail ho |
| API versioning | `/api/v1/...` — future breaking changes ke liye |
| Payout/Commission | earnings = order total − commission − fee — vendor payout calculate |
| Order state machine | PENDING→CONFIRMED→SHIPPED→DELIVERED→CANCELLED/RETURNED — random transitions block |
| Inventory mgmt | Stock decrement inside transaction — oversell na ho |
| Multi-vendor cart split | Order place pe per-vendor `SubOrder` — har vendor apna part dekhe |
| Webhook stubs | **`COD` / `UPI` / `Bank Detail`** — payment gateway + shipping + razorpay webhook stubs |
| Currency & Tax config | Per-vendor GST/tax table — vendor-wise tax lage |
| Swagger `/docs` | Auto OpenAPI — frontend devs contract dekh sake |
| `.env.example` | Har repo mai — kaun kaun se env var chahiye, documented rahe |
| **Realtime layer** | Socket.io — chat, live order tracking, live analytics dashboard |
| **Tracking middleware** | Har incoming request pe device + geo + session capture (background) |
| **Device fingerprint** | `ua-parser-js` + `deviceId` (client-generated) — device unique identify |
| **Analytics aggregation** | Daily Redis counters + BullMQ nightly rollup into Postgres |
| **Session management** | `Session` rows in Postgres, device-wise revoke possible |
| **2FA TOTP** | HMAC-SHA1 TOTP in `src/utils/crypto.ts` — optional per-user enable |
| **KYC / docs upload** | Vendor GST/PAN/Aadhaar verify flow |
| **Bulk import/export** | CSV/Excel endpoints for products, orders, users |
| **Feature flags** | `SystemSetting` category=feature — client boot pe fetch |
| **Maintenance mode** | Admin ON kare → 503 except `/health`, `/docs`, `/admin/*` |
| **PDF generation** | Invoice, packing slip, payout statement — `pdfkit` |
| **Geo serviceability** | Pincode → serviceable check (per vendor/zone) |

---

---

## Encrypted Request & Response

#### Goal

- Client → API: body/query/sensitive headers encrypted bhej sake (optional).
- API → Client: response encrypted bhej sake.
- **Toggle:** `.env` mai `ENCRYPTION_ENABLED=true|false` — bina code change ON/OFF.

#### Algorithm

- **AES-256-GCM** (authenticated encryption — tamper-proof).
- Client `x-encrypted: 1` header bheje → middleware samjhe ki decrypt karna hai.
- Response encrypt karega agar `x-encrypted` header request mai tha OR global setting ON.

#### Flow

```
Client (web/android/ios)
  ├─ Payload JSON → encrypt(AES-256-GCM, sharedKey)
  ├─ Header: x-encrypted: 1
  └─ POST /api/v1/orders/placeOrder  body: { iv, tag, data }

API encryption.middleware
  ├─ if ENCRYPTION.ENABLED && header present
  │    ├─ decrypt body → req.body
  │    └─ mark res.locals.shouldEncrypt = true
  ├─ route handler normal chalta hai (plain req.body)
  └─ on response: encrypt before send

Client decrypt karke JSON parse kare
```

#### Example — `src/middlewares/encryption.middleware.ts`

```tsx
import crypto from 'crypto';
import { ENCRYPTION } from '../config/encryption.config';

const KEY = Buffer.from(ENCRYPTION.KEY, 'hex');

const decryptPayload = (payload: { iv: string; tag: string; data: string }) => {
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const decipher = crypto.createDecipheriv(ENCRYPTION.ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8'));
};

const encryptPayload = (data: any) => {
  const iv = crypto.randomBytes(ENCRYPTION.IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION.ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  };
};

export const encryptionMiddleware = (req, res, next) => {
  if (!ENCRYPTION.ENABLED) return next();
  if (ENCRYPTION.SKIP_PATHS.some(p => req.path.startsWith(p))) return next();

  const isEncrypted = req.headers[ENCRYPTION.HEADER_NAME] === '1';

  if (isEncrypted && req.body && req.body.data) {
    try {
      req.body = decryptPayload(req.body);
      res.locals.shouldEncrypt = true;
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid encrypted payload.' });
    }
  }

  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    if (res.locals.shouldEncrypt && body) {
      return originalJson({ encrypted: true, ...encryptPayload(body) });
    }
    return originalJson(body);
  };

  next();
};
```

#### Env vars

```
ENCRYPTION_ENABLED=false
ENCRYPTION_KEY=<64-hex-chars>
```

Poora env inventory `src/config/env.config.ts` me Zod schema hai — server boot
se pehle validate hota hai, missing ya invalid value pe fail ho jata hai. `.env`
ko do hisso me rakha hai: **Part 1 required** (in ke bina app start nahi hota) aur
**Part 2 optional** (har ek ka default `.env` me likha hai).

**Part 1 — required (default nahi hai, boot error dega):**

| Var | Rule |
| --- | --- |
| `DATABASE_URL` | Non-empty. Render pe **internal** URL, local machine pe external |
| `JWT_ACCESS_SECRET` | Min 16 chars |
| `JWT_REFRESH_SECRET` | Min 16 chars, access se alag hona chahiye |

**Part 2 — optional (har ek ka default):**

| Var | Default | Kaam |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` = strict CORS, secure cookie, code log nahi hota |
| `PORT` | `5000` | Render khud inject karta hai |
| `APP_NAME` | `projectname` | JWT issuer/audience — **badalne se sab logout** |
| `LOG_LEVEL` | `info` | `fatal` se `trace` tak |
| `OTP_REQUIRED` | `true` | Poore OTP system ka master switch (§7.5) |
| `OTP_SMS_ENABLED` | `false` | Phone number pe code bhejne ke liye |
| `OTP_STATIC_CODE` | *(khali)* | Local testing ke liye fix code — production me boot error |
| `JWT_ACCESS_EXPIRY` | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh token TTL |
| `REDIS_URL` | *(khali)* | Nahi hai to cache/queue/rate-limit degrade |
| `REDIS_PREFIX` | `projectname` | Redis key namespace |
| `QUEUE_ENABLED` | `true` | `true` hai aur `REDIS_URL` khali → **boot error** |
| `QUEUE_PREFIX` | `projectname` | BullMQ queue namespace |
| `WORKER_ENABLED` | `true` | `false` = sirf HTTP serve, workers/cron nahi |
| `TRACKING_ENABLED` | `true` | Har request pe 2 extra DB query |
| `GEO_LOOKUP_ENABLED` | `true` | GeoLite lookup |
| `RATE_LIMIT_ENABLED` | `true` | `false` karne se OTP brute-force guard bhi jaata hai |
| `CORS_ORIGINS` | *(khali)* | CSV. Production me khali = har origin reject |
| `SOCKET_CORS_ORIGINS` | *(khali)* | Khali ho to `CORS_ORIGINS` use hota hai |
| `SUPER_ADMIN_EMAIL` | `superadmin@projectname.com` | Seed ka super admin |
| `SUPER_ADMIN_PASSWORD` | `SuperSecret@123` | ⚠️ Default kabhi live mat jaane do |
| `ENCRYPTION_ENABLED` | `false` | §4 ka transport encryption |
| `ENCRYPTION_KEY` | *(khali)* | `ENCRYPTION_ENABLED=true` pe **exactly 64 hex** chahiye |
| `CLOUDINARY_CLOUD_NAME` | *(khali)* | Khali = upload route 503 |
| `CLOUDINARY_API_KEY` | *(khali)* | Account-level **Root** key use karo |
| `CLOUDINARY_API_SECRET` | *(khali)* | |
| `CLOUDINARY_FOLDER` | `projectname` | Media library ka top folder |
| `BREVO_API_KEY` | *(khali)* | Set hai to SMTP ko priority milta hai |
| `BREVO_FROM_EMAIL` | *(khali)* | Brevo me verified sender hona chahiye |
| `BREVO_FROM_NAME` | `ProjectName` | |
| `BREVO_SENDER_NAME` | *(khali)* | Khali ho to `BREVO_FROM_NAME` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | *(khali)* / `587` / `false` | Brevo nahi to ye path |
| `SMTP_USER` / `SMTP_PASS` | *(khali)* | |
| `MAIL_FROM_NAME` | `ProjectName` | |
| `MAIL_FROM_EMAIL` | `no-reply@projectname.com` | |
| `MSG91_AUTHKEY` | *(khali)* | SMS provider |
| `MSG91_SENDER_ID` | *(khali)* | India me DLT-registered header mandatory |
| `MSG91_TEMPLATE_ID` | *(khali)* | DLT template, `{{0}}` placeholder |
| `MSG91_COUNTRY_CODE` | `91` | |
| `FCM_SERVER_KEY` / `FCM_ENABLED` | *(khali)* / `false` | Push — abhi koi code nahi padhta |
| `RAZORPAY_*` / `STRIPE_*` / `SHIPPING_PARTNER_WEBHOOK_SECRET` | *(khali)* | Payment module land hone tak safe ignore |

**Cross-field rules jo boot pe enforce hote hain:**

| Condition | Result |
| --- | --- |
| `QUEUE_ENABLED=true` + `REDIS_URL` khali | Boot error |
| `ENCRYPTION_ENABLED=true` + key 64 hex nahi | Boot error |
| `NODE_ENV=production` + `CORS_ORIGINS` me `*` | Boot error |
| `OTP_STATIC_CODE` set + `NODE_ENV=production` | Boot error |
| `OTP_STATIC_CODE` non-numeric | Boot error |
| `NODE_ENV=production` + `OTP_REQUIRED=true` + koi provider nahi | Boot error |

Local tooling (`npm run db:up` ke liye) raw `process.env` se padhta hai aur schema
me nahi hai: `PGLITE_MODE`, `PGLITE_PORT`, `PGLITE_HOST`, `PGLITE_DATA_DIR`,
`SEED_DEMO_DATA`.

---

## Sample Endpoints

| Method | Endpoint | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/register/sendOtp` | ❌ | Public | Registration step 1 — request a code |
| POST | `/api/v1/auth/register/verifyOtp` | ❌ | Public | Registration step 2 — code → `verificationToken` |
| POST | `/api/v1/auth/register` | ❌ | Public | Registration step 3 — spend the token (`type: CUSTOMER` or `type: VENDOR`) |
| POST | `/api/v1/auth/login` | ❌ | Public | Password login (any role) |
| POST | `/api/v1/auth/login/verifyOtp` | ❌ | Public | OTP login step 2 — verify the code and sign in || POST | `/api/v1/auth/refreshToken` | Cookie | Any | Refresh access token |
| POST | `/api/v1/auth/logout` | ✅ | Any | Logout + revoke refresh |
| POST | `/api/v1/auth/logoutAllDevices` | ✅ | Any | Revoke all sessions |
| GET | `/api/v1/auth/getMe` | ✅ | Any | Current user |
| POST | `/api/v1/auth/verifyOtp` | ❌ | Public | Verify OTP |
| POST | `/api/v1/auth/forgotPassword` | ❌ | Public | Trigger reset OTP flow |
| POST | `/api/v1/auth/resetPassword` | ❌ | Public | Reset with OTP |
| POST | `/api/v1/auth/changePassword` | ✅ | Any | Change own password |
| POST | `/api/v1/auth/verifyEmail` | ✅ | Any | Verify email |
| POST | `/api/v1/auth/verifyPhone` | ✅ | Any | Verify phone |
| POST | `/api/v1/auth/changeEmail/sendOtp` | ✅ | Any | Step 1 of email change — code to the new address |
| POST | `/api/v1/auth/changeEmail/verifyOtp` | ✅ | Any | Step 2 — code → `verificationToken` |
| POST | `/api/v1/auth/changeEmail` | ✅ | Any | Swap the sign-in email |
| POST | `/api/v1/auth/changePhone` | ✅ | Any | Swap the phone number |
| POST | `/api/v1/auth/restoreAccount` | ❌ | Public | Restore inside the deletion recovery window |
| POST | `/api/v1/auth/enable2FA` | ✅ | Any | Enable 2FA |
| POST | `/api/v1/auth/disable2FA` | ✅ | Any | Disable 2FA |
| POST | `/api/v1/auth/verify2FA` | ❌ | Public | 2FA challenge |
| POST | `/api/v1/auth/socialLogin` | ❌ | Public | Google/Apple/Facebook |
| POST | `/api/v1/auth/linkSocial` | ✅ | Any | Link social account |
| POST | `/api/v1/auth/unlinkSocial` | ✅ | Any | Unlink social |
| POST | `/api/v1/auth/checkAvailability` | ❌ | Public | Check email/phone |
| GET | `/api/v1/auth/sessions` | ✅ | Any | Active sessions |
| DELETE | `/api/v1/auth/sessions/:id` | ✅ | Any | Revoke session |
| GET | `/api/v1/users/getProfile` | ✅ | Any | Self profile |
| PATCH | `/api/v1/users/updateProfile` | ✅ | Any | Update self profile |
| DELETE | `/api/v1/users/deleteAccount` | ✅ | Any | Soft-delete self — recoverable for `security.accountPurgeDays` |
| GET | `/api/v1/users/getAddresses` | ✅ | CUSTOMER | List addresses |
| POST | `/api/v1/users/addAddress` | ✅ | CUSTOMER | Add address |
| PATCH | `/api/v1/users/updateAddress/:id` | ✅ | CUSTOMER | Update address |
| DELETE | `/api/v1/users/deleteAddress/:id` | ✅ | CUSTOMER | Delete address |
| PATCH | `/api/v1/users/setDefaultAddress/:id` | ✅ | CUSTOMER | Set default |
| GET | `/api/v1/users/getAll` | ✅ | ADMIN | List users |
| GET | `/api/v1/users/getById/:id` | ✅ | ADMIN | Single user |
| PATCH | `/api/v1/users/updateUser/:id` | ✅ | ADMIN | Update user |
| PATCH | `/api/v1/users/toggleStatus/:id` | ✅ | ADMIN | Suspend/activate |
| DELETE | `/api/v1/users/deleteUser/:id` | ✅ | SUPER_ADMIN | Hard delete |
| GET | `/api/v1/users/getActivity/:id` | ✅ | ADMIN | User activity |
| GET | `/api/v1/users/getOrders/:id` | ✅ | ADMIN | User orders |
| POST | `/api/v1/users/impersonate/:id` | ✅ | SUPER_ADMIN | Login as user |
| GET | `/api/v1/vendors/getProfile` | ✅ | VENDOR | My vendor profile |
| PATCH | `/api/v1/vendors/updateProfile` | ✅ | VENDOR | Update vendor profile |
| GET | `/api/v1/vendors/getAll` | ✅ | ADMIN | List vendors |
| GET | `/api/v1/vendors/getById/:id` | ✅ | ADMIN | Single vendor |
| PATCH | `/api/v1/vendors/approveVendor/:id` | ✅ | ADMIN | Approve vendor |
| PATCH | `/api/v1/vendors/rejectVendor/:id` | ✅ | ADMIN | Reject vendor |
| PATCH | `/api/v1/vendors/suspendVendor/:id` | ✅ | ADMIN | Suspend vendor |
| PATCH | `/api/v1/vendors/updateCommission/:id` | ✅ | ADMIN | Override commission |
| PATCH | `/api/v1/vendors/updateBankDetails/:id` | ✅ | VENDOR | Update bank/UPI |
| GET | `/api/v1/vendors/getStats` | ✅ | VENDOR | Dashboard stats |
| GET | `/api/v1/vendors/getRatings/:id` | ❌ | Public | Vendor rating summary |
| GET | `/api/v1/vendors/getProducts/:id` | ❌ | Public | Vendor products |
| POST | `/api/v1/vendors/requestPayout` | ✅ | VENDOR | Request payout |
| GET | `/api/v1/vendors/getPayoutHistory` | ✅ | VENDOR | Payout history |
| POST | `/api/v1/vendors/uploadDocuments` | ✅ | VENDOR | KYC docs |
| GET | `/api/v1/vendors/getDocuments` | ✅ | ADMIN | KYC docs |
| PATCH | `/api/v1/vendors/verifyDocuments/:id` | ✅ | ADMIN | Approve KYC |
| POST | `/api/v1/products/createProduct` | ✅ | VENDOR | Create product |
| GET | `/api/v1/products/getAll` | ❌ | Public | List products (paginated) |
| GET | `/api/v1/products/getById/:id` | ❌ | Public | Single product |
| GET | `/api/v1/products/getBySlug/:slug` | ❌ | Public | SEO URL product |
| PATCH | `/api/v1/products/updateProduct/:id` | ✅ | VENDOR | Update own product |
| DELETE | `/api/v1/products/deleteProduct/:id` | ✅ | VENDOR | Soft delete |
| PATCH | `/api/v1/products/updateStock/:id` | ✅ | VENDOR | Update stock |
| PATCH | `/api/v1/products/toggleStatus/:id` | ✅ | VENDOR | Active/Inactive |
| POST | `/api/v1/products/uploadImages/:id` | ✅ | VENDOR | Upload images |
| DELETE | `/api/v1/products/deleteImage/:id/:imageId` | ✅ | VENDOR | Remove image |
| POST | `/api/v1/products/bulkCreate` | ✅ | VENDOR | Bulk create |
| POST | `/api/v1/products/bulkImportCsv` | ✅ | VENDOR | CSV import |
| GET | `/api/v1/products/exportCsv` | ✅ | VENDOR | Export |
| PATCH | `/api/v1/products/bulkUpdate` | ✅ | VENDOR | Bulk edit |
| PATCH | `/api/v1/products/bulkDelete` | ✅ | VENDOR | Bulk delete |
| GET | `/api/v1/products/getRelated/:id` | ❌ | Public | Related products |
| GET | `/api/v1/products/getRecommended` | ✅ | Any | Recommendations |
| GET | `/api/v1/products/getFrequentlyBought/:id` | ❌ | Public | Frequently bought |
| GET | `/api/v1/products/getRecentlyViewed` | ✅ | Any | Recently viewed |
| POST | `/api/v1/products/trackView/:id` | ❌ | Any | Increment view |
| GET | `/api/v1/products/getFilters` | ❌ | Public | Facets |
| POST | `/api/v1/products/bulkPriceUpdate` | ✅ | VENDOR | Bulk price update |
| POST | `/api/v1/categories/createCategory` | ✅ | ADMIN | Create category |
| GET | `/api/v1/categories/getAll` | ❌ | Public | List categories |
| GET | `/api/v1/categories/getById/:id` | ❌ | Public | Single category |
| PATCH | `/api/v1/categories/updateCategory/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/categories/deleteCategory/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/categories/reorder` | ✅ | ADMIN | Drag sort |
| POST | `/api/v1/brands/createBrand` | ✅ | ADMIN | Create brand |
| GET | `/api/v1/brands/getAll` | ❌ | Public | List brands |
| GET | `/api/v1/brands/getById/:id` | ❌ | Public | Single brand |
| PATCH | `/api/v1/brands/updateBrand/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/brands/deleteBrand/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/tags/createTag` | ✅ | ADMIN | Create tag |
| GET | `/api/v1/tags/getAll` | ❌ | Public | List tags |
| DELETE | `/api/v1/tags/deleteTag/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/attributes/createAttribute` | ✅ | ADMIN | Create attribute |
| GET | `/api/v1/attributes/getAll` | ❌ | Public | List attributes |
| PATCH | `/api/v1/attributes/updateAttribute/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/attributes/deleteAttribute/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/collections/createCollection` | ✅ | ADMIN | Create collection |
| GET | `/api/v1/collections/getAll` | ❌ | Public | List collections |
| PATCH | `/api/v1/collections/updateCollection/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/collections/deleteCollection/:id` | ✅ | ADMIN | Delete |
| GET | `/api/v1/cart/getCart` | ✅ | CUSTOMER | View cart |
| POST | `/api/v1/cart/addItem` | ✅ | CUSTOMER | Add item |
| PATCH | `/api/v1/cart/updateItem` | ✅ | CUSTOMER | Update qty |
| DELETE | `/api/v1/cart/removeItem/:cartItemId` | ✅ | CUSTOMER | Remove item |
| DELETE | `/api/v1/cart/clearCart` | ✅ | CUSTOMER | Clear cart |
| POST | `/api/v1/cart/applyCoupon` | ✅ | CUSTOMER | Apply coupon |
| DELETE | `/api/v1/cart/removeCoupon` | ✅ | CUSTOMER | Remove coupon |
| POST | `/api/v1/cart/estimate` | ✅ | CUSTOMER | Pre-checkout totals |
| POST | `/api/v1/cart/mergeGuestCart` | ✅ | CUSTOMER | Merge after login |
| PATCH | `/api/v1/cart/updateItemOptions/:cartItemId` | ✅ | CUSTOMER | Gift wrap + per-item delivery note |
| GET | `/api/v1/cart/getSavedForLater` | ✅ | CUSTOMER | List saved-for-later |
| POST | `/api/v1/cart/saveForLater` | ✅ | CUSTOMER | Move a cart line aside |
| POST | `/api/v1/cart/savedForLater/:id/moveToCart` | ✅ | CUSTOMER | Move a saved line back |
| DELETE | `/api/v1/cart/savedForLater/:id` | ✅ | CUSTOMER | Drop a saved line |
| DELETE | `/api/v1/cart/savedForLater` | ✅ | CUSTOMER | Clear saved lines |
| GET | `/api/v1/priceWatches/getAll` | ✅ | CUSTOMER | List price watches |
| POST | `/api/v1/priceWatches/watch` | ✅ | CUSTOMER | Watch a product price |
| DELETE | `/api/v1/priceWatches/remove/:id` | ✅ | CUSTOMER | Stop watching |
| GET | `/api/v1/wishlist/getAll` | ✅ | CUSTOMER | List wishlist |
| POST | `/api/v1/wishlist/addItem` | ✅ | CUSTOMER | Add to wishlist |
| DELETE | `/api/v1/wishlist/removeItem/:id` | ✅ | CUSTOMER | Remove |
| DELETE | `/api/v1/wishlist/clear` | ✅ | CUSTOMER | Clear |
| POST | `/api/v1/wishlist/moveToCart/:id` | ✅ | CUSTOMER | Move to cart |
| POST | `/api/v1/orders/placeOrder` | ✅ | CUSTOMER | Place order |
| GET | `/api/v1/orders/getAll` | ✅ | CUSTOMER | My orders |
| GET | `/api/v1/orders/getById/:id` | ✅ | CUSTOMER | Order detail |
| POST | `/api/v1/orders/cancelOrder/:id` | ✅ | CUSTOMER | Cancel order |
| PATCH | `/api/v1/orders/updateStatus/:id` | ✅ | ADMIN | Update order status |
| GET | `/api/v1/orders/getVendorOrders` | ✅ | VENDOR | My sub-orders |
| PATCH | `/api/v1/orders/updateVendorStatus/:subOrderId` | ✅ | VENDOR | Update sub-order |
| GET | `/api/v1/orders/track/:id` | ❌ | Any | Live tracking |
| POST | `/api/v1/orders/reorder/:id` | ✅ | CUSTOMER | Re-order |
| GET | `/api/v1/orders/getInvoice/:id` | ✅ | CUSTOMER | Invoice PDF |
| GET | `/api/v1/orders/getPackingSlip/:id` | ✅ | VENDOR | Packing slip |
| GET | `/api/v1/orders/getShippingLabel/:subOrderId` | ✅ | VENDOR | Shipping label |
| PATCH | `/api/v1/orders/assignDeliveryBoy/:subOrderId` | ✅ | ADMIN | Assign |
| POST | `/api/v1/orders/verifyDeliveryOtp/:subOrderId` | ✅ | VENDOR/ADMIN | OTP confirm delivery |
| GET | `/api/v1/orders/getTimeline/:id` | ✅ | Any | Status history |
| POST | `/api/v1/orders/returnRequest/:id` | ✅ | CUSTOMER | Return request |
| PATCH | `/api/v1/orders/approveReturn/:returnId` | ✅ | VENDOR/ADMIN | Approve return |
| PATCH | `/api/v1/orders/rejectReturn/:returnId` | ✅ | VENDOR/ADMIN | Reject return |
| POST | `/api/v1/payments/payToken/:orderId` | ✅ | CUSTOMER | Pay token amount |
| POST | `/api/v1/payments/payBalance/:orderId` | ✅ | CUSTOMER | Pay balance |
| GET | `/api/v1/payments/getByOrder/:orderId` | ✅ | CUSTOMER | Payment info |
| POST | `/api/v1/payments/verifyUpi/:orderId` | ✅ | CUSTOMER | UPI reference |
| POST | `/api/v1/payments/verifyBank/:orderId` | ✅ | CUSTOMER | Bank slip |
| PATCH | `/api/v1/payments/markCodCollected/:orderId` | ✅ | VENDOR | COD collected |
| GET | `/api/v1/payments/getAll` | ✅ | ADMIN | All payments |
| PATCH | `/api/v1/payments/confirmPayment/:id` | ✅ | ADMIN | Manual confirm |
| POST | `/api/v1/payments/refund/:id` | ✅ | ADMIN | Refund |
| GET | `/api/v1/payments/getRefundHistory/:orderId` | ✅ | CUSTOMER | Refund history |
| POST | `/api/v1/payments/razorpay/createOrder` | ✅ | CUSTOMER | Razorpay init |
| POST | `/api/v1/payments/razorpay/verify` | ✅ | CUSTOMER | Verify signature |
| POST | `/api/v1/payments/stripe/createIntent` | ✅ | CUSTOMER | Stripe init |
| GET | `/api/v1/payments/methods` | ❌ | Public | Available methods |
| GET | `/api/v1/payments/walletBalance` | ✅ | CUSTOMER | Wallet balance |
| GET | `/api/v1/payouts/getVendorEarnings` | ✅ | VENDOR | My earnings |
| GET | `/api/v1/payouts/getAll` | ✅ | ADMIN | All payouts |
| PATCH | `/api/v1/payouts/approvePayout/:id` | ✅ | ADMIN | Approve payout |
| PATCH | `/api/v1/payouts/rejectPayout/:id` | ✅ | ADMIN | Reject payout |
| POST | `/api/v1/payouts/generateCycles` | ✅ | ADMIN | Batch calc |
| GET | `/api/v1/payouts/getSummary` | ✅ | ADMIN | Totals |
| GET | `/api/v1/payouts/getStatement/:vendorId` | ✅ | ADMIN | Statement PDF |
| POST | `/api/v1/payouts/bulkApprove` | ✅ | ADMIN | Bulk approve |
| GET | `/api/v1/payouts/getPendingAmount/:vendorId` | ✅ | VENDOR | Pending |
| PATCH | `/api/v1/payouts/updateStatus/:id` | ✅ | ADMIN | Generic update |
| POST | `/api/v1/returns/createRequest` | ✅ | CUSTOMER | Create return |
| GET | `/api/v1/returns/getAll` | ✅ | ADMIN/VENDOR | List |
| GET | `/api/v1/returns/getById/:id` | ✅ | Any | Detail |
| PATCH | `/api/v1/returns/approve/:id` | ✅ | ADMIN/VENDOR | Approve |
| PATCH | `/api/v1/returns/reject/:id` | ✅ | ADMIN/VENDOR | Reject |
| PATCH | `/api/v1/returns/markPickedUp/:id` | ✅ | VENDOR | Picked up |
| PATCH | `/api/v1/returns/markReceived/:id` | ✅ | VENDOR | Received |
| PATCH | `/api/v1/returns/processRefund/:id` | ✅ | ADMIN | Refund |
| GET | `/api/v1/returns/getReasons` | ❌ | Public | Reason list |
| POST | `/api/v1/returns/addReason` | ✅ | ADMIN | Add reason |
| POST | `/api/v1/reviews/addReview` | ✅ | CUSTOMER | Add review |
| GET | `/api/v1/reviews/getAll` | ❌ | Public | List reviews |
| PATCH | `/api/v1/reviews/updateReview/:id` | ✅ | CUSTOMER | Update own |
| DELETE | `/api/v1/reviews/deleteReview/:id` | ✅ | CUSTOMER | Delete own |
| PATCH | `/api/v1/reviews/approve/:id` | ✅ | ADMIN | Approve |
| PATCH | `/api/v1/reviews/reject/:id` | ✅ | ADMIN | Reject |
| POST | `/api/v1/reviews/voteHelpful/:id` | ✅ | Any | Helpful vote |
| POST | `/api/v1/reviews/reply/:id` | ✅ | VENDOR | Vendor reply |
| GET | `/api/v1/reviews/getSummary/:productId` | ❌ | Public | Rating breakdown |
| POST | `/api/v1/questions/ask` | ✅ | CUSTOMER | Ask question |
| POST | `/api/v1/questions/answer/:id` | ✅ | VENDOR | Answer |
| GET | `/api/v1/questions/getAll/:productId` | ❌ | Public | List Q&A |
| PATCH | `/api/v1/questions/approve/:id` | ✅ | ADMIN | Approve |
| DELETE | `/api/v1/questions/delete/:id` | ✅ | ADMIN/CUSTOMER | Delete |
| POST | `/api/v1/coupons/createCoupon` | ✅ | ADMIN | Create coupon |
| GET | `/api/v1/coupons/getAll` | ✅ | ADMIN | List coupons |
| GET | `/api/v1/coupons/getById/:id` | ✅ | ADMIN | Coupon detail |
| PATCH | `/api/v1/coupons/updateCoupon/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/coupons/deleteCoupon/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/coupons/validateCoupon` | ✅ | CUSTOMER | Validate code |
| POST | `/api/v1/coupons/applyCoupon` | ✅ | CUSTOMER | Apply coupon |
| GET | `/api/v1/coupons/getUsages/:id` | ✅ | ADMIN | Usage list |
| PATCH | `/api/v1/coupons/toggleStatus/:id` | ✅ | ADMIN | Enable/Disable |
| POST | `/api/v1/flashSales/create` | ✅ | ADMIN | Flash sale |
| GET | `/api/v1/flashSales/getActive` | ❌ | Public | Live sales |
| PATCH | `/api/v1/flashSales/update/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/flashSales/delete/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/banners/create` | ✅ | ADMIN | Create banner |
| GET | `/api/v1/banners/getAll` | ❌ | Public | Active banners |
| PATCH | `/api/v1/banners/update/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/banners/delete/:id` | ✅ | ADMIN | Delete |
| GET | `/api/v1/wallet/getBalance` | ✅ | CUSTOMER | Balance |
| GET | `/api/v1/wallet/getTransactions` | ✅ | CUSTOMER | History |
| POST | `/api/v1/wallet/addMoney` | ✅ | CUSTOMER | Top-up |
| POST | `/api/v1/wallet/useForOrder` | ✅ | CUSTOMER | Redeem at checkout |
| POST | `/api/v1/wallet/adminCredit` | ✅ | ADMIN | Manual credit |
| POST | `/api/v1/wallet/adminDebit` | ✅ | ADMIN | Manual debit |
| GET | `/api/v1/loyalty/getPoints` | ✅ | CUSTOMER | Points balance |
| GET | `/api/v1/loyalty/getHistory` | ✅ | CUSTOMER | Points history |
| POST | `/api/v1/loyalty/redeem` | ✅ | CUSTOMER | Redeem points |
| GET | `/api/v1/loyalty/getTiers` | ❌ | Public | Tier config |
| GET | `/api/v1/referral/getMyCode` | ✅ | CUSTOMER | My code |
| POST | `/api/v1/referral/applyCode` | ✅ | CUSTOMER | Apply code |
| GET | `/api/v1/referral/getRewards` | ✅ | CUSTOMER | My rewards |
| GET | `/api/v1/referral/getLeaderboard` | ✅ | CUSTOMER | Leaderboard |
| POST | `/api/v1/giftCards/create` | ✅ | ADMIN | Create gift card |
| GET | `/api/v1/giftCards/getAll` | ✅ | ADMIN | List |
| POST | `/api/v1/giftCards/redeem` | ✅ | CUSTOMER | Redeem |
| GET | `/api/v1/giftCards/checkBalance/:code` | ❌ | Public | Balance |
| PATCH | `/api/v1/giftCards/disable/:id` | ✅ | ADMIN | Disable |
| GET | `/api/v1/notifications/getAll` | ✅ | Any | List notifications |
| PATCH | `/api/v1/notifications/markRead/:id` | ✅ | Any | Mark read |
| PATCH | `/api/v1/notifications/markAllRead` | ✅ | Any | Mark all |
| DELETE | `/api/v1/notifications/delete/:id` | ✅ | Any | Delete |
| GET | `/api/v1/notifications/getUnreadCount` | ✅ | Any | Badge count |
| POST | `/api/v1/notifications/registerDevice` | ✅ | Any | Register FCM |
| POST | `/api/v1/notifications/unregisterDevice` | ✅ | Any | Remove FCM |
| GET | `/api/v1/notifications/getPreferences` | ✅ | Any | Preferences |
| PATCH | `/api/v1/notifications/updatePreferences` | ✅ | Any | Update prefs |
| POST | `/api/v1/notifications/sendBulk` | ✅ | ADMIN | Bulk push |
| GET | `/api/v1/notifications/getTemplates` | ✅ | ADMIN | Templates |
| POST | `/api/v1/notifications/createTemplate` | ✅ | ADMIN | Create template |
| PATCH | `/api/v1/notifications/updateTemplate/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/notifications/deleteTemplate/:id` | ✅ | ADMIN | Delete |
| GET | `/api/v1/chat/getConversations` | ✅ | Any | List threads |
| POST | `/api/v1/chat/startConversation` | ✅ | CUSTOMER | Start chat |
| GET | `/api/v1/chat/getMessages/:conversationId` | ✅ | Any | Messages |
| POST | `/api/v1/chat/sendMessage` | ✅ | Any | Send |
| PATCH | `/api/v1/chat/markRead/:conversationId` | ✅ | Any | Read |
| DELETE | `/api/v1/chat/deleteMessage/:id` | ✅ | Any | Delete |
| POST | `/api/v1/chat/blockUser/:userId` | ✅ | Any | Block |
| GET | `/api/v1/chat/getUnreadCount` | ✅ | Any | Badge |
| POST | `/api/v1/tickets/create` | ✅ | Any | Create ticket |
| GET | `/api/v1/tickets/getAll` | ✅ | Any | List |
| GET | `/api/v1/tickets/getById/:id` | ✅ | Any | Detail |
| POST | `/api/v1/tickets/reply/:id` | ✅ | Any | Reply |
| PATCH | `/api/v1/tickets/updateStatus/:id` | ✅ | ADMIN | Status |
| PATCH | `/api/v1/tickets/assign/:id` | ✅ | ADMIN | Assign |
| PATCH | `/api/v1/tickets/close/:id` | ✅ | Any | Close |
| DELETE | `/api/v1/tickets/delete/:id` | ✅ | ADMIN | Delete |
| GET | `/api/v1/tickets/getCategories` | ❌ | Public | Categories |
| GET | `/api/v1/cannedResponses/getAll` | ✅ | ADMIN | List canned responses |
| POST | `/api/v1/cannedResponses/create` | ✅ | ADMIN | Create canned response |
| PATCH | `/api/v1/cannedResponses/update/:id` | ✅ | ADMIN | Update canned response |
| DELETE | `/api/v1/cannedResponses/delete/:id` | ✅ | ADMIN | Delete canned response |
| POST | `/api/v1/pages/create` | ✅ | ADMIN | Create page |
| GET | `/api/v1/pages/getAll` | ❌ | Public | List pages |
| GET | `/api/v1/pages/getBySlug/:slug` | ❌ | Public | Detail |
| PATCH | `/api/v1/pages/update/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/pages/delete/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/blogs/create` | ✅ | ADMIN | Create blog |
| GET | `/api/v1/blogs/getAll` | ❌ | Public | List blogs |
| GET | `/api/v1/blogs/getBySlug/:slug` | ❌ | Public | Detail |
| PATCH | `/api/v1/blogs/update/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/blogs/delete/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/faqs/create` | ✅ | ADMIN | Create FAQ |
| GET | `/api/v1/faqs/getAll` | ❌ | Public | List FAQs |
| PATCH | `/api/v1/faqs/update/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/faqs/delete/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/contact/submit` | ❌ | Public | Contact form |
| GET | `/api/v1/contact/getAll` | ✅ | ADMIN | List submissions |
| POST | `/api/v1/newsletter/subscribe` | ❌ | Public | Subscribe |
| POST | `/api/v1/newsletter/unsubscribe` | ❌ | Public | Unsubscribe |
| GET | `/api/v1/newsletter/getAll` | ✅ | ADMIN | Subscribers |
| POST | `/api/v1/newsletter/sendCampaign` | ✅ | ADMIN | Blast |
| GET | `/api/v1/settings/getPublicSettings` | ❌ | Public | Public config |
| GET | `/api/v1/settings/getAll` | ✅ | ADMIN | All settings |
| PATCH | `/api/v1/settings/updateSetting` | ✅ | ADMIN | Update one |
| POST | `/api/v1/settings/bulkUpdateSettings` | ✅ | ADMIN | Bulk update |
| GET | `/api/v1/settings/getByCategory/:category` | ✅ | ADMIN | By category |
| POST | `/api/v1/settings/resetToDefault` | ✅ | SUPER_ADMIN | Reset |
| GET | `/api/v1/settings/getFeatureFlags` | ❌ | Public | Feature toggles |
| PATCH | `/api/v1/settings/toggleFeature` | ✅ | ADMIN | Toggle |
| GET | `/api/v1/settings/getMaintenance` | ❌ | Public | Maintenance status |
| PATCH | `/api/v1/settings/updateMaintenance` | ✅ | SUPER_ADMIN | Toggle |
| GET | `/api/v1/admin/getDashboardStats` | ✅ | ADMIN | Dashboard metrics |
| POST | `/api/v1/admin/createSubAdmin` | ✅ | SUPER_ADMIN | Create sub-admin |
| GET | `/api/v1/admin/getAllSubAdmins` | ✅ | SUPER_ADMIN | List sub-admins |
| PATCH | `/api/v1/admin/updateSubAdmin/:id` | ✅ | SUPER_ADMIN | Update |
| DELETE | `/api/v1/admin/deleteSubAdmin/:id` | ✅ | SUPER_ADMIN | Delete |
| PATCH | `/api/v1/admin/toggleSubAdminStatus/:id` | ✅ | SUPER_ADMIN | Active/Suspend |
| GET | `/api/v1/admin/getPermissions` | ✅ | ADMIN | All permissions |
| PATCH | `/api/v1/admin/updatePermissions/:id` | ✅ | SUPER_ADMIN | Set perms |
| GET | `/api/v1/admin/getAuditLogs` | ✅ | ADMIN | Audit logs |
| GET | `/api/v1/admin/getActivityLogs` | ✅ | ADMIN | Activity |
| GET | `/api/v1/admin/getSystemHealth` | ✅ | SUPER_ADMIN | DB/Redis/Queue |
| POST | `/api/v1/admin/clearCache` | ✅ | SUPER_ADMIN | Flush Redis |
| GET | `/api/v1/admin/getCronJobs` | ✅ | SUPER_ADMIN | Job list |
| POST | `/api/v1/admin/triggerJob` | ✅ | SUPER_ADMIN | Manual run |
| GET | `/api/v1/admin/getFailedJobs` | ✅ | SUPER_ADMIN | Dead letter queue |
| POST | `/api/v1/admin/retryFailedJob/:id` | ✅ | SUPER_ADMIN | Replay a failed job |
| PATCH | `/api/v1/admin/resolveFailedJob/:id` | ✅ | SUPER_ADMIN | Close without replay |
| DELETE | `/api/v1/admin/deleteFailedJob/:id` | ✅ | SUPER_ADMIN | Drop the row |
| GET | `/api/v1/analytics/getOverview` | ✅ | ADMIN | KPIs |
| GET | `/api/v1/analytics/getVisitors` | ✅ | ADMIN | Visitor stats |
| GET | `/api/v1/analytics/getUniqueVisitors` | ✅ | ADMIN | UV |
| GET | `/api/v1/analytics/getPageViews` | ✅ | ADMIN | PV |
| GET | `/api/v1/analytics/getTopPages` | ✅ | ADMIN | Top pages |
| GET | `/api/v1/analytics/getTrafficSources` | ✅ | ADMIN | Traffic |
| GET | `/api/v1/analytics/getDeviceBreakdown` | ✅ | ADMIN | Device/OS |
| GET | `/api/v1/analytics/getGeoBreakdown` | ✅ | ADMIN | Geo |
| GET | `/api/v1/analytics/getSessions` | ✅ | ADMIN | Sessions |
| GET | `/api/v1/analytics/getSessionDetail/:id` | ✅ | ADMIN | Journey |
| GET | `/api/v1/analytics/getFunnel` | ✅ | ADMIN | Funnel |
| GET | `/api/v1/analytics/getConversions` | ✅ | ADMIN | Conversions |
| GET | `/api/v1/analytics/getRevenueReport` | ✅ | ADMIN | Revenue |
| GET | `/api/v1/analytics/getProductPerformance` | ✅ | VENDOR/ADMIN | Product KPIs |
| GET | `/api/v1/analytics/getVendorPerformance` | ✅ | ADMIN | Vendor KPIs |
| GET | `/api/v1/analytics/getCustomerCohorts` | ✅ | ADMIN | Retention |
| GET | `/api/v1/analytics/getAbandonedCarts` | ✅ | ADMIN | Abandoned |
| GET | `/api/v1/analytics/getSearchTerms` | ✅ | ADMIN | Top searches |
| GET | `/api/v1/analytics/getZeroResultSearches` | ✅ | ADMIN | Missed searches |
| GET | `/api/v1/analytics/getRealtime` | ✅ | ADMIN | Live users |
| GET | `/api/v1/analytics/getCrashes` | ✅ | ADMIN | Crash reports |
| GET | `/api/v1/analytics/getAppVersions` | ✅ | ADMIN | Version dist |
| GET | `/api/v1/analytics/export` | ✅ | ADMIN | CSV export |
| POST | `/api/v1/track/event` | ❌ | Any | Generic event |
| POST | `/api/v1/track/pageView` | ❌ | Any | Page view |
| POST | `/api/v1/track/session/start` | ❌ | Any | Session start |
| POST | `/api/v1/track/session/end` | ❌ | Any | Session end |
| POST | `/api/v1/track/device` | ❌ | Any | Register device |
| POST | `/api/v1/track/appInstall` | ❌ | Public | App install |
| POST | `/api/v1/track/appOpen` | ❌ | Any | App open |
| POST | `/api/v1/track/crash` | ❌ | Any | Crash report |
| POST | `/api/v1/track/performance` | ❌ | Any | Perf metrics |
| POST | `/api/v1/track/error` | ❌ | Any | JS/API error |
| POST | `/api/v1/track/funnel` | ❌ | Any | Funnel step |
| POST | `/api/v1/track/conversion` | ❌ | Any | Conversion |
| POST | `/api/v1/track/click` | ❌ | Any | Click |
| POST | `/api/v1/track/scroll` | ❌ | Any | Scroll depth |
| POST | `/api/v1/track/search` | ❌ | Any | Search |
| POST | `/api/v1/track/utm` | ❌ | Any | UTM |
| POST | `/api/v1/track/referrer` | ❌ | Any | Referrer |
| POST | `/api/v1/track/heartbeat` | ❌ | Any | Keep alive |
| GET | `/api/v1/devices/getAll` | ✅ | ADMIN | All devices |
| GET | `/api/v1/devices/getById/:id` | ✅ | ADMIN | Detail |
| GET | `/api/v1/devices/getByUser/:userId` | ✅ | ADMIN | User devices |
| PATCH | `/api/v1/devices/block/:id` | ✅ | ADMIN | Block |
| PATCH | `/api/v1/devices/unblock/:id` | ✅ | ADMIN | Unblock |
| DELETE | `/api/v1/devices/delete/:id` | ✅ | ADMIN | Delete |
| GET | `/api/v1/devices/getTrusted` | ✅ | Any | My trusted |
| PATCH | `/api/v1/devices/trust/:id` | ✅ | Any | Trust |
| PATCH | `/api/v1/devices/untrust/:id` | ✅ | Any | Untrust |
| GET | `/api/v1/reports/sales` | ✅ | ADMIN | Sales |
| GET | `/api/v1/reports/orders` | ✅ | ADMIN | Orders |
| GET | `/api/v1/reports/products` | ✅ | VENDOR/ADMIN | Products |
| GET | `/api/v1/reports/customers` | ✅ | ADMIN | Customers |
| GET | `/api/v1/reports/vendors` | ✅ | ADMIN | Vendors |
| GET | `/api/v1/reports/payouts` | ✅ | ADMIN | Payouts |
| GET | `/api/v1/reports/tax` | ✅ | ADMIN | GST |
| GET | `/api/v1/reports/inventory` | ✅ | VENDOR | Stock |
| GET | `/api/v1/reports/returns` | ✅ | ADMIN | Returns |
| GET | `/api/v1/reports/export/:type` | ✅ | ADMIN | CSV/XLSX |
| POST | `/api/v1/reports/schedule` | ✅ | ADMIN | Schedule email |
| GET | `/api/v1/shipping/getZones` | ✅ | ADMIN | Zones |
| POST | `/api/v1/shipping/createZone` | ✅ | ADMIN | Create zone |
| PATCH | `/api/v1/shipping/updateZone/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/shipping/deleteZone/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/shipping/createMethod` | ✅ | ADMIN | Method |
| GET | `/api/v1/shipping/getMethods` | ❌ | Public | Methods |
| PATCH | `/api/v1/shipping/updateMethod/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/shipping/deleteMethod/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/shipping/checkServiceability` | ❌ | Public | Pincode check |
| POST | `/api/v1/shipping/calculateRate` | ✅ | CUSTOMER | Rate calc |
| POST | `/api/v1/shipping/createPartner` | ✅ | ADMIN | Partner |
| GET | `/api/v1/shipping/getPartners` | ✅ | ADMIN | List |
| POST | `/api/v1/shipping/createShipment/:subOrderId` | ✅ | VENDOR | Create |
| GET | `/api/v1/shipping/track/:awb` | ❌ | Any | Track |
| PATCH | `/api/v1/shipping/updateStatus/:id` | ✅ | VENDOR/ADMIN | Update |
| GET | `/api/v1/deliveryBoys/getAll` | ✅ | ADMIN | List boys |
| POST | `/api/v1/deliveryBoys/create` | ✅ | ADMIN | Create |
| PATCH | `/api/v1/deliveryBoys/update/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/deliveryBoys/delete/:id` | ✅ | ADMIN | Delete |
| PATCH | `/api/v1/deliveryBoys/toggleStatus/:id` | ✅ | ADMIN | Active |
| GET | `/api/v1/deliveryBoys/getMyDeliveries` | ✅ | DELIVERY_BOY | Assigned |
| PATCH | `/api/v1/deliveryBoys/updateDeliveryStatus/:id` | ✅ | DELIVERY_BOY | Update |
| GET | `/api/v1/search/global` | ❌ | Public | Multi-entity |
| GET | `/api/v1/search/autocomplete` | ❌ | Public | Suggestions |
| GET | `/api/v1/search/products` | ❌ | Public | Product search |
| GET | `/api/v1/search/vendors` | ❌ | Public | Vendor search |
| GET | `/api/v1/search/trending` | ❌ | Public | Trending |
| GET | `/api/v1/search/recent` | ✅ | Any | Recent |
| DELETE | `/api/v1/search/recent/clear` | ✅ | Any | Clear |
| POST | `/api/v1/bulk/importProducts` | ✅ | VENDOR | CSV import |
| POST | `/api/v1/bulk/importOrders` | ✅ | ADMIN | Bulk orders |
| POST | `/api/v1/bulk/importUsers` | ✅ | ADMIN | Bulk users |
| GET | `/api/v1/bulk/getJobStatus/:jobId` | ✅ | Any | Job status |
| GET | `/api/v1/bulk/getJobHistory` | ✅ | Any | History |
| POST | `/api/v1/apiKeys/create` | ✅ | ADMIN | Create key |
| GET | `/api/v1/apiKeys/getAll` | ✅ | ADMIN | List |
| PATCH | `/api/v1/apiKeys/revoke/:id` | ✅ | ADMIN | Revoke |
| DELETE | `/api/v1/apiKeys/delete/:id` | ✅ | ADMIN | Delete |
| GET | `/api/v1/apiKeys/getUsage/:id` | ✅ | ADMIN | Usage |
| GET | `/api/v1/i18n/getTranslations/:locale` | ❌ | Public | Strings |
| GET | `/api/v1/i18n/getLocales` | ❌ | Public | Supported |
| POST | `/api/v1/i18n/create` | ✅ | ADMIN | Create |
| PATCH | `/api/v1/i18n/update/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/i18n/delete/:id` | ✅ | ADMIN | Delete |
| POST | `/api/v1/i18n/bulkUpsert` | ✅ | ADMIN | Bulk |
| GET | `/api/v1/currencies/getAll` | ❌ | Public | Currencies |
| POST | `/api/v1/currencies/create` | ✅ | ADMIN | Create |
| PATCH | `/api/v1/currencies/update/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/currencies/delete/:id` | ✅ | ADMIN | Delete |
| GET | `/api/v1/tax/getConfigs` | ✅ | ADMIN | Tax rules |
| POST | `/api/v1/tax/create` | ✅ | ADMIN | Create |
| PATCH | `/api/v1/tax/update/:id` | ✅ | ADMIN | Update |
| DELETE | `/api/v1/tax/delete/:id` | ✅ | ADMIN | Delete |
| GET | `/api/v1/countries/getAll` | ❌ | Public | Countries |
| GET | `/api/v1/countries/getStates/:countryCode` | ❌ | Public | States |
| GET | `/api/v1/countries/getCities/:stateCode` | ❌ | Public | Cities |
| POST | `/api/v1/countries/checkPincode` | ❌ | Public | Serviceability |
| POST | `/api/v1/uploads/uploadImage` | ✅ | Any | Upload image |
| POST | `/api/v1/uploads/uploadVideo` | ✅ | Any | Upload video |
| POST | `/api/v1/uploads/uploadDocument` | ✅ | Any | Upload doc |
| POST | `/api/v1/uploads/uploadMultiple` | ✅ | Any | Bulk |
| POST | `/api/v1/uploads/deleteFile` | ✅ | Any | Delete |
| GET | `/api/v1/uploads/getSignedUrl` | ✅ | Any | Direct upload |
| POST | `/api/v1/webhooks/razorpay` | Signature | Webhook | Razorpay |
| POST | `/api/v1/webhooks/shipping` | Signature | Webhook | Shipping |
| POST | `/api/v1/webhooks/payment-gateway/:provider` | Signature | Webhook | Generic |
| GET | `/api/v1/webhooks/getLogs` | ✅ | ADMIN | Incoming log |
| POST | `/api/v1/webhooks/register` | ✅ | ADMIN | Outgoing URL |
| GET | `/api/v1/webhooks/getAll` | ✅ | ADMIN | List |
| DELETE | `/api/v1/webhooks/delete/:id` | ✅ | ADMIN | Delete |
| GET | `/api/v1/auditLogs/getAll` | ✅ | ADMIN | List |
| GET | `/api/v1/auditLogs/getById/:id` | ✅ | ADMIN | Detail |
| GET | `/api/v1/auditLogs/getByActor/:userId` | ✅ | ADMIN | Actor logs |
| GET | `/api/v1/auditLogs/export` | ✅ | ADMIN | CSV |
| DELETE | `/api/v1/auditLogs/purge` | ✅ | SUPER_ADMIN | Purge old |
| GET | `/api/v1/health/db` | ❌ | Public | DB check |
| GET | `/api/v1/health/redis` | ❌ | Public | Redis check |
| GET | `/api/v1/health/queue` | ❌ | Public | Queue check |
| GET | `/api/v1/activityLogs/getAll` | ✅ | ADMIN | List activity logs |
| GET | `/api/v1/analytics/funnels` | ✅ | ADMIN | List funnels |
| POST | `/api/v1/analytics/funnels` | ✅ | ADMIN | Create funnel |
| PATCH | `/api/v1/analytics/funnels/:id` | ✅ | ADMIN | Update funnel |
| GET | `/api/v1/attributes/getById/:id` | ❌ | Public | Single attribute |
| POST | `/api/v1/auth/sendOtp` | ❌ | Public | Send OTP — `type: REGISTER\|FORGOT_PASSWORD\|LOGIN\|PHONE_VERIFY\|EMAIL_VERIFY\|TWO_FA` |
| POST | `/api/v1/auth/changeEmail/sendOtp` | ✅ | Any | Send OTP — `type: EMAIL_CHANGE\|PHONE_CHANGE` |
| GET | `/api/v1/brands/getBySlug/:slug` | ❌ | Public | Brand by slug |
| POST | `/api/v1/categories/bulkCreate` | ✅ | ADMIN | Bulk create |
| GET | `/api/v1/categories/getBySlug/:slug` | ❌ | Public | Category by slug |
| GET | `/api/v1/chat/getBlocked` | ✅ | Any | Blocked users |
| POST | `/api/v1/chat/unblock/:id` | ✅ | Any | Remove block |
| GET | `/api/v1/collections/getById/:id` | ❌ | Public | Single collection |
| GET | `/api/v1/collections/getBySlug/:slug` | ❌ | Public | Collection by slug |
| GET | `/api/v1/collections/getProducts/:id` | ❌ | Public | Collection products |
| POST | `/api/v1/collections/setProducts/:id` | ✅ | Any | Replace products |
| PATCH | `/api/v1/contact/:id/markRead` | ✅ | ADMIN | Mark read |
| GET | `/api/v1/content/dropdowns` | ❌ | Public | List dropdowns |
| DELETE | `/api/v1/content/dropdowns/:id/delete` | ✅ | ADMIN | Delete |
| PATCH | `/api/v1/content/dropdowns/:id/update` | ✅ | ADMIN | Update |
| POST | `/api/v1/content/dropdowns/create` | ✅ | ADMIN | Create |
| POST | `/api/v1/countries/seedCountries` | ✅ | ADMIN | Seed reference data |
| GET | `/api/v1/currencies/convert` | ❌ | Public | Convert amount |
| GET | `/api/v1/docs/docs.json` | ✅ | Any | OpenAPI JSON |
| GET | `/api/v1/flashSales/getAll` | ✅ | ADMIN | List flash sales |
| GET | `/api/v1/flashSales/getBySlug/:slug` | ❌ | Public | Flash sale by slug |
| DELETE | `/api/v1/giftCards/delete/:id` | ✅ | ADMIN | Delete |
| GET | `/api/v1/health/jobs/:jobId` | ✅ | Any | Job state |
| POST | `/api/v1/loyalty/adjust/:userId` | ✅ | ADMIN | Adjust points |
| GET | `/api/v1/referral/admin/getAll` | ✅ | ADMIN | All referrals |
| POST | `/api/v1/referral/complete/:id` | ✅ | ADMIN | Mark complete |
| PATCH | `/api/v1/referral/updateStatus/:id` | ✅ | ADMIN | Update status |
| GET | `/api/v1/reports/getSchedules` | ✅ | ADMIN | Schedule list |
| DELETE | `/api/v1/reports/schedule/:id/delete` | ✅ | ADMIN | Delete schedule |
| PATCH | `/api/v1/reports/schedule/:id/update` | ✅ | ADMIN | Update schedule |
| PATCH | `/api/v1/shipping/updatePartner/:id` | ✅ | ADMIN | Update partner |
| POST | `/api/v1/tags/bulkCreate` | ✅ | Any | Bulk create |
| DELETE | `/api/v1/templates/email/:key/delete` | ✅ | ADMIN | Delete |
| POST | `/api/v1/templates/email/:key/render` | ✅ | ADMIN | Render with values |
| GET | `/api/v1/templates/email/getAll` | ✅ | ADMIN | List email templates |
| POST | `/api/v1/templates/email/upsert` | ✅ | ADMIN | Create or update |
| DELETE | `/api/v1/templates/notification/:key/delete` | ✅ | ADMIN | Delete |
| POST | `/api/v1/templates/notification/:key/render` | ✅ | ADMIN | Render with values |
| GET | `/api/v1/templates/notification/getAll` | ✅ | ADMIN | List notification templates |
| POST | `/api/v1/templates/notification/upsert` | ✅ | ADMIN | Create or update |
| DELETE | `/api/v1/templates/sms/:key/delete` | ✅ | ADMIN | Delete |
| POST | `/api/v1/templates/sms/:key/render` | ✅ | ADMIN | Render with values |
| GET | `/api/v1/templates/sms/getAll` | ✅ | ADMIN | List SMS templates |
| POST | `/api/v1/templates/sms/upsert` | ✅ | ADMIN | Create or update |
| POST | `/api/v1/tickets/categories` | ✅ | ADMIN | Create ticket category |
| GET | `/api/v1/tickets/getStats` | ✅ | ADMIN | Ticket counts by status |
| POST | `/api/v1/uploads/uploadImage/single` | ✅ | Any | Single file upload |
| PATCH | `/api/v1/users/updateAvatar` | ❌ | Public | Change avatar |
| POST | `/api/v1/webhooks/:id/rotateSecret` | ✅ | ADMIN | Rotate secret |
| PATCH | `/api/v1/webhooks/:id/update` | ✅ | ADMIN | Update |
| GET | `/api/v1/wishlist/checkProduct/:productId` | ✅ | Any | Is wishlisted |

---

---

## Sample Request / Response Pairs

### Register — Customer

Teen step. Pehle contact prove karo, phir us proof ke against account banao.

**Step 1 — code bhejo**

```
POST /api/v1/auth/register/sendOtp
Content-Type: application/json

{
  "identifier": "ravi@example.com"
}
```

`200 OK`

```json
{
  "status": true,
  "message": "OTP sent successfully.",
  "result": {
    "identifier": "ravi@example.com",
    "channel": "EMAIL",
    "expiresIn": 600,
    "otpLength": 6,
    "isNewUser": true
  }
}
```

**Step 2 — code verify karo**

```
POST /api/v1/auth/register/verifyOtp
Content-Type: application/json

{
  "identifier": "ravi@example.com",
  "otp": "123456"
}
```

`200 OK`

```json
{
  "status": true,
  "message": "OTP verified successfully.",
  "result": {
    "verificationToken": "9f2a41c7...",
    "expiresIn": 900,
    "identifier": "ravi@example.com",
    "otpLength": 6
  }
}
```

**Step 3 — details bhejo aur account banao**

```
POST /api/v1/auth/register
Content-Type: application/json

{
  "type": "CUSTOMER",
  "name": "Ravi Kumar",
  "email": "ravi@example.com",
  "phone": "+919876543210",
  "password": "Secret@123",
  "verificationToken": "9f2a41c7..."
}
```

`201 Created`

```json
{
  "status": true,
  "message": "Customer registered successfully.",
  "result": {
    "accessToken": "eyJhbGc...",
    "expiresIn": 900,
    "userData": {
      "userId": "usr_1",
      "name": "Ravi Kumar",
      "email": "ravi@example.com",
      "phone": "+919876543210",
      "isActive": true,
      "isEmailVerified": true,
      "isPhoneVerified": false
    },
    "rolesList": ["CUSTOMER"]
  }
}
```

**Note:** Step 2 sirf code check karta hai — koi account nahi banta, koi session nahi
milti. `verificationToken` hi step 3 ka permission hai, aur wo do cheezein apne
saath bind karta hai: **kaunsa contact** prove hua (step 3 me jo `email` ya `phone`
bheja jaye usi se match hona chahiye, warna `400`
`VERIFICATION_IDENTIFIER_MISMATCH`) aur **kis purpose** ke liye tha (register ka
token login nahi kar sakta). Token ek hi baar chalta hai — dobara bhejne pe `401`
`VERIFICATION_INVALID`, chahe pehli baar kuch bhi hua ho.

Sirf wahi contact `isVerified` mark hota hai jiska code aaya tha: email se register
kiya to `isPhoneVerified` false rahega. Doosre contact ko baad me
`POST /auth/verifyPhone` se verify karna padta hai.

Register ka row tabhi banta hai jab token valid ho. `OTP_REQUIRED=false` pe token
ki zaroorat nahi, tab account turant ban jaata hai aur `isVerified` flags false
rehte hain.

### Register — Vendor

Vendor ke liye bhi wahi teen step, bas step 3 me `shopName` add hota hai.

```
POST /api/v1/auth/register/sendOtp
{ "identifier": "ravi@example.com" }
```

```
POST /api/v1/auth/register/verifyOtp
{ "identifier": "ravi@example.com", "otp": "123456" }
```

```
POST /api/v1/auth/register
Content-Type: application/json

{
  "type": "VENDOR",
  "name": "Ravi Kumar",
  "email": "ravi@example.com",
  "phone": "+919876543210",
  "password": "Secret@123",
  "verificationToken": "9f2a41c7...",
  "shopName": "Ravi Store",
  "slug": "ravi-store"
}
```

`201 Created`

```json
{
  "status": true,
  "message": "Vendor registered successfully.",
  "result": {
    "accessToken": "eyJhbGc...",
    "expiresIn": 900,
    "userData": {
      "userId": "usr_1",
      "name": "Ravi Kumar",
      "email": "ravi@example.com",
      "phone": "+919876543210",
      "isActive": true
    },
    "vendorData": {
      "vendorId": "v_1",
      "shopName": "Ravi Store",
      "slug": "ravi-store",
      "status": "PENDING"
    },
    "rolesList": ["VENDOR"]
  }
}
```

Refresh token → HttpOnly cookie (`Set-Cookie: refreshToken=...; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`)

**Note:** Agar `vendor.autoApprove = true` ho, `vendorData.status = "APPROVED"` aa jayega. Warna vendor product create nahi kar sakta (403 `VENDOR_NOT_APPROVED`).

### Login — Password

Ek call. User email/phone + password bhejta hai, server seedha session de deta hai.

```
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "ravi@example.com",
  "password": "Secret@123"
}
```

`200 OK`

```json
{
  "status": true,
  "message": "Logged in successfully.",
  "result": {
    "accessToken": "eyJhbGc...",
    "expiresIn": 900,
    "twoFactorRequired": false,
    "userData": {
      "userId": "usr_1",
      "name": "Ravi Kumar",
      "email": "ravi@example.com",
      "rolesList": ["CUSTOMER"]
    }
  }
}
```

Refresh token → HttpOnly cookie, same register jaisa.

`email` ya `phone` — dono chalte hain, jo bhi bhejo.

**Note:** Ye endpoint sirf password leta hai. `otp` ya `type` field isme nahi
hote — OTP login ke liye 6.1d use karo. `twoFactorRequired: true` aaye to
response me tokens empty honge aur `twoFactorToken` milega, jise
`POST /auth/verify2FA` par bhejna hoga.

`revokedSessionCount` batata hai ki `security.maxActiveSessions` cap cross karne
par kitni purani sessions band hui. `0` default hai. Rules
[Account Security Rules](#account-security-rules) me hain.

### Login — OTP

Do step. Pehle contact prove karo, usi call me login ho jaata hai.

**Step 1 — code bhejo**

```
POST /api/v1/auth/sendOtp
Content-Type: application/json

{
  "type": "LOGIN",
  "channel": "EMAIL",
  "identifier": "ravi@example.com"
}
```

`200 OK`

```json
{
  "status": true,
  "result": {
    "identifier": "ravi@example.com",
    "channel": "EMAIL",
    "expiresIn": 600,
    "otpLength": 6,
    "isNewUser": false
  }
}
```

**Step 2 — code verify karo aur login ho jao**

```
POST /api/v1/auth/login/verifyOtp
Content-Type: application/json

{
  "identifier": "ravi@example.com",
  "otp": "123456"
}
```

`200 OK`

```json
{
  "status": true,
  "message": "Logged in successfully.",
  "result": {
    "accessToken": "eyJhbGc...",
    "expiresIn": 900,
    "twoFactorRequired": false,
    "userData": {
      "userId": "usr_1",
      "name": "Ravi Kumar",
      "email": "ravi@example.com",
      "rolesList": ["CUSTOMER"]
    }
  }
}
```

Refresh token → HttpOnly cookie.

**Note:** Ye do step me hota hai, teen me nahi. Code aur session ek hi request me
aate hain, isliye beech me identifier badalne ka koi mauka hi nahi hota — session
hamesha usi contact ke liye banti hai jiska code verify hua. Isiliye yahan
`verificationToken` ki zaroorat nahi; wo sirf register me chahiye, kyunki wahan
details ek alag request me aati hain.

Code single-use hai — wahi code dobara bhejne pe `401 OTP_INVALID` milega.

### List Categories (Simple Paginated)

```
GET /api/v1/categories/getAll?page=1&limit=20
```

`200 OK`

```json
{
  "status": true,
  "message": "Categories retrieved successfully.",
  "result": {
    "totalRecord": 5,
    "totalPage": 1,
    "currentPage": 1,
    "limit": 20,
    "hasNext": false,
    "hasPrevious": false,
    "nextPage": 0,
    "previousPage": 0,
    "categoryList": []
  }
}
```

### List Products (With Filters + Pagination)

```
GET /api/v1/products/getAll?page=1&limit=20&sort=-createdAt&search=shirt&category=men&minPrice=100&maxPrice=2000
```

`200 OK`

```json
{
  "status": true,
  "message": "Products fetched successfully.",
  "result": {
    "totalRecord": 145,
    "totalPage": 8,
    "currentPage": 1,
    "limit": 20,
    "hasNext": true,
    "hasPrevious": false,
    "nextPage": 2,
    "previousPage": 0,
    "filterData": {
      "search": "shirt",
      "category": "men",
      "minPrice": 100,
      "maxPrice": 2000
    },
    "productList": [
      {
        "productId": "prod_1",
        "name": "Blue Shirt",
        "price": 799,
        "stock": 25,
        "isActive": true,
        "categoryData": { "categoryId": "cat_1", "name": "Men" },
        "vendorData": { "vendorId": "v_1", "shopName": "Ravi Store" },
        "imageList": ["url1.jpg"],
        "reviewList": []
      }
    ]
  }
}
```

### Validation Error

```
POST /api/v1/auth/register
{ "type": "CUSTOMER", "email": "not-an-email" }
```

`400 Bad Request`

```json
{
  "status": false,
  "message": "Please enter a valid email address. Error Code (VALIDATION_ERROR)",
  "result": {}
}
```

### Not Found

```
GET /api/v1/products/getById/unknown-id
```

`404 Not Found`

```json
{
  "status": false,
  "message": "Product not found. Error Code (NOT_FOUND)",
  "result": {}
}
```

### Order Place (Multi-Vendor Split)

```json
{
  "status": true,
  "message": "Order placed successfully.",
  "result": {
    "orderId": "ord_1",
    "total": 1598,
    "status": "PENDING",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "addressData": {
      "line1": "123 Main St",
      "city": "Delhi",
      "pincode": "110001"
    },
    "subOrderList": [
      {
        "subOrderId": "sub_1",
        "vendorId": "v_1",
        "subtotal": 799,
        "commission": 79.9,
        "vendorEarning": 719.1,
        "status": "PENDING",
        "itemList": [{ "productId": "p_1", "qty": 1, "price": 799 }]
      },
      {
        "subOrderId": "sub_2",
        "vendorId": "v_2",
        "subtotal": 799,
        "commission": 79.9,
        "vendorEarning": 719.1,
        "status": "PENDING",
        "itemList": [{ "productId": "p_2", "qty": 1, "price": 799 }]
      }
    ]
  }
}
```

Note: `subOrderList` list hai but pagination nahi chahiye (single order ki hai).

### Track Event (Client → Server)

```
POST /api/v1/track/event
Content-Type: application/json

{
  "eventName": "add_to_cart",
  "eventData": { "productId": "prod_1", "qty": 2, "price": 799 },
  "sessionId": "sess_abc",
  "userId": "usr_1",
  "pageUrl": "/products/blue-shirt",
  "referrer": "https://google.com",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "deviceData": {
    "deviceId": "dev_uuid",
    "platform": "ANDROID",
    "os": "Android",
    "osVersion": "13.0",
    "browser": "",
    "browserVersion": "",
    "model": "Pixel 7",
    "manufacturer": "Google",
    "screenWidth": 1080,
    "screenHeight": 2340,
    "locale": "en-IN",
    "timezone": "Asia/Kolkata",
    "appVersion": "1.2.3"
  }
}
```

`200 OK`

```json
{
  "status": true,
  "message": "Event tracked successfully.",
  "result": {
    "eventId": "evt_1",
    "receivedAt": "2025-01-15T10:30:01.000Z"
  }
}
```

### Analytics Overview

```
GET /api/v1/analytics/getOverview?from=2025-01-01&to=2025-01-31
```

`200 OK`

```json
{
  "status": true,
  "message": "Analytics overview fetched.",
  "result": {
    "totalUsers": 12000,
    "newUsers": 850,
    "totalOrders": 3200,
    "totalRevenue": 4560000,
    "averageOrderValue": 1425.0,
    "conversionRate": 3.45,
    "visitorsData": {
      "uniqueVisitors": 45000,
      "pageViews": 180000,
      "sessions": 62000,
      "bounceRate": 42.5,
      "avgSessionDuration": 245
    },
    "deviceBreakdownData": {
      "android": 55.2,
      "ios": 28.7,
      "web": 16.1
    },
    "topPagesList": [
      { "pageUrl": "/", "views": 45000 },
      { "pageUrl": "/products", "views": 32000 }
    ],
    "topCountriesList": [
      { "country": "IN", "visitors": 40000 },
      { "country": "US", "visitors": 3000 }
    ]
  }
}
```

### Device Registration

```
POST /api/v1/track/device
Content-Type: application/json

{
  "deviceId": "dev_uuid",
  "platform": "IOS",
  "os": "iOS",
  "osVersion": "17.2",
  "model": "iPhone 15",
  "manufacturer": "Apple",
  "appVersion": "1.2.3",
  "fcmToken": "fcm_token_here",
  "locale": "en-IN",
  "timezone": "Asia/Kolkata"
}
```

`200 OK`

```json
{
  "status": true,
  "message": "Device registered.",
  "result": {
    "deviceId": "dev_uuid",
    "isTrusted": false,
    "registeredAt": "2025-01-15T10:30:00.000Z"
  }
}
```

---

---

## Configuration & Default Values

### App Defaults — `src/config/app.config.ts`

```tsx
export const APP = {
  NAME: 'projectname',
  API_PREFIX: '/api/v1',
  DEFAULT_PORT: 5000,
  DEFAULT_LOCALE: 'en',
  DEFAULT_TIMEZONE: 'Asia/Kolkata',
  DEFAULT_CURRENCY: 'INR',
  DEFAULT_DATE_FORMAT: 'DD-MM-YYYY',
  DEFAULT_TIME_FORMAT: 'hh:mm A',
  REQUEST_TIMEOUT_MS: 30_000,
  BODY_LIMIT: '1mb',
  JSON_LIMIT: '1mb',
  URLENCODED_LIMIT: '1mb',
};
```

### Pagination — `src/config/pagination.config.ts`

```tsx
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
  SORT_DEFAULT: '-createdAt',
  ALLOWED_SORTS: ['createdAt', 'updatedAt', 'price', 'name', 'rating', 'soldCount'],
};
```

### JWT — `src/config/jwt.config.ts`

```tsx
export const JWT = {
  ACCESS_EXPIRY: '15m',
  REFRESH_EXPIRY: '7d',
  ACCESS_SECRET: process.env.JWT_ACCESS_SECRET!,
  REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
  ISSUER: 'projectname-api',
  AUDIENCE: 'projectname-clients',
  REFRESH_COOKIE_NAME: 'refreshToken',
  REFRESH_COOKIE_OPTIONS: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth',
  },
};
```

### Password — `src/config/password.config.ts`

```tsx
export const PASSWORD = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 64,
  REQUIRE_UPPERCASE: true,
  REQUIRE_LOWERCASE: true,
  REQUIRE_NUMBER: true,
  REQUIRE_SPECIAL: true,
  BCRYPT_ROUNDS: 12,
  RESET_TOKEN_EXPIRY_MIN: 30,
  CONTACT_CHANGE_COOLDOWN_MIN: 10,
};

export const WARRANTY = {
  MAX_MONTHS: 120,
  MAX_TAGS_PER_ORDER: 20,
  MAX_TAG_LENGTH: 40,
};

export const DELIVERY_INSTRUCTIONS = {
  MAX_LENGTH: 500,
};
```

**Password history.** `security.passwordHistoryCount` (default `3`) is how many
previous hashes are retained per user, in `PasswordHistory`. Both
`POST /auth/changePassword` and `POST /auth/resetPassword` push the outgoing
hash into that table and refuse a new password that matches the live hash or any
retained one — 422 `PASSWORD_REUSED`. Setting the count to `0` turns the check
off. The trim runs in the same transaction as the write, so the retained set is
a ceiling and not a backlog.

**Consent / Terms Acceptance.** `UserConsent` table logs when a user accepts
TERMS, PRIVACY, or MARKETING consent. `POST /auth/acceptConsent` writes a row
with type, version, IP, and user-agent; `GET /auth/getMyConsents` returns all
accepted consents for the user. The unique constraint on (userId, type, version)
prevents duplicate accepts. DPDP compliance for audit trail.

### OTP — `src/config/otp.config.ts`

```tsx
export const OTP = {
  LENGTH: 6,
  EXPIRY_MIN: 10,
  MAX_ATTEMPTS: 3,
  RESEND_COOLDOWN_SEC: 60,
  MAX_RESENDS_PER_DAY: 10,
  BCRYPT_ROUNDS: 10,
  ATTEMPT_LOCK_MIN: 15,
  /**
   * Fixed code for local/testing, e.g. `111111`. Empty disables it and every
   * OTP is random. The env schema refuses this in production, because a known
   * code would let anyone log in as any account.
   */
  staticCode: ENV.OTP_STATIC_CODE,
};
```

**Note:** OTP ab single table me store hoga, `type` aur `channel` column ke saath:

- `POST /auth/sendOtp` → `{ type, channel, identifier }`
- `POST /auth/verifyOtp` → `{ type, identifier, otp }`
- `POST /auth/register/sendOtp` → `{ identifier }`
- `POST /auth/register/verifyOtp` → `{ identifier, otp }` → `verificationToken`
- `POST /auth/login/verifyOtp` → `{ identifier, otp }` → session

Record channel se keyed hota hai jo identifier se match karta hai (email pe
`EMAIL`, phone pe `SMS`), client ke requested channel pe nahi — isse SMS code ko
email code ki tarah redeem nahi kar sakte.

#### Code ke baad — `verificationToken`

Sirf `REGISTER` me code ke baad ek **single-use `verificationToken`** chahiye.
Wo tab zaroori hai jab code verify hone aur asli kaam hone ke beech ek aur
request aa jaaye — jaise registration me, jahan details step 3 me aati hain.

Login me ye gap nahi hai: code aur session ek hi request me aate hain
(`POST /auth/login/verifyOtp`), isliye wahan token ki zaroorat nahi.

Ye token `AuthVerification` table me rehta hai aur teen cheezein apne saath
pakadta hai:

| Field | Kyun zaroori |
| --- | --- |
| `purpose` | kis kaam ka token hai — ek kaam ka doosre me nahi chalega |
| `identifier` | wo exact email/phone jiska code aaya tha — step 3 me koi aur contact nahi bhej sakte |
| `usedAt` | ek hi baar chalta hai; dobara bhejne pe `401` `VERIFICATION_INVALID` |

Token plain text me store nahi hota, sirf uska SHA-256. `expiresAt` 15 minute.
Spend hote waqt row ek conditional `UPDATE` se mark hoti hai
(`usedAt: null` + `expiresAt` future + matching purpose), isliye do saath me aaye
hue do requests me se sirf ek hi jeet sakta hai.

Identifier mismatch pehle check hota hai, token spend hone se pehle — isliye galat
identifier bhejne se asli token barbaad nahi hota.

Ye `src/config/verification.config.ts` se configure hota hai (`TTL_MIN`,
`TOKEN_BYTES`).

**Throttling DB me hai.** Resend cooldown (60s) aur daily cap (10) `Otp` row ke
`lastSentAt`, `sendDay`, `sendCount` columns pe gina jate hain, Redis pe nahi —
warna Redis down hone par limit gayab ho jaati thi. Redis sirf cross-instance
accelerator hai; uska unavailable hona code bhejne ko rok nahi leta.

#### Master switch — `OTP_REQUIRED`

Poore system ka ek hi switch. Har enforcement point ise
`src/config/otp-policy.ts` se padhta hai, seedha `ENV.OTP_REQUIRED` se nahi —
isliye ise off karne pe koi ek code path bhi code demand karte nahi reh jaata.

| Value | Register | Login | Change password |
| --- | --- | --- | --- |
| `true` (default) | `verificationToken` zaroori, row sirf token spend hone ke baad | verified contact nahi hai to 403 `ACCOUNT_UNVERIFIED` | account ke apne contact pe code bhi chahiye |
| `false` | account turant, unverified | verification check skip | sirf current password |

`true` default hai kyunki wahi secure choice hai. Jab koi bhi channel code
deliver na kar sake to enforce nahi hota, taaki bina provider wala fresh clone
apni hi login screen pe na phanse. `NODE_ENV=production` me ye combination
**boot error** hai — code bhejne ka waada karke na bhejna deploy ki galti hai,
runtime condition nahi.

Code in flows me lagta hai: registration, OTP login, forgot/reset password, email
aur phone verification, aur password change.

#### Delivery

| Channel | Provider | Env |
| --- | --- | --- |
| Email | Brevo HTTP API | `BREVO_API_KEY` (SMTP ko priority deta hai) |
| Email | Koi bhi SMTP host | `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` |
| SMS | MSG91 | `MSG91_AUTHKEY` + `OTP_SMS_ENABLED=true` |

Koi provider set nahi hai to `sendOtp` phir bhi 200 deta hai aur code log me
chala jaata hai — `npm run doctor` is par fail karta hai. `OTP_STATIC_CODE=111111`
ke saath poora signup flow offline chal jaata hai.

### Rate Limit — `src/config/rateLimit.config.ts`

```tsx
export const RATE_LIMIT = {
  GLOBAL: { WINDOW_MS: 15 * 60_000, MAX: 300 },
  AUTH_LOGIN: { WINDOW_MS: 15 * 60_000, MAX: 10 },
  AUTH_REGISTER: { WINDOW_MS: 60 * 60_000, MAX: 5 },
  FORGOT_PASSWORD: { WINDOW_MS: 60 * 60_000, MAX: 3 },
  OTP_SEND: { WINDOW_MS: 60_000, MAX: 1 },
  UPLOAD: { WINDOW_MS: 60_000, MAX: 20 },
  SEARCH: { WINDOW_MS: 60_000, MAX: 60 },
  TRACKING: { WINDOW_MS: 60_000, MAX: 600 },
  ANALYTICS: { WINDOW_MS: 60_000, MAX: 120 },
};
```

### Upload — `src/config/upload.config.ts`

```tsx
export const UPLOAD = {
  IMAGE: {
    MAX_SIZE_MB: 5,
    MAX_COUNT: 10,
    ALLOWED_MIME: ['image/jpeg', 'image/png', 'image/webp'],
  },
  VIDEO: {
    MAX_SIZE_MB: 50,
    MAX_COUNT: 2,
    ALLOWED_MIME: ['video/mp4', 'video/webm'],
  },
  DOCUMENT: {
    MAX_SIZE_MB: 10,
    MAX_COUNT: 5,
    ALLOWED_MIME: ['application/pdf'],
  },
  CSV: {
    MAX_SIZE_MB: 20,
    MAX_COUNT: 1,
    ALLOWED_MIME: ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  CLOUDINARY_FOLDER: 'projectname',
  TEMP_DIR: 'uploads/tmp',
};
```

### Tracking — `src/config/tracking.config.ts`

```tsx
export const TRACKING = {
  SESSION_TIMEOUT_MIN: 30,
  HEARTBEAT_INTERVAL_SEC: 60,
  DEVICE_FINGERPRINT_ENABLED: true,
  GEO_LOOKUP_ENABLED: true,
  BOT_FILTER_ENABLED: true,
  EVENT_BATCH_SIZE: 50,
  EVENT_FLUSH_INTERVAL_MS: 5000,
  ALLOWED_EVENTS: [
    'app_open', 'app_install', 'app_update',
    'signup_start', 'signup_complete', 'login', 'logout',
    'product_view', 'category_view', 'search', 'filter_apply',
    'add_to_cart', 'remove_from_cart', 'add_to_wishlist',
    'checkout_start', 'address_add', 'payment_init',
    'payment_success', 'payment_fail', 'order_placed',
    'order_cancelled', 'order_returned', 'review_submit',
    'coupon_apply', 'coupon_fail', 'share', 'contact_click',
    'chat_open', 'chat_send', 'push_received', 'push_click',
  ],
};
```

### Analytics — `src/config/analytics.config.ts`

```tsx
export const ANALYTICS = {
  REALTIME_WINDOW_MIN: 5,
  AGGREGATION_CRON: '0 2 * * *',
  RETENTION_DAYS: {
    RAW_EVENTS: 90,
    SESSIONS: 365,
    AGGREGATES: 1095,
  },
  CACHE_TTL_SEC: 300,
  COHORT_WEEKS: 12,
};
```

### Shipping — `src/config/shipping.config.ts`

```tsx
export const SHIPPING = {
  DEFAULT_WEIGHT_UNIT: 'kg',
  DEFAULT_DIMENSION_UNIT: 'cm',
  DEFAULT_PARTNER: 'manual',
  TRACKING_REFRESH_MIN: 60,
};
```

### PDF — `src/config/pdf.config.ts`

```tsx
export const PDF = {
  PAGE_SIZE: 'A4',
  MARGIN: 40,
  FONT_SIZE: 10,
  HEADER_COLOR: '#111827',
  LOGO_PATH: 'assets/logo.png',
};
```

### Socket — `src/config/socket.config.ts`

```tsx
export const SOCKET = {
  NAMESPACE: '/ws',
  EVENTS: {
    CHAT_NEW: 'chat:new',
    CHAT_READ: 'chat:read',
    TYPING_START: 'typing:start',
    TYPING_STOP: 'typing:stop',
    USER_ONLINE: 'user:online',
    ORDER_STATUS: 'order:status',
    ANALYTICS_LIVE: 'analytics:live',
    NOTIFICATION_NEW: 'notification:new',
  },
  HEARTBEAT_INTERVAL_MS: 25000,
};
```

### Business Defaults (DB `SystemSetting` seed)

#### General / Site

| Key | Default Value | Category |
| --- | --- | --- |
| `site.name` | `"ProjectName"` | general |
| `site.logo` | `""` | general |
| `site.supportEmail` | `"support@projectname.com"` | general |
| `site.supportPhones` | `[]` (JSON array — 3 to 4 numbers) | general |
| `site.favicon` | `""` | general |
| `site.tagline` | `""` | general |
| `site.addressLine` | `""` | general |
| `site.socialLinks` | `{}` (object: `{facebook,instagram,twitter,youtube}`) | general |
| `site.maintenanceImage` | `""` | general |

#### Locale / Timezone / Currency

| Key | Default Value | Category |
| --- | --- | --- |
| `currency.code` | `"INR"` | currency |
| `currency.symbol` | `"₹"` | currency |
| `currency.decimals` | `2` | currency |
| `locale.default` | `"en"` | locale |
| `locale.supported` | `["en", "hi"]` (JSON array) | locale |
| `timezone.default` | `"Asia/Kolkata"` | locale |
| `date.format` | `"DD-MM-YYYY"` | locale |
| `time.format` | `"hh:mm A"` | locale |

#### Business / Commission

| Key | Default Value | Category |
| --- | --- | --- |
| `commission.default` | `10` (percent) | business |
| `commission.minPercent` | `0` | business |
| `commission.maxPercent` | `50` | business |
| `tax.defaultGstPercent` | `18` | tax |
| `tax.inclusive` | `false` | tax |

#### Order

| Key | Default Value | Category |
| --- | --- | --- |
| `order.minAmount` | `100` (INR) | business |
| `order.maxItems` | `50` | business |
| `order.cancelWindowMin` | `30` | business |
| `order.autoCancelUnpaidMin` | `1440` (24h) | order |
| `order.allowGuestCheckout` | `false` | order |
| `order.requirePhoneVerify` | `true` | order |
| `order.maxPerCustomerPerDay` | `20` | order |
| `order.showVendorSplit` | `true` | order |

#### Payment — COD / UPI / Bank

| Key | Default Value | Category |
| --- | --- | --- |
| `payment.cod.enabled` | `true` | payment |
| `payment.upi.enabled` | `true` | payment |
| `payment.bank.enabled` | `true` | payment |
| `payment.upi.id` | `"projectname@upi"` | payment |
| `payment.bank.holderName` | `"ProjectName Pvt Ltd"` | payment |
| `payment.bank.accountNo` | `"000000000000"` | payment |
| `payment.bank.ifsc` | `"HDFC0000000"` | payment |
| `payment.cod.maxAmount` | `20000` | payment |
| `payment.cod.enabledAbove` | `0` | payment |
| `payment.cod.extraCharge` | `0` (INR) | payment |
| `payment.razorpay.enabled` | `false` | payment |
| `payment.razorpay.keyId` | `""` | payment |
| `payment.razorpay.webhookSecret` | `""` | payment |

#### Payment — Token / Advance

**Idea:** Customer chhota token amount (fixed ya % of order) de kar order place kare. Baaki balance delivery ke time ya N days mai pay kare.

| Key | Default Value | Category |
| --- | --- | --- |
| `payment.token.enabled` | `false` | payment |
| `payment.token.mode` | `"percent"` (`"percent"` | `"fixed"`) | payment |
| `payment.token.percent` | `20` | payment |
| `payment.token.fixedAmount` | `100` (INR) | payment |
| `payment.token.minAmount` | `50` (INR) | payment |
| `payment.token.maxAmount` | `5000` (INR) | payment |
| `payment.token.applicableAbove` | `2000` | payment |
| `payment.token.allowedMethods` | `["UPI", "CARD", "NETBANKING"]` | payment |
| `payment.token.refundable` | `true` | payment |
| `payment.token.refundPercent` | `100` | payment |
| `payment.token.cancelWindowMin` | `60` | payment |
| `payment.token.balanceDueDays` | `7` | payment |
| `payment.token.balanceReminderHours` | `[24, 48, 72]` | payment |
| `payment.token.forfeitOnNoPay` | `true` | payment |
| `payment.token.autoCancelAfterDue` | `true` | payment |

**Token flow (order lifecycle):**

1. Cart value ≥ `payment.token.applicableAbove` → token required.
2. Token amount = `mode === "percent"` ? `total * percent / 100` : `fixedAmount`, clamped between `minAmount` and `maxAmount`.
3. Customer pays token via `allowedMethods` → order `status: CONFIRMED`.
4. Remaining balance paid at delivery / within `balanceDueDays`.
5. Cancel within `cancelWindowMin` → refund `refundPercent`.
6. Not paid within `balanceDueDays` → order auto-cancelled, token `forfeitOnNoPay`.

#### Shipping / Delivery

| Key | Default Value | Category |
| --- | --- | --- |
| `shipping.enabled` | `true` | shipping |
| `shipping.defaultCharge` | `49` (INR) | shipping |
| `shipping.freeAbove` | `999` (INR) | shipping |
| `shipping.estimatedDays` | `5` | shipping |
| `shipping.perKgCharge` | `0` (INR, 0 = off) | shipping |
| `shipping.maxDistanceKm` | `0` (0 = unlimited) | shipping |
| `shipping.serviceablePincodes` | `[]` | shipping |

#### Return / Refund

| Key | Default Value | Category |
| --- | --- | --- |
| `return.enabled` | `true` | return |
| `return.windowDays` | `7` | return |
| `return.reasonRequired` | `true` | return |
| `return.imagesRequired` | `true` | return |
| `return.maxQtyPerOrder` | `0` | return |
| `review.editWindowDays` | `7` | return |
| `refund.processingDays` | `5` | refund |
| `refund.mode` | `"original"` | refund |

#### Wallet / Loyalty

| Key | Default Value | Category |
| --- | --- | --- |
| `wallet.enabled` | `false` | wallet |
| `wallet.maxBalance` | `50000` (INR) | wallet |
| `wallet.minRedeem` | `100` (INR) | wallet |
| `wallet.expiryDays` | `365` | wallet |
| `loyalty.enabled` | `false` | loyalty |
| `loyalty.pointsPerRupee` | `1` | loyalty |
| `loyalty.pointValue` | `0.01` | loyalty |
| `loyalty.minRedeemPoints` | `100` | loyalty |

#### Coupon

| Key | Default Value | Category |
| --- | --- | --- |
| `coupon.maxPerOrder` | `1` | coupon |
| `coupon.stackable` | `false` | coupon |
| `coupon.minOrderAmount` | `0` (INR) | coupon |
| `coupon.maxDiscount` | `0` (0 = unlimited) | coupon |

#### Features

| Key | Default Value | Category |
| --- | --- | --- |
| `feature.reviews` | `true` | feature |
| `feature.wishlist` | `true` | feature |
| `feature.coupons` | `true` | feature |
| `feature.chat` | `false` | feature |
| `feature.multiVendor` | `true` | feature |
| `feature.guestCheckout` | `false` | feature |
| `feature.productCompare` | `false` | feature |
| `feature.recentlyViewed` | `true` | feature |
| `feature.liveTracking` | `false` | feature |
| `feature.wallet` | `false` | feature |
| `feature.loyalty` | `false` | feature |
| `feature.referral` | `false` | feature |
| `feature.giftCards` | `false` | feature |
| `feature.chatSupport` | `false` | feature |
| `feature.ticketSupport` | `true` | feature |
| `feature.socialLogin` | `true` | feature |
| `feature.twoFactor` | `false` | feature |
| `feature.analytics` | `true` | feature |
| `feature.tracking` | `true` | feature |

#### Catalog

| Key | Default Value | Category |
| --- | --- | --- |
| `catalog.productsPerPage` | `20` | catalog |
| `catalog.showOutOfStock` | `true` | catalog |
| `catalog.allowBackorder` | `false` | catalog |
| `catalog.defaultSort` | `"-createdAt"` | catalog |
| `catalog.maxImagesPerProduct` | `10` | catalog |

#### Cart

| Key | Default Value | Category |
| --- | --- | --- |
| `cart.maxItems` | `50` | cart |
| `cart.holdMinutes` | `30` | cart |
| `cart.persistAcrossDevices` | `true` | cart |

#### Vendor / Payout

| Key | Default Value | Category |
| --- | --- | --- |
| `vendor.autoApprove` | `false` | vendor |
| `vendor.maxProducts` | `500` | vendor |
| `vendor.minPayoutAmount` | `500` (INR) | vendor |
| `vendor.payoutCycleDays` | `7` | vendor |
| `vendor.payoutHoldDays` | `3` | vendor |
| `vendor.commissionOverrideAllowed` | `true` | vendor |

**Note:** `vendor.autoApprove = true` hone pe vendor register karte hi `APPROVED` ho jayega. `false` pe admin `approveVendor/:id` se approve karega.

#### Notification

| Key | Default Value | Category |
| --- | --- | --- |
| `notification.email.enabled` | `true` | notification |
| `notification.sms.enabled` | `false` | notification |
| `notification.push.enabled` | `true` | notification |
| `notification.whatsapp.enabled` | `false` | notification |
| `notification.orderEvents` | `["CONFIRMED","SHIPPED","DELIVERED","CANCELLED"]` | notification |
| `notification.tokenBalanceReminder` | `true` | notification |

#### Security

| Key | Default Value | Category |
| --- | --- | --- |
| `security.otpLoginEnabled` | `false` | security |
| `security.twoFactorEnabled` | `false` | security |
| `security.maxLoginAttempts` | `5` | security |
| `security.lockoutMinutes` | `15` | security |
| `security.passwordMinLength` | `8` | security |
| `security.passwordHistoryCount` | `3` | security |
| `security.requireEmailVerify` | `false` | security |
| `security.requirePhoneVerify` | `true` | security |
| `security.sessionDays` | `7` | security |

#### System / Maintenance

| Key | Default Value | Category |
| --- | --- | --- |
| `maintenance.enabled` | `false` | system |
| `maintenance.message` | `"We'll be back soon."` | system |
| `maintenance.allowedIps` | `[]` | system |
| `system.encryptionEnabled` | `false` | system |
| `system.apiRateLimitPerMin` | `100` | system |

#### App / Android / iOS

| Key | Default Value | Category |
| --- | --- | --- |
| `app.minAndroidVersion` | `"1.0.0"` | app |
| `app.forceUpdateAndroid` | `false` | app |
| `app.latestAndroidVersion` | `"1.0.0"` | app |
| `app.minIosVersion` | `"1.0.0"` | app |
| `app.forceUpdateIos` | `false` | app |
| `app.latestIosVersion` | `"1.0.0"` | app |
| `app.updateMessage` | `""` | app |

#### Tracking & Analytics

| Key | Default Value | Category |
| --- | --- | --- |
| `tracking.enabled` | `true` | tracking |
| `tracking.sessionTimeoutMin` | `30` | tracking |
| `tracking.geoLookupEnabled` | `true` | tracking |
| `tracking.botFilterEnabled` | `true` | tracking |
| `tracking.rawRetentionDays` | `90` | tracking |
| `analytics.realtimeWindowMin` | `5` | analytics |
| `analytics.aggregationCron` | `"0 2 * * *"` | analytics |
| `analytics.exportMaxRows` | `50000` | analytics |

#### Referral / Gift Cards

| Key | Default Value | Category |
| --- | --- | --- |
| `referral.enabled` | `false` | referral |
| `referral.referrerReward` | `100` (INR) | referral |
| `referral.refereeReward` | `50` (INR) | referral |
| `referral.expiryDays` | `90` | referral |
| `giftCard.enabled` | `false` | giftCard |
| `giftCard.minAmount` | `100` | giftCard |
| `giftCard.maxAmount` | `50000` | giftCard |
| `giftCard.expiryDays` | `365` | giftCard |

#### Support / Chat

| Key | Default Value | Category |
| --- | --- | --- |
| `support.ticket.enabled` | `true` | support |
| `support.chat.enabled` | `false` | support |
| `support.chatAutoReply` | `true` | support |
| `support.workingHours` | `{start: "10:00", end: "19:00"}` | support |

#### Seed Script Example (`prisma/seed.ts` snippet)

```tsx
const settings: Array<{ key: string; value: any; category: string; isPublic: boolean }> = [
  // ── General / Site ─────────────────────────────
  { key: 'site.name',              value: 'ProjectName',             category: 'general',  isPublic: true  },
  { key: 'site.logo',              value: '',                        category: 'general',  isPublic: true  },
  { key: 'site.supportEmail',      value: 'support@projectname.com', category: 'general',  isPublic: true  },
  { key: 'site.supportPhones',     value: [],                        category: 'general',  isPublic: true  },
  { key: 'site.favicon',           value: '',                        category: 'general',  isPublic: true  },
  { key: 'site.tagline',           value: '',                        category: 'general',  isPublic: true  },
  { key: 'site.addressLine',       value: '',                        category: 'general',  isPublic: true  },
  { key: 'site.socialLinks',       value: { facebook: '', instagram: '', twitter: '', youtube: '' }, category: 'general', isPublic: true },
  { key: 'site.maintenanceImage',  value: '',                        category: 'general',  isPublic: true  },

  // ── Locale / Timezone / Currency ───────────────
  { key: 'currency.code',          value: 'INR',           category: 'currency', isPublic: true },
  { key: 'currency.symbol',        value: '₹',             category: 'currency', isPublic: true },
  { key: 'currency.decimals',      value: 2,               category: 'currency', isPublic: true },
  { key: 'locale.default',         value: 'en',            category: 'locale',   isPublic: true },
  { key: 'locale.supported',       value: ['en', 'hi'],    category: 'locale',   isPublic: true },
  { key: 'timezone.default',       value: 'Asia/Kolkata',  category: 'locale',   isPublic: true },
  { key: 'date.format',            value: 'DD-MM-YYYY',    category: 'locale',   isPublic: true },
  { key: 'time.format',            value: 'hh:mm A',       category: 'locale',   isPublic: true },

  // ── Business / Commission ──────────────────────
  { key: 'commission.default',     value: 10,    category: 'business', isPublic: false },
  { key: 'commission.minPercent',  value: 0,     category: 'business', isPublic: false },
  { key: 'commission.maxPercent',  value: 50,    category: 'business', isPublic: false },
  { key: 'tax.defaultGstPercent',  value: 18,    category: 'tax',      isPublic: true  },
  { key: 'tax.inclusive',          value: false, category: 'tax',      isPublic: true  },

  // ── Order ──────────────────────────────────────
  { key: 'order.minAmount',             value: 100,   category: 'business', isPublic: true  },
  { key: 'order.maxItems',              value: 50,    category: 'business', isPublic: true  },
  { key: 'order.cancelWindowMin',       value: 30,    category: 'business', isPublic: true  },
  { key: 'order.autoCancelUnpaidMin',   value: 1440,  category: 'order',    isPublic: false },
  { key: 'order.allowGuestCheckout',    value: false, category: 'order',    isPublic: true  },
  { key: 'order.requirePhoneVerify',    value: true,  category: 'order',    isPublic: true  },
  { key: 'order.maxPerCustomerPerDay',  value: 20,    category: 'order',    isPublic: false },
  { key: 'order.showVendorSplit',       value: true,  category: 'order',    isPublic: true  },

  // ── Payment — COD / UPI / Bank ─────────────────
  { key: 'payment.cod.enabled',            value: true,                  category: 'payment', isPublic: true  },
  { key: 'payment.upi.enabled',            value: true,                  category: 'payment', isPublic: true  },
  { key: 'payment.bank.enabled',           value: true,                  category: 'payment', isPublic: true  },
  { key: 'payment.upi.id',                 value: 'projectname@upi',     category: 'payment', isPublic: true  },
  { key: 'payment.bank.holderName',        value: 'ProjectName Pvt Ltd', category: 'payment', isPublic: true  },
  { key: 'payment.bank.accountNo',         value: '000000000000',        category: 'payment', isPublic: true  },
  { key: 'payment.bank.ifsc',              value: 'HDFC0000000',         category: 'payment', isPublic: true  },
  { key: 'payment.cod.maxAmount',          value: 20000,                 category: 'payment', isPublic: true  },
  { key: 'payment.cod.enabledAbove',       value: 0,                     category: 'payment', isPublic: true  },
  { key: 'payment.cod.extraCharge',        value: 0,                     category: 'payment', isPublic: true  },
  { key: 'payment.razorpay.enabled',       value: false,                 category: 'payment', isPublic: false },
  { key: 'payment.razorpay.keyId',         value: '',                    category: 'payment', isPublic: false },
  { key: 'payment.razorpay.webhookSecret', value: '',                    category: 'payment', isPublic: false },

  // ── Payment — Token / Advance ──────────────────
  { key: 'payment.token.enabled',              value: false,                        category: 'payment', isPublic: true  },
  { key: 'payment.token.mode',                 value: 'percent',                    category: 'payment', isPublic: true  },
  { key: 'payment.token.percent',              value: 20,                           category: 'payment', isPublic: true  },
  { key: 'payment.token.fixedAmount',          value: 100,                          category: 'payment', isPublic: true  },
  { key: 'payment.token.minAmount',            value: 50,                           category: 'payment', isPublic: true  },
  { key: 'payment.token.maxAmount',            value: 5000,                         category: 'payment', isPublic: true  },
  { key: 'payment.token.applicableAbove',      value: 2000,                         category: 'payment', isPublic: true  },
  { key: 'payment.token.allowedMethods',       value: ['UPI', 'CARD', 'NETBANKING'], category: 'payment', isPublic: true  },
  { key: 'payment.token.refundable',           value: true,                         category: 'payment', isPublic: true  },
  { key: 'payment.token.refundPercent',        value: 100,                          category: 'payment', isPublic: true  },
  { key: 'payment.token.cancelWindowMin',      value: 60,                           category: 'payment', isPublic: true  },
  { key: 'payment.token.balanceDueDays',       value: 7,                            category: 'payment', isPublic: true  },
  { key: 'payment.token.balanceReminderHours', value: [24, 48, 72],                 category: 'payment', isPublic: false },
  { key: 'payment.token.forfeitOnNoPay',       value: true,                         category: 'payment', isPublic: false },
  { key: 'payment.token.autoCancelAfterDue',   value: true,                         category: 'payment', isPublic: false },

  // ── Shipping / Delivery ────────────────────────
  { key: 'shipping.enabled',              value: true, category: 'shipping', isPublic: true },
  { key: 'shipping.defaultCharge',        value: 49,   category: 'shipping', isPublic: true },
  { key: 'shipping.freeAbove',            value: 999,  category: 'shipping', isPublic: true },
  { key: 'shipping.estimatedDays',        value: 5,    category: 'shipping', isPublic: true },
  { key: 'shipping.perKgCharge',          value: 0,    category: 'shipping', isPublic: true },
  { key: 'shipping.maxDistanceKm',        value: 0,    category: 'shipping', isPublic: true },
  { key: 'shipping.serviceablePincodes',  value: [],   category: 'shipping', isPublic: true },

  // ── Return / Refund ────────────────────────────
  { key: 'return.enabled',         value: true,       category: 'return', isPublic: true  },
  { key: 'return.windowDays',      value: 7,          category: 'return', isPublic: true  },
  { key: 'return.reasonRequired',  value: true,       category: 'return', isPublic: true  },
  { key: 'return.imagesRequired',  value: true,       category: 'return', isPublic: true  },
  { key: 'return.maxQtyPerOrder',  value: 0,          category: 'return', isPublic: false },
  { key: 'review.editWindowDays', value: 7,          category: 'return', isPublic: true  },
  { key: 'refund.processingDays',  value: 5,          category: 'refund', isPublic: true  },
  { key: 'refund.mode',            value: 'original', category: 'refund', isPublic: true  },

  // ── Wallet / Loyalty ───────────────────────────
  { key: 'wallet.enabled',          value: false, category: 'wallet',  isPublic: true },
  { key: 'wallet.maxBalance',       value: 50000, category: 'wallet',  isPublic: true },
  { key: 'wallet.minRedeem',        value: 100,   category: 'wallet',  isPublic: true },
  { key: 'wallet.expiryDays',       value: 365,   category: 'wallet',  isPublic: true },
  { key: 'loyalty.enabled',         value: false, category: 'loyalty', isPublic: true },
  { key: 'loyalty.pointsPerRupee',  value: 1,     category: 'loyalty', isPublic: true },
  { key: 'loyalty.pointValue',      value: 0.01,  category: 'loyalty', isPublic: true },
  { key: 'loyalty.minRedeemPoints', value: 100,   category: 'loyalty', isPublic: true },

  // ── Coupon ────────────────────────────────────
  { key: 'coupon.maxPerOrder',    value: 1,     category: 'coupon', isPublic: true },
  { key: 'coupon.stackable',      value: false, category: 'coupon', isPublic: true },
  { key: 'coupon.minOrderAmount', value: 0,     category: 'coupon', isPublic: true },
  { key: 'coupon.maxDiscount',    value: 0,     category: 'coupon', isPublic: true },

  // ── Features ──────────────────────────────────
  { key: 'feature.reviews',        value: true,  category: 'feature', isPublic: true },
  { key: 'feature.wishlist',       value: true,  category: 'feature', isPublic: true },
  { key: 'feature.coupons',        value: true,  category: 'feature', isPublic: true },
  { key: 'feature.chat',           value: false, category: 'feature', isPublic: true },
  { key: 'feature.multiVendor',    value: true,  category: 'feature', isPublic: true },
  { key: 'feature.guestCheckout',  value: false, category: 'feature', isPublic: true },
  { key: 'feature.productCompare', value: false, category: 'feature', isPublic: true },
  { key: 'feature.recentlyViewed', value: true,  category: 'feature', isPublic: true },
  { key: 'feature.liveTracking',   value: false, category: 'feature', isPublic: true },
  { key: 'feature.wallet',         value: false, category: 'feature', isPublic: true },
  { key: 'feature.loyalty',        value: false, category: 'feature', isPublic: true },
  { key: 'feature.referral',       value: false, category: 'feature', isPublic: true },
  { key: 'feature.giftCards',      value: false, category: 'feature', isPublic: true },
  { key: 'feature.chatSupport',    value: false, category: 'feature', isPublic: true },
  { key: 'feature.ticketSupport',  value: true,  category: 'feature', isPublic: true },
  { key: 'feature.socialLogin',    value: true,  category: 'feature', isPublic: true },
  { key: 'feature.twoFactor',      value: false, category: 'feature', isPublic: true },
  { key: 'feature.analytics',      value: true,  category: 'feature', isPublic: true },
  { key: 'feature.tracking',       value: true,  category: 'feature', isPublic: true },

  // ── Catalog ───────────────────────────────────
  { key: 'catalog.productsPerPage',     value: 20,           category: 'catalog', isPublic: true  },
  { key: 'catalog.showOutOfStock',      value: true,         category: 'catalog', isPublic: true  },
  { key: 'catalog.allowBackorder',      value: false,        category: 'catalog', isPublic: true  },
  { key: 'catalog.defaultSort',         value: '-createdAt', category: 'catalog', isPublic: true  },
  { key: 'catalog.maxImagesPerProduct', value: 10,           category: 'catalog', isPublic: false },

  // ── Cart ──────────────────────────────────────
  { key: 'cart.maxItems',             value: 50,   category: 'cart', isPublic: true  },
  { key: 'cart.holdMinutes',          value: 30,   category: 'cart', isPublic: false },
  { key: 'cart.persistAcrossDevices', value: true, category: 'cart', isPublic: true  },

  // ── Vendor / Payout ───────────────────────────
  { key: 'vendor.autoApprove',               value: false, category: 'vendor', isPublic: false },
  { key: 'vendor.maxProducts',               value: 500,   category: 'vendor', isPublic: false },
  { key: 'vendor.minPayoutAmount',           value: 500,   category: 'vendor', isPublic: false },
  { key: 'vendor.payoutCycleDays',           value: 7,     category: 'vendor', isPublic: false },
  { key: 'vendor.payoutHoldDays',            value: 3,     category: 'vendor', isPublic: false },
  { key: 'vendor.commissionOverrideAllowed', value: true,  category: 'vendor', isPublic: false },

  // ── Notification ──────────────────────────────
  { key: 'notification.email.enabled',        value: true,  category: 'notification', isPublic: false },
  { key: 'notification.sms.enabled',          value: false, category: 'notification', isPublic: false },
  { key: 'notification.push.enabled',         value: true,  category: 'notification', isPublic: false },
  { key: 'notification.whatsapp.enabled',     value: false, category: 'notification', isPublic: false },
  { key: 'notification.orderEvents',          value: ['CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'], category: 'notification', isPublic: false },
  { key: 'notification.tokenBalanceReminder', value: true,  category: 'notification', isPublic: false },

  // ── Security ──────────────────────────────────
  { key: 'security.otpLoginEnabled',    value: false, category: 'security', isPublic: false },
  { key: 'security.twoFactorEnabled',   value: false, category: 'security', isPublic: false },
  { key: 'security.maxLoginAttempts',   value: 5,     category: 'security', isPublic: false },
  { key: 'security.lockoutMinutes',     value: 15,    category: 'security', isPublic: false },
  { key: 'security.passwordMinLength',  value: 8,     category: 'security', isPublic: false },
  { key: 'security.passwordHistoryCount', value: 3,   category: 'security', isPublic: false },
  { key: 'security.requireEmailVerify', value: false, category: 'security', isPublic: false },
  { key: 'security.requirePhoneVerify', value: true,  category: 'security', isPublic: false },
  { key: 'security.sessionDays',        value: 7,     category: 'security', isPublic: false },

  // ── System / Maintenance ──────────────────────
  { key: 'maintenance.enabled',       value: false,                 category: 'system', isPublic: false },
  { key: 'maintenance.message',       value: "We'll be back soon.", category: 'system', isPublic: true  },
  { key: 'maintenance.allowedIps',    value: [],                    category: 'system', isPublic: false },
  { key: 'system.encryptionEnabled',  value: false,                 category: 'system', isPublic: false },
  { key: 'system.apiRateLimitPerMin', value: 100,                   category: 'system', isPublic: false },

  // ── App / Android / iOS ───────────────────────
  { key: 'app.minAndroidVersion',    value: '1.0.0', category: 'app', isPublic: true },
  { key: 'app.forceUpdateAndroid',   value: false,   category: 'app', isPublic: true },
  { key: 'app.latestAndroidVersion', value: '1.0.0', category: 'app', isPublic: true },
  { key: 'app.minIosVersion',        value: '1.0.0', category: 'app', isPublic: true },
  { key: 'app.forceUpdateIos',       value: false,   category: 'app', isPublic: true },
  { key: 'app.latestIosVersion',     value: '1.0.0', category: 'app', isPublic: true },
  { key: 'app.updateMessage',        value: '',      category: 'app', isPublic: true },

  // ── Tracking & Analytics ──────────────────────
  { key: 'tracking.enabled',              value: true,          category: 'tracking',  isPublic: false },
  { key: 'tracking.sessionTimeoutMin',    value: 30,            category: 'tracking',  isPublic: false },
  { key: 'tracking.geoLookupEnabled',     value: true,          category: 'tracking',  isPublic: false },
  { key: 'tracking.botFilterEnabled',     value: true,          category: 'tracking',  isPublic: false },
  { key: 'tracking.rawRetentionDays',     value: 90,            category: 'tracking',  isPublic: false },
  { key: 'analytics.realtimeWindowMin',   value: 5,             category: 'analytics', isPublic: false },
  { key: 'analytics.aggregationCron',     value: '0 2 * * *',   category: 'analytics', isPublic: false },
  { key: 'analytics.exportMaxRows',       value: 50000,         category: 'analytics', isPublic: false },

  // ── Referral / Gift Cards ─────────────────────
  { key: 'referral.enabled',          value: false, category: 'referral', isPublic: true },
  { key: 'referral.referrerReward',   value: 100,   category: 'referral', isPublic: false },
  { key: 'referral.refereeReward',    value: 50,    category: 'referral', isPublic: false },
  { key: 'referral.expiryDays',       value: 90,    category: 'referral', isPublic: false },
  { key: 'giftCard.enabled',          value: false, category: 'giftCard', isPublic: true },
  { key: 'giftCard.minAmount',        value: 100,   category: 'giftCard', isPublic: true },
  { key: 'giftCard.maxAmount',        value: 50000, category: 'giftCard', isPublic: true },
  { key: 'giftCard.expiryDays',       value: 365,   category: 'giftCard', isPublic: true },

  // ── Support / Chat ────────────────────────────
  { key: 'support.ticket.enabled',    value: true,                                    category: 'support', isPublic: true },
  { key: 'support.chat.enabled',      value: false,                                   category: 'support', isPublic: true },
  { key: 'support.chatAutoReply',     value: true,                                    category: 'support', isPublic: false },
  { key: 'support.workingHours',      value: { start: '10:00', end: '19:00' },        category: 'support', isPublic: true },
];

for (const s of settings) {
  await prisma.systemSetting.upsert({
    where:  { key: s.key },
    // Sirf category update hoti hai — value aur isPublic nahi. Isse admin ne
    // jo tune kiya hai wo re-seed se mitta nahi.
    update: { category: s.category },
    create: { key: s.key, value: s.value, category: s.category, isPublic: s.isPublic },
  });
}

// ── SUPER_ADMIN seed ───────────────────────────────────
const superAdminEmail    = process.env.SUPER_ADMIN_EMAIL    || 'superadmin@projectname.com';
const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'SuperSecret@123';

await prisma.user.upsert({
  where:  { email: superAdminEmail },
  // Login ke liye verified contact zaroori hai, isliye create aur update dono me.
  update: { isEmailVerified: true },
  create: {
    email:        superAdminEmail,
    passwordHash: await bcrypt.hash(superAdminPassword, 12),
    name:         'Super Admin',
    phone:        '',
    role:         'SUPER_ADMIN',
    isActive:     true,
  },
});
```

### Token Amount — Quick Formula

```tsx
function calcTokenAmount(orderTotal: number, cfg: {
  mode: 'percent' | 'fixed';
  percent: number;
  fixedAmount: number;
  minAmount: number;
  maxAmount: number;
  applicableAbove: number;
}) {
  // Rule 1: order total below applicableAbove → token not required
  if (orderTotal < cfg.applicableAbove) return 0;

  // Rule 2: compute raw
  const raw = cfg.mode === 'percent'
    ? (orderTotal * cfg.percent) / 100
    : cfg.fixedAmount;

  // Rule 3: clamp between min and max
  const clamped = Math.min(Math.max(raw, cfg.minAmount), cfg.maxAmount);

  // Rule 4: never exceed order total
  return Math.min(clamped, orderTotal);
}

// Example:
// orderTotal = 2000, mode='percent', percent=20 → 400
// orderTotal = 2000, mode='fixed',   fixedAmount=100 → 100
// orderTotal = 500,  applicableAbove=2000 → 0 (token not required)
// orderTotal = 20000, percent=20 → 4000 → clamped to maxAmount=5000? no → 4000
// orderTotal = 40000, percent=20 → 8000 → clamped to maxAmount=5000
```

### Token Order — Response Example

```json
{
  "status": true,
  "message": "Order placed successfully. Token payment required.",
  "result": {
    "orderId": "ord_1",
    "total": 2000,
    "tokenRequired": true,
    "tokenAmount": 400,
    "balanceAmount": 1600,
    "balanceDueDays": 7,
    "status": "PENDING_TOKEN",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "paymentData": {
      "method": "UPI",
      "status": "PENDING",
      "tokenPaid": false,
      "allowedMethods": ["UPI", "CARD", "NETBANKING"]
    },
    "addressData": {
      "line1": "123 Main St",
      "city": "Delhi",
      "pincode": "110001"
    },
    "subOrderList": []
  }
}
```

### Catalog & Order Rules

Rules jo schema se khud nahi padhchi jaatin, is liye yahan likhi hain.

**Product condition and warranty.** `Product.condition` is one of
`NEW` / `USED` / `REFURBISHED` / `OPEN_BOX` and defaults to `NEW`.
`warrantyMonths` is capped at `WARRANTY.MAX_MONTHS`, and `0` means no warranty
is offered. All of them are set through the same product create and update
payload, and the CSV bulk-import schema carries them too.

**Non-returnable items.** `Product.isNonReturnable` is read from the **live
product**, not from a copy on the order line, so a seller who changes the policy
after a purchase still governs what may be sent back.
`POST /returns/createRequest` answers 422 `NON_RETURNABLE` when any requested
line belongs to such a product.

**Review edit window.** `review.editWindowDays` (default `7`) bounds
`PATCH /reviews/updateReview/:id`; past it the call is 422
`EDIT_WINDOW_PASSED`. `0` disables the window.

**Order tags.** An order carries at most `WARRANTY.MAX_TAGS_PER_ORDER` labels.
Labels are upper-cased and unique per order, so re-posting an existing one
updates its colour instead of failing. All three tag routes are admin-only and
accept an order id *or* an order number in the `:id` segment.

**Delivery instructions.** `Address.deliveryInstructions` rides along with the
address everywhere it is echoed - order detail, packing slip and the checkout
address preview.

**Order internal notes.** `OrderNote` table lets admin and vendor attach
private comments to an order. `POST /orders/addNote/:id` adds a note with the
caller's userId and IP; `GET /orders/getNotes/:id` lists them newest-first;
`DELETE /orders/removeNote/:id/:noteId` removes one. Notes are not visible to
the customer and appear in the order detail alongside tags and timeline.

### Account Security Rules

Ye rules schema se nahi, code se padhchi jaatin hain.

**Password expiry.** `User.passwordChangedAt` is stamped at registration and on
every successful `changePassword` / `resetPassword`. When
`security.passwordExpiryDays` is greater than `0`, a password older than that
many days blocks `POST /auth/login` with 403 `PASSWORD_EXPIRED`; the default `0`
means passwords never expire. OTP login is unaffected, since there is no password
to expire.

**Concurrent session limit.** `security.maxActiveSessions` (`0` = unlimited) is
enforced inside `issueTokens` on every sign-in. Once a user is at the cap, the
oldest sessions by `lastSeenAt` are closed and their refresh tokens revoked, and
the session that just signed in is always kept. The login response returns
`revokedSessionCount` so the client can say how many devices were signed out.

**Contact change.** Changing the sign-in email or phone is a two-step flow, and
the code always goes to the contact being *claimed*, never the current one.
`POST /auth/changeEmail/sendOtp` sends it (rate limited by
`PASSWORD.CONTACT_CHANGE_COOLDOWN_MIN` per target address), `POST
/auth/changeEmail/verifyOtp` returns a single-use `verificationToken`, and
`POST /auth/changeEmail` / `POST /auth/changePhone` need both. On success the new
contact is marked verified and **every** refresh token is revoked, so a takeover
cannot ride along on an existing session. The account is notified of the swap
after the fact.

**Deletion recovery window.** `DELETE /users/deleteAccount` no longer destroys
anything outright: it sets `deletedAt`, releases the email and phone, and stamps
`purgeAfter` at `security.accountPurgeDays` (default `30`). The restore token is
emailed at that moment and stored only as a hash, so `POST /auth/restoreAccount`
matches on `deletionTokenHash` — the released contacts cannot identify the row.
The `purge-deleted-accounts` cron deletes accounts whose window has closed, and
restore returns 410 `ACCOUNT_PURGE_WINDOW` once it has.

**Sign-in alerts.** A login from a device the account has not used before raises
an in-app `ALERT` notification with the IP and platform, controlled by
`security.loginAlerts` and `security.newDeviceAlerts`. The first-known device is
recorded at that moment, so the alert fires once per device rather than once per
login. `User.lastLoginIp` tracks the previous IP for location comparison.

### Cart Rules

**Gift wrap.** `CartItem.isGiftWrap` is per line, and the charge is
`cart.giftWrapCharge` (default `49`) counted once per wrapped line - not per
unit, so three units of one wrapped product still cost one wrap. It lands as
`giftWrapAmount` on both the cart totals and `Order`, and
`placeOrder` recomputes it from the lines it is actually fulfilling, so a
line dropped for stock does not leave the customer paying for its wrap.
Turning the flag off clears the note rather than keeping it orphaned.
`cart.giftWrapNoteMaxLength` bounds the note.

**Per-item delivery note.** `CartItem.deliveryNote` is distinct from
`Address.deliveryInstructions`: the address note applies to the whole delivery,
this one to a single line. Both survive onto `OrderItem`, so the packing slip and
the order detail show the line-level note next to the item it belongs to.

**Save for later.** `SavedCartItem` is a separate table rather than a flag on
`CartItem`. That is deliberate - nothing that totals, checks out, counts against
`cart.maxItems` or holds stock can see a saved line, which a flag could not
guarantee. Saving *moves* the line out of the cart rather than copying it.
`POST /cart/savedForLater/:id/moveToCart` takes an optional `qty`; a partial
move leaves the remainder saved, and the saved row goes only when the quantity
reaches zero.

**Price drop alerts.** `PriceWatch` stores `targetPrice` plus the
`lastSeenPrice` the last scan saw. The `price-drop-scan` cron compares the two
and notifies only when the price has actually fallen *and* is at or below
target - so an already-cheap watch stays quiet instead of re-notifying every
pass. Target must be below the current price at creation.
`POST /priceWatches/watch` takes a variant id, in which case the variant price
is watched and `0` means "any drop".

### Payment Rules

**Partial and repeated refunds.** `POST /payments/refund/:id` takes an optional
`amount`; omitting it refunds whatever is left. The cap is always
`paidAmount - (sum of already-settled refunds)`, re-read at initiation, and
exceeding it is 422 `REFUND_EXCEEDS_PAID`. Nhi: `Payment.status` and
`Order.paymentStatus` only move to `REFUNDED` when the settled total reaches
`paidAmount`; until then they sit at `PARTIALLY_REFUNDED`. There is no limit on
how many refunds one order can carry - `GET /payments/getRefundHistory/:orderId`
lists them all. This is what the old gap table called "multiple refunds per
order"; it already worked.

**Idempotency keys.** Money-moving routes accept an `Idempotency-Key` header -
`payToken`, `payBalance`, `verifyUpi`, `verifyBank`, `markCodCollected`,
`confirmPayment` and `refund`. The header is **optional**: without it the
request behaves exactly as before, so adopting keys cannot break an older
client.

The rules the code holds to:

| Situation | Result |
| --- | --- |
| No header | Normal handling, nothing recorded |
| Key shorter than 8 chars | 400 `IDEMPOTENCY_KEY_INVALID` |
| First use of a key | Handler runs; response stored as `COMPLETED` |
| Same key, same body | Stored response replayed verbatim, header `x-idempotency-replayed: true` |
| Same key, different body | 409 `IDEMPOTENCY_KEY_REUSED` |
| Same key while the first call is still running | 409 `IDEMPOTENCY_IN_PROGRESS` |
| Any 4xx/5xx outcome | Key **released**, so the client can fix and retry |
| First attempt died mid-flight | Reclaimed once it is older than `IN_PROGRESS_MAX_AGE_SEC` |

Three details that are easy to get wrong:

- **`responseBody` is text, not `JSONB`.** JSONB does not preserve key order, so
  a replayed response would come back `result, status, message` and break the
  fixed `status, message, result` envelope contract.
- **A key belongs to a call that *succeeded*.** The response is captured on
  `finish` and any 4xx/5xx deletes the row instead of storing it, so a client
  that sent a bad body once is not locked out of that key afterwards.
- **Keys are unique per `(userId, key)`**, not globally, and the unique index is
  what serialises concurrent retries - a check-then-insert would race.

`cleanup-expired` sweeps rows past `expiresAt` (`IDEMPOTENCY.RETENTION_HOURS`,
default 24).

---

### Percentage Rules

Har field jiska naam `percentage` hai, wo **0-100** pe hai, fraction nahi. Ye
contract hai — clients ise directly template me lagate hain (`width: {percentage}%`),
isliye `0.2` ka matlab hai `0.2%`, `20` ka matlab hai `20%`.

Do helper `src/utils/calculations.ts` me hain:

| Helper | Kahan | Behaviour |
| --- | --- | --- |
| `toPercent(part, total)` | Share-of-total lists | 0-100, 1 decimal, `0` jab total `0` ho |
| `toPercentDistribution(parts)` | Fixed-bucket columns | Ye bhi 0-100, aur list **exactly 100** kaati hai |

`toPercentDistribution` ka residual sabse bade share pe jaata hai. Ye zaroori
hai kyunki har share ko alag round karne se drift hota hai — teen barabar
shares `33.3 + 33.3 + 33.3 = 99.9` ban jaate hain — aur jo distribution 100 se
kam ho, usse stacked bar me gap dikhta hai.

**Call sites:** `reviews/getSummary/:productId` ka `distributionList` (5 star
buckets, fixed column) → `toPercentDistribution`. Baaki chaar
(`analytics/getTopPages`, `getTrafficSources`, device breakdown, app versions)
→ `toPercent`, kyunki wo ranked lists hain, fixed column nahi, aur unhe exactly
100 kaatne ki zaroorat nahi.

`tests/percentage.test.ts` ye scale lock karta hai.

---

### Job Retry & Dead Letter Rules

**Retry.** Every job carries `attempts` and an exponential `backoff`, applied per
job at enqueue time rather than as the Queue's `defaultJobOptions` — `getQueue()`
is synchronous everywhere and reading settings is not. Both numbers come from
settings first, falling back to `QUEUE_POLICY` in `src/config/queue.config.ts`:

| Setting | Default | Kya |
| --- | --- | --- |
| `queue.maxAttempts` | `3` | Total attempts, not retries after the first |
| `queue.backoffDelayMs` | `3000` | First backoff; exponential from there |
| `queue.maxReplays` | `3` | Manual replays one dead row is allowed |

`queue.maxAttempts` is clamped to at least 1 — a zero there would silently mean
"run once, never retry".

**Dead letter queue.** When BullMQ spends the last attempt, the worker's `failed`
hook writes a `FailedJob` row. The check is `attemptsMade >= job.opts.attempts`,
not `attemptsMade > 0`, so the row appears only once the retry is actually spent
— recording on the first transient failure would defeat the retry entirely.

The row is keyed `@@unique([queue, jobId])`, so a job that fails, is replayed and
fails again updates one row instead of accumulating one per attempt, and a
resolved row reopens to `PENDING` when its job comes back.

| Situation | Result |
| --- | --- |
| Failure with attempts left | Logged only; BullMQ retries it |
| Last attempt failed | `FailedJob` written, status `PENDING` |
| `retryFailedJob/:id` | Re-queued under `replay-{jobId}-{n}`, `replayCount` incremented |
| Replay beyond `queue.maxReplays` | 409 `FAILED_JOB_REPLAY_LIMIT` |
| Queue or Redis down at replay time | 503 `FAILED_JOB_QUEUE_UNAVAILABLE`, row untouched |
| `resolveFailedJob/:id` | Status `RESOLVED` with the acting admin, no replay |
| Replay or resolve on a non-`PENDING` row | 409 `FAILED_JOB_ALREADY_RESOLVED` |
| The write itself fails | Logged; the worker keeps running |

Two properties come from storing the row in Postgres instead of a Bull queue: a
failure survives a Redis flush, and an admin can query it over HTTP.

**The replay gets its own queue id** (`replay-{jobId}-{n}`). Reusing the original
would collide with the retained failed job, and the original row has to stay put
as the record of what went wrong.

`prune-failed-jobs` runs nightly (`CRON.PRUNE_FAILED_JOBS`): a `PENDING` row
untouched for `DLQ.STALE_PENDING_DAYS` (30) becomes `ABANDONED`, and anything
`RESOLVED` or `ABANDONED` older than `DLQ.RESOLVED_RETENTION_DAYS` (30) is
deleted. An unreplayed failure that old has almost always been fixed by then,
and keeping it forever only hides the live ones.

---

## Folder Structure

Module layout **domain-grouped** hai — ek module ke andar multiple routers
rehte hain, ek resource per folder nahi. Ye jane bujh kar kiya gaya hai: 49
alag folder ka matlab 49 routing layer aur 49 serializer file, jabki actual
surface un modules me aata hi jaata hai. Neeche mapping di hai taaki route
path se module pata chal jaaye.

```
projectname-api/
|-- prisma/
|   |-- schema.prisma
|   |-- migrations/
|   |   |-- migration_lock.toml
|   |   `-- 20260101000000_init/   # poori schema ek hi folder me (98 models)
|   `-- seed.ts
|-- src/
|   |-- constants/        # roles, permissions, statuses, http, countries, tracking
|   |-- messages/         # success, error, validation texts
|   |-- config/           # env, app, pagination, upload, jwt, otp, otp-policy,
|   |                     # password, rateLimit, encryption, currency, logger,
|   |                     # tracking, shipping, analytics, pdf, socket, payment,
|   |                     # setting + setting-defaults
|   |-- middlewares/      # auth, rbac, error, validate, rateLimit, upload,
|   |                     # requestId, encryption, maintenance, tracking, common
|   |-- modules/
|   |   |-- auth/         # register, login, otp, password, sessions, social, 2fa
|   |   |-- user/         # profile, addresses, account
|   |   |-- vendor/       # apply, kyc, payouts, ratings, wallet
|   |   |-- product/      # products, variants, inventory
|   |   |-- category/     # categories
|   |   |-- catalog/      # brand, tag, collection, attribute
|   |   |-- cart/         # cart, wishlist
|   |   |-- order/
|   |   |-- payment/      # payment, payout, return, wallet
|   |   |-- review/       # review, q&a, coupon, flashSale
|   |   |-- engagement/   # loyalty, referral, giftCard, template
|   |   |-- content/      # page, blog, faq, banner, contact, newsletter,
|   |   |                 # report, bulk, apiKey, webhook, currency, tax, country,
|   |   |                 # i18n, dropdown
|   |   |-- notification/ # notification, chat, ticket
|   |   |-- shipping/     # shipping, deliveryBoy, settings, admin, audit, activityLog
|   |   |-- analytics/    # tracking, device, analytics, search, upload
|   |   |-- system/       # version, maintenance
|   |   `-- health/       # /api/v1/health
|   |-- services/
|   |   |-- mail/mail.service.ts     # brevo → smtp → log
|   |   |-- sms/sms.service.ts       # msg91
|   |   |-- settings, audit, cloudinary, notification, pdf,
|   |   | socket, email, prisma, redis, logger, template
|   |-- utils/            # AppError, asyncHandler, ApiResponse, defaults,
|   |                     # serialize, pagination, crypto, geo, deviceParser,
|   |                     # slug, dates, calculations, validate
|   |-- jobs/             # bullmq workers + cron + deadletter.service.ts
|   |-- templates/        # default email HTML (DB row ki fallback)
|   |-- routes/           # /api/v1 aggregator
|   |-- docs/             # swagger spec
|   |-- types/            # ambient declarations
|   |-- app.ts
|   `-- server.ts
|-- scripts/              # dev tooling — build me compile nahi hota
|   |-- db.ts, apply-migrations.ts, db-reset.ts, seed-check.ts
|   |-- doctor.ts, env-sync.ts, pglite-server.ts
|   |-- comment-audit.ts, comment-normalise.ts
|   |-- route-dump.ts, route-param-audit.ts, generate-postman.ts
|   `-- e2e-*.ts, run-e2e.ps1
|-- tests/                # vitest
|-- .github/workflows/    # ci
|-- .env, .env.example    # .env.example generated — npm run env:sync
|-- .gitattributes
|-- .nvmrc
|-- render.yaml           # Render blueprint
|-- tsconfig.json         # typecheck + eslint ke liye (scripts/tests included)
|-- tsconfig.build.json   # build ke liye — sirf src/, dist/server.js banata hai
|-- vitest.config.ts
|-- docker-compose.yml
|-- package.json
|-- package-lock.json
|-- README.md            # operational README — setup, commands, deploy
`-- README.md           # setup + commands
```

Har module me: `<name>.routes.ts`, `<name>.controller.ts`, `<name>.service.ts`,
`<name>.schema.ts`, `<name>.types.ts`.

Entity serializer ka **ek hi registry** hai — `src/utils/serialize.ts`. Ek entity
ka shape do jagah define kabhi nahi hona chahiye, warna same record do alag JSON
shapes me chala jaayega. Module ka `<name>.serializer.ts` sirf us module ke
apne response shapes banata hai (`serializeProfile`, `serializeUserList`,
`serializeCategoryTree`, `serializeEstimate`) aur canonical entity serializer ko
import karke use karta hai — re-declare nahi karta. Canonical registry ko chahiye
se chhoti nested projection ke liye alag naam hota hai, jaise `serializeUserSummary`
(review author, activity-log actor, nested `userData`).

`npm test` me `serializer-registry.test.ts` ye guard karta hai: koi module serializer
canonical naam dobara declare kare to test fail ho jaata hai.

**Route prefix → module mapping** (`src/routes/index.ts` se):

| Module | Mounted prefixes |
| --- | --- |
| `auth/` | `/auth` |
| `user/` | `/users` |
| `vendor/` | `/vendors` |
| `product/` | `/products` |
| `category/` | `/categories` |
| `catalog/` | `/brands`, `/tags`, `/collections`, `/attributes` |
| `cart/` | `/cart`, `/wishlist` |
| `order/` | `/orders` |
| `payment/` | `/payments`, `/payouts`, `/returns`, `/wallet` |
| `review/` | `/reviews`, `/questions`, `/coupons`, `/flashSales` |
| `engagement/` | `/loyalty`, `/referral`, `/giftCards`, `/templates` |
| `content/` | `/pages`, `/blogs`, `/faqs`, `/banners`, `/contact`, `/newsletter`, `/countries`, `/currencies`, `/tax`, `/i18n`, `/content`, `/webhooks`, `/bulk`, `/reports`, `/apiKeys` |
| `notification/` | `/notifications`, `/chat`, `/tickets` |
| `shipping/` | `/shipping`, `/deliveryBoys`, `/settings`, `/admin`, `/auditLogs`, `/activityLogs` |
| `analytics/` | `/track`, `/devices`, `/analytics`, `/search`, `/uploads` |
| `system/` | `/version` |
| `health/` | `/health` |

**Build me kya jaata hai:** sirf `src/`. `tsconfig.build.json` `rootDir: ./src`
aur `outDir: ./dist` set karta hai, isliye entry `dist/server.js` banta hai aur
`tests/`, `scripts/`, `prisma/` image me nahi jaate.

---

---

## Prisma Models

- `User` (role, email, passwordHash, isActive)
- `VendorProfile` (userId, shopName, slug, status, commissionRate)
- `Category` (name, slug, parentId?)
- `Brand` (name, slug, logo, description)
- `Tag` (name)
- `Attribute` (name, type, options[])
- `Product` (vendorId, categoryId, brandId, name, slug, price, stock, images[], status, condition, warrantyMonths, warrantySummary, isNonReturnable)
- `ProductVariant` (productId, attributes{}, price, stock, sku)
- `Collection` (name, slug, type, productIds[], rules{})
- `Cart` / `CartItem`
- `Wishlist` / `WishlistItem`
- `Order`, `SubOrder`, `OrderItem`, `OrderTimeline`, `OrderTag`, `OrderNote`
- `Payment` (method, status, reference)
- `Refund`
- `Payout` (vendorId, amount, status, period)
- `ReturnRequest` / `ReturnItem` / `ReturnReason`
- `Review`
- `Question` / `Answer`
- `Coupon` / `CouponUsage`
- `FlashSale` / `FlashSaleItem`
- `Banner`
- `WalletTransaction`
- `LoyaltyTransaction`
- `Referral`
- `GiftCard`
- `Notification` / `NotificationPreference`
- `Conversation` / `Message`
- `Ticket` / `TicketMessage` / `TicketCategory` / `TicketNote`
- `CannedResponse`
- `Page` / `Blog` / `Faq` / `ContactSubmission` / `NewsletterSubscriber`
- `AuditLog` / `ActivityLog`
- `TaxConfig`
- `ShippingZone` / `ShippingMethod` / `Shipment` / `DeliveryBoy`
- `Currency` / `Country` / `State` / `City`
- `ApiKey` / `WebhookEndpoint` / `WebhookLog`
- `BulkJob` / `ReportSchedule`
- **`FailedJob`** (queue, jobName, jobId, payload, error, replayCount, status) — the dead letter queue; unique on `(queue, jobId)`
- **`SystemSetting`** (key, value Json, category, isPublic)
- **`RolePermission`** (role, permission)
- **`EmailTemplate`**, **`SmsTemplate`**, **`NotificationTemplate`**
- **`Translation`** (locale, key, value)
- **`Dropdown`** (type, options Json)
- **`RefreshToken`** (userId, tokenHash, expiresAt, revokedAt)
- **`PasswordHistory`** (userId, passwordHash) — the last N hashes, for the reuse check
- **`UserConsent`** (userId, type, version) — TERMS/PRIVACY/MARKETING audit trail
- **`Otp`** (id, identifier, type, channel, otpHash, expiresAt, attempts, createdAt)
- **`Session`** (id, userId, deviceId, ip, userAgent, geo{}, startedAt, endedAt, isActive)
- **`Device`** (id, deviceId, userId?, platform, os, osVersion, browser, model, fcmToken, isBlocked, isTrusted, lastSeenAt)
- **`VisitorLog`** (id, sessionId, deviceId, userId?, eventType, eventData Json, pageUrl, referrer, utm{}, geo{}, createdAt)
- **`PageView`** (id, sessionId, pageUrl, timeOnPage, scrollDepth, createdAt)
- **`Event`** (id, sessionId, name, meta Json, createdAt)
- **`CrashLog`** (id, deviceId, platform, appVersion, errorMessage, stack, breadcrumbs Json, createdAt)
- **`Funnel`** / **`FunnelStep`**

**Note:** DB mai `null` allowed ho sakta hai (Prisma level) but **serializer** null scrub karega.

---

---

## API Routes Outline

Every route in the API, straight off the OpenAPI spec. When this table and
`GET /api/v1/docs.json` disagree, the spec is right — it is generated from the
live Express router, whereas a hand-written list drifts.

```
/activityLogs
    GET            /activityLogs/getAll
/admin
    DELETE         /admin/deleteSubAdmin/{id}
    GET            /admin/getActivityLogs
    GET            /admin/getAllSubAdmins
    GET            /admin/getAuditLogs
    GET            /admin/getCronJobs
    GET            /admin/getDashboardStats
    GET            /admin/getFailedJobs
    GET            /admin/getPermissions
    GET            /admin/getSystemHealth
    PATCH          /admin/resolveFailedJob/{id}
    PATCH          /admin/toggleSubAdminStatus/{id}
    PATCH          /admin/updatePermissions/{id}
    PATCH          /admin/updateSubAdmin/{id}
    POST           /admin/clearCache
    POST           /admin/createSubAdmin
    POST           /admin/retryFailedJob/{id}
    POST           /admin/triggerJob
    DELETE         /admin/deleteFailedJob/{id}
/analytics
    GET            /analytics/export
    GET            /analytics/getAbandonedCarts
    GET            /analytics/getAppVersions
    GET            /analytics/getConversions
    GET            /analytics/getCrashes
    GET            /analytics/getCustomerCohorts
    GET            /analytics/getDeviceBreakdown
    GET            /analytics/getFunnel
    GET            /analytics/getGeoBreakdown
    GET            /analytics/getOverview
    GET            /analytics/getPageViews
    GET            /analytics/getProductPerformance
    GET            /analytics/getRealtime
    GET            /analytics/getRevenueReport
    GET            /analytics/getSearchTerms
    GET            /analytics/getSessionDetail/{id}
    GET            /analytics/getSessions
    GET            /analytics/getTopPages
    GET            /analytics/getTrafficSources
    GET            /analytics/getUniqueVisitors
    GET            /analytics/getVendorPerformance
    GET            /analytics/getVisitors
    GET            /analytics/getZeroResultSearches
    GET|POST       /analytics/funnels
    PATCH          /analytics/funnels/{id}
/apiKeys
    DELETE         /apiKeys/delete/{id}
    GET            /apiKeys/getAll
    GET            /apiKeys/getUsage/{id}
    PATCH          /apiKeys/revoke/{id}
    POST           /apiKeys/create
/attributes
    DELETE         /attributes/deleteAttribute/{id}
    GET            /attributes/getAll
    GET            /attributes/getById/{id}
    PATCH          /attributes/updateAttribute/{id}
    POST           /attributes/createAttribute
/auditLogs
    DELETE         /auditLogs/purge
    GET            /auditLogs/export
    GET            /auditLogs/getAll
    GET            /auditLogs/getByActor/{userId}
    GET            /auditLogs/getById/{id}
/auth
    DELETE         /auth/sessions/{id}
    GET            /auth/getMe
    GET            /auth/getMyConsents
    GET            /auth/sessions
    POST           /auth/acceptConsent
    POST           /auth/changeEmail
    POST           /auth/changeEmail/sendOtp
    POST           /auth/changeEmail/verifyOtp
    POST           /auth/changePassword
    POST           /auth/changePhone
    POST           /auth/checkAvailability
    POST           /auth/disable2FA
    POST           /auth/enable2FA
    POST           /auth/forgotPassword
    POST           /auth/linkSocial
    POST           /auth/login
    POST           /auth/login/verifyOtp
    POST           /auth/logout
    POST           /auth/logoutAllDevices
    POST           /auth/refreshToken
    POST           /auth/register
    POST           /auth/register/sendOtp
    POST           /auth/register/verifyOtp
    POST           /auth/resetPassword
    POST           /auth/restoreAccount
    POST           /auth/sendOtp
    POST           /auth/socialLogin
    POST           /auth/unlinkSocial
    POST           /auth/verify2FA
    POST           /auth/verifyEmail
    POST           /auth/verifyOtp
    POST           /auth/verifyPhone
/banners
    DELETE         /banners/delete/{id}
    GET            /banners/getAll
    PATCH          /banners/update/{id}
    POST           /banners/create
/blogs
    DELETE         /blogs/delete/{id}
    GET            /blogs/getAll
    GET            /blogs/getBySlug/{slug}
    PATCH          /blogs/update/{id}
    POST           /blogs/create
/brands
    DELETE         /brands/deleteBrand/{id}
    GET            /brands/getAll
    GET            /brands/getById/{id}
    GET            /brands/getBySlug/{slug}
    PATCH          /brands/updateBrand/{id}
    POST           /brands/createBrand
/bulk
    GET            /bulk/getJobHistory
    GET            /bulk/getJobStatus/{jobId}
    POST           /bulk/importOrders
    POST           /bulk/importProducts
    POST           /bulk/importUsers
/cannedResponses
    DELETE         /cannedResponses/delete/{id}
    GET            /cannedResponses/getAll
    PATCH          /cannedResponses/update/{id}
    POST           /cannedResponses/create
/cart
    DELETE         /cart/clearCart
    DELETE         /cart/removeCoupon
    DELETE         /cart/removeItem/{cartItemId}
    DELETE         /cart/savedForLater
    DELETE         /cart/savedForLater/{id}
    GET            /cart/getCart
    GET            /cart/getSavedForLater
    PATCH          /cart/updateItem
    PATCH          /cart/updateItemOptions/{cartItemId}
    POST           /cart/addItem
    POST           /cart/applyCoupon
    POST           /cart/estimate
    POST           /cart/mergeGuestCart
    POST           /cart/saveForLater
    POST           /cart/savedForLater/{id}/moveToCart
/priceWatches
    DELETE         /priceWatches/remove/{id}
    GET            /priceWatches/getAll
    POST           /priceWatches/watch
/categories
    DELETE         /categories/deleteCategory/{id}
    GET            /categories/getAll
    GET            /categories/getById/{id}
    GET            /categories/getBySlug/{slug}
    PATCH          /categories/updateCategory/{id}
    POST           /categories/bulkCreate
    POST           /categories/createCategory
    POST           /categories/reorder
/chat
    DELETE         /chat/deleteMessage/{id}
    GET            /chat/getBlocked
    GET            /chat/getConversations
    GET            /chat/getMessages/{conversationId}
    GET            /chat/getUnreadCount
    PATCH          /chat/markRead/{conversationId}
    POST           /chat/blockUser/{userId}
    POST           /chat/sendMessage
    POST           /chat/startConversation
    POST           /chat/unblock/{id}
/collections
    DELETE         /collections/deleteCollection/{id}
    GET            /collections/getAll
    GET            /collections/getById/{id}
    GET            /collections/getBySlug/{slug}
    GET            /collections/getProducts/{id}
    PATCH          /collections/updateCollection/{id}
    POST           /collections/createCollection
    POST           /collections/setProducts/{id}
/contact
    GET            /contact/getAll
    PATCH          /contact/{id}/markRead
    POST           /contact/submit
/content
    DELETE         /content/dropdowns/{id}/delete
    GET            /content/dropdowns
    PATCH          /content/dropdowns/{id}/update
    POST           /content/dropdowns/create
/countries
    GET            /countries/getAll
    GET            /countries/getCities/{stateCode}
    GET            /countries/getStates/{countryCode}
    POST           /countries/checkPincode
    POST           /countries/seedCountries
/coupons
    DELETE         /coupons/deleteCoupon/{id}
    GET            /coupons/getAll
    GET            /coupons/getById/{id}
    GET            /coupons/getUsages/{id}
    PATCH          /coupons/toggleStatus/{id}
    PATCH          /coupons/updateCoupon/{id}
    POST           /coupons/applyCoupon
    POST           /coupons/createCoupon
    POST           /coupons/validateCoupon
/currencies
    DELETE         /currencies/delete/{id}
    GET            /currencies/convert
    GET            /currencies/getAll
    PATCH          /currencies/update/{id}
    POST           /currencies/create
/deliveryBoys
    DELETE         /deliveryBoys/delete/{id}
    GET            /deliveryBoys/getAll
    GET            /deliveryBoys/getMyDeliveries
    PATCH          /deliveryBoys/toggleStatus/{id}
    PATCH          /deliveryBoys/update/{id}
    PATCH          /deliveryBoys/updateDeliveryStatus/{id}
    POST           /deliveryBoys/create
/devices
    DELETE         /devices/delete/{id}
    GET            /devices/getAll
    GET            /devices/getById/{id}
    GET            /devices/getByUser/{userId}
    GET            /devices/getTrusted
    PATCH          /devices/block/{id}
    PATCH          /devices/trust/{id}
    PATCH          /devices/unblock/{id}
    PATCH          /devices/untrust/{id}
/docs
    GET            /docs/
    GET            /docs/docs.json
    GET            /docs/swagger-ui-bundle.js
    GET            /docs/swagger-ui-standalone-preset.js
    GET            /docs/swagger-ui.css
/docs.json
    GET            /docs.json
/faqs
    DELETE         /faqs/delete/{id}
    GET            /faqs/getAll
    PATCH          /faqs/update/{id}
    POST           /faqs/create
/flashSales
    DELETE         /flashSales/delete/{id}
    GET            /flashSales/getActive
    GET            /flashSales/getAll
    GET            /flashSales/getBySlug/{slug}
    PATCH          /flashSales/update/{id}
    POST           /flashSales/create
/giftCards
    DELETE         /giftCards/delete/{id}
    GET            /giftCards/checkBalance/{code}
    GET            /giftCards/getAll
    PATCH          /giftCards/disable/{id}
    POST           /giftCards/create
    POST           /giftCards/redeem
/health
    GET            /health/
    GET            /health/db
    GET            /health/jobs/{jobId}
    GET            /health/queue
    GET            /health/redis
/i18n
    DELETE         /i18n/delete/{id}
    GET            /i18n/getLocales
    GET            /i18n/getTranslations/{locale}
    PATCH          /i18n/update/{id}
    POST           /i18n/bulkUpsert
    POST           /i18n/create
/loyalty
    GET            /loyalty/getHistory
    GET            /loyalty/getPoints
    GET            /loyalty/getTiers
    POST           /loyalty/adjust/{userId}
    POST           /loyalty/redeem
/newsletter
    GET            /newsletter/getAll
    POST           /newsletter/sendCampaign
    POST           /newsletter/subscribe
    POST           /newsletter/unsubscribe
/notifications
    DELETE         /notifications/delete/{id}
    DELETE         /notifications/deleteTemplate/{id}
    GET            /notifications/getAll
    GET            /notifications/getPreferences
    GET            /notifications/getTemplates
    GET            /notifications/getUnreadCount
    PATCH          /notifications/markAllRead
    PATCH          /notifications/markRead/{id}
    PATCH          /notifications/updatePreferences
    PATCH          /notifications/updateTemplate/{id}
    POST           /notifications/createTemplate
    POST           /notifications/registerDevice
    POST           /notifications/sendBulk
    POST           /notifications/unregisterDevice
/orders
    DELETE         /orders/removeNote/{id}/{noteId}
    DELETE         /orders/removeTag/{id}/{tagId}
    GET            /orders/getAll
    GET            /orders/getById/{id}
    GET            /orders/getInvoice/{id}
    GET            /orders/getNotes/{id}
    GET            /orders/getPackingSlip/{id}
    GET            /orders/getShippingLabel/{subOrderId}
    GET            /orders/getTags/{id}
    GET            /orders/getTimeline/{id}
    GET            /orders/getVendorOrders
    GET            /orders/track/{id}
    PATCH          /orders/approveReturn/{returnId}
    PATCH          /orders/assignDeliveryBoy/{subOrderId}
    PATCH          /orders/rejectReturn/{returnId}
    PATCH          /orders/updateStatus/{id}
    PATCH          /orders/updateVendorStatus/{subOrderId}
    POST           /orders/addNote/{id}
    POST           /orders/addTags/{id}
    POST           /orders/cancelOrder/{id}
    POST           /orders/placeOrder
    POST           /orders/reorder/{id}
    POST           /orders/returnRequest/{id}
    POST           /orders/verifyDeliveryOtp/{subOrderId}
/pages
    DELETE         /pages/delete/{id}
    GET            /pages/getAll
    GET            /pages/getBySlug/{slug}
    PATCH          /pages/update/{id}
    POST           /pages/create
/payments
    GET            /payments/getAll
    GET            /payments/getByOrder/{orderId}
    GET            /payments/getRefundHistory/{orderId}
    GET            /payments/methods
    GET            /payments/walletBalance
    PATCH          /payments/confirmPayment/{id}
    PATCH          /payments/markCodCollected/{orderId}
    POST           /payments/payBalance/{orderId}
    POST           /payments/payToken/{orderId}
    POST           /payments/razorpay/createOrder
    POST           /payments/razorpay/verify
    POST           /payments/refund/{id}
    POST           /payments/stripe/createIntent
    POST           /payments/verifyBank/{orderId}
    POST           /payments/verifyUpi/{orderId}
/payouts
    GET            /payouts/getAll
    GET            /payouts/getPendingAmount/{vendorId}
    GET            /payouts/getStatement/{vendorId}
    GET            /payouts/getSummary
    GET            /payouts/getVendorEarnings
    PATCH          /payouts/approvePayout/{id}
    PATCH          /payouts/rejectPayout/{id}
    PATCH          /payouts/updateStatus/{id}
    POST           /payouts/bulkApprove
    POST           /payouts/generateCycles
/products
    DELETE         /products/deleteImage/{id}/{imageId}
    DELETE         /products/deleteProduct/{id}
    GET            /products/exportCsv
    GET            /products/getAll
    GET            /products/getById/{id}
    GET            /products/getBySlug/{slug}
    GET            /products/getFilters
    GET            /products/getFrequentlyBought/{id}
    GET            /products/getRecentlyViewed
    GET            /products/getRecommended
    GET            /products/getRelated/{id}
    PATCH          /products/bulkDelete
    PATCH          /products/bulkUpdate
    PATCH          /products/toggleStatus/{id}
    PATCH          /products/updateProduct/{id}
    PATCH          /products/updateStock/{id}
    POST           /products/bulkCreate
    POST           /products/bulkImportCsv
    POST           /products/bulkPriceUpdate
    POST           /products/createProduct
    POST           /products/trackView/{id}
    POST           /products/uploadImages/{id}
/questions
    DELETE         /questions/delete/{id}
    GET            /questions/getAll/{productId}
    PATCH          /questions/approve/{id}
    POST           /questions/answer/{id}
    POST           /questions/ask
/referral
    GET            /referral/admin/getAll
    GET            /referral/getLeaderboard
    GET            /referral/getMyCode
    GET            /referral/getRewards
    PATCH          /referral/updateStatus/{id}
    POST           /referral/applyCode
    POST           /referral/complete/{id}
/reports
    DELETE         /reports/schedule/{id}/delete
    GET            /reports/customers
    GET            /reports/export/{type}
    GET            /reports/getSchedules
    GET            /reports/inventory
    GET            /reports/orders
    GET            /reports/payouts
    GET            /reports/products
    GET            /reports/returns
    GET            /reports/sales
    GET            /reports/tax
    GET            /reports/vendors
    PATCH          /reports/schedule/{id}/update
    POST           /reports/schedule
/returns
    GET            /returns/getAll
    GET            /returns/getById/{id}
    GET            /returns/getReasons
    PATCH          /returns/approve/{id}
    PATCH          /returns/markPickedUp/{id}
    PATCH          /returns/markReceived/{id}
    PATCH          /returns/processRefund/{id}
    PATCH          /returns/reject/{id}
    POST           /returns/addReason
    POST           /returns/createRequest
/reviews
    DELETE         /reviews/deleteReview/{id}
    GET            /reviews/getAll
    GET            /reviews/getSummary/{productId}
    PATCH          /reviews/approve/{id}
    PATCH          /reviews/reject/{id}
    PATCH          /reviews/updateReview/{id}
    POST           /reviews/addReview
    POST           /reviews/reply/{id}
    POST           /reviews/voteHelpful/{id}
/search
    DELETE         /search/recent/clear
    GET            /search/autocomplete
    GET            /search/global
    GET            /search/products
    GET            /search/recent
    GET            /search/trending
    GET            /search/vendors
/settings
    GET            /settings/getAll
    GET            /settings/getByCategory/{category}
    GET            /settings/getFeatureFlags
    GET            /settings/getMaintenance
    GET            /settings/getPublicSettings
    PATCH          /settings/toggleFeature
    PATCH          /settings/updateMaintenance
    PATCH          /settings/updateSetting
    POST           /settings/bulkUpdateSettings
    POST           /settings/resetToDefault
/shipping
    DELETE         /shipping/deleteMethod/{id}
    DELETE         /shipping/deleteZone/{id}
    GET            /shipping/getMethods
    GET            /shipping/getPartners
    GET            /shipping/getZones
    GET            /shipping/track/{awb}
    PATCH          /shipping/updateMethod/{id}
    PATCH          /shipping/updatePartner/{id}
    PATCH          /shipping/updateStatus/{id}
    PATCH          /shipping/updateZone/{id}
    POST           /shipping/calculateRate
    POST           /shipping/checkServiceability
    POST           /shipping/createMethod
    POST           /shipping/createPartner
    POST           /shipping/createShipment/{subOrderId}
    POST           /shipping/createZone
/tags
    DELETE         /tags/deleteTag/{id}
    GET            /tags/getAll
    POST           /tags/bulkCreate
    POST           /tags/createTag
/tax
    DELETE         /tax/delete/{id}
    GET            /tax/getConfigs
    PATCH          /tax/update/{id}
    POST           /tax/create
/templates
    DELETE         /templates/email/{key}/delete
    DELETE         /templates/notification/{key}/delete
    DELETE         /templates/sms/{key}/delete
    GET            /templates/email/getAll
    GET            /templates/notification/getAll
    GET            /templates/sms/getAll
    POST           /templates/email/upsert
    POST           /templates/email/{key}/render
    POST           /templates/notification/upsert
    POST           /templates/notification/{key}/render
    POST           /templates/sms/upsert
    POST           /templates/sms/{key}/render
/tickets
    DELETE         /tickets/delete/{id}
    DELETE         /tickets/removeNote/{id}/{noteId}
    GET            /tickets/getAll
    GET            /tickets/getById/{id}
    GET            /tickets/getCategories
    GET            /tickets/getNotes/{id}
    GET            /tickets/getStats
    PATCH          /tickets/assign/{id}
    PATCH          /tickets/close/{id}
    PATCH          /tickets/updateStatus/{id}
    POST           /tickets/addNote/{id}
    POST           /tickets/categories
    POST           /tickets/create
    POST           /tickets/reply/{id}
/track
    POST           /track/appInstall
    POST           /track/appOpen
    POST           /track/click
    POST           /track/conversion
    POST           /track/crash
    POST           /track/device
    POST           /track/error
    POST           /track/event
    POST           /track/funnel
    POST           /track/heartbeat
    POST           /track/pageView
    POST           /track/performance
    POST           /track/referrer
    POST           /track/scroll
    POST           /track/search
    POST           /track/session/end
    POST           /track/session/start
    POST           /track/utm
/uploads
    GET            /uploads/getSignedUrl
    POST           /uploads/deleteFile
    POST           /uploads/uploadDocument
    POST           /uploads/uploadImage
    POST           /uploads/uploadImage/single
    POST           /uploads/uploadMultiple
    POST           /uploads/uploadVideo
/users
    DELETE         /users/deleteAccount
    DELETE         /users/deleteAddress/{id}
    DELETE         /users/deleteUser/{id}
    GET            /users/getActivity/{id}
    GET            /users/getAddresses
    GET            /users/getAll
    GET            /users/getById/{id}
    GET            /users/getOrders/{id}
    GET            /users/getProfile
    PATCH          /users/setDefaultAddress/{id}
    PATCH          /users/toggleStatus/{id}
    PATCH          /users/updateAddress/{id}
    PATCH          /users/updateAvatar
    PATCH          /users/updateProfile
    PATCH          /users/updateUser/{id}
    POST           /users/addAddress
    POST           /users/impersonate/{id}
/vendors
    GET            /vendors/getAll
    GET            /vendors/getById/{id}
    GET            /vendors/getDocuments
    GET            /vendors/getPayoutHistory
    GET            /vendors/getProducts/{id}
    GET            /vendors/getProfile
    GET            /vendors/getRatings/{id}
    GET            /vendors/getStats
    PATCH          /vendors/approveVendor/{id}
    PATCH          /vendors/rejectVendor/{id}
    PATCH          /vendors/suspendVendor/{id}
    PATCH          /vendors/updateBankDetails/{id}
    PATCH          /vendors/updateCommission/{id}
    PATCH          /vendors/updateProfile
    PATCH          /vendors/verifyDocuments/{id}
    POST           /vendors/requestPayout
    POST           /vendors/uploadDocuments
/version
    GET            /version/
/wallet
    GET            /wallet/getBalance
    GET            /wallet/getTransactions
    POST           /wallet/addMoney
    POST           /wallet/adminCredit
    POST           /wallet/adminDebit
    POST           /wallet/useForOrder
/webhooks
    DELETE         /webhooks/delete/{id}
    GET            /webhooks/getAll
    GET            /webhooks/getLogs
    PATCH          /webhooks/{id}/update
    POST           /webhooks/payment-gateway/{provider}
    POST           /webhooks/razorpay
    POST           /webhooks/register
    POST           /webhooks/shipping
    POST           /webhooks/{id}/rotateSecret
/wishlist
    DELETE         /wishlist/clear
    DELETE         /wishlist/removeItem/{id}
    GET            /wishlist/checkProduct/{productId}
    GET            /wishlist/getAll
    POST           /wishlist/addItem
    POST           /wishlist/moveToCart/{id}
```

---

## Missing / Planned Features

Jo cheezein abhi **nahi** hain — koi endpoint nahi, koi model nahi, koi setting
nahi. Ye gap analysis se nikli hain, implementation nahi. Ye section sirf
document hai: koi bhi item yahan implement nahi hua hai.

Type column me do marker hain:

| Marker | Matlab |
| --- | --- |
| 🔴 | Truly Missing — koi endpoint, model ya setting exist hi nahi karti |
| 🟡 | Partial/Stub — endpoint ya setting hai, par actual kaam nahi karta |

Jin gaps ka kaam poora ho chuka hai, unhe is table se hata diya gaya hai — unka
naya behaviour ab [Catalog & Order Rules](#catalog--order-rules),
[Password](#password--srcconfigpasswordconfigts),
[Account Security Rules](#account-security-rules),
[Cart Rules](#cart-rules),
[Payment Rules](#payment-rules),
[Percentage Rules](#percentage-rules) and
[Job Retry & Dead Letter Rules](#job-retry--dead-letter-rules) mai documented hai.
Jo row ab bhi yahan hai, uska kaam adhoora hai ya bilkul nahi hua.

### 1. Auth & Security

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Account Recovery (no email)** | 🔴 | Email kho gaya to koi recovery nahi. | Alternate recovery (security questions, backup codes). Phone OTP recovery chalta hai. | User permanently locked out ho jata hai. Support load badhta hai. |
| **Login Notifications (every login)** | 🟡 | Sirf first-time-device pe alert. | Har login pe email/push with device + IP + location. | User ko pata chale koi aur login kiya. |

### 2. Customer / User

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Saved Payment Methods** | 🔴 | Har baar card/UPI dobara daalna padta hai. | Tokenized card/UPI save, 1-click pay. | Conversion rate 20-30% badhta hai. |
| **Customer Preferences** | 🟡 | Language/currency partial. | Notification channel prefs, timezone, digest frequency. | Personalization ke liye. |
| **Customer Segments** | 🔴 | Koi segment/tag nahi. | VIP, wholesale, blocked, new, repeat tags. | Targeted marketing ke liye. |
| **Customer Notes** | 🔴 | Admin customer pe note nahi likh sakta. | Internal notes with author + timestamp. | Support team coordination. |
| **Customer Timeline** | 🔴 | Orders, returns, tickets alag-alag. | Unified timeline (orders + returns + tickets + chats + logins). | Support agent ko full context milta hai. |
| **Customer Merge** | 🔴 | Duplicate accounts merge nahi. | Merge API with conflict resolution. | Duplicate accounts se data mess. |
| **Customer Export** | 🟡 | Reports me hai, per-customer nahi. | Single customer ka full data export (JSON/CSV). | DPDP right to access. |
| **DPDP Data Export** | 🔴 | Customer apna data download nahi kar sakta. | Self-service data export endpoint. | DPDP legal requirement. |
| **Customer Block/Ban** | 🟡 | Sirf `isActive` toggle. | Proper block with reason, duration, auto-unban. | Fraud/abuse rokne ke liye. |

### 3. Vendor

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Vendor Coupons** | 🔴 | `/coupons/createCoupon` sirf ADMIN. | Vendor-scoped coupon create/update/delete, vendor ke products pe apply. | Vendor growth ka #1 tool. Revenue 15-25% badhta hai. |
| **Vendor Flash Sales** | 🔴 | `/flashSales/create` sirf ADMIN. | Vendor apni flash sale schedule kar sake. | Festive sales, inventory clearance. |
| **Vendor Banners** | 🔴 | `/banners/create` sirf ADMIN. | Vendor store banner, product banner. | Store branding + promotion. |
| **Vendor Promoted Listings** | 🔴 | Koi paid promotion nahi. | Bid-based ad slots, CPC/CPM, budget cap. | Naya revenue stream. |
| **Vendor Bundle Offers** | 🔴 | Combo create nahi ho sakta. | Buy 2 get 1, combo pack, kit. | AOV badhane ke liye. |
| **Vendor Tiered Discounts** | 🔴 | Volume discount nahi. | Buy 5+ = 10% off, Buy 10+ = 20% off. | B2B/wholesale ke liye. |
| **Vendor Free Shipping** | 🔴 | Sirf global `shipping.freeAbove`. | Vendor apne products pe free shipping de sake. | Vendor ka competitive edge. |
| **Vendor Cashback** | 🔴 | Customer ko cashback nahi. | Vendor-funded wallet credit on purchase. | Repeat purchase badhta hai. |
| **Vendor Email/Push Campaign** | 🔴 | `/newsletter/sendCampaign` sirf ADMIN. | Vendor apne customers ko blast bhej sake. | Vendor retention tool. |
| **Vendor Referral Program** | 🔴 | `/referral/*` global. | Vendor-specific referral with own rewards. | Vendor ka growth loop. |
| **Vendor Loyalty Program** | 🔴 | `/loyalty/*` global. | Vendor-specific points program. | Vendor ke repeat customers. |
| **Vendor Gift Cards** | 🔴 | Global gift cards. | Vendor apne gift cards issue kare. | Vendor branding + revenue. |
| **Vendor Store Page** | 🔴 | Koi storefront nahi. | Logo, banner, about, policies, theme colors. | Vendor ki identity. |
| **Store Policies** | 🔴 | Global policies. | Per-vendor return, shipping, privacy. | Vendor ka apna policy. |
| **Store Vacation Mode** | 🔴 | Store pause nahi. | `isOnVacation` flag, orders block. | Vendor chhutti pe ja sake. |
| **Store Announcements** | 🔴 | Koi announcement nahi. | Store pe notice banner. | Vendor customer ko inform kare. |
| **Store Reviews** | 🔴 | Sirf product reviews. | Store-level rating + review. | Vendor reputation. |
| **Vendor Staff / Sub-Users** | 🔴 | Sirf 1 user per vendor. | Team members with role-based permissions. | Vendor team scale nahi kar sakta. |
| **Vendor Shipping Preferences** | 🔴 | `/shipping/createZone` sirf ADMIN. | Vendor apne zones/rates set kare. | Vendor apni shipping control kare. |
| **Vendor Tax Config** | 🔴 | Sirf admin-level `TaxConfig`. | Vendor GSTIN, HSN, tax rate. | India GST compliance. |
| **Vendor Return Policy** | 🔴 | Global `return.windowDays`. | Vendor apni return window. | Vendor ke business model. |
| **Vendor Inventory Alerts** | 🔴 | Low stock pe koi alert nahi. | Threshold-based email/push. | Stockout rokne ke liye. |
| **Vendor Restock Reminder** | 🔴 | Koi suggestion nahi. | Demand forecast + auto restock reminder. | Sales loss rokne ke liye. |
| **Vendor Bulk Order Accept/Reject** | 🔴 | Ek-ek order handle. | Bulk select + accept/reject. | Vendor time bachta hai. |
| **Vendor Order Notes** | 🔴 | Internal notes nahi. | Packing notes, internal comments. | Warehouse coordination. |
| **Vendor Dispute Resolution** | 🔴 | Koi dispute workflow nahi. | Customer-vendor dispute, admin mediation. | Trust building. |
| **Vendor Dashboard Analytics** | 🟡 | `getStats` hai. Deep analytics nahi. | Traffic, funnel, top products, cohorts. | Vendor informed decisions. |
| **Vendor Product Performance** | 🟡 | `/analytics/getProductPerformance` hai. Funnel nahi. | View → cart → order funnel per product. | Vendor conversion optimize kare. |
| **Vendor Traffic Sources** | 🔴 | Koi traffic data nahi. | Source, medium, campaign breakdown. | Marketing ROI. |
| **Vendor Customer Insights** | 🔴 | Repeat/LTV/churn nahi. | Customer segmentation vendor ke liye. | Retention strategy. |
| **Vendor Competitor Benchmark** | 🔴 | Category rank nahi. | Rank, competitor pricing, market share. | Competitive intelligence. |
| **Vendor Payout Forecast** | 🔴 | Next payout nahi pata. | Pending orders → expected payout. | Cash flow planning. |
| **Vendor Leaderboard** | 🔴 | Koi ranking nahi. | Top vendors, badges (Silver/Gold/Platinum). | Gamification. |
| **Vendor Performance Score** | 🔴 | Koi score nahi. | Fulfilment, cancellation, response time, rating. | Quality control. |
| **Vendor Subscription Plans** | 🔴 | Flat commission. | Free/Silver/Gold/Platinum SaaS plans. | New revenue model. |
| **Vendor Commission Tiers** | 🟡 | Flat + per-vendor override. | Category-wise, volume-based tiers. | Fairness + incentive. |
| **Vendor Featured Listing** | 🔴 | Koi featured section nahi. | Paid featured product slots. | Revenue + visibility. |
| **Vendor Sponsored Search** | 🔴 | Search me paid spot nahi. | Bid-based sponsored results. | Revenue. |
| **Vendor Ad Budget & Billing** | 🔴 | Koi ad wallet nahi. | Ad spend wallet, auto-debit, invoice. | Ad system chalane ke liye. |
| **Vendor ↔ Admin Chat** | 🔴 | Sirf customer-vendor chat. | Vendor admin se directly chat kare. | Support efficiency. |
| **Vendor Announcements** | 🔴 | Admin blast nahi bhej sakta. | Policy change, holiday, feature announcement. | Vendor communication. |
| **Vendor Onboarding Checklist** | 🔴 | Koi progress tracking nahi. | Registration → KYC → first product → first sale. | Vendor activation rate. |
| **Vendor Help Center** | 🔴 | Koi FAQ/guide nahi. | Vendor-specific docs, videos. | Support load kam. |
| **Vendor Notification Preferences** | 🔴 | Vendor customize nahi kar sakta. | Per-event channel prefs. | Vendor control. |
| **Vendor Fraud Detection** | 🔴 | Koi protection nahi. | Fake orders, fake reviews, coupon abuse. | Vendor trust. |
| **Vendor Chargeback Protection** | 🔴 | Koi alert nahi. | Chargeback alert + evidence upload. | Vendor loss rokne ke liye. |
| **Vendor Blacklist Customer** | 🔴 | Vendor blacklist nahi kar sakta. | Problematic customer blacklist. | Vendor safety. |
| **Vendor GST e-Invoice** | 🔴 | Koi e-invoice nahi. | IRN generate, GSTN integration. | India compliance. |
| **Vendor Payout Statement PDF** | 🟡 | `/payouts/getStatement` hai. Vendor download nahi. | Vendor self-service PDF download. | Vendor record keeping. |
| **Vendor TDS/GST TDS** | 🔴 | Koi TDS nahi. | Payout pe TDS deduction, certificate. | India tax compliance. |

### 4. Product / Catalog

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Product Approval Workflow** | 🔴 | Vendor create kare → direct live. | Admin approve/reject step. | Quality control. |
| **Product Draft / Scheduled Publish** | 🔴 | Sirf active/inactive. | Draft, schedule future publish. | Vendor planning. |
| **Product Versioning / Audit** | 🟡 | `AuditLog` hai, product-level nahi. | Per-product change history. | Dispute resolution. |
| **Digital Products** | 🔴 | Sirf physical. | Downloadable files, license keys. | Naya product category. |
| **Product Bundles / Kits** | 🔴 | Combo nahi. | Bundle with own pricing. | AOV badhta hai. |
| **Product Variants Matrix** | 🟡 | Partial. | Full size × color × material matrix. | Fashion/electronics ke liye. |
| **Custom Options / Personalization** | 🔴 | Koi custom field nahi. | Name engraving, custom text, upload. | Personalization products. |
| **Product Q&A Moderation Queue** | 🟡 | Approve/reject hai. Bulk nahi. | Bulk moderation with filters. | Admin efficiency. |
| **Product Compare API** | 🟡 | Flag hai, endpoints nahi. | Compare endpoint with attributes. | Conversion tool. |
| **Product Restock Notification** | 🔴 | "Notify me" nahi. | Out-of-stock pe email/push. | Lost sales recover. |
| **Product Import Mapping UI** | 🟡 | CSV import hai. Mapping nahi. | Column mapping, preview, validation. | Import UX. |
| **Product Feed (Google/Facebook)** | 🔴 | Koi feed nahi. | Shopping feed XML/CSV. | Google Shopping. |
| **Product Recall / Ban** | 🔴 | Admin ban nahi kar sakta. | Recall flag, notification to buyers. | Safety/compliance. |
| **Category Restrictions** | 🔴 | Koi restriction nahi. | Category-wise vendor allow/block. | Marketplace policy. |
| **Product Expiry / Batch** | 🔴 | Koi batch nahi. | Batch no, expiry, manufacturing date. | Pharma/food compliance. |
| **Product Serial / IMEI** | 🔴 | Koi serial nahi. | Serial tracking, warranty activation. | Electronics. |
| **Product Reviews with Media** | 🔴 | Sirf text review. | Image/video upload. | Trust + conversion. |
| **Product Size Chart** | 🔴 | Koi size chart nahi. | Fashion size chart per category. | Returns kam. |
| **Product Ingredients / Specs** | 🟡 | Partial attributes. | Structured ingredients, specs. | Food/cosmetics compliance. |
| **Product Cross-sell / Upsell Rules** | 🟡 | Manual related. Rules nahi. | Rule-based cross-sell. | AOV badhta hai. |
| **Product Frequently Bought Together** | 🟡 | Endpoint hai, algorithm nahi. | Actual co-purchase algorithm. | AOV. |

### 5. Cart

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Guest Cart Persistence** | 🟡 | `mergeGuestCart` hai. Storage partial. | Cookie/localStorage strategy. | Guest checkout. |
| **Cart Expiry Notification** | 🔴 | Koi reminder nahi. | Abandon hone se pehle email/push. | Abandoned cart recovery. |
| **Cart Sharing** | 🔴 | Cart link share nahi. | Shareable cart URL. | Social commerce. |
| **Cart Stock Hold** | 🟡 | `cart.holdMinutes` setting. Actual reservation nahi. | Real stock reservation during checkout. | Oversell rokne ke liye. |
| **Cart Per-Vendor Coupon** | 🔴 | Ek coupon. Multiple nahi. | Per-vendor coupon in multi-vendor cart. | Vendor coupons ke saath. |
| **Cart Scheduled Delivery** | 🔴 | Koi slot nahi. | Date/time slot selection. | Customer convenience. |

### 6. Order

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Partial Cancellation** | 🔴 | Full order cancel. | Item-level cancel. | Customer flexibility. |
| **Partial Shipment** | 🔴 | SubOrder full ship. | SubOrder ke andar bhi partial. | Multi-item orders. |
| **Order Edit** | 🔴 | Place ke baad edit nahi. | Window me edit (address, items). | Customer mistakes. |
| **Order Merge** | 🔴 | Multiple orders alag. | Same customer ke merge. | Shipping cost. |
| **Order Split** | 🔴 | Ek order split nahi. | Split into multiple. | Warehouse ops. |
| **Order Hold / On-hold** | 🔴 | Koi hold state nahi. | Payment issue pe hold. | Fraud prevention. |
| **Order Priority** | 🔴 | Koi priority nahi. | VIP order priority. | Premium customers. |
| **Order Attachments** | 🔴 | Koi attach nahi. | PO, prescription, KYC doc. | B2B orders. |
| **Order Credit Note** | 🔴 | Koi credit note nahi. | Return ke baad credit note. | GST compliance. |
| **Order Debit Note** | 🔴 | Koi debit note nahi. | Additional charge note. | GST compliance. |
| **Order e-Invoice (IRN)** | 🔴 | Koi e-invoice nahi. | IRN generate, GSTN API. | India compliance. |
| **Order e-Way Bill** | 🔴 | Koi e-way bill nahi. | Transport ke liye generate. | India compliance. |
| **Order Delivery OTP** | 🟡 | `verifyDeliveryOtp` hai. Partial. | Full OTP flow with retry. | Delivery proof. |
| **Order Proof of Delivery** | 🔴 | Koi POD nahi. | Photo, signature, geo. | Dispute proof. |
| **Order Delivery Attempts** | 🔴 | Koi tracking nahi. | Failed attempts count. | NDR flow. |
| **Order Reschedule Delivery** | 🔴 | Reschedule nahi. | Customer reschedule. | Flexibility. |
| **Order COD Reconciliation** | 🟡 | Partial. | Cash collection → deposit → reconcile. | Finance accuracy. |
| **Order Auto-complete** | 🔴 | Manual complete. | Delivered + N days → auto-complete. | Ops automation. |
| **Order Auto-cancel Unpaid** | 🟡 | Setting hai. Cron nahi. | Nightly job to cancel unpaid. | Inventory release. |
| **Order Reorder with Substitutions** | 🔴 | Reorder hai, substitute nahi. | Out-of-stock item substitute. | Conversion. |
| **Order Backorder** | 🟡 | `allowBackorder` setting. Flow nahi. | Backorder accept + fulfil later. | Lost sales recover. |

### 7. Payment

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Actual Razorpay/Stripe SDK** | 🟡 | Routes hain, SDK call nahi. | Actual SDK integration. | Live payment ke liye. |
| **Webhook Signature Verification** | 🟡 | Stub hai. | Actual HMAC verify. | Security. |
| **Webhook Retry + DLQ** | 🔴 | Koi retry nahi. | Failed webhook retry + DLQ. | Reliability. |
| **Payment Reconciliation** | 🔴 | Koi reconciliation nahi. | Daily settlement vs gateway. | Finance accuracy. |
| **Refund to Source** | 🟡 | Endpoint hai. Gateway call nahi. | Actual gateway refund API. | Customer trust. |
| **Payment Retry** | 🔴 | Koi retry nahi. | Failed payment retry. | Conversion. |
| **Payment Link** | 🔴 | Koi link nahi. | Shareable payment link. | B2B invoices. |
| **Payment Reminder** | 🟡 | `balanceReminderHours` setting. Job nahi. | Actual cron to remind. | Balance recovery. |
| **Split Payment** | 🟡 | Partial. | Wallet + card + COD mix. | Flexibility. |
| **Payment Dispute / Chargeback** | 🔴 | Koi dispute nahi. | Evidence upload, tracking. | Loss rokne ke liye. |
| **Payment Gateway Fallback** | 🔴 | Ek gateway. | Primary fail → secondary. | Uptime. |
| **Payment Method Restrictions** | 🟡 | Partial. | Per-category, per-amount. | Risk control. |

### 8. Shipping / Delivery

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Label Generation** | 🟡 | Endpoint hai. PDF nahi. | Actual label PDF. | Warehouse ops. |
| **Manifest Generation** | 🔴 | Koi manifest nahi. | Pickup manifest PDF. | Carrier pickup. |
| **Pickup Scheduling** | 🔴 | Manual pickup. | Carrier pickup API. No need now | Automation. |
| **AWB Assignment** | 🔴 | Manual AWB. | Auto AWB from carrier. No need now | Automation. |
| **Serviceability by Weight/Size** | 🟡 | Pincode check. Weight nahi. | Weight/size based serviceability. | Accuracy. |
| **Hyperlocal Delivery** | 🔴 | Koi hyperlocal nahi. | Same-day, 2-hour. | Quick commerce. |
| **Delivery Slots** | 🔴 | Koi slot nahi. | Time slot selection. | Customer convenience. |
| **Multi-Package Shipment** | 🔴 | Ek box. | Multiple boxes per order. | Large orders. |
| **Return Pickup** | 🟡 | Partial. | Reverse logistics API. | Returns. |
| **Delivery Boy Earnings** | 🔴 | Koi rider payout nahi. | Per-delivery earnings. | Rider retention. |
| **Delivery Boy Shift/Roster** | 🔴 | Koi roster nahi. | Shift management. | Ops. |
| **Delivery Proof** | 🟡 | OTP hai. | Photo, signature, geo. | Dispute proof. |
| **Delivery Attempts** | 🔴 | Koi tracking nahi. | Attempts count. | NDR. |
| **NDR (Non-Delivery Report)** | 🔴 | Koi NDR nahi. | NDR flow + reattempt. | Delivery success. |
| **RTO (Return to Origin)** | 🔴 | Koi RTO nahi. | RTO flow. | Loss control. |

### 9. Returns / Refunds

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Exchange / Replacement** | 🔴 | Sirf return-refund. | Exchange flow. | Customer preference. |
| **Partial Return** | 🟡 | Partial. | Item-level return. | Flexibility. |
| **Return QC** | 🔴 | Koi QC step nahi. | Received pe quality check. | Fraud rokne ke liye. |
| **Return Reason Analytics** | 🟡 | Partial. | Top reasons dashboard. | Product improvement. |
| **Return Fraud Detection** | 🔴 | Koi detection nahi. | Serial returner flag. | Loss rokne ke liye. |
| **Refund to Wallet vs Source** | 🟡 | `refund.mode` setting. Partial. | Actual routing. | Speed. |
| **Return Pickup Scheduling** | 🔴 | Manual. | Auto pickup. | UX. |
| **Return Window per Category** | 🔴 | Global window. | Category-wise. | Flexibility. |
| **Return Policy per Vendor** | 🔴 | Global. | Vendor-specific. | Vendor control. |
| **Return Credit Note** | 🔴 | Koi credit note nahi. | GST credit note. | Compliance. |

### 10. Reviews / Q&A

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Review with Images/Video** | 🔴 | Text only. | Media upload. | Trust. |
| **Review Verification Badge** | 🟡 | Partial. | Verified purchase badge. | Trust. |
| **Review Moderation Queue** | 🟡 | Approve/reject. Bulk nahi. | Bulk moderation. | Admin efficiency. |
| **Review Reply Threading** | 🟡 | Flat reply. | Nested threads. | Conversation. |
| **Review Fraud Detection** | 🔴 | Koi detection nahi. | Fake review detection. | Trust. |
| **Q&A Follow** | 🔴 | Koi follow nahi. | Follow question. | Engagement. |
| **Q&A Notification** | 🟡 | Partial. | Answer aane pe notify. | Engagement. |

### 11. Coupons / Promotions

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Vendor Coupons** | 🔴 | Sirf admin. | Vendor-scoped coupons. | Vendor growth. |
| **Category/Brand/Product Coupon** | 🟡 | Partial. | Full scoping. | Targeting. |
| **Customer-specific Coupon** | 🔴 | Koi customer-specific nahi. | Assign to specific customer. | Loyalty. |
| **First-order Coupon** | 🔴 | Koi first-order nahi. | Auto-apply new users. | Acquisition. |
| **Referral Coupon** | 🔴 | Koi referral coupon nahi. | Referrer + referee coupon. | Growth. |
| **Coupon Stacking Rules** | 🟡 | `stackable` hai. Complex nahi. | Rule engine. | Flexibility. |
| **Coupon Budget Cap** | 🟡 | Partial. | Total discount cap. | Loss control. |
| **Coupon Fraud Detection** | 🔴 | Koi detection nahi. | Abuse detection. | Loss. |
| **Coupon A/B Testing** | 🔴 | Koi A/B nahi. | Variant testing. | Optimization. |
| **Coupon Analytics** | 🟡 | Usage hai. ROI nahi. | ROI dashboard. | Marketing. |
| **Bundle Discount** | 🔴 | Koi bundle nahi. | Bundle pricing. | AOV. |
| **Cart-level Discount** | 🟡 | Partial. | Cart total discount. | AOV. |
| **Free Gift with Purchase** | 🔴 | Koi free gift nahi. | Auto-add gift. | AOV. |
| **Loyalty-based Discount** | 🔴 | Koi loyalty discount nahi. | Tier-based discount. | Loyalty. |
| **Abandoned Cart Coupon** | 🔴 | Koi auto coupon nahi. | Cart recovery coupon. | Conversion. |

### 12. Wallet / Loyalty / Referral / Gift Cards

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Wallet Withdrawal** | 🔴 | Koi withdrawal nahi. | Bank withdrawal. | Trust. |
| **Loyalty Tiers** | 🟡 | `getTiers` hai. Upgrade nahi. | Auto tier upgrade. | Loyalty. |
| **Loyalty Redemption Catalog** | 🔴 | Koi catalog nahi. | Points → products. | Redemption. |
| **Referral Fraud Detection** | 🔴 | Koi detection nahi. | Self-referral block. | Loss. |
| **Referral Multi-level** | 🔴 | Koi multi-level nahi. | 2-level referral. | Growth. |
| **Referral Payout** | 🟡 | Partial. | Cash vs points choice. | Flexibility. |
| **Gift Card Partial Redemption** | 🟡 | Partial. | Balance carry forward. | UX. |
| **Gift Card Transfer** | 🔴 | Koi transfer nahi. | Gift to friend. | Social. |
| **Gift Card Bulk Issue** | 🔴 | Koi bulk nahi. | Corporate bulk. | B2B. |
| **Gift Card Design** | 🔴 | Koi design nahi. | Custom templates. | Branding. |

### 13. Notifications

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **FCM Push Actual Implementation** | 🟡 | Settings hain. Code nahi. | Actual FCM send. | Engagement. |
| **In-app Notification Center** | 🟡 | `getAll` hai. Realtime partial. | Real-time center. | UX. |
| **Notification Scheduling** | 🔴 | Koi scheduling nahi. | Schedule future send. | Campaigns. |
| **Notification A/B Testing** | 🔴 | Koi A/B nahi. | Variant testing. | Optimization. |
| **Notification Digest** | 🔴 | Koi digest nahi. | Daily/weekly. | Frequency control. |
| **Notification Quiet Hours** | 🔴 | Koi quiet hours nahi. | Do-not-disturb window. | UX. |
| **Notification Frequency Cap** | 🔴 | Koi cap nahi. | Per-user cap. | Anti-spam. |
| **Notification Retry** | 🔴 | Koi retry nahi. | Failed retry. | Reliability. |
| **Notification Analytics** | 🔴 | Koi analytics nahi. | Delivered, opened, clicked. | Optimization. |
| **Notification Templates Multilingual** | 🔴 | Single language. | Per-locale templates. | i18n. |
| **Push Deep Linking** | 🔴 | Koi deep link nahi. | Open specific screen. | UX. |
| **Rich Push (image, action buttons)** | 🔴 | Plain text. | Rich media. | Engagement. |

### 14. Chat / Tickets

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Chat File/Image Upload** | 🔴 | Sirf text. | File/image upload. | Support. |
| **Chat Assignment** | 🔴 | Koi assignment nahi. | Agent assign. | Ops. |
| **Chat SLA Tracking** | 🔴 | Koi SLA nahi. | Response time SLA. | Quality. |
| **Chat CSAT Survey** | 🔴 | Koi CSAT nahi. | Post-chat survey. | Quality. |
| **Ticket SLA / Escalation** | 🔴 | Koi SLA nahi. | Auto escalation. | Quality. |
| **Ticket Canned Responses** | 🔴 | Koi canned nahi. | Pre-written. | Speed. |
| **Ticket Attachments** | 🔴 | Koi attach nahi. | File upload. | Support. |
| **Ticket Merge** | 🔴 | Koi merge nahi. | Merge duplicates. | Ops. |
| **Ticket CSAT** | 🔴 | Koi CSAT nahi. | Post-resolution survey. | Quality. |
| **Knowledge Base / Help Center** | 🔴 | Koi KB nahi. | Self-service docs. | Support load. |

### 15. Content

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Content Versioning** | 🔴 | Koi version nahi. | Revision history. | Editorial. |
| **Content Scheduling** | 🔴 | Koi scheduling nahi. | Future publish. | Editorial. |
| **Content Localization** | 🟡 | i18n hai. Content per-locale nahi. | Multi-locale content. | i18n. |
| **Content Sitemap** | 🔴 | Koi sitemap nahi. | Auto sitemap.xml. | SEO. |
| **Content RSS Feed** | 🔴 | Koi RSS nahi. | Auto RSS. | Distribution. |
| **Content Comments** | 🔴 | Koi comments nahi. | Blog comments. | Engagement. |
| **Content Categories/Tags** | 🟡 | Partial. | Blog taxonomy. | Discovery. |
| **Content Author** | 🔴 | Koi author nahi. | Author profile. | Attribution. |
| **Content Preview** | 🔴 | Koi preview nahi. | Draft preview. | Editorial. |
| **Banner Scheduling** | 🟡 | Partial. | Start/end date. | Campaigns. |
| **Banner Targeting** | 🔴 | Koi targeting nahi. | Audience, geo, device. | Personalization. |
| **Banner A/B Testing** | 🔴 | Koi A/B nahi. | Variant testing. | Optimization. |
| **Banner Click Tracking** | 🔴 | Koi tracking nahi. | CTR tracking. | Analytics. |
| **Popup / Modal Management** | 🔴 | Koi popup nahi. | Popup builder. | Conversion. |
| **Announcement Bar** | 🔴 | Koi announcement nahi. | Top bar announcement. | Communication. |
| **Cookie Consent** | 🔴 | Koi consent nahi. | DPDP cookie banner. | Compliance. |

### 16. Search

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Search Engine (Meilisearch/ES)** | 🟡 | Postgres search. Scale nahi. | Dedicated engine. | Performance. |
| **Typo Tolerance** | 🔴 | Koi typo tolerance nahi. | Fuzzy match. | UX. |
| **Synonyms** | 🔴 | Koi synonym nahi. | Custom synonyms. | Recall. |
| **Zero-result Recovery** | 🟡 | `getZeroResultSearches` hai. Action nahi. | Fallback suggestions. | Conversion. |
| **Search Filters Facets** | 🟡 | `getFilters` hai. Dynamic partial. | Dynamic facets. | UX. |

### 17. Admin / System

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Admin Impersonation Audit** | 🟡 | `impersonate` hai. Log partial. | Full audit trail. | Security. |
| **Admin Approval Workflow** | 🔴 | Koi multi-level nahi. | Multi-level approvals. | Governance. |
| **Admin Bulk Operations** | 🟡 | Partial. | Full bulk actions. | Efficiency. |
| **Admin Notification Center** | 🔴 | Koi center nahi. | Admin alerts. | Ops. |
| **Admin Dashboard Widgets** | 🔴 | Koi widgets nahi. | Configurable widgets. | UX. |
| **Admin Saved Filters** | 🔴 | Koi saved filters nahi. | Save filter presets. | Efficiency. |
| **Admin Custom Reports** | 🟡 | `reports` hai. Builder nahi. | Report builder. | Flexibility. |
| **Admin Scheduled Reports** | 🟡 | `schedule` hai. Cron partial. | Actual cron delivery. | Automation. |
| **Admin Data Import** | 🟡 | Users, orders partial. | Full import. | Migration. |
| **Admin System Alerts** | 🟡 | Partial. | DB down, queue stuck alerts. | Ops. |
| **Admin Feature Flag UI** | 🟡 | API hai. UI nahi. | Admin UI. | Usability. |
| **Admin Audit Log Retention** | 🟡 | `purge` hai. Policy nahi. | Retention policy. | Compliance. |
| **Admin Session Timeout** | 🔴 | Koi timeout nahi. | Idle timeout. | Security. |
| **Admin Activity Feed** | 🔴 | Koi feed nahi. | Real-time activity. | Ops. |

### 18. i18n / Currency / Tax / Geo

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **GSTIN Validation** | 🔴 | Koi validation nahi. | GSTN API validation. | Compliance. |
| **HSN Code Mapping** | 🔴 | Koi HSN nahi. | HSN per product. | GST. |
| **e-Invoice / e-Way Bill** | 🔴 | Koi e-invoice nahi. | IRN, e-way bill. | India compliance. |
| **TDS / TCS** | 🔴 | Koi TDS nahi. | TDS/TCS deduction. | India tax. |

### 19. Bulk / Import / Export

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Import Column Mapping** | 🔴 | Koi mapping nahi. | Column map UI. | Import UX. |
| **Import Validation Preview** | 🔴 | Koi preview nahi. | Preview before commit. | Data safety. |
| **Import Rollback** | 🔴 | Koi rollback nahi. | Undo import. | Data safety. |
| **Import Scheduling** | 🔴 | Koi scheduling nahi. | Schedule imports. | Automation. |
| **Export Streaming** | 🟡 | Partial. | Streaming for large. | Performance. |
| **Export Templates** | 🔴 | Koi templates nahi. | Saved export formats. | Efficiency. |

### 20. API Keys / Webhooks

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **API Key Authentication Middleware** | 🟡 | Routes hain. Auth nahi. | Actual middleware. | Third-party access. |
| **API Key Scopes/Permissions** | 🔴 | Koi scopes nahi. | Scope-based access. | Security. |
| **API Key Rate Limit** | 🔴 | Koi per-key limit nahi. | Per-key throttle. | Fairness. |
| **API Key Expiry** | 🔴 | Koi expiry nahi. | TTL on keys. | Security. |
| **API Key Usage Analytics** | 🟡 | `getUsage` hai. Deep nahi. | Full analytics. | Monitoring. |
| **Webhook Retry + DLQ** | 🔴 | Koi retry nahi. | Retry policy + DLQ. | Reliability. |
| **Webhook Signature** | 🟡 | Partial. | Full HMAC. | Security. |
| **Webhook Event Filtering** | 🔴 | Koi filter nahi. | Subscribe specific events. | Efficiency. |
| **Webhook Payload Versioning** | 🔴 | Koi versioning nahi. | API versioning. | Compatibility. |
| **Webhook Testing Tool** | 🔴 | Koi test tool nahi. | Test endpoint. | DX. |
| **Webhook Replay** | 🔴 | Koi replay nahi. | Replay events. | Debugging. |

### 21. Uploads

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Image Optimization** | 🟡 | Cloudinary partial. | WebP, compression. | Performance. |
| **Image Variants** | 🟡 | Cloudinary partial. | Thumbnail, medium, large. | Performance. |
| **CDN Invalidation** | 🔴 | Koi invalidation nahi. | Purge cache. | Freshness. |
| **Upload Progress** | 🔴 | Koi progress nahi. | Progress events. | UX. |
| **Chunked Upload** | 🔴 | Koi chunked nahi. | Large file chunking. | UX. |
| **Resumable Upload** | 🔴 | Koi resumable nahi. | Resume failed uploads. | UX. |
| **Direct-to-Cloud Upload** | 🟡 | Signed URL hai. Actual partial. | Full direct upload. | Performance. |
| **Upload Retention Policy** | 🔴 | Koi policy nahi. | Auto-delete old. | Storage. |

### 22. Jobs / Queue

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Job Dashboard (Bull Board)** | 🔴 | Koi dashboard nahi. | Bull Board UI. | Ops. |
| **Job Scheduling UI** | 🔴 | Koi UI nahi. | Schedule management. | Ops. |
| **Job Metrics** | 🔴 | Koi metrics nahi. | Prometheus metrics. | Monitoring. |
| **Job Alerting** | 🔴 | Koi alert nahi. | Failed job alerts. | Ops. |
| **Cron Job Management** | 🟡 | `getCronJobs`, `triggerJob` hai. Actual partial. | Full cron mgmt. | Ops. |

### 23. Realtime / Socket

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Socket JWT Auth** | 🔴 | Koi auth nahi. | Handshake JWT verify. | Security. |
| **Redis Adapter** | 🔴 | Koi adapter nahi. | Multi-instance scaling. | Scale. |
| **Room-based Delivery** | 🟡 | Partial. | Full room system. | Efficiency. |
| **Presence** | 🟡 | Partial. | Online/offline tracking. | UX. |
| **Read Receipts** | 🟡 | Partial. | Message read status. | UX. |
| **Live Support Chat** | 🟡 | Partial. | Full live chat. | Support. |
| **Socket Rate Limit** | 🔴 | Koi limit nahi. | Per-socket throttle. | Abuse. |
| **Socket Reconnection** | 🔴 | Koi reconnection nahi. | Auto-reconnect. | UX. |

### 24. Infrastructure / Ops

| Feature | Type | Abhi Kya Hai | Kya Missing | Kyun Zaroori |
| --- | --- | --- | --- | --- |
| **Idempotency** | 🟢 | Payment writes key-protected. | Extend to every write route. | Duplicate rokne ke liye. |
| **Observability (Sentry, OTel, Prometheus)** | 🔴 | Sirf pino logs. | Full observability. | Debugging. |
| **Alerting (PagerDuty, Slack)** | 🔴 | Koi alert nahi. | Alert channels. | Ops. |
| **Backup & DR** | 🔴 | Koi backup nahi. | Automated backup. | Data safety. |
| **CSRF Protection** | 🔴 | Koi CSRF nahi. | CSRF token. | Security. |
| **WAF** | 🔴 | Koi WAF nahi. | Cloudflare WAF. | Security. |
| **DB Partitioning** | 🔴 | Koi partition nahi. | Logs/analytics partition. | Scale. |
| **Caching Strategy (Redis)** | 🟡 | Partial. | Full cache layer. | Performance. |
| **Compliance (DPDP, PCI)** | 🔴 | Koi compliance nahi. | Full compliance. | Legal. |
