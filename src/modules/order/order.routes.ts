import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './order.controller';
import * as schema from './order.schema';

const router = Router();

// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * GET /orders/track/:id — public tracking, no auth.
 * Declared before the authenticated routes so `track` is never shadowed.
 */
router.get('/track/:id', validate({ params: schema.trackParamSchema }), controller.track);

// ─── Customer ─────────────────────────────────────────────────────────────────

/** GET /orders/getAll */
router.get(
  '/getAll',
  authenticate,
  validate({ query: schema.listOrdersSchema }),
  controller.getAll,
);

/** POST /orders/placeOrder */
router.post(
  '/placeOrder',
  authenticate,
  validate({ body: schema.placeOrderSchema }),
  controller.placeOrder,
);

/** POST /orders/reorder/:id — body may carry `skipUnavailable` */
router.post(
  '/reorder/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema, body: schema.reorderSchema.partial() }),
  controller.reorder,
);

/** POST /orders/cancelOrder/:id */
router.post(
  '/cancelOrder/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema, body: schema.cancelOrderSchema }),
  controller.cancelOrder,
);

/** GET /orders/getById/:id — accepts an id or an order number */
router.get(
  '/getById/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema }),
  controller.getById,
);

/** GET /orders/getTimeline/:id */
router.get(
  '/getTimeline/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema }),
  controller.getTimeline,
);

/** GET /orders/getInvoice/:id — PDF by default, JSON with ?format=json */
router.get(
  '/getInvoice/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema, query: schema.invoiceQuerySchema }),
  controller.getInvoice,
);

/** POST /orders/returnRequest/:id */
router.post(
  '/returnRequest/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema, body: schema.returnRequestSchema }),
  controller.returnRequest,
);

// ─── Vendor ───────────────────────────────────────────────────────────────────

/** GET /orders/getVendorOrders */
router.get(
  '/getVendorOrders',
  authenticate,
  ...controller.guards.vendor,
  validate({ query: schema.vendorOrdersSchema }),
  controller.vendorOrders,
);

/** PATCH /orders/updateVendorStatus/:subOrderId */
router.patch(
  '/updateVendorStatus/:subOrderId',
  authenticate,
  ...controller.guards.vendor,
  validate({
    params: schema.subOrderParamSchema,
    body: schema.updateSubOrderStatusSchema,
  }),
  controller.updateSubOrderStatus,
);

/** GET /orders/getPackingSlip/:id — targets a sub-order id */
router.get(
  '/getPackingSlip/:id',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: idParamSchema, query: schema.invoiceQuerySchema }),
  controller.getPackingSlip,
);

/** GET /orders/getShippingLabel/:subOrderId */
router.get(
  '/getShippingLabel/:subOrderId',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: schema.subOrderParamSchema, query: schema.invoiceQuerySchema }),
  controller.getShippingLabel,
);

// ─── Admin ────────────────────────────────────────────────────────────────────

/** PATCH /orders/updateStatus/:id */
router.patch(
  '/updateStatus/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.orderIdParamSchema, body: schema.updateOrderStatusSchema }),
  controller.updateStatus,
);

/** PATCH /orders/assignDeliveryBoy/:subOrderId */
router.patch(
  '/assignDeliveryBoy/:subOrderId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.subOrderParamSchema, body: schema.assignDeliveryBoySchema }),
  controller.assignDeliveryBoy,
);

/** POST /orders/verifyDeliveryOtp/:subOrderId — vendor or admin */
router.post(
  '/verifyDeliveryOtp/:subOrderId',
  authenticate,
  validate({ params: schema.subOrderParamSchema, body: schema.confirmDeliverySchema }),
  controller.verifyDeliveryOtp,
);

/** PATCH /orders/approveReturn/:returnId — vendor or admin */
router.patch(
  '/approveReturn/:returnId',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.returnDecisionSchema }),
  controller.approveReturn,
);

/** PATCH /orders/rejectReturn/:returnId — vendor or admin */
router.patch(
  '/rejectReturn/:returnId',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.rejectReturnDecisionSchema }),
  controller.rejectReturn,
);

export default router;
