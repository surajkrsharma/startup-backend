import { Request } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { isAdminRole, ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { getPagination } from '../../utils/pagination';
import { AppError } from '../../utils/AppError';
import { requireRole } from '../../middlewares/auth.middleware';
import * as service from './content.service';
import {
  serializeBanner,
  serializeBlog,
  serializeBulkJob,
  serializeContactSubmission,
  serializeCountry,
  serializeCurrency,
  serializeFaq,
  serializeNewsletterSubscriber,
  serializePage,
  serializeReportSchedule,
  serializeState,
  serializeTaxConfig,
  serializeTranslation,
  serializeWebhookEndpoint,
  serializeWebhookLog,
} from '../../utils/serialize';

const userId = (req: Request): string => req.auth!.userId;

export const guards = {
  admin: [requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN)],
  superAdmin: [requireRole(ROLES.SUPER_ADMIN)],
};

/** Unpublished rows are only ever exposed to staff. */
const isStaff = (req: Request): boolean => isAdminRole(D.str(req.auth?.role));

/** A vendor may only import into its own catalogue. */
const ownVendorId = (req: Request): string => {
  const vendorId = D.str(req.auth?.vendorId);

  if (!vendorId) throw AppError.forbidden('A vendor profile is required for this action.');

  return vendorId;
};

// ═══ Pages ═══════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/pages:
 *   get:
 *     tags: [Content]
 *     summary: CMS pages, newest first
 *     responses:
 *       200: { description: Paginated page list }
 */
export const listPages = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listPages(
    { ...(req.query as any), skip, take },
    isStaff(req),
  );

  return ApiResponse.paginated(res, {
    message: SUCCESS.CONTENT.PAGE_FETCHED,
    result: { itemList: rows.map(serializePage) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/pages/by-slug/:slug:
 *   get:
 *     tags: [Content]
 *     summary: One page resolved by its slug
 *     responses:
 *       200: { description: The page }
 */
export const getPageBySlug = asyncHandler(async (req, res) => {
  const page = await service.getPageBySlug(req.params.slug, isStaff(req));

  return ApiResponse.success(res, {
    message: SUCCESS.CONTENT.PAGE_FETCHED,
    result: serializePage(page),
  });
});

/**
 * @openapi
 * /content/pages/createPage:
 *   post:
 *     tags: [Content]
 *     summary: Create a CMS page
 *     responses:
 *       201: { description: The created page }
 */
export const createPage = asyncHandler(async (req, res) => {
  const page = await service.createPage(req.body, req);

  return ApiResponse.created(res, SUCCESS.CONTENT.PAGE_CREATED, serializePage(page));
});

/**
 * @openapi
 * /content/pages/updatePage/:id:
 *   patch:
 *     tags: [Content]
 *     summary: Update a CMS page
 *     responses:
 *       200: { description: The updated page }
 */
export const updatePage = asyncHandler(async (req, res) => {
  const page = await service.updatePage(req.params.id, req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CONTENT.PAGE_UPDATED,
    result: serializePage(page),
  });
});

/**
 * @openapi
 * /content/pages/deletePage/:id:
 *   delete:
 *     tags: [Content]
 *     summary: Soft delete a CMS page
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deletePage = asyncHandler(async (req, res) => {
  await service.deletePage(req.params.id, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CONTENT.PAGE_DELETED,
    result: { pageId: D.str(req.params.id), isDeleted: true },
  });
});

// ═══ Blog ════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/blogs:
 *   get:
 *     tags: [Content]
 *     summary: Blog posts, newest first
 *     responses:
 *       200: { description: Paginated post list }
 */
export const listBlogs = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listBlogs(
    { ...(req.query as any), skip, take },
    isStaff(req),
  );

  return ApiResponse.paginated(res, {
    message: SUCCESS.CONTENT.BLOG_FETCHED,
    result: { itemList: rows.map(serializeBlog) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/blogs/by-slug/:slug:
 *   get:
 *     tags: [Content]
 *     summary: One post resolved by its slug
 *     responses:
 *       200: { description: The post }
 */
export const getBlogBySlug = asyncHandler(async (req, res) => {
  const post = await service.getBlogBySlug(req.params.slug, isStaff(req));

  return ApiResponse.success(res, {
    message: SUCCESS.CONTENT.BLOG_FETCHED,
    result: serializeBlog(post),
  });
});

/**
 * @openapi
 * /content/blogs/createBlog:
 *   post:
 *     tags: [Content]
 *     summary: Create a blog post
 *     responses:
 *       201: { description: The created post }
 */
export const createBlog = asyncHandler(async (req, res) => {
  const post = await service.createBlog(req.body, userId(req), req);

  return ApiResponse.created(res, SUCCESS.CONTENT.BLOG_CREATED, serializeBlog(post));
});

/**
 * @openapi
 * /content/blogs/updateBlog/:id:
 *   patch:
 *     tags: [Content]
 *     summary: Update a blog post
 *     responses:
 *       200: { description: The updated post }
 */
export const updateBlog = asyncHandler(async (req, res) => {
  const post = await service.updateBlog(req.params.id, req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CONTENT.BLOG_UPDATED,
    result: serializeBlog(post),
  });
});

/**
 * @openapi
 * /content/blogs/deleteBlog/:id:
 *   delete:
 *     tags: [Content]
 *     summary: Soft delete a blog post
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deleteBlog = asyncHandler(async (req, res) => {
  await service.deleteBlog(req.params.id, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CONTENT.BLOG_DELETED,
    result: { blogId: D.str(req.params.id), isDeleted: true },
  });
});

// ═══ FAQ ═════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/faqs:
 *   get:
 *     tags: [Content]
 *     summary: FAQ entries
 *     responses:
 *       200: { description: Paginated FAQ list }
 */
export const listFaqs = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listFaqs({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.CONTENT.FAQ_FETCHED,
    result: { itemList: rows.map(serializeFaq) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/faqs/createFaq:
 *   post:
 *     tags: [Content]
 *     summary: Create a FAQ entry
 *     responses:
 *       201: { description: The created FAQ }
 */
export const createFaq = asyncHandler(async (req, res) => {
  const faq = await service.createFaq(req.body, req);

  return ApiResponse.created(res, SUCCESS.CONTENT.FAQ_CREATED, serializeFaq(faq));
});

/**
 * @openapi
 * /content/faqs/updateFaq/:id:
 *   patch:
 *     tags: [Content]
 *     summary: Update a FAQ entry
 *     responses:
 *       200: { description: The updated FAQ }
 */
export const updateFaq = asyncHandler(async (req, res) => {
  const faq = await service.updateFaq(req.params.id, req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CONTENT.FAQ_UPDATED,
    result: serializeFaq(faq),
  });
});

/**
 * @openapi
 * /content/faqs/deleteFaq/:id:
 *   delete:
 *     tags: [Content]
 *     summary: Delete a FAQ entry
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deleteFaq = asyncHandler(async (req, res) => {
  await service.deleteFaq(req.params.id, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CONTENT.FAQ_DELETED,
    result: { faqId: D.str(req.params.id), isDeleted: true },
  });
});

// ═══ Banners ══════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/banners:
 *   get:
 *     tags: [Content]
 *     summary: Banners, optionally filtered to what is live right now
 *     responses:
 *       200: { description: Paginated banner list }
 */
export const listBanners = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listBanners({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.CONTENT.BANNER_FETCHED,
    result: { itemList: rows.map(serializeBanner) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/banners/createBanner:
 *   post:
 *     tags: [Content]
 *     summary: Create a banner
 *     responses:
 *       201: { description: The created banner }
 */
export const createBanner = asyncHandler(async (req, res) => {
  const banner = await service.createBanner(req.body, req);

  return ApiResponse.created(res, SUCCESS.CONTENT.BANNER_CREATED, serializeBanner(banner));
});

/**
 * @openapi
 * /content/banners/updateBanner/:id:
 *   patch:
 *     tags: [Content]
 *     summary: Update a banner
 *     responses:
 *       200: { description: The updated banner }
 */
export const updateBanner = asyncHandler(async (req, res) => {
  const banner = await service.updateBanner(req.params.id, req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CONTENT.BANNER_UPDATED,
    result: serializeBanner(banner),
  });
});

/**
 * @openapi
 * /content/banners/deleteBanner/:id:
 *   delete:
 *     tags: [Content]
 *     summary: Delete a banner
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deleteBanner = asyncHandler(async (req, res) => {
  await service.deleteBanner(req.params.id, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CONTENT.BANNER_DELETED,
    result: { bannerId: D.str(req.params.id), isDeleted: true },
  });
});

// ═══ Contact + newsletter ═════════════════════════════════════════════════════

/**
 * @openapi
 * /content/contact:
 *   post:
 *     tags: [Content]
 *     summary: Submit a contact form
 *     responses:
 *       201: { description: The submission reference }
 */
export const submitContact = asyncHandler(async (req, res) => {
  const row = await service.submitContact(req.body, D.str(req.auth?.userId) || undefined, req);

  return ApiResponse.created(res, SUCCESS.CONTACT.SUBMITTED, {
    contactId: D.str(row.id),
    name: D.str(row.name),
    email: D.str(row.email),
    isRead: D.bool(row.isRead),
    createdAt: D.date(row.createdAt),
  });
});

/**
 * @openapi
 * /content/contact/getAll:
 *   get:
 *     tags: [Content]
 *     summary: Contact submissions, staff only
 *     responses:
 *       200: { description: Paginated submission list }
 */
export const listContacts = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listContacts({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.CONTACT.FETCHED,
    result: { itemList: rows.map(serializeContactSubmission) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/contact/:id/markRead:
 *   patch:
 *     tags: [Content]
 *     summary: Mark a contact submission read or unread
 *     responses:
 *       200: { description: The updated submission }
 */
export const markContactRead = asyncHandler(async (req, res) => {
  const row = await service.markContactRead(req.params.id, req.body.isRead !== false, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CONTACT.MARKED_READ,
    result: serializeContactSubmission(row),
  });
});

/**
 * @openapi
 * /content/newsletter/subscribe:
 *   post:
 *     tags: [Content]
 *     summary: Subscribe an address to the newsletter
 *     responses:
 *       201: { description: Subscription state }
 */
export const subscribe = asyncHandler(async (req, res) => {
  const result = await service.subscribe(req.body.email, req);

  return ApiResponse.created(res, SUCCESS.NEWSLETTER.SUBSCRIBED, result);
});

/**
 * @openapi
 * /content/newsletter/unsubscribe:
 *   post:
 *     tags: [Content]
 *     summary: Unsubscribe using the token from an unsubscribe link
 *     responses:
 *       200: { description: Unsubscription state }
 */
export const unsubscribe = asyncHandler(async (req, res) => {
  const result = await service.unsubscribe(req.body.token);

  return ApiResponse.success(res, { message: SUCCESS.NEWSLETTER.UNSUBSCRIBED, result });
});

/**
 * @openapi
 * /content/newsletter/getAll:
 *   get:
 *     tags: [Content]
 *     summary: Newsletter subscribers, staff only
 *     responses:
 *       200: { description: Paginated subscriber list }
 */
export const listSubscribers = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listSubscribers({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.NEWSLETTER.FETCHED,
    result: { itemList: rows.map(serializeNewsletterSubscriber) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

// ═══ Geo ══════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/geo/countries:
 *   get:
 *     tags: [Content]
 *     summary: Countries with their states nested
 *     responses:
 *       200: { description: Paginated country list }
 */
export const listCountries = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listCountries({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.COUNTRY.FETCHED,
    result: { itemList: rows.map(serializeCountry) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/geo/states:
 *   get:
 *     tags: [Content]
 *     summary: States with their cities nested
 *     responses:
 *       200: { description: Paginated state list }
 */
export const listStates = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listStates({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.COUNTRY.STATES_FETCHED,
    result: { itemList: rows.map(serializeState) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/geo/cities:
 *   get:
 *     tags: [Content]
 *     summary: Cities, optionally scoped to a state
 *     responses:
 *       200: { description: Paginated city list }
 */
export const listCities = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listCities({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.COUNTRY.CITIES_FETCHED,
    result: {
      itemList: rows.map((c: any) => ({
        cityId: D.str(c?.id),
        name: D.str(c?.name),
        stateCode: D.str(c?.stateCode),
        pincode: D.str(c?.pincode),
        isServiceable: D.bool(c?.isServiceable),
        isActive: D.bool(c?.isActive),
      })),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/geo/checkPincode:
 *   get:
 *     tags: [Content]
 *     summary: Resolve a pincode to its city, state and country
 *     responses:
 *       200: { description: Serviceability plus the resolved location }
 */
export const checkPincode = asyncHandler(async (req, res) => {
  const result = await service.checkPincode(D.str((req.query as any).pincode));

  return ApiResponse.success(res, { message: SUCCESS.COUNTRY.PINCODE_CHECKED, result });
});

/**
 * @openapi
 * /content/geo/seedCountries:
 *   post:
 *     tags: [Content]
 *     summary: Seed the country and state reference tables
 *     responses:
 *       200: { description: How many countries and states were written }
 */
export const seedCountries = asyncHandler(async (req, res) => {
  const result = await service.seedCountries(req);

  return ApiResponse.success(res, { message: SUCCESS.COUNTRY.FETCHED, result });
});

// ═══ Currency ═════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/currencies:
 *   get:
 *     tags: [Content]
 *     summary: Currencies, default first
 *     responses:
 *       200: { description: The currency list }
 */
export const listCurrencies = asyncHandler(async (req, res) => {
  const rows = await service.listCurrencies(D.str((req.query as any).isActive) !== 'false');

  return ApiResponse.success(res, {
    message: SUCCESS.CURRENCY.FETCHED,
    result: { itemList: rows.map(serializeCurrency), totalRecord: rows.length },
  });
});

/**
 * @openapi
 * /content/currencies/create:
 *   post:
 *     tags: [Content]
 *     summary: Create a currency
 *     responses:
 *       201: { description: The created currency }
 */
export const createCurrency = asyncHandler(async (req, res) => {
  const row = await service.createCurrency(req.body, req);

  return ApiResponse.created(res, SUCCESS.CURRENCY.CREATED, serializeCurrency(row));
});

/**
 * @openapi
 * /content/currencies/:id/update:
 *   patch:
 *     tags: [Content]
 *     summary: Update a currency
 *     responses:
 *       200: { description: The updated currency }
 */
export const updateCurrency = asyncHandler(async (req, res) => {
  const row = await service.updateCurrency(req.params.id, req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CURRENCY.UPDATED,
    result: serializeCurrency(row),
  });
});

/**
 * @openapi
 * /content/currencies/:id/delete:
 *   delete:
 *     tags: [Content]
 *     summary: Delete a currency
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deleteCurrency = asyncHandler(async (req, res) => {
  await service.deleteCurrency(req.params.id, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CURRENCY.DELETED,
    result: { currencyId: D.str(req.params.id), isDeleted: true },
  });
});

/**
 * @openapi
 * /content/currencies/convert:
 *   get:
 *     tags: [Content]
 *     summary: Convert an amount into another currency
 *     responses:
 *       200: { description: The converted amount plus the rate used }
 */
export const convertCurrency = asyncHandler(async (req, res) => {
  const result = await service.convertCurrency(
    D.float((req.query as any).amount),
    D.str((req.query as any).to),
  );

  return ApiResponse.success(res, { message: SUCCESS.CURRENCY.FETCHED, result });
});

// ═══ Tax ══════════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/taxConfigs:
 *   get:
 *     tags: [Content]
 *     summary: Tax configurations
 *     responses:
 *       200: { description: The tax config list }
 */
export const listTaxConfigs = asyncHandler(async (req, res) => {
  const rows = await service.listTaxConfigs(D.str((req.query as any).isActive) !== 'false');

  return ApiResponse.success(res, {
    message: SUCCESS.TAX.FETCHED,
    result: { itemList: rows.map(serializeTaxConfig), totalRecord: rows.length },
  });
});

/**
 * @openapi
 * /content/taxConfigs/create:
 *   post:
 *     tags: [Content]
 *     summary: Create a tax configuration
 *     responses:
 *       201: { description: The created tax config }
 */
export const createTaxConfig = asyncHandler(async (req, res) => {
  const row = await service.createTaxConfig(req.body, req);

  return ApiResponse.created(res, SUCCESS.TAX.CREATED, serializeTaxConfig(row));
});

/**
 * @openapi
 * /content/taxConfigs/:id/update:
 *   patch:
 *     tags: [Content]
 *     summary: Update a tax configuration
 *     responses:
 *       200: { description: The updated tax config }
 */
export const updateTaxConfig = asyncHandler(async (req, res) => {
  const row = await service.updateTaxConfig(req.params.id, req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.TAX.UPDATED,
    result: serializeTaxConfig(row),
  });
});

/**
 * @openapi
 * /content/taxConfigs/:id/delete:
 *   delete:
 *     tags: [Content]
 *     summary: Delete a tax configuration
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deleteTaxConfig = asyncHandler(async (req, res) => {
  await service.deleteTaxConfig(req.params.id, req);

  return ApiResponse.success(res, {
    message: SUCCESS.TAX.DELETED,
    result: { taxConfigId: D.str(req.params.id), isDeleted: true },
  });
});

// ═══ Translations ══════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/translations:
 *   get:
 *     tags: [Content]
 *     summary: Translation entries, optionally scoped to a locale
 *     responses:
 *       200: { description: The translation list }
 */
export const listTranslations = asyncHandler(async (req, res) => {
  const rows = await service.listTranslations(
    D.str((req.query as any).locale),
    D.str((req.query as any).namespace),
  );

  return ApiResponse.success(res, {
    message: SUCCESS.I18N.TRANSLATIONS_FETCHED,
    result: { itemList: rows.map(serializeTranslation), totalRecord: rows.length },
  });
});

/**
 * @openapi
 * /content/translations/upsert:
 *   post:
 *     tags: [Content]
 *     summary: Create or update many translation keys in one call
 *     responses:
 *       200: { description: How many keys were written }
 */
export const upsertTranslations = asyncHandler(async (req, res) => {
  const count = await service.upsertTranslations(req.body, userId(req));

  return ApiResponse.success(res, {
    message: SUCCESS.I18N.BULK_UPSERTED,
    result: {
      upsertedCount: D.num(count),
      locale: D.str(req.body.locale),
      namespace: D.str(req.body.namespace),
    },
  });
});

// ═══ Dropdowns ════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/dropdowns:
 *   get:
 *     tags: [Content]
 *     summary: Dropdown options grouped by type
 *     responses:
 *       200: { description: Paginated option list }
 */
export const listDropdowns = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listDropdowns({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.DROPDOWN.FETCHED,
    result: {
      itemList: rows.map((d: any) => ({
        dropdownId: D.str(d?.id),
        type: D.str(d?.type),
        label: D.str(d?.label),
        value: D.str(d?.value),
        sortOrder: D.num(d?.sortOrder),
        isActive: D.bool(d?.isActive),
        metadata: D.json(d?.metadata),
        createdAt: D.date(d?.createdAt),
      })),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/dropdowns/create:
 *   post:
 *     tags: [Content]
 *     summary: Create a dropdown option
 *     responses:
 *       201: { description: The created option }
 */
export const createDropdown = asyncHandler(async (req, res) => {
  const row = await service.createDropdown(req.body, req);

  return ApiResponse.created(res, SUCCESS.DROPDOWN.CREATED, {
    dropdownId: D.str(row.id),
    type: D.str(row.type),
    label: D.str(row.label),
    value: D.str(row.value),
    sortOrder: D.num(row.sortOrder),
    isActive: D.bool(row.isActive),
  });
});

/**
 * @openapi
 * /content/dropdowns/:id/update:
 *   patch:
 *     tags: [Content]
 *     summary: Update a dropdown option
 *     responses:
 *       200: { description: The updated option }
 */
export const updateDropdown = asyncHandler(async (req, res) => {
  const row = await service.updateDropdown(req.params.id, req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.DROPDOWN.UPDATED,
    result: {
      dropdownId: D.str(row.id),
      type: D.str(row.type),
      label: D.str(row.label),
      value: D.str(row.value),
      sortOrder: D.num(row.sortOrder),
      isActive: D.bool(row.isActive),
    },
  });
});

/**
 * @openapi
 * /content/dropdowns/:id/delete:
 *   delete:
 *     tags: [Content]
 *     summary: Delete a dropdown option
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deleteDropdown = asyncHandler(async (req, res) => {
  await service.deleteDropdown(req.params.id, req);

  return ApiResponse.success(res, {
    message: SUCCESS.DROPDOWN.DELETED,
    result: { dropdownId: D.str(req.params.id), isDeleted: true },
  });
});

// ═══ Webhooks ══════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/webhooks:
 *   get:
 *     tags: [Content]
 *     summary: Registered webhook endpoints
 *     responses:
 *       200: { description: Paginated endpoint list }
 */
export const listWebhooks = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listWebhooks({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.WEBHOOK.FETCHED,
    result: { itemList: rows.map(serializeWebhookEndpoint) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/webhooks/register:
 *   post:
 *     tags: [Content]
 *     summary: Register a webhook endpoint
 *     responses:
 *       201: { description: The endpoint plus its signing secret, shown once }
 */
export const registerWebhook = asyncHandler(async (req, res) => {
  const row = await service.createWebhook(req.body, req);

  return ApiResponse.created(res, SUCCESS.WEBHOOK.REGISTERED, {
    ...serializeWebhookEndpoint(row),
    secret: D.str(row.secret),
    note: D.str(row.note),
  });
});

/**
 * @openapi
 * /content/webhooks/:id/update:
 *   patch:
 *     tags: [Content]
 *     summary: Update a webhook endpoint
 *     responses:
 *       200: { description: The updated endpoint }
 */
export const updateWebhook = asyncHandler(async (req, res) => {
  const row = await service.updateWebhook(req.params.id, req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.WEBHOOK.UPDATED,
    result: serializeWebhookEndpoint(row),
  });
});

/**
 * @openapi
 * /content/webhooks/:id/rotateSecret:
 *   post:
 *     tags: [Content]
 *     summary: Rotate an endpoint's signing secret
 *     responses:
 *       200: { description: The new secret, shown once }
 */
export const rotateSecret = asyncHandler(async (req, res) => {
  const result = await service.rotateWebhookSecret(req.params.id, req);

  return ApiResponse.success(res, { message: SUCCESS.WEBHOOK.SECRET_ROTATED, result });
});

/**
 * @openapi
 * /content/webhooks/:id/delete:
 *   delete:
 *     tags: [Content]
 *     summary: Delete a webhook endpoint
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deleteWebhook = asyncHandler(async (req, res) => {
  await service.deleteWebhook(req.params.id, req);

  return ApiResponse.success(res, {
    message: SUCCESS.WEBHOOK.DELETED,
    result: { webhookId: D.str(req.params.id), isDeleted: true },
  });
});

/**
 * @openapi
 * /content/webhooks/receive:
 *   post:
 *     tags: [Content]
 *     summary: Inbound webhook receiver that verifies the signature and logs the delivery
 *     responses:
 *       200: { description: Whether the signature verified }
 */
export const receiveWebhook = asyncHandler(async (req, res) => {
  const endpointId = D.str(req.body.endpointId);
  const signature = D.str(req.headers['x-webhook-signature'] as string);
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});

  const isValid = endpointId
    ? await service.verifyWebhookSignature(endpointId, rawBody, signature)
    : false;

  const row = await service.recordWebhook(
    {
      endpointId,
      event: D.str(req.body.event),
      eventId: D.str(req.body.eventId),
      payload: req.body,
      signature,
      direction: 'INBOUND',
    },
    isValid,
  );

  return ApiResponse.success(res, { message: SUCCESS.WEBHOOK.RECEIVED, result: row });
});

/**
 * @openapi
 * /content/webhooks/logs:
 *   get:
 *     tags: [Content]
 *     summary: Webhook delivery log
 *     responses:
 *       200: { description: Paginated log list }
 */
export const listWebhookLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listWebhookLogs({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.WEBHOOK.LOGS_FETCHED,
    result: { itemList: rows.map(serializeWebhookLog) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

// ═══ Bulk jobs ═════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/bulk/importProducts:
 *   post:
 *     tags: [Content]
 *     summary: Import products row by row into the caller's catalogue
 *     responses:
 *       201: { description: The job reference plus per-row counts }
 */
export const importProducts = asyncHandler(async (req, res) => {
  const result = await service.bulkImportProducts(
    ownVendorId(req),
    { rows: req.body.rows, continueOnError: req.body.continueOnError },
    userId(req),
    req,
  );

  return ApiResponse.created(res, SUCCESS.BULK.PRODUCTS_IMPORTED, result);
});

/**
 * @openapi
 * /content/bulk/getAll:
 *   get:
 *     tags: [Content]
 *     summary: Bulk job history
 *     responses:
 *       200: { description: Paginated job list }
 */
export const listBulkJobs = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listBulkJobs(
    { ...(req.query as any), skip, take },
    isStaff(req) ? D.str((req.query as any).vendorId) || undefined : ownVendorId(req),
  );

  return ApiResponse.paginated(res, {
    message: SUCCESS.BULK.HISTORY_FETCHED,
    result: { itemList: rows.map(serializeBulkJob) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/bulk/:jobId/status:
 *   get:
 *     tags: [Content]
 *     summary: One bulk job
 *     responses:
 *       200: { description: The job with its per-row results }
 */
export const getBulkJobStatus = asyncHandler(async (req, res) => {
  const job = await service.getBulkJob(req.params.jobId);

  return ApiResponse.success(res, {
    message: SUCCESS.BULK.STATUS_FETCHED,
    result: serializeBulkJob(job),
  });
});

// ═══ Reports ══════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /content/reports/:type:
 *   get:
 *     tags: [Content]
 *     summary: Run one of the nine report builders over a date range
 *     responses:
 *       200: { description: Rows, columns, summary and a CSV rendering }
 */
export const runReport = asyncHandler(async (req, res) => {
  const type = D.str(req.params.type).toUpperCase();
  const result = await service.runReport(type, {
    ...(req.query as any),
    vendorId: D.str((req.query as any).vendorId),
  });

  const messages: Record<string, string> = {
    SALES: SUCCESS.REPORT.SALES_FETCHED,
    ORDERS: SUCCESS.REPORT.ORDERS_FETCHED,
    PRODUCTS: SUCCESS.REPORT.PRODUCTS_FETCHED,
    CUSTOMERS: SUCCESS.REPORT.CUSTOMERS_FETCHED,
    VENDORS: SUCCESS.REPORT.VENDORS_FETCHED,
    PAYOUTS: SUCCESS.REPORT.PAYOUTS_FETCHED,
    TAX: SUCCESS.REPORT.TAX_FETCHED,
    INVENTORY: SUCCESS.REPORT.INVENTORY_FETCHED,
    RETURNS: SUCCESS.REPORT.RETURNS_FETCHED,
  };

  return ApiResponse.success(res, {
    message: messages[type] ?? SUCCESS.REPORT.EXPORTED,
    result:
      D.str((req.query as any).format) === 'csv'
        ? { csv: D.str(result.csv), totalRecord: D.num(result.totalRecord) }
        : result,
  });
});

/**
 * @openapi
 * /content/reports/schedules:
 *   get:
 *     tags: [Content]
 *     summary: Scheduled report definitions
 *     responses:
 *       200: { description: Paginated schedule list }
 */
export const listSchedules = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listReportSchedules({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.REPORT.SCHEDULES_FETCHED,
    result: { itemList: rows.map(serializeReportSchedule) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /content/reports/schedules/create:
 *   post:
 *     tags: [Content]
 *     summary: Create a scheduled report
 *     responses:
 *       201: { description: The created schedule }
 */
export const createSchedule = asyncHandler(async (req, res) => {
  const row = await service.createReportSchedule(req.body, userId(req), req);

  return ApiResponse.created(res, SUCCESS.REPORT.SCHEDULE_CREATED, serializeReportSchedule(row));
});

/**
 * @openapi
 * /content/reports/schedules/:id/update:
 *   patch:
 *     tags: [Content]
 *     summary: Update a scheduled report
 *     responses:
 *       200: { description: The updated schedule }
 */
export const updateSchedule = asyncHandler(async (req, res) => {
  const row = await service.updateReportSchedule(req.params.id, req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.REPORT.SCHEDULE_UPDATED,
    result: serializeReportSchedule(row),
  });
});

/**
 * @openapi
 * /content/reports/schedules/:id/delete:
 *   delete:
 *     tags: [Content]
 *     summary: Delete a scheduled report
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deleteSchedule = asyncHandler(async (req, res) => {
  await service.deleteReportSchedule(req.params.id, req);

  return ApiResponse.success(res, {
    message: SUCCESS.REPORT.SCHEDULE_DELETED,
    result: { scheduleId: D.str(req.params.id), isDeleted: true },
  });
});

/** POST /reports/schedule — admin */
export const scheduleReport = asyncHandler(async (req, res) => {
  const row = await service.createReportSchedule(req.body, userId(req), req);

  return ApiResponse.created(res, SUCCESS.REPORT.SCHEDULE_CREATED, serializeReportSchedule(row));
});

/** GET /reports/export/:type — admin */
export const exportReport = asyncHandler(async (req, res) => {
  const result = await service.runReport(D.str(req.params.type).toUpperCase(), req.query as any);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${D.str(req.params.type).toLowerCase()}-report.csv"`,
  );

  return res.status(200).send(D.str(result.csv));
});

// ═══ Newsletter campaign ══════════════════════════════════════════════════════

/** POST /newsletter/sendCampaign — admin */
export const sendCampaign = asyncHandler(async (req, res) => {
  const result = await service.sendCampaign(req.body, userId(req), req);
  return ApiResponse.created(res, SUCCESS.NEWSLETTER.CAMPAIGN_SENT, result);
});

// ═══ Bulk import of orders and users ══════════════════════════════════════════

/** POST /bulk/importOrders — admin */
export const importOrders = asyncHandler(async (req, res) => {
  const result = await service.bulkImportOrders(req.body, userId(req), req);
  return ApiResponse.created(res, SUCCESS.BULK.ORDERS_IMPORTED, result);
});

/** POST /bulk/importUsers — admin */
export const importUsers = asyncHandler(async (req, res) => {
  const result = await service.bulkImportUsers(req.body, userId(req), req);
  return ApiResponse.created(res, SUCCESS.BULK.USERS_IMPORTED, result);
});

// ═══ API keys ═════════════════════════════════════════════════════════════════

/** GET /apiKeys/getAll — admin; secrets are never listed */
export const listApiKeys = asyncHandler(async (_req, res) => {
  const rows = await service.listApiKeys();

  return ApiResponse.success(res, {
    message: SUCCESS.API_KEY.FETCHED,
    result: { itemCount: rows.length, itemList: rows },
  });
});

/** POST /apiKeys/create — admin; the secret is returned exactly once */
export const createApiKey = asyncHandler(async (req, res) => {
  const row = await service.createApiKey(req.body, userId(req), req);
  return ApiResponse.created(res, SUCCESS.API_KEY.CREATED, row);
});

/** PATCH /apiKeys/revoke/:id — admin */
export const revokeApiKey = asyncHandler(async (req, res) => {
  const row = await service.revokeApiKey(D.str(req.params.id), userId(req), req);
  return ApiResponse.success(res, { message: SUCCESS.API_KEY.REVOKED, result: row });
});

/** DELETE /apiKeys/delete/:id — admin */
export const deleteApiKey = asyncHandler(async (req, res) => {
  await service.deleteApiKey(D.str(req.params.id), userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.API_KEY.DELETED,
    result: { apiKeyId: D.str(req.params.id), isDeleted: true },
  });
});

/** GET /apiKeys/getUsage/:id — admin */
export const getApiKeyUsage = asyncHandler(async (req, res) => {
  const result = await service.getApiKeyUsage(D.str(req.params.id));
  return ApiResponse.success(res, { message: SUCCESS.API_KEY.USAGE_FETCHED, result });
});

// ═══ Translations ═════════════════════════════════════════════════════════════

/** GET /i18n/getLocales */
export const listLocales = asyncHandler(async (_req, res) => {
  const rows = await service.listLocales();

  return ApiResponse.success(res, {
    message: SUCCESS.I18N.LOCALES_FETCHED,
    result: { itemCount: rows.length, itemList: rows },
  });
});

/** GET /i18n/getTranslations/:locale */
export const getTranslations = asyncHandler(async (req, res) => {
  const result = await service.getTranslationsByLocale(D.str(req.params.locale));

  return ApiResponse.success(res, {
    message: SUCCESS.I18N.TRANSLATIONS_FETCHED,
    result,
  });
});

/** POST /i18n/create — admin */
export const createTranslation = asyncHandler(async (req, res) => {
  const row = await service.createTranslation(req.body, userId(req), req);
  return ApiResponse.created(res, SUCCESS.I18N.CREATED, serializeTranslation(row));
});

/** PATCH /i18n/update/:id — admin */
export const updateTranslation = asyncHandler(async (req, res) => {
  const row = await service.updateTranslation(D.str(req.params.id), req.body, userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.I18N.UPDATED,
    result: serializeTranslation(row),
  });
});

/** DELETE /i18n/delete/:id — admin */
export const deleteTranslation = asyncHandler(async (req, res) => {
  await service.deleteTranslation(D.str(req.params.id), req);

  return ApiResponse.success(res, {
    message: SUCCESS.I18N.DELETED,
    result: { translationId: D.str(req.params.id), isDeleted: true },
  });
});

/** POST /i18n/bulkUpsert — admin */
export const bulkUpsertTranslations = asyncHandler(async (req, res) => {
  const count = await service.upsertTranslations(req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.I18N.BULK_UPSERTED,
    result: {
      upsertedCount: D.num(count),
      locale: D.str(req.body.locale),
      namespace: D.str(req.body.namespace),
    },
  });
});

// ═══ Provider webhooks ═════════════════════════════════════════════════════════

/**
 * One receiver for every inbound provider.
 *
 * The provider is known before the body is read so the signature can be checked against that
 * provider's own secret, and a delivery is always recorded even when verification fails.
 */
const handleProviderWebhook = async (
  provider: string,
  req: Request,
  res: any,
): Promise<unknown> => {
  const signature = D.str(
    (req.headers['x-signature'] ?? req.headers['x-webhook-signature']) as string,
  );

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});

  const isValid = await service.verifyProviderSignature(provider, rawBody, signature);

  const row = await service.recordWebhook(
    {
      endpointId: D.str(req.body.endpointId),
      event: D.str(req.body.event) || provider.toLowerCase(),
      eventId: D.str(req.body.eventId ?? req.body.id),
      payload: req.body,
      signature,
      direction: 'INBOUND',
    },
    isValid,
  );

  return ApiResponse.success(res, { message: SUCCESS.WEBHOOK.RECEIVED, result: row });
};

/** POST /webhooks/razorpay */
export const receiveRazorpayWebhook = asyncHandler(async (req, res) =>
  handleProviderWebhook('razorpay', req, res),
);

/** POST /webhooks/shipping */
export const receiveShippingWebhook = asyncHandler(async (req, res) =>
  handleProviderWebhook('shipping', req, res),
);

/** POST /webhooks/payment-gateway/:provider */
export const receivePaymentGatewayWebhook = asyncHandler(async (req, res) =>
  handleProviderWebhook(D.str(req.params.provider).toLowerCase(), req, res),
);
