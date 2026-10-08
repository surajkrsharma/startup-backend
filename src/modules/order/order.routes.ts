import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './order.controller';
import * as schema from './order.schema';

const router = Router();

router.get('/track/:id', validate({ params: schema.trackParamSchema }), controller.track);

router.get(
  '/getAll',
  authenticate,
  validate({ query: schema.listOrdersSchema }),
  controller.getAll,
);

router.post(
  '/placeOrder',
  authenticate,
  validate({ body: schema.placeOrderSchema }),
  controller.placeOrder,
);

router.post(
  '/reorder/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema, body: schema.reorderSchema.partial() }),
  controller.reorder,
);

router.post(
  '/cancelOrder/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema, body: schema.cancelOrderSchema }),
  controller.cancelOrder,
);

router.get(
  '/getById/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema }),
  controller.getById,
);

router.get(
  '/getTimeline/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema }),
  controller.getTimeline,
);

router.get(
  '/getTags/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.orderIdParamSchema }),
  controller.getTags,
);

router.post(
  '/addTags/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.orderIdParamSchema, body: schema.addOrderTagsSchema }),
  controller.addTags,
);

router.delete(
  '/removeTag/:id/:tagId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.orderTagParamSchema }),
  controller.removeTag,
);

router.post(
  '/addNote/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.orderIdParamSchema, body: schema.addOrderNoteSchema }),
  controller.addNote,
);

router.get(
  '/getNotes/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.orderIdParamSchema }),
  controller.getNotes,
);

router.delete(
  '/removeNote/:id/:noteId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.orderNoteParamSchema }),
  controller.removeNote,
);

router.get(
  '/getInvoice/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema, query: schema.invoiceQuerySchema }),
  controller.getInvoice,
);

router.post(
  '/returnRequest/:id',
  authenticate,
  validate({ params: schema.orderIdParamSchema, body: schema.returnRequestSchema }),
  controller.returnRequest,
);

router.get(
  '/getVendorOrders',
  authenticate,
  ...controller.guards.vendor,
  validate({ query: schema.vendorOrdersSchema }),
  controller.vendorOrders,
);

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

router.post(
  '/vendorBulkStatusUpdate',
  authenticate,
  ...controller.guards.vendor,
  validate({ body: schema.vendorBulkStatusUpdateSchema }),
  controller.vendorBulkStatusUpdate,
);

router.get(
  '/getPackingSlip/:id',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: idParamSchema, query: schema.invoiceQuerySchema }),
  controller.getPackingSlip,
);

router.get(
  '/getShippingLabel/:subOrderId',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: schema.subOrderParamSchema, query: schema.invoiceQuerySchema }),
  controller.getShippingLabel,
);

router.patch(
  '/updateStatus/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.orderIdParamSchema, body: schema.updateOrderStatusSchema }),
  controller.updateStatus,
);

router.patch(
  '/assignDeliveryBoy/:subOrderId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.subOrderParamSchema, body: schema.assignDeliveryBoySchema }),
  controller.assignDeliveryBoy,
);

router.post(
  '/verifyDeliveryOtp/:subOrderId',
  authenticate,
  validate({ params: schema.subOrderParamSchema, body: schema.confirmDeliverySchema }),
  controller.verifyDeliveryOtp,
);

router.patch(
  '/approveReturn/:returnId',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.returnDecisionSchema }),
  controller.approveReturn,
);

router.patch(
  '/rejectReturn/:returnId',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.rejectReturnDecisionSchema }),
  controller.rejectReturn,
);

export default router;
