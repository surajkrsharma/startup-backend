# Conventions

The rules this codebase holds itself to. Read this before writing or changing
anything — most of it is not negotiable, and several points are enforced by
`npm run lint`, `npm run comments:check` or the test suite rather than by review.

For what the system actually does, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Contents

- [Centralized Strings, Constants & Dynamic Config](#centralized-strings-constants--dynamic-config)
- [Encrypted Transport Rules](#encrypted-transport-rules)
- [Making Behaviour Dynamic](#making-behaviour-dynamic)
- [Standard Response Format](#standard-response-format)
- [Key Ordering & No-Null Rules](#key-ordering--no-null-rules)
- [Helper Classes](#helper-classes)
- [HTTP Codes](#http-codes)
- [Endpoint Naming Rules](#endpoint-naming-rules)
- [Edge Cases](#edge-cases)
- [DO's and DON'Ts](#dos-and-donts)

---

## Centralized Strings, Constants & Dynamic Config

Rule: **Kahin bhi hardcoded string, message, ya number nahi.** Sab kuch ek jagah se aayega.

#### Two-Layer Approach

| Layer | Kahan Store | Kab Use |
| --- | --- | --- |
| **Static Layer** | Code files (`src/constants/`, `src/messages/`) | Jo rarely badalta hai (roles, enums, HTTP codes) |
| **Dynamic Layer** | Database table `SystemSetting` (+ Redis cache) | Jo admin runtime pe change kar sake (site name, commission, feature flags) |

#### Example — `src/constants/roles.ts`

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

#### Example — `src/messages/success.ts`

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

#### Example — `src/messages/error.ts`

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

#### Example — `src/messages/validation.ts`

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

#### Example — `src/config/encryption.config.ts`

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

#### Dynamic Settings — DB Table

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

---

## Encrypted Transport Rules

- `/health`, `/docs`, `/docs.json`, `/webhooks`, `/track` encrypt nahi honge (skip list).
- Swagger docs mai bhi 2 modes document karo: plain aur encrypted.
- Key rotation: `ENCRYPTION_KEY` change karne pe purane tokens/data invalid ho sakte — version field add karo future mai.

---

---

## Making Behaviour Dynamic

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

#### Golden Rule

- **Code mai koi magic string/number nahi.** Sab `constants/`, `messages/`, `config/` se import karo.
- **Runtime pe badalne wali cheez** = DB `SystemSetting` (Redis cached).
- **Admin panel** → Settings page → API `/settings/updateSetting` → DB update → Redis invalidate.
- **Frontend** bhi `/settings/getPublicSettings` endpoint se public settings fetch kare (site name, logo, currency, feature flags) — hardcode na kare.

---

Har module mai: `route.ts`, `controller.ts`, `service.ts`, `schema.ts` (Zod), `types.ts`, `serializer.ts`.

---

---

## Standard Response Format

**Har API ek hi shape return karegi — frontend interceptor ek jagah handle kar lega.**

### Envelope Rules (STRICT — Only 3 Top-Level Keys)

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

### Success Response (Single Resource)

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

### Success with Pagination

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

### Error Response

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

### Encrypted Response (jab ON ho)

```json
"FnrFcz1TDCrSwKZzhVvpn6pTBjXJv6atuky1fYTysd89d7zbkq8nISTYjcASH1FVm9IEIwjl+yWp8IjdXKySKL7RBZW3Ib5iOu0SF..."
```

### Encrypted Response (jab OFF ho)

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

---

## Key Ordering & No-Null Rules

### No Null Policy

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

### Key Ordering Rule (inside EVERY object)

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

### Field Naming Convention

| Suffix | Meaning | Example |
| --- | --- | --- |
| `xxxData` | Nested object | `userData`, `orderData` |
| `xxxList` | Array | `productList`, `rolesList` |
| no suffix | Single value | `productId`, `price`, `isActive` |

Note: `{}` ka suffix `Data`, `[]` ka suffix `List` — ye convention client ke liye critical hai.

---

---

## Helper Classes

### `src/utils/defaults.ts`

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

### `src/utils/ApiResponse.ts`

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

### `src/utils/AppError.ts`

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

### `src/utils/serialize.ts` (Pattern)

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

### `src/utils/pagination.ts`

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

### `src/utils/asyncHandler.ts`

```tsx
import { RequestHandler } from 'express';

export const asyncHandler = (fn: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
```

### `src/middlewares/error.ts`

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

---

## HTTP Codes

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

---

## Endpoint Naming Rules

### Rules

- **Prefix:** `/api/v1/...`
- **CRUD resource:** REST-style — `GET /products`, `GET /products/:id`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id`
- **Action / self-op routes:** `<verbNoun>` **camelCase** — `updateProfile`, `approveVendor`, `cancelOrder`, `sendOtp`, `placeOrder`, `getAll`, `getById/:id`, `createProduct`, `updateProduct/:id`, `deleteProduct/:id`
- **Multi-mode single URL:** jab ek hi intent multiple modes me ho → `POST /<module>/<action>` + `body.type` (e.g. `/auth/register` with `type: CUSTOMER | VENDOR`, `/auth/sendOtp` with `type: REGISTER | FORGOT_PASSWORD | ...`)
- **Sub-resource:** `/orders/:id/items`
- **Query params:** `?page=1&limit=20&sort=-createdAt&search=shirt&status=active`
- **Multi-word module name:** camelCase — `/vendorProfiles`, `/subAdmins`, `/auditLogs`, `/systemSettings`

---

## Edge Cases

### Auth

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

### Product

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

### Cart / Order

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

### Payment / Payout

| Case | Behavior | Response |
| --- | --- | --- |
| Token already paid | Block | 409 `ALREADY_PAID` |
| Balance paid before token | Block | 422 `TOKEN_PENDING` |
| Payout below min | Block | 422 `PAYOUT_MIN_AMOUNT` |
| Payout with pending order | Block | 422 `PENDING_ORDERS` |
| Refund more than paid | Reject | 422 `REFUND_EXCEEDS_PAID` |
| Razorpay signature fail | Reject | 400 `INVALID_SIGNATURE` |

### Review / Q&A

| Case | Behavior | Response |
| --- | --- | --- |
| Review without purchase | Reject | 403 `PURCHASE_REQUIRED` |
| Duplicate review | Reject | 409 `ALREADY_REVIEWED` |
| Review on own product (vendor) | Block | 403 `FORBIDDEN` |
| Q&A on deleted product | 404 | `NOT_FOUND` |

### Chat / Ticket

| Case | Behavior | Response |
| --- | --- | --- |
| Chat with blocked user | Block | 403 `USER_BLOCKED` |
| Ticket reply after close | Block | 422 `TICKET_CLOSED` |
| File in chat > limit | Reject | 413 |
| Socket disconnect mid-send | Queue & retry | Log |

### Tracking / Analytics

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

### Device / Session

| Case | Behavior |
| --- | --- |
| Duplicate deviceId | Update `lastSeenAt` |
| Blocked device requests | 403 `DEVICE_BLOCKED` |
| Session timeout | Auto `isActive=false` |
| Trust toggle | Update `isTrusted` |
| Revoke active session | Invalidate refresh token |

### Upload

| Case | Behavior |
| --- | --- |
| No file | 400 `FILE_REQUIRED` |
| Count > MAX | 400 `TOO_MANY_FILES` |
| Wrong mime | 415 |
| Size exceeded | 413 |
| Cloudinary down | 503 + retry queue |
| Special chars in filename | Sanitize |

### Rate Limit

| Case | Behavior |
| --- | --- |
| Limit hit | 429 with `Retry-After` |
| Redis down | Fallback memory store + log |
| Proxy IP | `trust proxy` + `X-Forwarded-For` |
| Tracking burst | Higher limit (`TRACKING` config) |

### Maintenance Mode

| Case | Behavior |
| --- | --- |
| `maintenance.enabled = true` | 503 except `/health`, `/docs`, `/admin/*` for SUPER_ADMIN |
| Response | `503 { status:false, message:"Maintenance", result:{} }` |

### Encryption

| Case | Behavior |
| --- | --- |
| `x-encrypted:1` but plain body | 400 `INVALID_ENCRYPTED_PAYLOAD` |
| Wrong key | 400 `DECRYPT_FAILED` |
| Encryption OFF, header present | Ignore, treat plain |
| Skip paths | `/health`, `/docs`, `/docs.json`, `/webhooks`, `/track` |
| File upload | Skip (binary) |

### DB / Prisma

| Case | Behavior |
| --- | --- |
| Migration fails | Build fail |
| Pool exhausted | Tune + log |
| `P2002` unique violation | 409 |
| `P2025` not found | 404 |
| Transaction fails | Rollback, log, 500 |

### CORS

| Case | Behavior |
| --- | --- |
| Origin not whitelisted | Block |
| Preflight | 204 with methods |
| Cookies cross-site | `credentials:true` + `SameSite=None; Secure` (prod) |
| Socket origin | Separate `SOCKET_CORS_ORIGINS` |

### Validation

| Case | Behavior |
| --- | --- |
| Extra unknown fields | `.strict()` reject |
| Empty string vs undefined | Empty = invalid for required |
| Number as string | `z.coerce.number()` |
| Boolean as "true"/"false" | `z.coerce.boolean()` |

### i18n / Currency / Geo

| Case | Behavior |
| --- | --- |
| Unsupported locale | Fallback to default `en` |
| Missing translation key | Return key itself + log |
| Unknown pincode | `serviceable: false` |
| Currency mismatch | Convert on display layer, not stored |

---

---

## DO's and DON'Ts

### DO's

#### Response Envelope (STRICT)

- **Top-level sirf 3 keys, fixed order:** `status` → `message` → `result`
- `status` → boolean (`true` / `false`)
- `message` → string, past-tense, human readable ("User created successfully.")
- `result` → always object (never `null`, never top-level array)
- **Koi `meta` / `data` / `success` / `statusCode` / `timestamp` / `requestId` top-level mai nahi**
- Request tracking → response **header** `X-Request-Id` mai (body mai nahi)
- Har controller `ApiResponse.success()` / `ApiResponse.paginated()` / `ApiResponse.error()` se hi return kare

#### Error Response (STRICT)

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

#### Pagination (STRICT — Nums FIRST, Only When List Exists)

- Pagination nums **`result` ke andar sabse pehle**, is exact order mai:
`totalRecord` → `totalPage` → `currentPage` → `limit` → `hasNext` → `hasPrevious` → `nextPage` → `previousPage`
- Uske baad → `filterData` (object)
- Uske baad → `xxxList` (array)
- **Sirf tab** jab `result` mai koi `xxxList` ho
- Single resource / object-only response pe pagination fields **skip**
- Nested `subOrderList` / `itemList` jaisi lists (jo single parent ke andar hain) → pagination **skip**

#### No-Null Rule

- String → `""`
- Number (int) → `0`
- Number (float) → `0.0`
- Boolean → `false`
- Array → `[]`
- Object → `{}`
- Prisma `null` → serializer mai default bharo
- Empty relation → `{}`, empty list → `[]` — kabhi `null` nahi
- `site.logo` bhi `""` — null nahi

#### Key Ordering (Inside EVERY Object)

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

#### Naming

- **CRUD resource** → REST-style — `GET /products`, `GET /products/:id`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id`
- **Action / self-op** → verb-noun **camelCase** — `updateProfile`, `approveVendor`, `cancelOrder`, `sendOtp`, `placeOrder`, `getAll`, `getById/:id`, `createProduct`, `updateProduct/:id`, `deleteProduct/:id`
- **Multi-mode single URL** → `POST /<module>/<action>` + `body.type` — `/auth/register` with `type: CUSTOMER | VENDOR`, `/auth/sendOtp` with `type: REGISTER | FORGOT_PASSWORD | LOGIN | PHONE_VERIFY | EMAIL_VERIFY | TWO_FA`
- **Multi-word module** → camelCase — `/vendorProfiles`, `/subAdmins`, `/auditLogs`, `/systemSettings`, `/flashSales`, `/giftCards`, `/deliveryBoys`, `/apiKeys`
- **No kebab-case**, **no snake_case**, **no PascalCase**
- **Query params:** `?page=1&limit=20&sort=-createdAt&search=x&status=active`
- Sub-resource: `/orders/:id/items`

#### Helper Classes Usage

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

#### Config & Defaults

- Har config file (app, pagination, jwt, password, otp, rateLimit, upload, tracking, analytics, socket, pdf) mai hard-coded defaults
- `SystemSetting` seed — har key ka default, `isPublic` flag ke saath
- Seed script `upsert` use kare — existing values override na ho
- `site.supportPhones` → array (`[]` ya 3-4 numbers) — kabhi string nahi
- `payment.token.*` settings — fixed/percent mode, min/max clamp, applicableAbove
- `vendor.autoApprove` setting — `true` pe vendor register karte hi APPROVED, `false` pe admin approve karega

#### Tracking & Analytics

- Har event mein `sessionId` + `deviceId` mandatory
- Geo lookup `geoip-lite` se, IP header `X-Forwarded-For` respect karo
- Bot filter `ua-parser-js` se — `isBot` flag
- Realtime counts Redis counters se, DB pe heavy queries nahi
- Nightly aggregation BullMQ cron se — raw events TTL se expire
- Export ke liye streaming (jaise `pagination` ya `cursor`)

#### Edge Cases Handled

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

#### Testing & Hygiene

- Snapshot tests — response shape ke liye
- `vitest` + `supertest` — auth + orders minimum
- ESLint + Prettier + Husky pre-commit
- Env validation at boot (Zod) — missing vars pe crash early
- Graceful shutdown — SIGTERM pe Prisma disconnect + Redis quit + Socket close

---

### DON'Ts

#### Response Envelope

- `meta` / `data` / `success` / `statusCode` / `timestamp` / `requestId` **top-level mai kabhi nahi**
- `result: null` — always at least `{}`
- Top-level array `[ {...} ]` — always object wrap in `result`
- Envelope ke bahar custom keys (`user: {}`, `product: {}`, `pagination: {}`)
- `res.json()` directly — always `ApiResponse.*` helpers
- `res.status(200).json({ user })` — banned

#### Error Response (STRICT)

- `result: { errors: [...], code: "...", path: "..." }` — **banned**
- `code` / `path` / `errors` **`result` ke andar** — sirf `message` ke andar `Error Code (CODE)`
- Error code missing from `message` — har error mai suffix hona chahiye
- `result: null` ya `result` missing — always `{}`
- Error messages leaking internals ("Prisma error at line 42", stack traces)
- Login error: "Email exists" vs "Wrong password" — generic rakho

#### Pagination

- Pagination nums **`result` ke bahar** — banned
- `xxxList` pagination nums se **pehle** — banned
- `totalRecord` / `totalPage` single resource response pe — skip karo
- `meta` naam se pagination wrap karna — banned
- Nested lists (single parent ke andar) mai pagination nums — skip karo
- Pagination fields galat order mai (e.g. `xxxList` pehle, phir `totalRecord`)

#### No-Null

- `"phone": null` — use `"phone": ""`
- `"price": null` — use `"price": 0`
- `"rating": null` — use `"rating": 0.0`
- `"isActive": null` — use `"isActive": false`
- `"items": null` — use `"items": []`
- `"userData": null` — use `"userData": {}`
- `"site.logo": null` — use `""`
- `"site.supportPhones": null` — use `[]`

#### Key Ordering

- Array before single value
- Object before single value
- Pagination nums after singles / objects / arrays
- Mixed ordering (random)
- `xxxData` mai single value
- `xxxList` mai object (jab array of objects hona chahiye)

#### Naming

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

#### Code Hygiene

- Raw Prisma object → response (`res.json(prismaResult)`)
- `serializeX()` skip karna
- Ek entity ka `serializeX()` do jagah define karna — ek shape, ek jagah
- try/catch in every controller — `asyncHandler` use karo
- Leaking `passwordHash`, `internalId`, `deletedAt` unless needed
- Business logic in controller — service layer mai rakho
- `serializeXList()` mai pagination nums daalna — `ApiResponse.paginated()` ka kaam hai
- `ApiResponse.error()` mai `errors` field pass karna — ab allowed nahi

#### Comment Structure

Comments **English** me. Hinglish sirf `docs/` aur commit
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
- **Fix karoge to comment mat likho.** Koi code kaam nahi kar raha tha aur tumne
  theek kiya — us fix ke saath koi comment mat add karo. Jo comment pehle se tha
  woh theek rahega, naya nahi. Comment tabhi likho jab fix koi aisi invariant
  introduce karta hai jo code se khud nahi pata chalti (jaise `Promise.all` ki
  wajah se ordering guarantee hoti hai). Warna working code + ek naya comment =
  wo comment bina wajah.
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

#### Helper / Config

- `D.*` helpers skip karke manual `?? ''` / `?? 0` — inconsistent ho jaata hai
- Direct `Math.min` / `Math.max` — `getPagination()` use karo
- Seed script mai `create` — `upsert` use karo (idempotent)
- `SystemSetting` mai hard-coded public keys admin panel mai — `isPublic` flag respect karo

#### Tracking / Analytics

- Tracking ko synchronous heavy DB write banana — queue/stream use karo
- Bot traffic ko real users mai count karna — filter karo
- Geo data null mai rakhna — `{}` bhejo
- Realtime dashboard ke liye baar-baar heavy SQL — Redis counters use karo
- Raw events forever rakhna — retention TTL set karo

#### Security

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

#### Encryption

- `/health`, `/docs`, `/docs.json`, `/webhooks`, `/track` ko encrypt karna
- File upload (binary) ko encrypt karna
- Encryption OFF hone pe bhi header respect karna — ignore karo

#### Chat / Socket

- Socket auth skip karna — JWT verify karo handshake pe
- Broadcast sab users ko — room-based delivery
- Message persist na karna — DB mai store karo

#### Wallet / Loyalty

- Balance negative allow karna
- Transaction atomicity skip karna — Prisma transaction use karo
- Redeem without order link

---

---
