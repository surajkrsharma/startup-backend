import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate, optionalAuth } from '../../middlewares/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as controller from './content.controller';
import * as schema from './content.schema';

// ── Pages ────────────────────────────────────────────────────────────────────

const page = Router();

/** GET /pages/getAll */
page.get(
  '/getAll',
  optionalAuth,
  validate({ query: schema.listPagesSchema }),
  controller.listPages,
);

/** GET /pages/getBySlug/:slug */
page.get(
  '/getBySlug/:slug',
  optionalAuth,
  validate({ params: schema.pageSlugParamSchema }),
  controller.getPageBySlug,
);

/** POST /pages/create — admin */
page.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createPageSchema }),
  controller.createPage,
);

/** PATCH /pages/update/:id — admin */
page.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.updatePageSchema }),
  controller.updatePage,
);

/** DELETE /pages/delete/:id — admin */
page.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema }),
  controller.deletePage,
);

export const pageRoutes = page;

// ── Blogs ────────────────────────────────────────────────────────────────────

const blog = Router();

/** GET /blogs/getAll */
blog.get(
  '/getAll',
  optionalAuth,
  validate({ query: schema.listBlogsSchema }),
  controller.listBlogs,
);

/** GET /blogs/getBySlug/:slug */
blog.get(
  '/getBySlug/:slug',
  optionalAuth,
  validate({ params: schema.blogSlugParamSchema }),
  controller.getBlogBySlug,
);

/** POST /blogs/create — admin */
blog.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createBlogSchema }),
  controller.createBlog,
);

/** PATCH /blogs/update/:id — admin */
blog.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.updateBlogSchema }),
  controller.updateBlog,
);

/** DELETE /blogs/delete/:id — admin */
blog.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema }),
  controller.deleteBlog,
);

export const blogRoutes = blog;

// ── FAQs ─────────────────────────────────────────────────────────────────────

const faq = Router();

/** GET /faqs/getAll */
faq.get('/getAll', validate({ query: schema.listFaqsSchema }), controller.listFaqs);

/** POST /faqs/create — admin */
faq.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createFaqSchema }),
  controller.createFaq,
);

/** PATCH /faqs/update/:id — admin */
faq.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.faqIdParamSchema, body: schema.updateFaqSchema }),
  controller.updateFaq,
);

/** DELETE /faqs/delete/:id — admin */
faq.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.faqIdParamSchema }),
  controller.deleteFaq,
);

export const faqRoutes = faq;

// ── Banners ──────────────────────────────────────────────────────────────────

const banner = Router();

/** GET /banners/getAll */
banner.get('/getAll', validate({ query: schema.listBannersSchema }), controller.listBanners);

/** POST /banners/create — admin */
banner.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createBannerSchema }),
  controller.createBanner,
);

/** PATCH /banners/update/:id — admin */
banner.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.bannerIdParamSchema, body: schema.updateBannerSchema }),
  controller.updateBanner,
);

/** DELETE /banners/delete/:id — admin */
banner.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.bannerIdParamSchema }),
  controller.deleteBanner,
);

export const bannerRoutes = banner;

// ── Contact ──────────────────────────────────────────────────────────────────

const contact = Router();

/** POST /contact/submit — public */
contact.post(
  '/submit',
  optionalAuth,
  validate({ body: schema.submitContactSchema }),
  controller.submitContact,
);

/** GET /contact/getAll — admin */
contact.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listContactsSchema }),
  controller.listContacts,
);

/** PATCH /contact/:id/markRead — admin */
contact.patch(
  '/:id/markRead',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.markContactReadSchema }),
  controller.markContactRead,
);

export const contactRoutes = contact;

// ── Newsletter ───────────────────────────────────────────────────────────────

const newsletter = Router();

/** POST /newsletter/subscribe — public */
newsletter.post('/subscribe', validate({ body: schema.subscribeSchema }), controller.subscribe);

/** POST /newsletter/unsubscribe — public, token based */
newsletter.post(
  '/unsubscribe',
  validate({ body: schema.unsubscribeSchema }),
  controller.unsubscribe,
);

/** GET /newsletter/getAll — admin */
newsletter.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listSubscribersSchema }),
  controller.listSubscribers,
);

/** POST /newsletter/sendCampaign — admin */
newsletter.post(
  '/sendCampaign',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.sendCampaignSchema }),
  controller.sendCampaign,
);

export const newsletterRoutes = newsletter;

// ── Countries / states / cities ──────────────────────────────────────────────

const country = Router();

/** GET /countries/getAll */
country.get('/getAll', validate({ query: schema.listCountriesSchema }), controller.listCountries);

/** GET /countries/getStates/:countryCode */
country.get(
  '/getStates/:countryCode',
  validate({ params: schema.countryCodeParamSchema, query: schema.listStatesSchema }),
  controller.listStates,
);

/** GET /countries/getCities/:stateCode */
country.get(
  '/getCities/:stateCode',
  validate({ params: schema.stateCodeParamSchema, query: schema.listCitiesSchema }),
  controller.listCities,
);

/** POST /countries/checkPincode — public */
country.post(
  '/checkPincode',
  validate({ body: schema.checkPincodeSchema }),
  controller.checkPincode,
);

/** POST /countries/seedCountries — admin, writes the geo reference tables */
country.post('/seedCountries', authenticate, ...controller.guards.admin, controller.seedCountries);

export const countryRoutes = country;

// ── Currencies ───────────────────────────────────────────────────────────────

const currency = Router();

/** GET /currencies/getAll */
currency.get('/getAll', controller.listCurrencies);

/** GET /currencies/convert — declared before any /:id route so it is not shadowed */
currency.get('/convert', controller.convertCurrency);

/** POST /currencies/create — admin */
currency.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.currencySchema }),
  controller.createCurrency,
);

/** PATCH /currencies/update/:id — admin */
currency.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.currencyUpdateSchema }),
  controller.updateCurrency,
);

/** DELETE /currencies/delete/:id — admin */
currency.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema }),
  controller.deleteCurrency,
);

export const currencyRoutes = currency;

// ── Tax ──────────────────────────────────────────────────────────────────────

const tax = Router();

/** GET /tax/getConfigs */
tax.get('/getConfigs', controller.listTaxConfigs);

/** POST /tax/create — admin */
tax.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.taxConfigSchema }),
  controller.createTaxConfig,
);

/** PATCH /tax/update/:id — admin */
tax.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.taxConfigUpdateSchema }),
  controller.updateTaxConfig,
);

/** DELETE /tax/delete/:id — admin */
tax.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema }),
  controller.deleteTaxConfig,
);

export const taxRoutes = tax;

// ── Translations (i18n) ──────────────────────────────────────────────────────

const i18n = Router();

/** GET /i18n/getLocales */
i18n.get('/getLocales', controller.listLocales);

/** GET /i18n/getTranslations/:locale */
i18n.get(
  '/getTranslations/:locale',
  validate({ params: schema.localeParamSchema }),
  controller.getTranslations,
);

/** POST /i18n/bulkUpsert — admin */
i18n.post(
  '/bulkUpsert',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.bulkUpsertTranslationsSchema }),
  controller.bulkUpsertTranslations,
);

/** POST /i18n/create — admin */
i18n.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createTranslationSchema }),
  controller.createTranslation,
);

/** PATCH /i18n/update/:id — admin */
i18n.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema, body: schema.updateTranslationSchema }),
  controller.updateTranslation,
);

/** DELETE /i18n/delete/:id — admin */
i18n.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.deleteTranslation,
);

export const i18nRoutes = i18n;

// ── Dropdowns (dynamic reference data) ───────────────────────────────────────

const content = Router();

/** GET /content/dropdowns */
content.get(
  '/dropdowns',
  validate({ query: schema.dropdownQuerySchema }),
  controller.listDropdowns,
);

/** POST /content/dropdowns/create — admin */
content.post(
  '/dropdowns/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.dropdownSchema }),
  controller.createDropdown,
);

/** PATCH /content/dropdowns/:id/update — admin */
content.patch(
  '/dropdowns/:id/update',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.dropdownSchema.partial() }),
  controller.updateDropdown,
);

/** DELETE /content/dropdowns/:id/delete — admin */
content.delete(
  '/dropdowns/:id/delete',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema }),
  controller.deleteDropdown,
);

export const contentRoutes = content;

// ── Webhooks ─────────────────────────────────────────────────────────────────

const webhook = Router();

/** POST /webhooks/register — admin */
webhook.post(
  '/register',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createWebhookSchema }),
  controller.registerWebhook,
);

/** POST /webhooks/razorpay — signature verified, no auth */
webhook.post('/razorpay', controller.receiveRazorpayWebhook);

/** POST /webhooks/shipping — signature verified, no auth */
webhook.post('/shipping', controller.receiveShippingWebhook);

/** POST /webhooks/payment-gateway/:provider — signature verified, no auth */
webhook.post(
  '/payment-gateway/:provider',
  validate({ params: schema.webhookProviderParamSchema }),
  controller.receivePaymentGatewayWebhook,
);

/** GET /webhooks/getLogs — admin, declared after the receiver routes */
webhook.get(
  '/getLogs',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.webhookLogSchema }),
  controller.listWebhookLogs,
);

/** GET /webhooks/getAll — admin */
webhook.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listWebhooksSchema }),
  controller.listWebhooks,
);

/** PATCH /webhooks/:id/update — admin */
webhook.patch(
  '/:id/update',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.webhookIdParamSchema, body: schema.updateWebhookSchema }),
  controller.updateWebhook,
);

/** POST /webhooks/:id/rotateSecret — admin */
webhook.post(
  '/:id/rotateSecret',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.webhookIdParamSchema }),
  controller.rotateSecret,
);

/** DELETE /webhooks/delete/:id — admin */
webhook.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.webhookIdParamSchema }),
  controller.deleteWebhook,
);

export const webhookRoutes = webhook;

// ── Bulk jobs ────────────────────────────────────────────────────────────────

const bulk = Router();

/** POST /bulk/importProducts — vendors and staff */
bulk.post(
  '/importProducts',
  authenticate,
  validate({ body: schema.bulkProductsSchema }),
  controller.importProducts,
);

/** POST /bulk/importOrders — admin */
bulk.post(
  '/importOrders',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.bulkRowsSchema }),
  controller.importOrders,
);

/** POST /bulk/importUsers — admin */
bulk.post(
  '/importUsers',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.bulkRowsSchema }),
  controller.importUsers,
);

/** GET /bulk/getJobStatus/:jobId */
bulk.get(
  '/getJobStatus/:jobId',
  authenticate,
  validate({ params: schema.jobIdParamSchema }),
  controller.getBulkJobStatus,
);

/** GET /bulk/getJobHistory */
bulk.get(
  '/getJobHistory',
  authenticate,
  validate({ query: schema.listJobsSchema }),
  controller.listBulkJobs,
);

export const bulkRoutes = bulk;

// ── Reports ──────────────────────────────────────────────────────────────────

const report = Router();

/**
 * Each report gets its own route so a dashboard can link straight to one.
 * The handler is bound to the report type here rather than repeating nine near-identical
 * controller functions.
 */
const reportHandler = (type: string) =>
  asyncHandler(async (req, res, next) => {
    req.params = { ...req.params, type };
    return controller.runReport(req, res, next);
  });

const reportRoute = (type: string) => [
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.reportSchema }),
  reportHandler(type),
];

report.get('/sales', ...reportRoute('SALES'));
report.get('/orders', ...reportRoute('ORDERS'));
report.get('/products', ...reportRoute('PRODUCTS'));
report.get('/customers', ...reportRoute('CUSTOMERS'));
report.get('/vendors', ...reportRoute('VENDORS'));
report.get('/payouts', ...reportRoute('PAYOUTS'));
report.get('/tax', ...reportRoute('TAX'));
report.get('/inventory', ...reportRoute('INVENTORY'));
report.get('/returns', ...reportRoute('RETURNS'));

/** GET /reports/export/:type — admin */
report.get(
  '/export/:type',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.reportSchema }),
  controller.exportReport,
);

/** POST /reports/schedule — admin */
report.post(
  '/schedule',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createScheduleSchema }),
  controller.scheduleReport,
);

/** GET /reports/getSchedules — admin */
report.get(
  '/getSchedules',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listSchedulesSchema }),
  controller.listSchedules,
);

/** PATCH /reports/schedule/:id/update — admin */
report.patch(
  '/schedule/:id/update',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.scheduleIdParamSchema, body: schema.createScheduleSchema.partial() }),
  controller.updateSchedule,
);

/** DELETE /reports/schedule/:id/delete — admin */
report.delete(
  '/schedule/:id/delete',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.scheduleIdParamSchema }),
  controller.deleteSchedule,
);

export const reportRoutes = report;

// ── API keys ─────────────────────────────────────────────────────────────────

const apiKey = Router();

/** GET /apiKeys/getAll — admin */
apiKey.get('/getAll', authenticate, ...controller.guards.admin, controller.listApiKeys);

/** POST /apiKeys/create — admin */
apiKey.post(
  '/create',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ body: schema.createApiKeySchema }),
  controller.createApiKey,
);

/** PATCH /apiKeys/revoke/:id — admin */
apiKey.patch(
  '/revoke/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.apiKeyIdParamSchema }),
  controller.revokeApiKey,
);

/** DELETE /apiKeys/delete/:id — admin */
apiKey.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: schema.apiKeyIdParamSchema }),
  controller.deleteApiKey,
);

/** GET /apiKeys/getUsage/:id — admin */
apiKey.get(
  '/getUsage/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.apiKeyIdParamSchema }),
  controller.getApiKeyUsage,
);

export const apiKeyRoutes = apiKey;

export default contentRoutes;
