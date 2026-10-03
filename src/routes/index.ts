import { Router } from 'express';

import healthRoutes from '../modules/health/health.routes';
import systemRoutes from '../modules/system/system.routes';
import authRoutes from '../modules/auth/auth.routes';
import userRoutes from '../modules/user/user.routes';
import vendorRoutes from '../modules/vendor/vendor.routes';
import productRoutes from '../modules/product/product.routes';
import categoryRoutes from '../modules/category/category.routes';
import catalogRoutes from '../modules/catalog/catalog.routes';
import { cartRoutes, wishlistRoutes } from '../modules/cart/cart.routes';
import orderRoutes from '../modules/order/order.routes';
import {
  paymentRoutes,
  payoutRoutes,
  returnRoutes,
  walletRoutes,
} from '../modules/payment/payment.routes';
import {
  reviewRoutes,
  questionRoutes,
  couponRoutes,
  flashSaleRoutes,
} from '../modules/review/review.routes';
import {
  loyaltyRoutes,
  referralRoutes,
  giftCardRoutes,
  templateRoutes,
} from '../modules/engagement/engagement.routes';
import {
  notificationRoutes,
  chatRoutes,
  ticketRoutes,
} from '../modules/notification/notification.routes';
import {
  shippingRoutes,
  deliveryBoyRoutes,
  settingsRoutes,
  adminRoutes,
  auditRoutes,
  activityLogRoutes,
} from '../modules/shipping/shipping.routes';
import {
  trackingRoutes,
  deviceRoutes,
  analyticsRoutes,
  searchRoutes,
  uploadRoutes,
} from '../modules/analytics/analytics.routes';
import {
  pageRoutes,
  blogRoutes,
  faqRoutes,
  bannerRoutes,
  contactRoutes,
  newsletterRoutes,
  countryRoutes,
  currencyRoutes,
  taxRoutes,
  i18nRoutes,
  contentRoutes,
  webhookRoutes,
  bulkRoutes,
  reportRoutes,
  apiKeyRoutes,
} from '../modules/content/content.routes';
import { docsRouter, getSpec } from '../docs/swagger.routes';

const apiRoutes = Router();

// ── Always available (bypass maintenance mode, no auth) ─────────────────────
apiRoutes.use('/health', healthRoutes);
apiRoutes.use('/version', systemRoutes);
apiRoutes.use('/docs', docsRouter);
apiRoutes.get('/docs.json', (_req, res) => res.json(getSpec()));

// ── Module routes (auth module is public; guards live inside each route) ────
apiRoutes.use('/auth', authRoutes);
apiRoutes.use('/users', userRoutes);
apiRoutes.use('/vendors', vendorRoutes);
apiRoutes.use('/products', productRoutes);
apiRoutes.use('/categories', categoryRoutes);
apiRoutes.use(catalogRoutes);
apiRoutes.use('/cart', cartRoutes);
apiRoutes.use('/wishlist', wishlistRoutes);
apiRoutes.use('/orders', orderRoutes);
apiRoutes.use('/payments', paymentRoutes);
apiRoutes.use('/payouts', payoutRoutes);
apiRoutes.use('/returns', returnRoutes);
apiRoutes.use('/wallet', walletRoutes);
apiRoutes.use('/reviews', reviewRoutes);
apiRoutes.use('/questions', questionRoutes);
apiRoutes.use('/coupons', couponRoutes);
apiRoutes.use('/flashSales', flashSaleRoutes);
apiRoutes.use('/loyalty', loyaltyRoutes);
apiRoutes.use('/referral', referralRoutes);
apiRoutes.use('/giftCards', giftCardRoutes);
apiRoutes.use('/templates', templateRoutes);
apiRoutes.use('/pages', pageRoutes);
apiRoutes.use('/blogs', blogRoutes);
apiRoutes.use('/faqs', faqRoutes);
apiRoutes.use('/banners', bannerRoutes);
apiRoutes.use('/contact', contactRoutes);
apiRoutes.use('/newsletter', newsletterRoutes);
apiRoutes.use('/countries', countryRoutes);
apiRoutes.use('/currencies', currencyRoutes);
apiRoutes.use('/tax', taxRoutes);
apiRoutes.use('/i18n', i18nRoutes);
apiRoutes.use('/content', contentRoutes);
apiRoutes.use('/webhooks', webhookRoutes);
apiRoutes.use('/bulk', bulkRoutes);
apiRoutes.use('/reports', reportRoutes);
apiRoutes.use('/apiKeys', apiKeyRoutes);
apiRoutes.use('/notifications', notificationRoutes);
apiRoutes.use('/chat', chatRoutes);
apiRoutes.use('/tickets', ticketRoutes);
apiRoutes.use('/shipping', shippingRoutes);
apiRoutes.use('/deliveryBoys', deliveryBoyRoutes);
apiRoutes.use('/settings', settingsRoutes);
apiRoutes.use('/admin', adminRoutes);
apiRoutes.use('/auditLogs', auditRoutes);
apiRoutes.use('/activityLogs', activityLogRoutes);
apiRoutes.use('/track', trackingRoutes);
apiRoutes.use('/devices', deviceRoutes);
apiRoutes.use('/analytics', analyticsRoutes);
apiRoutes.use('/search', searchRoutes);
apiRoutes.use('/uploads', uploadRoutes);

export { apiRoutes };
export default apiRoutes;
