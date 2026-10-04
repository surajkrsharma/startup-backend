import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate, optionalAuth } from '../../middlewares/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as controller from './content.controller';
import * as schema from './content.schema';

const page = Router();

page.get(
  '/getAll',
  optionalAuth,
  validate({ query: schema.listPagesSchema }),
  controller.listPages,
);

page.get(
  '/getBySlug/:slug',
  optionalAuth,
  validate({ params: schema.pageSlugParamSchema }),
  controller.getPageBySlug,
);

page.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createPageSchema }),
  controller.createPage,
);

page.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.updatePageSchema }),
  controller.updatePage,
);

page.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema }),
  controller.deletePage,
);

export const pageRoutes = page;

const blog = Router();

blog.get(
  '/getAll',
  optionalAuth,
  validate({ query: schema.listBlogsSchema }),
  controller.listBlogs,
);

blog.get(
  '/getBySlug/:slug',
  optionalAuth,
  validate({ params: schema.blogSlugParamSchema }),
  controller.getBlogBySlug,
);

blog.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createBlogSchema }),
  controller.createBlog,
);

blog.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.updateBlogSchema }),
  controller.updateBlog,
);

blog.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema }),
  controller.deleteBlog,
);

export const blogRoutes = blog;

const faq = Router();

faq.get('/getAll', validate({ query: schema.listFaqsSchema }), controller.listFaqs);

faq.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createFaqSchema }),
  controller.createFaq,
);

faq.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.faqIdParamSchema, body: schema.updateFaqSchema }),
  controller.updateFaq,
);

faq.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.faqIdParamSchema }),
  controller.deleteFaq,
);

export const faqRoutes = faq;

const banner = Router();

banner.get('/getAll', validate({ query: schema.listBannersSchema }), controller.listBanners);

banner.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createBannerSchema }),
  controller.createBanner,
);

banner.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.bannerIdParamSchema, body: schema.updateBannerSchema }),
  controller.updateBanner,
);

banner.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.bannerIdParamSchema }),
  controller.deleteBanner,
);

export const bannerRoutes = banner;

const contact = Router();

contact.post(
  '/submit',
  optionalAuth,
  validate({ body: schema.submitContactSchema }),
  controller.submitContact,
);

contact.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listContactsSchema }),
  controller.listContacts,
);

contact.patch(
  '/:id/markRead',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.markContactReadSchema }),
  controller.markContactRead,
);

export const contactRoutes = contact;

const newsletter = Router();

newsletter.post('/subscribe', validate({ body: schema.subscribeSchema }), controller.subscribe);

newsletter.post(
  '/unsubscribe',
  validate({ body: schema.unsubscribeSchema }),
  controller.unsubscribe,
);

newsletter.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listSubscribersSchema }),
  controller.listSubscribers,
);

newsletter.post(
  '/sendCampaign',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.sendCampaignSchema }),
  controller.sendCampaign,
);

export const newsletterRoutes = newsletter;

const country = Router();

country.get('/getAll', validate({ query: schema.listCountriesSchema }), controller.listCountries);

country.get(
  '/getStates/:countryCode',
  validate({ params: schema.countryCodeParamSchema, query: schema.listStatesSchema }),
  controller.listStates,
);

country.get(
  '/getCities/:stateCode',
  validate({ params: schema.stateCodeParamSchema, query: schema.listCitiesSchema }),
  controller.listCities,
);

country.post(
  '/checkPincode',
  validate({ body: schema.checkPincodeSchema }),
  controller.checkPincode,
);

country.post('/seedCountries', authenticate, ...controller.guards.admin, controller.seedCountries);

export const countryRoutes = country;

const currency = Router();

currency.get('/getAll', controller.listCurrencies);

currency.get('/convert', controller.convertCurrency);

currency.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.currencySchema }),
  controller.createCurrency,
);

currency.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.currencyUpdateSchema }),
  controller.updateCurrency,
);

currency.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema }),
  controller.deleteCurrency,
);

export const currencyRoutes = currency;

const tax = Router();

tax.get('/getConfigs', controller.listTaxConfigs);

tax.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.taxConfigSchema }),
  controller.createTaxConfig,
);

tax.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.taxConfigUpdateSchema }),
  controller.updateTaxConfig,
);

tax.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema }),
  controller.deleteTaxConfig,
);

export const taxRoutes = tax;

const i18n = Router();

i18n.get('/getLocales', controller.listLocales);

i18n.get(
  '/getTranslations/:locale',
  validate({ params: schema.localeParamSchema }),
  controller.getTranslations,
);

i18n.post(
  '/bulkUpsert',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.bulkUpsertTranslationsSchema }),
  controller.bulkUpsertTranslations,
);

i18n.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createTranslationSchema }),
  controller.createTranslation,
);

i18n.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema, body: schema.updateTranslationSchema }),
  controller.updateTranslation,
);

i18n.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.deleteTranslation,
);

export const i18nRoutes = i18n;

const content = Router();

content.get(
  '/dropdowns',
  validate({ query: schema.dropdownQuerySchema }),
  controller.listDropdowns,
);

content.post(
  '/dropdowns/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.dropdownSchema }),
  controller.createDropdown,
);

content.patch(
  '/dropdowns/:id/update',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema, body: schema.dropdownSchema.partial() }),
  controller.updateDropdown,
);

content.delete(
  '/dropdowns/:id/delete',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.contentIdParamSchema }),
  controller.deleteDropdown,
);

export const contentRoutes = content;

const webhook = Router();

webhook.post(
  '/register',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createWebhookSchema }),
  controller.registerWebhook,
);

/**
 * @openapi
 * /webhooks/razorpay:
 *   post:
 *     tags: [Webhooks]
 *     summary: Receive a Razorpay event
 *     description: >
 *       Called by Razorpay, not by an app. There is no bearer token; the request is
 *       accepted only when the HMAC in `x-signature` (or `x-webhook-signature`) matches
 *       the raw body. The payload is stored verbatim after `endpointId`, `event` and
 *       `eventId` are read off it.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WebhookProviderPayload'
 *     responses:
 *       200:
 *         description: Event accepted and recorded
 *       400:
 *         description: Signature missing or not matching
 */
webhook.post('/razorpay', controller.receiveRazorpayWebhook);

/**
 * @openapi
 * /webhooks/shipping:
 *   post:
 *     tags: [Webhooks]
 *     summary: Receive a shipping courier event
 *     description: >
 *       Called by the courier webhook, not by an app. No bearer token; the request is
 *       accepted only when the HMAC in `x-signature` (or `x-webhook-signature`) matches
 *       the raw body. The payload is stored verbatim after `endpointId`, `event` and
 *       `eventId` are read off it.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WebhookProviderPayload'
 *     responses:
 *       200:
 *         description: Event accepted and recorded
 *       400:
 *         description: Signature missing or not matching
 */
webhook.post('/shipping', controller.receiveShippingWebhook);

/**
 * @openapi
 * /webhooks/payment-gateway/{provider}:
 *   post:
 *     tags: [Webhooks]
 *     summary: Receive a payment gateway event
 *     description: >
 *       Called by the gateway named in `provider`, not by an app. No bearer token; the
 *       request is accepted only when the HMAC in `x-signature` (or `x-webhook-signature`)
 *       matches the raw body. The payload is stored verbatim after `endpointId`, `event`
 *       and `eventId` are read off it.
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [RAZORPAY, PAYPAL, STRIPE, PHONEPE]
 *         example: RAZORPAY
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WebhookProviderPayload'
 *     responses:
 *       200:
 *         description: Event accepted and recorded
 *       400:
 *         description: Signature missing or not matching
 */
webhook.post(
  '/payment-gateway/:provider',
  validate({ params: schema.webhookProviderParamSchema }),
  controller.receivePaymentGatewayWebhook,
);

webhook.get(
  '/getLogs',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.webhookLogSchema }),
  controller.listWebhookLogs,
);

webhook.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listWebhooksSchema }),
  controller.listWebhooks,
);

webhook.patch(
  '/:id/update',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.webhookIdParamSchema, body: schema.updateWebhookSchema }),
  controller.updateWebhook,
);

webhook.post(
  '/:id/rotateSecret',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.webhookIdParamSchema }),
  controller.rotateSecret,
);

webhook.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.webhookIdParamSchema }),
  controller.deleteWebhook,
);

export const webhookRoutes = webhook;

const bulk = Router();

bulk.post(
  '/importProducts',
  authenticate,
  validate({ body: schema.bulkProductsSchema }),
  controller.importProducts,
);

bulk.post(
  '/importOrders',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.bulkRowsSchema }),
  controller.importOrders,
);

bulk.post(
  '/importUsers',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.bulkRowsSchema }),
  controller.importUsers,
);

bulk.get(
  '/getJobStatus/:jobId',
  authenticate,
  validate({ params: schema.jobIdParamSchema }),
  controller.getBulkJobStatus,
);

bulk.get(
  '/getJobHistory',
  authenticate,
  validate({ query: schema.listJobsSchema }),
  controller.listBulkJobs,
);

export const bulkRoutes = bulk;

const report = Router();

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

report.get(
  '/export/:type',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.reportTypeParamSchema, query: schema.reportSchema }),
  controller.exportReport,
);

report.post(
  '/schedule',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createScheduleSchema }),
  controller.scheduleReport,
);

report.get(
  '/getSchedules',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listSchedulesSchema }),
  controller.listSchedules,
);

report.patch(
  '/schedule/:id/update',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.scheduleIdParamSchema, body: schema.createScheduleSchema.partial() }),
  controller.updateSchedule,
);

report.delete(
  '/schedule/:id/delete',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.scheduleIdParamSchema }),
  controller.deleteSchedule,
);

export const reportRoutes = report;

const apiKey = Router();

apiKey.get('/getAll', authenticate, ...controller.guards.admin, controller.listApiKeys);

apiKey.post(
  '/create',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ body: schema.createApiKeySchema }),
  controller.createApiKey,
);

apiKey.patch(
  '/revoke/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.apiKeyIdParamSchema }),
  controller.revokeApiKey,
);

apiKey.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: schema.apiKeyIdParamSchema }),
  controller.deleteApiKey,
);

apiKey.get(
  '/getUsage/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.apiKeyIdParamSchema }),
  controller.getApiKeyUsage,
);

export const apiKeyRoutes = apiKey;

export default contentRoutes;
