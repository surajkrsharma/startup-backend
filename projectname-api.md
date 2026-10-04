# PART — API (`projectname-api`)

Ye **sirf backend** hai. Sabhi web apps + Android + iOS isko consume karenge.

---

## 1. Tech Stack (API only)

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

## 2. API ke liye zaruri

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
| **Session management** | Redis-backed session store — device-wise revoke possible |
| **2FA TOTP** | `speakeasy` — optional per-user enable |
| **KYC / docs upload** | Vendor GST/PAN/Aadhaar verify flow |
| **Bulk import/export** | CSV/Excel endpoints for products, orders, users |
| **Feature flags** | `SystemSetting` category=feature — client boot pe fetch |
| **Maintenance mode** | Admin ON kare → 503 except `/health`, `/docs`, `/admin/*` |
| **PDF generation** | Invoice, packing slip, payout statement — `pdfkit` |
| **Geo serviceability** | Pincode → serviceable check (per vendor/zone) |

---

## 3. Centralized Strings, Constants & Dynamic Config

Rule: **Kahin bhi hardcoded string, message, ya number nahi.** Sab kuch ek jagah se aayega.

### 3.1 Two-Layer Approach

| Layer | Kahan Store | Kab Use |
| --- | --- | --- |
| **Static Layer** | Code files (`src/constants/`, `src/messages/`) | Jo rarely badalta hai (roles, enums, HTTP codes) |
| **Dynamic Layer** | Database table `SystemSetting` (+ Redis cache) | Jo admin runtime pe change kar sake (site name, commission, feature flags) |

### 3.2 Example — `src/constants/roles.ts`

```tsx
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SUB_ADMIN: 'SUB_ADMIN',
  VENDOR: 'VENDOR',
  CUSTOMER: 'CUSTOMER',
  DELIVERY_BOY: 'DELIVERY_BOY',
} as const;

export type Role = keyof typeof ROLES;

export const REGISTER_TYPE = {
  CUSTOMER: 'CUSTOMER',
  VENDOR: 'VENDOR',
} as const;

export type RegisterType = keyof typeof REGISTER_TYPE;

export const OTP_TYPE = {
  REGISTER: 'REGISTER',
  FORGOT_PASSWORD: 'FORGOT_PASSWORD',
  LOGIN: 'LOGIN',
  PHONE_VERIFY: 'PHONE_VERIFY',
  EMAIL_VERIFY: 'EMAIL_VERIFY',
  TWO_FA: 'TWO_FA',
} as const;

export type OtpType = keyof typeof OTP_TYPE;

export const SOCIAL_PROVIDER = {
  GOOGLE: 'GOOGLE',
  APPLE: 'APPLE',
  FACEBOOK: 'FACEBOOK',
} as const;

export const PLATFORM = {
  ANDROID: 'ANDROID',
  IOS: 'IOS',
  WEB: 'WEB',
} as const;

export const PAYMENT_METHOD = {
  COD: 'COD',
  UPI: 'UPI',
  BANK: 'BANK',
  CARD: 'CARD',
  NETBANKING: 'NETBANKING',
  WALLET: 'WALLET',
  RAZORPAY: 'RAZORPAY',
  STRIPE: 'STRIPE',
} as const;

export const ORDER_STATUS = {
  PENDING: 'PENDING',
  PENDING_TOKEN: 'PENDING_TOKEN',
  CONFIRMED: 'CONFIRMED',
  SHIPPED: 'SHIPPED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  RETURNED: 'RETURNED',
} as const;

export const RETURN_STATUS = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PICKED_UP: 'PICKED_UP',
  RECEIVED: 'RECEIVED',
  REFUNDED: 'REFUNDED',
} as const;

export const TICKET_STATUS = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;

export const TRACKING_EVENT = {
  APP_OPEN: 'app_open',
  APP_INSTALL: 'app_install',
  APP_UPDATE: 'app_update',
  SIGNUP_START: 'signup_start',
  SIGNUP_COMPLETE: 'signup_complete',
  LOGIN: 'login',
  LOGOUT: 'logout',
  PRODUCT_VIEW: 'product_view',
  CATEGORY_VIEW: 'category_view',
  SEARCH: 'search',
  FILTER_APPLY: 'filter_apply',
  ADD_TO_CART: 'add_to_cart',
  REMOVE_FROM_CART: 'remove_from_cart',
  ADD_TO_WISHLIST: 'add_to_wishlist',
  CHECKOUT_START: 'checkout_start',
  ADDRESS_ADD: 'address_add',
  PAYMENT_INIT: 'payment_init',
  PAYMENT_SUCCESS: 'payment_success',
  PAYMENT_FAIL: 'payment_fail',
  ORDER_PLACED: 'order_placed',
  ORDER_CANCELLED: 'order_cancelled',
  ORDER_RETURNED: 'order_returned',
  REVIEW_SUBMIT: 'review_submit',
  COUPON_APPLY: 'coupon_apply',
  COUPON_FAIL: 'coupon_fail',
  SHARE: 'share',
  CONTACT_CLICK: 'contact_click',
  CHAT_OPEN: 'chat_open',
  CHAT_SEND: 'chat_send',
  PUSH_RECEIVED: 'push_received',
  PUSH_CLICK: 'push_click',
} as const;

export const NOTIFICATION_CHANNEL = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH: 'PUSH',
  WHATSAPP: 'WHATSAPP',
  IN_APP: 'IN_APP',
} as const;
```

### 3.3 Example — `src/messages/success.ts`

```tsx
export const SUCCESS = {
  AUTH: {
    REGISTERED_CUSTOMER: 'Customer registered successfully.',
    REGISTERED_VENDOR: 'Vendor registered successfully.',
    LOGGED_IN: 'Logged in successfully.',
    LOGGED_OUT: 'Logged out successfully.',
    TOKEN_REFRESHED: 'Token refreshed.',
    OTP_SENT: 'OTP sent successfully.',
    OTP_VERIFIED: 'OTP verified successfully.',
    PASSWORD_RESET: 'Password reset successfully.',
    PROFILE_UPDATED: 'Profile updated successfully.',
    PASSWORD_UPDATED: 'Password updated successfully.',
    SOCIAL_LINKED: 'Social account linked successfully.',
    SOCIAL_UNLINKED: 'Social account unlinked.',
    SESSION_REVOKED: 'Session revoked.',
    TWO_FA_ENABLED: 'Two-factor authentication enabled.',
    TWO_FA_DISABLED: 'Two-factor authentication disabled.',
  },
  PRODUCT: {
    CREATED: 'Product created successfully.',
    UPDATED: 'Product updated successfully.',
    DELETED: 'Product deleted successfully.',
    BULK_UPDATED: 'Products bulk updated successfully.',
    IMAGES_UPLOADED: 'Images uploaded successfully.',
    STOCK_UPDATED: 'Stock updated successfully.',
  },
  ORDER: {
    PLACED: 'Order placed successfully.',
    CANCELLED: 'Order cancelled.',
    STATUS_UPDATED: 'Order status updated.',
    REORDERED: 'Order re-created successfully.',
    TRACKED: 'Order tracking fetched.',
  },
  CART: {
    ITEM_ADDED: 'Item added to cart.',
    ITEM_UPDATED: 'Cart updated.',
    ITEM_REMOVED: 'Item removed.',
    CART_CLEARED: 'Cart cleared.',
    COUPON_APPLIED: 'Coupon applied.',
    COUPON_REMOVED: 'Coupon removed.',
  },
  WISHLIST: {
    ADDED: 'Added to wishlist.',
    REMOVED: 'Removed from wishlist.',
    CLEARED: 'Wishlist cleared.',
    MOVED_TO_CART: 'Moved to cart.',
  },
  PAYMENT: {
    TOKEN_PAID: 'Token payment recorded.',
    BALANCE_PAID: 'Balance payment recorded.',
    VERIFIED: 'Payment verified.',
    REFUND_INITIATED: 'Refund initiated.',
  },
  PAYOUT: {
    REQUESTED: 'Payout requested.',
    APPROVED: 'Payout approved.',
    REJECTED: 'Payout rejected.',
    GENERATED: 'Payout cycle generated.',
  },
  REVIEW: {
    ADDED: 'Review added.',
    UPDATED: 'Review updated.',
    DELETED: 'Review deleted.',
    APPROVED: 'Review approved.',
    REJECTED: 'Review rejected.',
    REPLIED: 'Reply posted.',
  },
  RETURN: {
    REQUESTED: 'Return requested.',
    APPROVED: 'Return approved.',
    REJECTED: 'Return rejected.',
    PICKED_UP: 'Return picked up.',
    RECEIVED: 'Return received.',
    REFUNDED: 'Refund processed.',
  },
  TICKET: {
    CREATED: 'Ticket created.',
    REPLIED: 'Reply sent.',
    UPDATED: 'Ticket updated.',
    CLOSED: 'Ticket closed.',
  },
  CHAT: {
    STARTED: 'Conversation started.',
    MESSAGE_SENT: 'Message sent.',
    READ: 'Marked as read.',
  },
  NOTIFICATION: {
    FETCHED: 'Notifications fetched.',
    MARKED_READ: 'Marked as read.',
    DEVICE_REGISTERED: 'Device registered.',
    PREFERENCES_UPDATED: 'Preferences updated.',
    BULK_SENT: 'Notification blast sent.',
  },
  WALLET: {
    BALANCE_FETCHED: 'Wallet balance fetched.',
    ADDED: 'Money added to wallet.',
    DEBITED: 'Wallet debited.',
  },
  COUPON: {
    CREATED: 'Coupon created.',
    UPDATED: 'Coupon updated.',
    DELETED: 'Coupon deleted.',
    VALIDATED: 'Coupon is valid.',
  },
  SETTING: {
    UPDATED: 'Setting updated.',
    BULK_UPDATED: 'Settings bulk updated.',
    RESET: 'Settings reset to default.',
  },
  COMMON: {
    CREATED: 'Created successfully.',
    UPDATED: 'Updated successfully.',
    DELETED: 'Deleted successfully.',
    FETCHED: 'Fetched successfully.',
  },
};
```

### 3.4 Example — `src/messages/error.ts`

```tsx
export const ERROR = {
  AUTH: {
    INVALID_CREDENTIALS: 'Invalid email or password.',
    UNAUTHORIZED: 'You are not authorized.',
    TOKEN_EXPIRED: 'Session expired, please log in again.',
    EMAIL_EXISTS: 'Email is already registered.',
    PHONE_EXISTS: 'Phone number is already registered.',
    INVALID_REGISTER_TYPE: 'Invalid register type.',
    VENDOR_DETAILS_REQUIRED: 'Vendor shop details required.',
    INVALID_OTP_TYPE: 'Invalid OTP type.',
    OTP_INVALID: 'Invalid or expired OTP.',
    OTP_MAX_ATTEMPTS: 'Maximum OTP attempts reached.',
    OTP_RESEND_COOLDOWN: 'Please wait before requesting another OTP.',
    ACCOUNT_SUSPENDED: 'Your account is suspended.',
    SESSION_EXPIRED: 'Session expired, please log in again.',
    SOCIAL_PROVIDER_INVALID: 'Social provider not supported.',
    TWO_FA_REQUIRED: '2FA verification required.',
    TWO_FA_INVALID: 'Invalid 2FA code.',
  },
  PRODUCT: {
    NOT_FOUND: 'Product not found.',
    OUT_OF_STOCK: 'Product is out of stock.',
    VENDOR_NOT_APPROVED: 'Vendor not approved yet.',
    IMAGE_LIMIT_EXCEEDED: 'Image upload limit exceeded.',
  },
  ORDER: {
    NOT_FOUND: 'Order not found.',
    INVALID_STATUS_TRANSITION: 'This status change is not allowed.',
    MIN_AMOUNT: 'Order amount is below minimum.',
    CANCEL_WINDOW_PASSED: 'Cancellation window passed.',
    STOCK_CHANGED: 'Stock changed, please retry.',
  },
  CART: {
    EMPTY: 'Cart is empty.',
    ITEM_NOT_FOUND: 'Cart item not found.',
    MAX_ITEMS: 'Maximum cart items reached.',
  },
  COUPON: {
    NOT_FOUND: 'Coupon not found.',
    EXPIRED: 'Coupon expired.',
    MIN_NOT_MET: 'Coupon minimum order amount not met.',
    USAGE_LIMIT: 'Coupon usage limit reached.',
    INVALID: 'Coupon is invalid.',
  },
  PAYMENT: {
    FAILED: 'Payment failed.',
    NOT_FOUND: 'Payment not found.',
    ALREADY_PAID: 'Payment already done.',
  },
  RETURN: {
    NOT_FOUND: 'Return not found.',
    WINDOW_PASSED: 'Return window passed.',
    INVALID_STATUS: 'Invalid return status.',
  },
  TICKET: {
    NOT_FOUND: 'Ticket not found.',
    CLOSED: 'Ticket is closed.',
  },
  UPLOAD: {
    FILE_REQUIRED: 'File is required.',
    TOO_MANY_FILES: 'Too many files.',
    UNSUPPORTED_TYPE: 'Unsupported file type.',
    PAYLOAD_TOO_LARGE: 'File size exceeds limit.',
  },
  COMMON: {
    SERVER_ERROR: 'Something went wrong. Please try again.',
    VALIDATION_FAILED: 'Validation failed.',
    RATE_LIMITED: 'Too many requests, please try again later.',
    NOT_FOUND: 'Resource not found.',
    FORBIDDEN: 'You do not have permission.',
    DUPLICATE: 'Duplicate value.',
    MAINTENANCE: 'Service under maintenance.',
  },
};
```

### 3.5 Example — `src/messages/validation.ts`

```tsx
export const VALIDATION = {
  REQUIRED: (field: string) => `${field} is required.`,
  INVALID_EMAIL: 'Please enter a valid email address.',
  MIN_LENGTH: (field: string, n: number) => `${field} must be at least ${n} characters.`,
  MAX_LENGTH: (field: string, n: number) => `${field} must not exceed ${n} characters.`,
  INVALID_PHONE: 'Please enter a valid phone number.',
  INVALID_URL: 'Please enter a valid URL.',
  INVALID_NUMBER: 'Please enter a valid number.',
  INVALID_DATE: 'Please enter a valid date.',
  INVALID_ENUM: (field: string) => `${field} has invalid value.`,
  STRICT_FIELD: (field: string) => `Unknown field: ${field}`,
};
```

### 3.6 Example — `src/config/encryption.config.ts`

```tsx
export const ENCRYPTION = {
  ENABLED: process.env.ENCRYPTION_ENABLED === 'true',
  ALGORITHM: 'aes-256-gcm',
  KEY: process.env.ENCRYPTION_KEY!,
  IV_LENGTH: 12,
  TAG_LENGTH: 16,
  HEADER_NAME: 'x-encrypted',
  SKIP_PATHS: ['/health', '/docs', '/docs.json', '/webhooks', '/track'],
};
```

### 3.7 Dynamic Settings — DB Table

```
model SystemSetting {
  id        String   @id @default(cuid())
  key       String   @unique
  value     Json
  category  String
  isPublic  Boolean  @default(false)
  updatedAt DateTime @updatedAt
  updatedBy String?
  @@index([category])
}
```

**`settings.service.ts`** — cache in Redis (TTL 5 min), admin update pe invalidate:

```tsx
export const getSetting = async <T>(key: string, fallback: T): Promise<T> => {
  const cached = await redis.get(`setting:${key}`);
  if (cached) return JSON.parse(cached) as T;
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  const val = (row?.value as T) ?? fallback;
  await redis.set(`setting:${key}`, JSON.stringify(val), 'EX', 300);
  return val;
};

export const setSetting = async (key: string, value: any, category: string, userId?: string) => {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value, category, updatedBy: userId },
    update: { value, updatedBy: userId },
  });
  await redis.del(`setting:${key}`);
};
```

---

## 4. Encrypted Request & Response (with ON/OFF)

### 4.1 Goal

- Client → API: body/query/sensitive headers encrypted bhej sake (optional).
- API → Client: response encrypted bhej sake.
- **Toggle:** `.env` mai `ENCRYPTION_ENABLED=true|false` — bina code change ON/OFF.

### 4.2 Algorithm

- **AES-256-GCM** (authenticated encryption — tamper-proof).
- Client `x-encrypted: 1` header bheje → middleware samjhe ki decrypt karna hai.
- Response encrypt karega agar `x-encrypted` header request mai tha OR global setting ON.

### 4.3 Flow

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

### 4.4 Example — `src/middlewares/encryption.middleware.ts`

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

### 4.5 Env vars

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

### 4.6 Rules / Notes

- `/health`, `/docs`, `/docs.json`, `/webhooks`, `/track` encrypt nahi honge (skip list).
- Swagger docs mai bhi 2 modes document karo: plain aur encrypted.
- Key rotation: `ENCRYPTION_KEY` change karne pe purane tokens/data invalid ho sakte — version field add karo future mai.

---

## 5. Backend Dynamic Banane Ki Full List (55 items) — Kya, Kahan, Kaise

**Legend:**

- 🟢 **Static (Code)** — constant file mai, rarely badalta
- 🔵 **DB + Redis (Dynamic)** — `SystemSetting` table se, admin runtime change kar sakta
- 🟡 **Hybrid** — code default + DB override

| # | Item | Type | Kahan Store | Kaam |
| --- | --- | --- | --- | --- |
| 1 | Constants | 🟢 | `src/constants/` | Roles, enums, HTTP codes |
| 2 | Config / Configuration | 🟡 | `src/config/` + DB overrides | App-level defaults |
| 3 | Environment Variables | 🟢 | `.env` + Zod validate | Secrets, DB URL, keys |
| 4 | API Response Messages | 🟡 | `src/messages/` + DB | Success/error text |
| 5 | Error Messages | 🟡 | `src/messages/error.ts` + DB | Standard errors |
| 6 | Success Messages | 🟡 | `src/messages/success.ts` + DB | Standard success |
| 7 | Validation Rules | 🟡 | `src/config/validation` + DB | Length, regex, ranges |
| 8 | Business Rules | 🔵 | DB `SystemSetting` | Commission %, min order, etc |
| 9 | Status Codes / Values | 🟢 | `src/constants/statuses.ts` | ORDER_STATUS, VENDOR_STATUS |
| 10 | Roles | 🟢 | `src/constants/roles.ts` | Fixed roles |
| 11 | Permissions | 🔵 | DB `RolePermission` table | Role → allowed actions |
| 12 | Feature Flags | 🔵 | DB `SystemSetting` (category=feature) | ON/OFF features |
| 13 | Pagination Settings | 🟡 | `src/config/pagination.config.ts` | default page/limit |
| 14 | File Upload Settings | 🟡 | `src/config/upload.config.ts` | temp path, folder |
| 15 | Image / Video Size Limits | 🔵 | DB (admin change) | 5MB → 10MB runtime |
| 16 | Allowed File Types | 🔵 | DB | mime list |
| 17 | OTP Configuration | 🔵 | DB | length, expiry, max retries |
| 18 | Password Rules | 🟡 | `src/config/password.config.ts` + DB | min length, regex |
| 19 | Login Attempt Limits | 🔵 | DB + Redis counter | 5 attempts → lock 15m |
| 20 | Token / JWT Configuration | 🟢 | `.env` + `jwt.config.ts` | expiry, secrets |
| 21 | Session Configuration | 🔵 | DB + Redis | timeout, max devices |
| 22 | Email Configuration | 🟢 | `.env` | SMTP host, creds |
| 23 | SMS Configuration | 🟢 | `.env` | provider creds |
| 24 | Notification Templates | 🔵 | DB `NotificationTemplate` | subject, body, vars |
| 25 | Push Notification Config | 🟢 | `.env` | FCM key |
| 26 | Payment Configuration | 🔵 | DB | COD/UPI/Bank on/off, bank details |
| 27 | Payment Limits | 🔵 | DB | min/max per method |
| 28 | Transaction Limits | 🔵 | DB | per day, per user |
| 29 | Transaction Fees / Charges | 🔵 | DB | platform fee, COD fee |
| 30 | Currency Configuration | 🔵 | DB | INR symbol, decimals |
| 31 | Country Configuration | 🔵 | DB | allowed countries |
| 32 | Phone Country Codes | 🟢 | `src/constants/countries.ts` | static ISO list |
| 33 | Language / Localization | 🔵 | DB `Translation` table | key → value per locale |
| 34 | Date & Time Format | 🔵 | DB | display format |
| 35 | Timezone | 🔵 | DB | e.g. Asia/Kolkata |
| 36 | Third-Party API Config | 🟢 | `.env` | Razorpay, Cloudinary keys |
| 37 | Database Configuration | 🟢 | `.env` | DATABASE_URL |
| 38 | Cache Configuration | 🟢 | `.env` + `cache.config.ts` | TTLs |
| 39 | Rate Limiting | 🟡 | `rateLimit.config.ts` + DB | per route limits |
| 40 | Security Configuration | 🟡 | `.env` + DB | encryption ON/OFF, headers |
| 41 | CORS Configuration | 🟢 | `.env` CORS_ORIGINS | whitelist |
| 42 | Maintenance Mode | 🔵 | DB | ON → API 503 return |
| 43 | App Version / Force Update | 🔵 | DB (per platform) | Android/iOS update prompt |
| 44 | Feature Enable / Disable | 🔵 | DB | same as #12 |
| 45 | Admin Settings | 🔵 | DB | admin prefs |
| 46 | Dynamic Dropdown Data | 🔵 | DB `Dropdown` table | type → options[] |
| 47 | Dynamic Categories | 🔵 | DB `Category` table | already dynamic |
| 48 | Dynamic Labels / Text | 🔵 | DB `Translation` | UI labels |
| 49 | Dynamic Email Templates | 🔵 | DB `EmailTemplate` | HTML with vars |
| 50 | Dynamic SMS Templates | 🔵 | DB `SmsTemplate` | text with vars |
| 51 | Dynamic Notification Templates | 🔵 | DB `NotificationTemplate` | title, body, vars |
| 52 | Dynamic Business Settings | 🔵 | DB | commission, min order, etc |
| 53 | System Settings in DB | 🔵 | `SystemSetting` table | generic key-value |
| 54 | Audit / Activity Config | 🟡 | DB | kaunse actions log ho |
| 55 | Logging Configuration | 🟢 | `logger.config.ts` + `.env` | level, transport |

### 5.1 Golden Rule

- **Code mai koi magic string/number nahi.** Sab `constants/`, `messages/`, `config/` se import karo.
- **Runtime pe badalne wali cheez** = DB `SystemSetting` (Redis cached).
- **Admin panel** → Settings page → API `/settings/updateSetting` → DB update → Redis invalidate.
- **Frontend** bhi `/settings/getPublicSettings` endpoint se public settings fetch kare (site name, logo, currency, feature flags) — hardcode na kare.

---

Har module mai: `route.ts`, `controller.ts`, `service.ts`, `schema.ts` (Zod), `types.ts`, `serializer.ts`.

---

# PART — (API with Response, Endpoint & Default Values)

# 1. Standard Response Format

**Har API ek hi shape return karegi — frontend interceptor ek jagah handle kar lega.**

## 1.1 Envelope Rules (STRICT — Only 3 Top-Level Keys)

Top-level keys — **fixed order, exactly 3**:

```
1. status   → boolean (true / false)
2. message  → string  (never empty)
3. result   → object  (never null — at least {})
```

**Pagination fields (only when list exists) — inside `result`:**

**Rule:** Pagination fields **sirf tab** aayenge jab `result` mai koi `xxxList` ho.

**Error response — same 3 keys, error details `message` ke andar:**

```
1. status   → false
2. message  → string (with Error Code (CODE))
3. result   → {}
```

## 1.2 Success Response (Single Resource)

```json
{
  "status": true,
  "message": "Product created successfully.",
  "result": {
    "productId": "prod_123",
    "name": "Shirt",
    "slug": "shirt",
    "price": 799,
    "stock": 25,
    "isActive": true,
    "categoryData": {
      "categoryId": "cat_1",
      "name": "Men"
    },
    "vendorData": {
      "vendorId": "v_1",
      "shopName": "Ravi Store"
    },
    "imageList": ["url1.jpg", "url2.jpg"],
    "reviewList": []
  }
}
```

**Observe:**

- Only 3 top-level keys: `status`, `message`, `result`.
- Inside `result`: singles (`productId`, `name`, `price`...) → objects (`categoryData`) → arrays (`imageList`, `reviewList`).
- No `totalRecord` / `totalPage` other paginationData — kyunki ye single resource hai, list nahi.

## 1.3 Success with Pagination

```json
{
	"status":true,
	"message":"Categories retrieved successfully.",
	"result":{
		"totalRecord":10,
		"totalPage":5,
		"currentPage":3,
		"limit":2,
		"hasNext":true,
		"hasPrevious":true,
		"nextPage":4,
		"previousPage":2,
		"categoryList":[]
	}
}
```

Products list example:

```json
{
  "status": true,
  "message": "Products fetched successfully.",
  "result": {
		"totalRecord":145,
		"totalPage":5,
		"currentPage":3,
		"limit":2,
		"hasNext":true,
		"hasPrevious":true,
		"nextPage":4,
		"previousPage":2,
    "filterData": {
      "search": "shirt",
      "categoryId": "",
      "vendorId": "",
      "minPrice": 0,
      "maxPrice": 0
    },
    "productList": [
      {
        "productId": "prod_1",
        "name": "Blue Shirt",
        "price": 799,
        "stock": 25,
        "isActive": true,
        "categoryData": {},
        "vendorData": {},
        "imageList": [],
        "reviewList": []
      }
    ]
  }
}
```

**Observe:**

- `totalRecord` / `totalPage` (Single Value) pehle → `filterData` (object) fir → `productList` (array) baad mai.
- Pagination fields `result` ke **andar** hain.
- Non-list endpoints pe `totalRecord` / `totalPage` bhejna hi nahi.

## 1.4 Error Response

```json
{
  "status": false,
  "message": "Please enter a valid email address. Error Code (VALIDATION_ERROR)",
  "result": {}
}
```

Not found:

```json
{
  "status": false,
  "message": "Product not found. Error Code (NOT_FOUND)",
  "result": {}
}
```

## 1.5 Encrypted Response (jab ON ho)

```json
"FnrFcz1TDCrSwKZzhVvpn6pTBjXJv6atuky1fYTysd89d7zbkq8nISTYjcASH1FVm9IEIwjl+yWp8IjdXKySKL7RBZW3Ib5iOu0SF..."
```

## 1.6 Encrypted Response (jab OFF ho)

```json
{
  "status": "Success",
  "reason": "Liste de données de parcours",
  "result": [
    {
      "productId": "prod_123",
	    "name": "Shirt",
	    "slug": "shirt"
    }
  ]
}
```

Encrypted responses bypass normal envelope — client decrypt karega pehle, phir andar ka envelope milega.

---

# 2. Key Ordering & No-Null Rules (STRICT)

## 2.1 No Null Policy

**Database ya logic mai value nahi hai? To bhi `null` NEVER send. Default bhejo:**

| **Type** | **Default (if missing)** | **Example** |
| --- | --- | --- |
| String | `""` | `"Ravi Kumar"` or `""` |
| Number (int) | `0` | `799` or `0` |
| Number (float) | `0.0` | `45.67` or `0.0` |
| Boolean | `false` | `true` / `false` |
| Null | **Never sent** | — |
| Array | `[]` | `[1, 2, 3]` or `[]` |
| Object | `{}` | `{ "id": 1 }` or `{}` |
| Nested | recursive defaults | — |

## 2.2 Key Ordering Rule (inside EVERY object)

```
1st → Pagination nums  (totalRecord, totalPage — only if list exists)
2nd → Single values (string, number, boolean, date)
3rd → Objects          (nested {})
4th → Arrays           (list [])
```

**Correct:**

```json
{
  "userId": "u_1",
  "fullName": "Ravi",
  "age": 28,
  "isActive": true,
  "userData": { "email": "ravi@x.com" },
  "addressData": { "city": "Delhi" },
  "rolesList": ["admin", "customer"],
  "orderList": [{ "orderId": "o_1" }]
}
```

**List with pagination:**

```json
{
  "totalRecord": 145,
  "totalPage": 8,
  "filterData": { "search": "shirt" },
  "productList": [ { "productId": "prod_1" } ]
}
```

**Wrong:**

```json
{
  "rolesList": ["admin"],   ❌ array before singles
  "userId": "u_1",          ❌ single after array
  "phone": null             ❌ null never allowed
}
```

## 2.3 Field Naming Convention

| Suffix | Meaning | Example |
| --- | --- | --- |
| `xxxData` | Nested object | `userData`, `orderData` |
| `xxxList` | Array | `productList`, `rolesList` |
| no suffix | Single value | `productId`, `price`, `isActive` |

Note: `{}` ka suffix `Data`, `[]` ka suffix `List` — ye convention client ke liye critical hai.

---

# 3. Helper Classes

## 3.1 `src/utils/defaults.ts`

```tsx
export const D = {
  str:   (v?: string  | null) => v ?? '',
  num:   (v?: number  | null) => v ?? 0,
  float: (v?: number  | null) => v ?? 0.0,
  bool:  (v?: boolean | null) => v ?? false,
  arr:   <T>(v?: T[] | null): T[] => (Array.isArray(v) ? v : []),
  obj:   <T extends object>(v?: T | null): T => v ?? ({} as T),
  date:  (v?: Date | string | null) =>
    v ? new Date(v).toISOString() : '',
};
```

## 3.2 `src/utils/ApiResponse.ts`

```tsx
import { Response } from 'express';
import { D } from './defaults';

export class ApiResponse {
  static success(
    res: Response,
    {
      statusCode = 200,
      message = 'OK',
      result = {},
    }: { statusCode?: number; message: string; result?: any },
  ) {
    return res.status(statusCode).json({
      status: true,
      message: D.str(message),
      result: result ?? {},
    });
  }

  static paginated(
    res: Response,
    {
      statusCode = 200,
      message = 'OK',
      result = {},
      totalRecord = 0,
      totalPage = 0,
      currentPage = 0,
      limit = 0,
      hasNext = false,
      hasPrevious = false,
      nextPage = 0,
      previousPage = 0,
    }: {
      statusCode?: number;
      message: string;
      result?: any;
      totalRecord?: number;
      totalPage?: number;
      currentPage?: number;
      limit?: number;
      hasNext?: boolean;
      hasPrevious?: boolean;
      nextPage?: number;
      previousPage?: number;
    },
  ) {
    return res.status(statusCode).json({
      status: true,
      message: D.str(message),
      result: {
        totalRecord: D.num(totalRecord),
        totalPage: D.num(totalPage),
        currentPage: D.num(currentPage),
        limit: D.num(limit),
        hasNext: D.bool(hasNext),
        hasPrevious: D.bool(hasPrevious),
        nextPage: D.num(nextPage),
        previousPage: D.num(previousPage),
        ...(result ?? {}),
      },
    });
  }

  static error(
    res: Response,
    {
      statusCode = 500,
      message = 'Something went wrong.',
      code = 'INTERNAL_ERROR',
    }: { statusCode?: number; message: string; code?: string },
  ) {
    return res.status(statusCode).json({
      status: false,
      message: `${D.str(message)} Error Code (${D.str(code)})`,
      result: {},
    });
  }
}
```

## 3.3 `src/utils/AppError.ts`

```tsx
export class AppError extends Error {
  statusCode: number;
  code: string;
  errors: any[];

  constructor(
    message: string,
    statusCode = 500,
    code = '',
    errors: any[] = [],
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }
}
```

## 3.4 `src/utils/serialize.ts` (Pattern)

```tsx
import { D } from './defaults';

export const serializeProduct = (p: any) => ({
  productId: D.str(p?.id),
  name: D.str(p?.name),
  slug: D.str(p?.slug),
  price: D.float(p?.price),
  stock: D.num(p?.stock),
  isActive: D.bool(p?.status === 'ACTIVE'),
  createdAt: D.date(p?.createdAt),

  categoryData: p?.category
    ? { categoryId: D.str(p.category.id), name: D.str(p.category.name) }
    : {},
  vendorData: p?.vendor
    ? { vendorId: D.str(p.vendor.id), shopName: D.str(p.vendor.shopName) }
    : {},

  imageList: D.arr(p?.images),
  reviewList: D.arr(p?.reviews).map((r: any) => ({
    reviewId: D.str(r.id),
    rating: D.num(r.rating),
    comment: D.str(r.comment),
  })),
});

export const serializeProductList = (rows: any[]) => ({
  productList: D.arr(rows).map(serializeProduct),
});
```

**Controller usage:**

```tsx
const { page, limit, skip } = getPagination(req.query);
const [rows, total] = await Promise.all([
  prisma.product.findMany({ skip, take: limit, include: { category: true, vendor: true, reviews: true } }),
  prisma.product.count(),
]);

return ApiResponse.paginated(res, {
  message: 'Products fetched successfully.',
  result: {
    filterData: {
      search: D.str(req.query.search as string),
      categoryId: D.str(req.query.categoryId as string),
      vendorId: D.str(req.query.vendorId as string),
      minPrice: D.float(Number(req.query.minPrice)),
      maxPrice: D.float(Number(req.query.maxPrice)),
    },
    ...serializeProductList(rows),
  },
  totalRecord: total,
  totalPage: Math.ceil(total / limit),
  currentPage: page,
  limit,
  hasNext: page * limit < total,
  hasPrevious: page > 1,
  nextPage: page * limit < total ? page + 1 : 0,
  previousPage: page > 1 ? page - 1 : 0,
});
```

## 3.5 `src/utils/pagination.ts`

```tsx
import { PAGINATION } from '../config/pagination.config';

export const getPagination = (query: any) => {
  const page  = Math.max(1, Number(query.page)  || PAGINATION.DEFAULT_PAGE);
  const limit = Math.min(
    PAGINATION.MAX_LIMIT,
    Math.max(PAGINATION.MIN_LIMIT, Number(query.limit) || PAGINATION.DEFAULT_LIMIT),
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};
```

## 3.6 `src/utils/asyncHandler.ts`

```tsx
import { RequestHandler } from 'express';

export const asyncHandler = (fn: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
```

## 3.7 `src/middlewares/error.ts`

```tsx
import { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { AppError } from '../utils/AppError';

export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof AppError) {
    return ApiResponse.error(res, {
      statusCode: err.statusCode,
      message: err.message,
      code: err.code,
    });
  }

  if (err?.code === 'P2002') {
    return ApiResponse.error(res, {
      statusCode: 409, message: 'Duplicate value.', code: 'DUPLICATE',
    });
  }
  if (err?.code === 'P2025') {
    return ApiResponse.error(res, {
      statusCode: 404, message: 'Resource not found.', code: 'NOT_FOUND',
    });
  }

  return ApiResponse.error(res, {
    statusCode: 500,
    message: 'Something went wrong.',
    code: 'INTERNAL_ERROR',
  });
};
```

---

# 4. HTTP Codes Table

| Code | Kab Use | Code String |
| --- | --- | --- |
| 200 | GET, PUT, PATCH success | — |
| 201 | POST success (created) | — |
| 204 | DELETE success (no body) | — |
| 400 | Validation / bad request | `VALIDATION_ERROR` |
| 401 | Not logged in / token invalid | `UNAUTHORIZED`, `TOKEN_EXPIRED` |
| 403 | Logged in but no permission | `FORBIDDEN` |
| 404 | Resource not found | `NOT_FOUND` |
| 409 | Conflict (email exists, duplicate) | `EMAIL_EXISTS`, `STOCK_CHANGED` |
| 413 | Payload too large | `PAYLOAD_TOO_LARGE` |
| 415 | Unsupported media type | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | Business rule violation | `OUT_OF_STOCK`, `COUPON_EXPIRED` |
| 429 | Rate limit hit | `RATE_LIMITED` |
| 500 | Server error | `INTERNAL_ERROR` |
| 503 | Maintenance mode | `MAINTENANCE` |

---

# 5. Endpoint Naming Conventions & Sample Endpoints

## 5.1 Rules

- **Prefix:** `/api/v1/...`
- **CRUD resource:** REST-style — `GET /products`, `GET /products/:id`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id`
- **Action / self-op routes:** `<verbNoun>` **camelCase** — `updateProfile`, `approveVendor`, `cancelOrder`, `sendOtp`, `placeOrder`, `getAll`, `getById/:id`, `createProduct`, `updateProduct/:id`, `deleteProduct/:id`
- **Multi-mode single URL:** jab ek hi intent multiple modes me ho → `POST /<module>/<action>` + `body.type` (e.g. `/auth/register` with `type: CUSTOMER | VENDOR`, `/auth/sendOtp` with `type: REGISTER | FORGOT_PASSWORD | ...`)
- **Sub-resource:** `/orders/:id/items`
- **Query params:** `?page=1&limit=20&sort=-createdAt&search=shirt&status=active`
- **Multi-word module name:** camelCase — `/vendorProfiles`, `/subAdmins`, `/auditLogs`, `/systemSettings`

## 5.2 Sample Endpoints

| Method | Endpoint | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | ❌ | Public | Register — `type: CUSTOMER` or `type: VENDOR` |
| POST | `/api/v1/auth/login` | ❌ | Public | Login (any role) |
| POST | `/api/v1/auth/loginWithOtp` | ❌ | Public | OTP-based login |
| POST | `/api/v1/auth/refreshToken` | Cookie | Any | Refresh access token |
| POST | `/api/v1/auth/logout` | ✅ | Any | Logout + revoke refresh |
| POST | `/api/v1/auth/logoutAllDevices` | ✅ | Any | Revoke all sessions |
| GET | `/api/v1/auth/getMe` | ✅ | Any | Current user |
| POST | `/api/v1/auth/verifyOtp` | ❌ | Public | Verify OTP |
| POST | `/api/v1/auth/forgotPassword` | ❌ | Public | Trigger reset OTP flow |
| POST | `/api/v1/auth/resetPassword` | ❌ | Public | Reset with OTP |
| POST | `/api/v1/auth/changePassword` | ✅ | Any | Change own password |
| POST | `/api/v1/auth/verifyEmail` | ✅ | Any | Verify email |
| POST | `/api/v1/auth/verifyPhone` | ✅ | Any | Verify phone |
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
| DELETE | `/api/v1/users/deleteAccount` | ✅ | Any | Soft-delete self |
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

# 6. Sample Request/Response Pairs

## 6.1a Register — Customer

```
POST /api/v1/auth/sendOtp
Content-Type: application/json

{
  "type": "REGISTER",
  "channel": "EMAIL",
  "identifier": "ravi@example.com"
}
```

`otp` ki value se hi register karo:

```
POST /api/v1/auth/register
Content-Type: application/json

{
  "type": "CUSTOMER",
  "name": "Ravi Kumar",
  "email": "ravi@example.com",
  "phone": "+919876543210",
  "password": "Secret@123",
  "otp": "123456"
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

**Note:** User row tabhi banta hai jab `otp` verify ho jaaye — pehle koi partial
account create nahi hota. Sirf wahi contact `isVerified` mark hota hai jiska code
aaya tha: email se register kiya to `isPhoneVerified` false rahega. `otp`
`OTP_REQUIRED=false` pe optional hai — tab account turant ban jaata hai,
`isVerified` flags false.

## 6.1b Register — Vendor

```
POST /api/v1/auth/register
Content-Type: application/json

{
  "type": "VENDOR",
  "name": "Ravi Kumar",
  "email": "ravi@example.com",
  "phone": "+919876543210",
  "password": "Secret@123",
  "otp": "123456",
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

## 6.2 List Categories (Simple Paginated)

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

## 6.3 List Products (With Filters + Pagination)

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

## 6.4 Validation Error

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

## 6.5 Not Found

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

## 6.6 Order Place (Multi-Vendor Split)

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

## 6.7 Track Event (Client → Server)

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

## 6.8 Analytics Overview

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

## 6.9 Device Registration

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

# 7. Default Values (All Config Files)

## 7.1 App Defaults — `src/config/app.config.ts`

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

## 7.2 Pagination — `src/config/pagination.config.ts`

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

## 7.3 JWT — `src/config/jwt.config.ts`

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

## 7.4 Password — `src/config/password.config.ts`

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
};
```

## 7.5 OTP — `src/config/otp.config.ts`

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

Record channel se keyed hota hai jo identifier se match karta hai (email pe
`EMAIL`, phone pe `SMS`), client ke requested channel pe nahi — isse SMS code ko
email code ki tarah redeem nahi kar sakte.

### Master switch — `OTP_REQUIRED`

Poore system ka ek hi switch. Har enforcement point ise
`src/config/otp-policy.ts` se padhta hai, seedha `ENV.OTP_REQUIRED` se nahi —
isliye ise off karne pe koi ek code path bhi code demand karte nahi reh jaata.

| Value | Register | Login | Change password |
| --- | --- | --- | --- |
| `true` (default) | `otp` zaroori, row sirf verify hone ke baad | verified contact nahi hai to 403 `ACCOUNT_UNVERIFIED` | account ke apne contact pe code bhi chahiye |
| `false` | account turant, unverified | verification check skip | sirf current password |

`true` default hai kyunki wahi secure choice hai. Jab koi bhi channel code
deliver na kar sake to enforce nahi hota, taaki bina provider wala fresh clone
apni hi login screen pe na phanse. `NODE_ENV=production` me ye combination
**boot error** hai — code bhejne ka waada karke na bhejna deploy ki galti hai,
runtime condition nahi.

Code in flows me lagta hai: registration, OTP login, forgot/reset password, email
aur phone verification, aur password change.

### Delivery

| Channel | Provider | Env |
| --- | --- | --- |
| Email | Brevo HTTP API | `BREVO_API_KEY` (SMTP ko priority deta hai) |
| Email | Koi bhi SMTP host | `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` |
| SMS | MSG91 | `MSG91_AUTHKEY` + `OTP_SMS_ENABLED=true` |

Koi provider set nahi hai to `sendOtp` phir bhi 200 deta hai aur code log me
chala jaata hai — `npm run doctor` is par fail karta hai. `OTP_STATIC_CODE=111111`
ke saath poora signup flow offline chal jaata hai.

## 7.6 Rate Limit — `src/config/rateLimit.config.ts`

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

## 7.7 Upload — `src/config/upload.config.ts`

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

## 7.8 Tracking — `src/config/tracking.config.ts`

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

## 7.9 Analytics — `src/config/analytics.config.ts`

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

## 7.10 Shipping — `src/config/shipping.config.ts`

```tsx
export const SHIPPING = {
  DEFAULT_WEIGHT_UNIT: 'kg',
  DEFAULT_DIMENSION_UNIT: 'cm',
  DEFAULT_PARTNER: 'manual',
  TRACKING_REFRESH_MIN: 60,
};
```

## 7.11 PDF — `src/config/pdf.config.ts`

```tsx
export const PDF = {
  PAGE_SIZE: 'A4',
  MARGIN: 40,
  FONT_SIZE: 10,
  HEADER_COLOR: '#111827',
  LOGO_PATH: 'assets/logo.png',
};
```

## 7.12 Socket — `src/config/socket.config.ts`

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

## 7.13 Business Defaults (DB `SystemSetting` seed)

### 7.13.1 General / Site

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

### 7.13.2 Locale / Timezone / Currency

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

### 7.13.3 Business / Commission

| Key | Default Value | Category |
| --- | --- | --- |
| `commission.default` | `10` (percent) | business |
| `commission.minPercent` | `0` | business |
| `commission.maxPercent` | `50` | business |
| `tax.defaultGstPercent` | `18` | tax |
| `tax.inclusive` | `false` | tax |

### 7.13.4 Order

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

### 7.13.5 Payment — COD / UPI / Bank

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

### 7.13.6 Payment — Token / Advance

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

### 7.13.7 Shipping / Delivery

| Key | Default Value | Category |
| --- | --- | --- |
| `shipping.enabled` | `true` | shipping |
| `shipping.defaultCharge` | `49` (INR) | shipping |
| `shipping.freeAbove` | `999` (INR) | shipping |
| `shipping.estimatedDays` | `5` | shipping |
| `shipping.perKgCharge` | `0` (INR, 0 = off) | shipping |
| `shipping.maxDistanceKm` | `0` (0 = unlimited) | shipping |
| `shipping.serviceablePincodes` | `[]` | shipping |

### 7.13.8 Return / Refund

| Key | Default Value | Category |
| --- | --- | --- |
| `return.enabled` | `true` | return |
| `return.windowDays` | `7` | return |
| `return.reasonRequired` | `true` | return |
| `return.imagesRequired` | `true` | return |
| `return.maxQtyPerOrder` | `0` | return |
| `refund.processingDays` | `5` | refund |
| `refund.mode` | `"original"` | refund |

### 7.13.9 Wallet / Loyalty

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

### 7.13.10 Coupon

| Key | Default Value | Category |
| --- | --- | --- |
| `coupon.maxPerOrder` | `1` | coupon |
| `coupon.stackable` | `false` | coupon |
| `coupon.minOrderAmount` | `0` (INR) | coupon |
| `coupon.maxDiscount` | `0` (0 = unlimited) | coupon |

### 7.13.11 Features

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

### 7.13.12 Catalog

| Key | Default Value | Category |
| --- | --- | --- |
| `catalog.productsPerPage` | `20` | catalog |
| `catalog.showOutOfStock` | `true` | catalog |
| `catalog.allowBackorder` | `false` | catalog |
| `catalog.defaultSort` | `"-createdAt"` | catalog |
| `catalog.maxImagesPerProduct` | `10` | catalog |

### 7.13.13 Cart

| Key | Default Value | Category |
| --- | --- | --- |
| `cart.maxItems` | `50` | cart |
| `cart.holdMinutes` | `30` | cart |
| `cart.persistAcrossDevices` | `true` | cart |

### 7.13.14 Vendor / Payout

| Key | Default Value | Category |
| --- | --- | --- |
| `vendor.autoApprove` | `false` | vendor |
| `vendor.maxProducts` | `500` | vendor |
| `vendor.minPayoutAmount` | `500` (INR) | vendor |
| `vendor.payoutCycleDays` | `7` | vendor |
| `vendor.payoutHoldDays` | `3` | vendor |
| `vendor.commissionOverrideAllowed` | `true` | vendor |

**Note:** `vendor.autoApprove = true` hone pe vendor register karte hi `APPROVED` ho jayega. `false` pe admin `approveVendor/:id` se approve karega.

### 7.13.15 Notification

| Key | Default Value | Category |
| --- | --- | --- |
| `notification.email.enabled` | `true` | notification |
| `notification.sms.enabled` | `false` | notification |
| `notification.push.enabled` | `true` | notification |
| `notification.whatsapp.enabled` | `false` | notification |
| `notification.orderEvents` | `["CONFIRMED","SHIPPED","DELIVERED","CANCELLED"]` | notification |
| `notification.tokenBalanceReminder` | `true` | notification |

### 7.13.16 Security

| Key | Default Value | Category |
| --- | --- | --- |
| `security.otpLoginEnabled` | `false` | security |
| `security.twoFactorEnabled` | `false` | security |
| `security.maxLoginAttempts` | `5` | security |
| `security.lockoutMinutes` | `15` | security |
| `security.passwordMinLength` | `8` | security |
| `security.requireEmailVerify` | `false` | security |
| `security.requirePhoneVerify` | `true` | security |
| `security.sessionDays` | `7` | security |

### 7.13.17 System / Maintenance

| Key | Default Value | Category |
| --- | --- | --- |
| `maintenance.enabled` | `false` | system |
| `maintenance.message` | `"We'll be back soon."` | system |
| `maintenance.allowedIps` | `[]` | system |
| `system.encryptionEnabled` | `false` | system |
| `system.apiRateLimitPerMin` | `100` | system |

### 7.13.18 App / Android / iOS

| Key | Default Value | Category |
| --- | --- | --- |
| `app.minAndroidVersion` | `"1.0.0"` | app |
| `app.forceUpdateAndroid` | `false` | app |
| `app.latestAndroidVersion` | `"1.0.0"` | app |
| `app.minIosVersion` | `"1.0.0"` | app |
| `app.forceUpdateIos` | `false` | app |
| `app.latestIosVersion` | `"1.0.0"` | app |
| `app.updateMessage` | `""` | app |

### 7.13.19 Tracking & Analytics

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

### 7.13.20 Referral / Gift Cards

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

### 7.13.21 Support / Chat

| Key | Default Value | Category |
| --- | --- | --- |
| `support.ticket.enabled` | `true` | support |
| `support.chat.enabled` | `false` | support |
| `support.chatAutoReply` | `true` | support |
| `support.workingHours` | `{start: "10:00", end: "19:00"}` | support |

### 7.13.22 Seed Script Example (`prisma/seed.ts` snippet)

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

## 7.14 Token Amount — Quick Formula

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

## 7.15 Token Order — Response Example

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

**Observe:**

- `result` order → Singles (`orderId`, `total`, `tokenRequired`, `tokenAmount`, `balanceAmount`, `balanceDueDays`, `status`, `createdAt`) → Object (`paymentData`, `addressData`) → Array (`subOrderList`)
- Token amount settings se calculate hua

---

# 8. Edge Cases (Every Module)

## 8.1 Auth

| Case | Behavior | Response |
| --- | --- | --- |
| Email already registered | Reject | 409 `EMAIL_EXISTS` |
| Login wrong password | Generic error | 401 `INVALID_CREDENTIALS` |
| Access token expired | Auto refresh | 401 `TOKEN_EXPIRED` |
| Refresh token expired/revoked | Force logout | 401 `SESSION_EXPIRED` |
| Role mismatch | Reject | 403 `FORBIDDEN` |
| Suspended user login | Reject | 403 `ACCOUNT_SUSPENDED` |
| Register `type` invalid | Zod reject | 400 `INVALID_REGISTER_TYPE` |
| Vendor register, shopName missing | Zod reject | 400 `VENDOR_DETAILS_REQUIRED` |
| Vendor register, slug taken | Auto-append `-2`, `-3` | 201 with new slug |
| Vendor register, `autoApprove = false` | User + VendorProfile create, status `PENDING` | 201 `rolesList:["VENDOR"]` |
| sendOtp `type` invalid | Zod reject | 400 `INVALID_OTP_TYPE` |
| OTP max attempts | Block | 429 `OTP_MAX_ATTEMPTS` |
| OTP resend cooldown | Block | 429 `OTP_RESEND_COOLDOWN` |
| Vendor not approved adds product | Reject | 403 `VENDOR_NOT_APPROVED` |
| Social provider token invalid | Reject | 401 `SOCIAL_PROVIDER_INVALID` |
| 2FA enabled, no OTP | Reject | 401 `TWO_FA_REQUIRED` |
| 2FA wrong OTP | Reject | 401 `TWO_FA_INVALID` |
| Check availability, both empty | Zod reject | 400 `VALIDATION_ERROR` |

## 8.2 Product

| Case | Behavior | Response |
| --- | --- | --- |
| Vendor A edits B's product | Block | 403 `FORBIDDEN` |
| Duplicate slug | Auto-append `-2`, `-3` | 201 with new slug |
| Price ≤ 0 | Zod reject | 400 `VALIDATION_ERROR` |
| Stock negative | Zod reject | 400 |
| Delete with active orders | Soft delete | 200 `PRODUCT_ARCHIVED` |
| Image count > limit | Reject | 400 `TOO_MANY_FILES` |
| MIME not allowed | Reject | 415 `UNSUPPORTED_MEDIA_TYPE` |
| File size > limit | Multer reject | 413 `PAYLOAD_TOO_LARGE` |
| Bulk CSV bad row | Skip row, log error, return summary | 200 with `successCount, failCount` |
| Brand delete with products | Soft delete or reject | 409 `BRAND_IN_USE` |

## 8.3 Cart / Order

| Case | Behavior | Response |
| --- | --- | --- |
| Add out-of-stock | Block | 422 `OUT_OF_STOCK` |
| 2 vendors in cart | Split into 2 SubOrders | 201 |
| Stock changed | Re-validate | 409 `STOCK_CHANGED` |
| Coupon expired | Reject | 422 `COUPON_EXPIRED` |
| Coupon min not met | Reject | 422 `COUPON_MIN_NOT_MET` |
| Order below min | Reject | 422 `ORDER_MIN_AMOUNT` |
| Cancel after window | Reject | 422 `CANCEL_WINDOW_PASSED` |
| Invalid transition | Reject | 422 `INVALID_STATUS_TRANSITION` |
| Vendor updates other's sub-order | Block | 403 |
| Empty cart | Reject | 400 `CART_EMPTY` |
| Return window passed | Reject | 422 `RETURN_WINDOW_PASSED` |
| Reorder with deleted product | Skip deleted, return partial | 201 with `skippedList` |

## 8.4 Payment / Payout

| Case | Behavior | Response |
| --- | --- | --- |
| Token already paid | Block | 409 `ALREADY_PAID` |
| Balance paid before token | Block | 422 `TOKEN_PENDING` |
| Payout below min | Block | 422 `PAYOUT_MIN_AMOUNT` |
| Payout with pending order | Block | 422 `PENDING_ORDERS` |
| Refund more than paid | Reject | 422 `REFUND_EXCEEDS_PAID` |
| Razorpay signature fail | Reject | 400 `INVALID_SIGNATURE` |

## 8.5 Review / Q&A

| Case | Behavior | Response |
| --- | --- | --- |
| Review without purchase | Reject | 403 `PURCHASE_REQUIRED` |
| Duplicate review | Reject | 409 `ALREADY_REVIEWED` |
| Review on own product (vendor) | Block | 403 `FORBIDDEN` |
| Q&A on deleted product | 404 | `NOT_FOUND` |

## 8.6 Chat / Ticket

| Case | Behavior | Response |
| --- | --- | --- |
| Chat with blocked user | Block | 403 `USER_BLOCKED` |
| Ticket reply after close | Block | 422 `TICKET_CLOSED` |
| File in chat > limit | Reject | 413 |
| Socket disconnect mid-send | Queue & retry | Log |

## 8.7 Tracking / Analytics

| Case | Behavior |
| --- | --- |
| Duplicate event within 5s | Dedup via Redis key |
| Missing `deviceId` | Generate server-side, warn |
| Bot user-agent | Skip storage, count separately |
| Geo lookup fail | Store `{}`, log warning |
| Huge payload | Reject 413 |
| Track before session | Auto-create session |
| Crash without device | Store with `deviceId: ""` |
| Analytics export > max rows | Paginate or streaming CSV |

## 8.8 Device / Session

| Case | Behavior |
| --- | --- |
| Duplicate deviceId | Update `lastSeenAt` |
| Blocked device requests | 403 `DEVICE_BLOCKED` |
| Session timeout | Auto `isActive=false` |
| Trust toggle | Update `isTrusted` |
| Revoke active session | Invalidate refresh token |

## 8.9 Upload

| Case | Behavior |
| --- | --- |
| No file | 400 `FILE_REQUIRED` |
| Count > MAX | 400 `TOO_MANY_FILES` |
| Wrong mime | 415 |
| Size exceeded | 413 |
| Cloudinary down | 503 + retry queue |
| Special chars in filename | Sanitize |

## 8.10 Rate Limit

| Case | Behavior |
| --- | --- |
| Limit hit | 429 with `Retry-After` |
| Redis down | Fallback memory store + log |
| Proxy IP | `trust proxy` + `X-Forwarded-For` |
| Tracking burst | Higher limit (`TRACKING` config) |

## 8.11 Maintenance Mode

| Case | Behavior |
| --- | --- |
| `maintenance.enabled = true` | 503 except `/health`, `/docs`, `/admin/*` for SUPER_ADMIN |
| Response | `503 { status:false, message:"Maintenance", result:{} }` |

## 8.12 Encryption

| Case | Behavior |
| --- | --- |
| `x-encrypted:1` but plain body | 400 `INVALID_ENCRYPTED_PAYLOAD` |
| Wrong key | 400 `DECRYPT_FAILED` |
| Encryption OFF, header present | Ignore, treat plain |
| Skip paths | `/health`, `/docs`, `/docs.json`, `/webhooks`, `/track` |
| File upload | Skip (binary) |

## 8.13 DB / Prisma

| Case | Behavior |
| --- | --- |
| Migration fails | Build fail |
| Pool exhausted | Tune + log |
| `P2002` unique violation | 409 |
| `P2025` not found | 404 |
| Transaction fails | Rollback, log, 500 |

## 8.14 CORS

| Case | Behavior |
| --- | --- |
| Origin not whitelisted | Block |
| Preflight | 204 with methods |
| Cookies cross-site | `credentials:true` + `SameSite=None; Secure` (prod) |
| Socket origin | Separate `SOCKET_CORS_ORIGINS` |

## 8.15 Validation

| Case | Behavior |
| --- | --- |
| Extra unknown fields | `.strict()` reject |
| Empty string vs undefined | Empty = invalid for required |
| Number as string | `z.coerce.number()` |
| Boolean as "true"/"false" | `z.coerce.boolean()` |

## 8.16 i18n / Currency / Geo

| Case | Behavior |
| --- | --- |
| Unsupported locale | Fallback to default `en` |
| Missing translation key | Return key itself + log |
| Unknown pincode | `serviceable: false` |
| Currency mismatch | Convert on display layer, not stored |

---

# 9. Folder Structure (API)

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
|   |   `-- 20260101000000_init/   # poori schema ek hi folder me (97 models)
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
|   |-- jobs/             # bullmq workers + cron
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
`-- projectname-api.md  # ye doc
```

Har module me: `<name>.routes.ts`, `<name>.controller.ts`, `<name>.service.ts`,
`<name>.schema.ts`, `<name>.types.ts`.

Entity serializer ka **ek hi registry** hai � `src/utils/serialize.ts`. Ek entity
ka shape do jagah define kabhi nahi hona chahiye, warna same record do alag JSON
shapes me chala jaayega. Module ka `<name>.serializer.ts` sirf us module ke
apne response shapes banata hai (`serializeProfile`, `serializeUserList`,
`serializeCategoryTree`, `serializeEstimate`�) aur canonical entity serializer ko
import karke use karta hai � re-declare nahi karta. Canonical registry ko chahiye
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


# 10. Prisma Models

- `User` (role, email, passwordHash, isActive)
- `VendorProfile` (userId, shopName, slug, status, commissionRate)
- `Category` (name, slug, parentId?)
- `Brand` (name, slug, logo, description)
- `Tag` (name)
- `Attribute` (name, type, options[])
- `Product` (vendorId, categoryId, brandId, name, slug, price, stock, images[], status)
- `ProductVariant` (productId, attributes{}, price, stock, sku)
- `Collection` (name, slug, type, productIds[], rules{})
- `Cart` / `CartItem`
- `Wishlist` / `WishlistItem`
- `Order`, `SubOrder`, `OrderItem`, `OrderTimeline`
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
- `Ticket` / `TicketMessage` / `TicketCategory`
- `Page` / `Blog` / `Faq` / `ContactSubmission` / `NewsletterSubscriber`
- `AuditLog` / `ActivityLog`
- `TaxConfig`
- `ShippingZone` / `ShippingMethod` / `Shipment` / `DeliveryBoy`
- `Currency` / `Country` / `State` / `City`
- `ApiKey` / `WebhookEndpoint` / `WebhookLog`
- `BulkJob` / `ReportSchedule`
- **`SystemSetting`** (key, value Json, category, isPublic)
- **`RolePermission`** (role, permission)
- **`EmailTemplate`**, **`SmsTemplate`**, **`NotificationTemplate`**
- **`Translation`** (locale, key, value)
- **`Dropdown`** (type, options Json)
- **`RefreshToken`** (userId, tokenHash, expiresAt, revokedAt)
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

# 11. API Routes Outline (`/api/v1`)

```
/activityLogs     getAll
/brands          getAll, getById/:id, getBySlug/:slug
                 createBrand, updateBrand/:id, deleteBrand/:id
/tags            getAll, createTag, bulkCreate
                 deleteTag/:id
/attributes      getAll, getById/:id, createAttribute
                 updateAttribute/:id, deleteAttribute/:id
/collections     getAll, getById/:id, getBySlug/:slug
                 getProducts/:id, createCollection, updateCollection/:id
                 deleteCollection/:id, setProducts/:id
/admin           getDashboardStats, getSystemHealth, createSubAdmin
                 getAllSubAdmins, updateSubAdmin/:id, deleteSubAdmin/:id
                 toggleSubAdminStatus/:id, getPermissions, updatePermissions/:id
                 getAuditLogs, getActivityLogs, clearCache
                 getCronJobs, triggerJob
/analytics       getOverview, getVisitors, getUniqueVisitors
                 getPageViews, getTopPages, getTrafficSources
                 getDeviceBreakdown, getGeoBreakdown, getSessions
                 getSessionDetail/:id, getFunnel, getConversions
                 getRevenueReport, getProductPerformance, getVendorPerformance
                 getCustomerCohorts, getAbandonedCarts, getSearchTerms
                 getZeroResultSearches, getRealtime, getCrashes
                 getAppVersions, export, funnels
                 funnels, funnels/:id
/apiKeys         getAll, create, revoke/:id
                 delete/:id, getUsage/:id
/auditLogs       getAll, getById/:id, getByActor/:userId
                 export, purge
/auth            register, login, loginWithOtp
                 refreshToken, logout, logoutAllDevices
                 getMe, sendOtp, verifyOtp
                 forgotPassword, resetPassword, changePassword
                 verifyEmail, verifyPhone, enable2FA
                 disable2FA, verify2FA, socialLogin
                 linkSocial, unlinkSocial, checkAvailability
                 sessions, sessions/:id
/banners         getAll, create, update/:id
                 delete/:id
/blogs           getAll, getBySlug/:slug, create
                 update/:id, delete/:id
/bulk            importProducts, importOrders, importUsers
                 getJobStatus/:jobId, getJobHistory
/cart            getCart, addItem, updateItem
                 removeItem/:cartItemId, clearCart, applyCoupon
                 removeCoupon, estimate, mergeGuestCart
/categories      getAll, getById/:id, getBySlug/:slug
                 createCategory, updateCategory/:id, deleteCategory/:id
                 reorder, bulkCreate
/chat            getConversations, getUnreadCount, startConversation
                 getMessages/:conversationId, sendMessage, markRead/:conversationId
                 deleteMessage/:id, blockUser/:userId, unblock/:id, getBlocked
/contact         submit, getAll, :id/markRead
/content         dropdowns, dropdowns/create, dropdowns/:id/update
                 dropdowns/:id/delete
/countries       getAll, getStates/:countryCode, getCities/:stateCode
                 checkPincode, seedCountries
/coupons         getAll, getById/:id, applyCoupon
                 createCoupon, updateCoupon/:id, deleteCoupon/:id
                 validateCoupon, getUsages/:id, toggleStatus/:id
/currencies      getAll, convert, create
                 update/:id, delete/:id
/deliveryBoys    getAll, create, update/:id
                 delete/:id, toggleStatus/:id, getMyDeliveries
                 updateDeliveryStatus/:id
/devices         getAll, getById/:id, getByUser/:userId
                 block/:id, unblock/:id, delete/:id
                 getTrusted, trust/:id, untrust/:id
/faqs            getAll, create, update/:id
                 delete/:id
/flashSales      getActive, getAll, getBySlug/:slug
                 create, update/:id, delete/:id
/giftCards       checkBalance/:code, redeem, getAll
                 create, disable/:id, delete/:id
/i18n            getLocales, getTranslations/:locale, bulkUpsert
                 create, update/:id, delete/:id
/loyalty         getPoints, getTiers, getHistory
                 redeem, adjust/:userId
/newsletter      subscribe, unsubscribe, getAll
                 sendCampaign
/notifications   getAll, getUnreadCount, markRead/:id
                 markAllRead, delete/:id, getPreferences
                 updatePreferences, registerDevice, unregisterDevice
                 sendBulk, getTemplates, createTemplate
                 updateTemplate/:id, deleteTemplate/:id
/orders          track/:id, getAll, placeOrder
                 reorder/:id, cancelOrder/:id, getById/:id
                 getTimeline/:id, getInvoice/:id, returnRequest/:id
                 getVendorOrders, updateVendorStatus/:subOrderId, getPackingSlip/:id
                 getShippingLabel/:subOrderId, updateStatus/:id, assignDeliveryBoy/:subOrderId
                 verifyDeliveryOtp/:subOrderId, approveReturn/:returnId, rejectReturn/:returnId
/pages           getAll, getBySlug/:slug, create
                 update/:id, delete/:id
/payments        methods, getAll, getByOrder/:orderId
                 payToken/:orderId, payBalance/:orderId, verifyUpi/:orderId
                 verifyBank/:orderId, markCodCollected/:orderId, confirmPayment/:id
                 refund/:id, getRefundHistory/:orderId, razorpay/createOrder
                 razorpay/verify, stripe/createIntent, walletBalance
/payouts         getVendorEarnings, getAll, approvePayout/:id
                 rejectPayout/:id, generateCycles, getSummary
                 getStatement/:vendorId, bulkApprove, getPendingAmount/:vendorId
                 updateStatus/:id
/products        getAll, getById/:id, getBySlug/:slug
                 getFilters, getRelated/:id, getRecommended
                 getFrequentlyBought/:id, getRecentlyViewed, trackView/:id
                 createProduct, updateProduct/:id, deleteProduct/:id
                 updateStock/:id, toggleStatus/:id, uploadImages/:id
                 deleteImage/:id/:imageId, bulkCreate, bulkUpdate
                 bulkDelete, bulkPriceUpdate, bulkImportCsv
                 exportCsv
/questions       getAll/:productId, ask, answer/:id
                 approve/:id, delete/:id
/referral        getMyCode, applyCode, getRewards
                 getLeaderboard, admin/getAll, complete/:id
                 updateStatus/:id
/reports         sales, orders, products
                 customers, vendors, payouts
                 tax, inventory, returns
                 export/:type, schedule, getSchedules
                 schedule/:id/update, schedule/:id/delete
/returns         getReasons, addReason, createRequest
                 getAll, getById/:id, approve/:id
                 reject/:id, markPickedUp/:id, markReceived/:id
                 processRefund/:id
/reviews         getAll, getSummary/:productId, addReview
                 updateReview/:id, deleteReview/:id, approve/:id
                 reject/:id, voteHelpful/:id, reply/:id
/search          global, autocomplete, products
                 vendors, trending, recent
                 recent/clear
/settings        getPublicSettings, getAll, updateSetting
                 bulkUpdateSettings, getByCategory/:category, resetToDefault
                 getFeatureFlags, toggleFeature, getMaintenance
                 updateMaintenance
/shipping        getZones, createZone, updateZone/:id
                 deleteZone/:id, getMethods, createMethod
                 updateMethod/:id, deleteMethod/:id, getPartners
                 createPartner, updatePartner/:id, checkServiceability
                 calculateRate, createShipment/:subOrderId, track/:awb
                 updateStatus/:id
/tax             getConfigs, create, update/:id
                 delete/:id
/templates       email/getAll, email/upsert, email/:key/render
                 email/:key/delete, sms/getAll, sms/upsert
                 sms/:key/render, sms/:key/delete, notification/getAll
                 notification/upsert, notification/:key/render, notification/:key/delete
/tickets         getCategories, create, getAll
                 getById/:id, reply/:id, updateStatus/:id
                 assign/:id, close/:id, delete/:id
                 categories, getStats
/track           event, pageView, session/start
                 session/end, device, appInstall
                 appOpen, crash, performance
                 error, funnel, conversion
                 click, scroll, search
                 utm, referrer, heartbeat
/uploads         uploadImage, uploadImage/single, uploadVideo
                 uploadDocument, uploadMultiple, deleteFile
                 getSignedUrl
/users           getProfile, updateProfile, updateAvatar
                 deleteAccount, getAddresses, addAddress
                 updateAddress/:id, deleteAddress/:id, setDefaultAddress/:id
                 getAll, getById/:id, updateUser/:id
                 toggleStatus/:id, deleteUser/:id, getActivity/:id
                 getOrders/:id, impersonate/:id
/vendors         getProfile, updateProfile, updateBankDetails/:id
                 getStats, requestPayout, getPayoutHistory
                 uploadDocuments, getRatings/:id, getProducts/:id
                 getAll, getById/:id, approveVendor/:id
                 rejectVendor/:id, suspendVendor/:id, updateCommission/:id
                 getDocuments, verifyDocuments/:id
/wallet          getBalance, getTransactions, addMoney
                 useForOrder, adminCredit, adminDebit
/webhooks        register, razorpay, shipping
                 payment-gateway/:provider, getLogs, getAll
                 :id/update, :id/rotateSecret, delete/:id
/wishlist       getAll, checkProduct/:productId, addItem
                 removeItem/:id, clear, moveToCart/:id
/health         uptime, db, redis, queue, jobs/:jobId
/version        api version
/docs           swagger UI, docs.json
/docs.json      OpenAPI JSON
```

---

# 12. Render Deployment (API)

`render.yaml` blueprint hai — Render ka **New → Blueprint** flow usi ko padhta
hai. Build, start, health path aur env var list wahin se aati hai.

- **Service type:** Web Service (Node)
- **Build:** `npm ci --include=dev && npx prisma generate && npx prisma migrate deploy && npm run seed && npm run build`
- **Start:** `npm start`
- **Health check path:** `/api/v1/health`
- **Postgres:** Render Postgres — app ke liye **internal** URL (private network
  me resolve hota hai, external nahi)
- **Redis:** Render Key Value ya Upstash (REDIS_URL)

**Do flags zaroori hain, bhoolne se build/boot dono fail hote hain:**

- `--include=dev` — `NODE_ENV=production` hone par npm devDependencies omit kar
  deta hai (`npm config get omit` = `dev`), aur `prisma`, `typescript`, `tsx` teeno
  devDeps hain. Bina iske build ke paas compiler hi nahi hota.
- `--ignore-scripts` **mat** lagao — bcrypt ka native binary uske `install`
  script se aata hai; scripts skip karne se har login runtime pe crash hoga.
  `HUSKY=0` se sirf `prepare` hook no-op hota hai, wahi kaam karo.
- `npm run seed` build ke andar hai kyunki `migrate deploy` sirf schema banata
  hai — super admin, 163 settings aur permission matrix nahi. Fresh DB pe dono
  chahiye, warna koi login hi nahi kar paayega.

**Dashboard me bharne wale vars** (blueprint me `sync: false`):

| Var | Kahan se |
| --- | --- |
| `DATABASE_URL` | Render Postgres → Internal Database URL |
| `REDIS_URL` | Render Key Value / Upstash |
| `CORS_ORIGINS` | Frontend ka URL — CSV, wildcard nahi |
| `SUPER_ADMIN_PASSWORD` | Kuch strong — code ka default `SuperSecret@123` hai |
| `CLOUDINARY_*` | Cloudinary → Settings → API Keys (Root key) |
| `BREVO_API_KEY` ya `SMTP_*` | `OTP_REQUIRED=true` hone se zaroori — warna boot error |
| `MSG91_*` + `OTP_SMS_ENABLED` | Sirf SMS chahiye to |

`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` blueprint `generateValue` se khud ban
jaate hain.

**Local pe wahi build simulate karne ke liye** — `npm ci --include=dev && npx
prisma generate && npx prisma migrate deploy && npm run seed && npm run build`,
phir `NODE_ENV=production npm start`. Production ki saari env rules isi tarah se
check hoti hain.

Saare commands ek jagah `README.md` me hain — clean install, database, testing,
production build aur deploy, troubleshooting table ke saath.

**⚠️ Render ka free Postgres plan 30 din baad delete ho jaata hai** — data bhi.
Production ke liye plan upgrade karo.

---

# 13. DOS AND DON'Ts

## 13.1 DO's

### Response Envelope (STRICT)

- **Top-level sirf 3 keys, fixed order:** `status` → `message` → `result`
- `status` → boolean (`true` / `false`)
- `message` → string, past-tense, human readable ("User created successfully.")
- `result` → always object (never `null`, never top-level array)
- **Koi `meta` / `data` / `success` / `statusCode` / `timestamp` / `requestId` top-level mai nahi**
- Request tracking → response **header** `X-Request-Id` mai (body mai nahi)
- Har controller `ApiResponse.success()` / `ApiResponse.paginated()` / `ApiResponse.error()` se hi return kare

### Error Response (STRICT)

- `status: false`
- `message` → human message + **`Error Code (CODE)`** append karke
- `result: {}` — **empty object, hamesha** (kabhi `null` nahi, kabhi error fields nahi)
- Error code **message ke andar hi** — `errors` / `code` / `path` result mai **nahi**

**Correct:**

```json
{
  "status": false,
  "message": "Product not found. Error Code (NOT_FOUND)",
  "result": {}
}
```

### Pagination (STRICT — Nums FIRST, Only When List Exists)

- Pagination nums **`result` ke andar sabse pehle**, is exact order mai:
`totalRecord` → `totalPage` → `currentPage` → `limit` → `hasNext` → `hasPrevious` → `nextPage` → `previousPage`
- Uske baad → `filterData` (object)
- Uske baad → `xxxList` (array)
- **Sirf tab** jab `result` mai koi `xxxList` ho
- Single resource / object-only response pe pagination fields **skip**
- Nested `subOrderList` / `itemList` jaisi lists (jo single parent ke andar hain) → pagination **skip**

### No-Null Rule

- String → `""`
- Number (int) → `0`
- Number (float) → `0.0`
- Boolean → `false`
- Array → `[]`
- Object → `{}`
- Prisma `null` → serializer mai default bharo
- Empty relation → `{}`, empty list → `[]` — kabhi `null` nahi
- `site.logo` bhi `""` — null nahi

### Key Ordering (Inside EVERY Object)

```
1st → Pagination nums  (only if list exists at this level)
2nd → Single values    (string, number, boolean, date)
3rd → Objects          (nested {})
4th → Arrays           (list [])
```

- `xxxData` suffix for objects (`userData`, `categoryData`)
- `xxxList` suffix for arrays (`productList`, `rolesList`)
- No suffix for single values (`productId`, `price`, `isActive`)
- Ek line, ek key — readable JSON

### Naming

- **CRUD resource** → REST-style — `GET /products`, `GET /products/:id`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id`
- **Action / self-op** → verb-noun **camelCase** — `updateProfile`, `approveVendor`, `cancelOrder`, `sendOtp`, `placeOrder`, `getAll`, `getById/:id`, `createProduct`, `updateProduct/:id`, `deleteProduct/:id`
- **Multi-mode single URL** → `POST /<module>/<action>` + `body.type` — `/auth/register` with `type: CUSTOMER | VENDOR`, `/auth/sendOtp` with `type: REGISTER | FORGOT_PASSWORD | LOGIN | PHONE_VERIFY | EMAIL_VERIFY | TWO_FA`
- **Multi-word module** → camelCase — `/vendorProfiles`, `/subAdmins`, `/auditLogs`, `/systemSettings`, `/flashSales`, `/giftCards`, `/deliveryBoys`, `/apiKeys`
- **No kebab-case**, **no snake_case**, **no PascalCase**
- **Query params:** `?page=1&limit=20&sort=-createdAt&search=x&status=active`
- Sub-resource: `/orders/:id/items`

### Helper Classes Usage

- `D.str` / `D.num` / `D.float` / `D.bool` / `D.arr` / `D.obj` / `D.date` — har field pe
- `ApiResponse.success()` → single resource
- `ApiResponse.paginated()` → list (pagination nums first, `result` baad mai merge)
- `ApiResponse.error()` → error (message mai code append, `result: {}`)
- `AppError` throw karo service layer se, `errorHandler` catch karega
- `asyncHandler(fn)` — try/catch repetition na karo
- `serializeX()` har entity ke liye — raw Prisma response mai kabhi nahi
- Entity serializer sirf `src/utils/serialize.ts` me define karo — module serializer usse import kare, dobara declare na kare
- Chhoti nested projection ka alag naam rakho (`serializeUserSummary`), taaki endpoint ka user shape guess na karna pade
- `serializeXList()` sirf `xxxList` deta hai — pagination nums `ApiResponse.paginated()` deta hai
- `getPagination(query)` se consistent page/limit/skip

### Config & Defaults

- Har config file (app, pagination, jwt, password, otp, rateLimit, upload, tracking, analytics, socket, pdf) mai hard-coded defaults
- `SystemSetting` seed — har key ka default, `isPublic` flag ke saath
- Seed script `upsert` use kare — existing values override na ho
- `site.supportPhones` → array (`[]` ya 3-4 numbers) — kabhi string nahi
- `payment.token.*` settings — fixed/percent mode, min/max clamp, applicableAbove
- `vendor.autoApprove` setting — `true` pe vendor register karte hi APPROVED, `false` pe admin approve karega

### Tracking & Analytics

- Har event mein `sessionId` + `deviceId` mandatory
- Geo lookup `geoip-lite` se, IP header `X-Forwarded-For` respect karo
- Bot filter `ua-parser-js` se — `isBot` flag
- Realtime counts Redis counters se, DB pe heavy queries nahi
- Nightly aggregation BullMQ cron se — raw events TTL se expire
- Export ke liye streaming (jaise `pagination` ya `cursor`)

### Edge Cases Handled

- Auth: 401/403 with generic messages, auto-refresh flow, `type` based register/OTP validation, 2FA, social
- Product: vendor scoping, soft delete, slug suffix, bulk ops
- Cart/Order: multi-vendor split, stock re-validation, state machine, reorder
- Payment: token + balance, refund, razorpay verify
- Payout: min amount, pending order check, cycle
- Return/Refund: window, images, approval flow
- Review: purchase verification
- Chat/Ticket: blocked user, closed ticket
- Upload: MIME + size validation
- Rate limit: Redis store + fallback
- Maintenance: 503 except `/health`, `/docs`, `/admin/*`
- Encryption: skip `/health`, `/docs`, `/docs.json`, `/webhooks`, `/track`
- Tracking: bot filter, geo fallback, dedup
- Zod `.strict()` — unknown fields reject
- Prisma errors mapped (`P2002` → 409, `P2025` → 404)

### Testing & Hygiene

- Snapshot tests — response shape ke liye
- `vitest` + `supertest` — auth + orders minimum
- ESLint + Prettier + Husky pre-commit
- Env validation at boot (Zod) — missing vars pe crash early
- Graceful shutdown — SIGTERM pe Prisma disconnect + Redis quit + Socket close

---

## 13.2 DON'Ts

### Response Envelope

- `meta` / `data` / `success` / `statusCode` / `timestamp` / `requestId` **top-level mai kabhi nahi**
- `result: null` — always at least `{}`
- Top-level array `[ {...} ]` — always object wrap in `result`
- Envelope ke bahar custom keys (`user: {}`, `product: {}`, `pagination: {}`)
- `res.json()` directly — always `ApiResponse.*` helpers
- `res.status(200).json({ user })` — banned

### Error Response (STRICT)

- `result: { errors: [...], code: "...", path: "..." }` — **banned**
- `code` / `path` / `errors` **`result` ke andar** — sirf `message` ke andar `Error Code (CODE)`
- Error code missing from `message` — har error mai suffix hona chahiye
- `result: null` ya `result` missing — always `{}`
- Error messages leaking internals ("Prisma error at line 42", stack traces)
- Login error: "Email exists" vs "Wrong password" — generic rakho

### Pagination

- Pagination nums **`result` ke bahar** — banned
- `xxxList` pagination nums se **pehle** — banned
- `totalRecord` / `totalPage` single resource response pe — skip karo
- `meta` naam se pagination wrap karna — banned
- Nested lists (single parent ke andar) mai pagination nums — skip karo
- Pagination fields galat order mai (e.g. `xxxList` pehle, phir `totalRecord`)

### No-Null

- `"phone": null` — use `"phone": ""`
- `"price": null` — use `"price": 0`
- `"rating": null` — use `"rating": 0.0`
- `"isActive": null` — use `"isActive": false`
- `"items": null` — use `"items": []`
- `"userData": null` — use `"userData": {}`
- `"site.logo": null` — use `""`
- `"site.supportPhones": null` — use `[]`

### Key Ordering

- Array before single value
- Object before single value
- Pagination nums after singles / objects / arrays
- Mixed ordering (random)
- `xxxData` mai single value
- `xxxList` mai object (jab array of objects hona chahiye)

### Naming

- `/getProducts` — verb-only, banned
- `/product` (singular) — plural use karo
- `/products/getAll` for pure CRUD resource — REST-style `GET /products` use karo
- `/products/delete/123` — `DELETE /products/:id`
- `/api/v1/Products` (PascalCase) — camelCase
- `/vendor_profiles` (snake_case) — camelCase
- `/vendor-profiles` (kebab-case) — camelCase
- `/auth/forgot-password` — `/auth/forgotPassword` (camelCase)
- `/auth/reset-password` — `/auth/resetPassword`
- `/auth/refresh` — `/auth/refreshToken`
- `/users/me` — `/users/getProfile` + `/users/updateProfile`
- `/vendors/apply` — register me `type: VENDOR` se handle karo
- Multiple URLs for same intent (`/register-customer`, `/register-vendor`, `/register-admin`) — single URL + `type` in body
- Query casing mismatch (`Search` vs `search`)

### Code Hygiene

- Raw Prisma object → response (`res.json(prismaResult)`)
- `serializeX()` skip karna
- Ek entity ka `serializeX()` do jagah define karna — ek shape, ek jagah
- try/catch in every controller — `asyncHandler` use karo
- Leaking `passwordHash`, `internalId`, `deletedAt` unless needed
- Business logic in controller — service layer mai rakho
- `serializeXList()` mai pagination nums daalna — `ApiResponse.paginated()` ka kaam hai
- `ApiResponse.error()` mai `errors` field pass karna — ab allowed nahi

### Comment Structure

Comments **English** me. Hinglish sirf `projectname-api.md` (ye spec) aur commit
message me — source code me nahi.

Chaar form hain, aur har ek ka ek hi kaam hai. Inka mix mat karo.

**1. Route marker** — ek line, sirf method + path. Har route handler ke upar.

```ts
/** POST /auth/register */
export const register = asyncHandler(async (req, res) => { /* ... */ });
```

**2. Doc block** — do ya zyada line. Pehla line summary, phir khaali ` *`, phir
kyun. Yehi form hai lambi baat ke liye — ek line se zyada ka matlab.

```ts
/**
 * What it does, in one line.
 *
 * Why it works the way it does — the non-obvious part only. Anything the
 * signature or the name already says, do not repeat.
 */
```

**3. Inline note** — ek line, `//`. Code ke andar, jahan padhne wala ek extra
shabd se samajh jaye.

```ts
// Runs before the insert, so no unverified account is ever created.
```

**4. Banner** — section divider. Sirf drawing characters aur ek label, kabhi
prose nahi.

```ts
// ── Orders ────────────────────────────────────────────
```

Rules:

- **"Why", not "what".** Naam aur type se pata chalne wala likhna bekaar hai.
  `// increment counter` ki jagah `// Attempts are capped here rather than in the
  service so a direct call cannot bypass the cap.`
- **Ek line ka matlab ek `//`.** Do line ki baat hai to doc block banao —
  `// …` ki do line ek form me nahi rehni chahiye, warna form ka matlab kho deta
  hai. Ye baat `npm run comments:check` enforce karta hai.
- **Comment fix ki kahani mat batao.** "Pehle ye bug tha", "ab ye hota hai",
  "ye isliye ki na ho" — development ke dauran likha hua aisa comment us code
  ki history document karta hai, current behaviour nahi. Wo jaldi stale ho jata
  hai aur phir galat comment se bekaar kuch nahi hota. Jo rule abhi bhi sahi
  hai woh likho, baaki hata do. `comments:check` narrative wording bhi pakadta
  hai.
- **Comment stale ho to delete karo, update mat karo.**
- **Zaroorat sirf wahan hai jahan code khud nahi bata sakta.** License header,
  `@ts-ignore` ki wajah, quirky regex ka kaam.
- `TODO` likhna ho to owner + reason + kab hatana hai, warna woh TODO nahi —
  gurbani hai.
- ESLint directive comment nahi hai — uska apna format hai, chhedna nahi.

File ka top: file ka kya kaam hai, 2-4 line, doc block se. Har exported
function/class/const pe JSDoc. Interface aur `type` pe bhi — shape kyun aisi hai
ye batana contract ka hissa hai.

Config ya constant file me har value pe comment mat likho — value khud document
hai. Zaroorat ho to file ke top ek block me saare defaults ek saath.

**`npm run comments:check`** ye teen galtiyan dhoondta hai: `//` ki do-plus line
wali run jahan doc block chahiye, doc block jahan khaali hai, aur narrative
wording. `npm run comments:fix` pehli wali automatically theek kar deta hai.

### Helper / Config

- `D.*` helpers skip karke manual `?? ''` / `?? 0` — inconsistent ho jaata hai
- Direct `Math.min` / `Math.max` — `getPagination()` use karo
- Seed script mai `create` — `upsert` use karo (idempotent)
- `SystemSetting` mai hard-coded public keys admin panel mai — `isPublic` flag respect karo

### Tracking / Analytics

- Tracking ko synchronous heavy DB write banana — queue/stream use karo
- Bot traffic ko real users mai count karna — filter karo
- Geo data null mai rakhna — `{}` bhejo
- Realtime dashboard ke liye baar-baar heavy SQL — Redis counters use karo
- Raw events forever rakhna — retention TTL set karo

### Security

- `null` in JWT payload
- Refresh token in localStorage
- CORS with credentials wildcard (`*` + `credentials: true`)
- Access token in response mai cookie ke saath (body mai rakho, cookie mai nahi)
- Password hash kabhi serializer ke through leak
- Error stack prod mai response mai
- Blocked device ko ignore karna — har request pe check
- Unverified account ko session dena — `isEmailVerified`/`isPhoneVerified` me se
  koi ek `true` hona chahiye, warna `ACCOUNT_UNVERIFIED`
- `OTP_STATIC_CODE` ko production me set karna — env schema boot block karta hai
- OTP ko us identifier ke alawa kisi aur ko consume karne dena
- `verifyEmail`/`verifyPhone` me wo identifier dena jo account ka nahi hai

### Encryption

- `/health`, `/docs`, `/docs.json`, `/webhooks`, `/track` ko encrypt karna
- File upload (binary) ko encrypt karna
- Encryption OFF hone pe bhi header respect karna — ignore karo

### Chat / Socket

- Socket auth skip karna — JWT verify karo handshake pe
- Broadcast sab users ko — room-based delivery
- Message persist na karna — DB mai store karo

### Wallet / Loyalty

- Balance negative allow karna
- Transaction atomicity skip karna — Prisma transaction use karo
- Redeem without order link

---