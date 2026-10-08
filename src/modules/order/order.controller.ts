import { Request } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { getPagination } from '../../utils/pagination';
import { requireRole } from '../../middlewares/auth.middleware';
import * as service from './order.service';
import {
  serializeOrder,
  serializeOrderSummary,
  serializeVendorOrder,
  serializePlaceOrderResult,
  serializeTrackOrder,
  serializeOrderTimeline,
  serializeOrderTagList,
  serializeOrderNote,
  serializeOrderNoteList,
  serializeSubOrder,
} from './order.serializer';

const userId = (req: Request): string => req.auth!.userId;
const vendorId = (req: Request): string => req.auth!.vendorId;

export const guards = {
  admin: [requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN)],
  vendor: [requireRole('VENDOR')],
};

/**
 * @openapi
 * /orders/getAll:
 *   get:
 *     tags: [Orders]
 *     summary: List the caller's orders
 *     description: >
 *       Filters: `?status=`, `?paymentStatus=`, `?paymentMethod=`, `?vendorId=`,
 *       `?from=`, `?to=`, `?search=`, `?sort=-createdAt`.
 *     responses:
 *       200: { description: Paginated order summaries, pagination fields first }
 */
export const getAll = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listOrders(userId(req), {
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ORDER.FETCHED,
    result: { itemList: rows.map(serializeOrderSummary) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /orders/placeOrder:
 *   post:
 *     tags: [Orders]
 *     summary: Place an order from the cart
 *     description: >
 *       Fans out into one sub-order per vendor, decrements stock in a single
 *       transaction, and empties the cart. Pass `skipUnavailable: true` to drop
 *       lines that ran out of stock instead of failing the whole checkout.
 *     responses:
 *       201: { description: Order placed }
 *       422: { description: Empty cart, below minimum, or stock changed }
 */
export const placeOrder = asyncHandler(async (req, res) => {
  const { order, skipped } = await service.placeOrder(userId(req), req.body, req);

  return ApiResponse.created(
    res,
    order.tokenRequired ? SUCCESS.ORDER.TOKEN_PLACED : SUCCESS.ORDER.PLACED,
    serializePlaceOrderResult(order, skipped),
  );
});

/**
 * @openapi
 * /orders/getById/:id:
 *   get:
 *     tags: [Orders]
 *     summary: A single order with sub-orders, items, payments and timeline
 *     responses:
 *       200: { description: Order detail }
 *       404: { description: Not found or not the caller's order }
 */
export const getById = asyncHandler(async (req, res) => {
  const order = await service.getOrderById(D.str(req.params.id), userId(req));
  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.FETCHED,
    result: serializeOrder(order),
  });
});

/**
 * @openapi
 * /orders/getTimeline/:id:
 *   get:
 *     tags: [Orders]
 *     summary: Status history for an order
 *     responses:
 *       200: { description: Timeline entries, oldest first }
 */
export const getTimeline = asyncHandler(async (req, res) => {
  const order = await service.getOrderById(D.str(req.params.id), userId(req));
  const timeline = await service.getTimeline(order.id);

  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.TIMELINE_FETCHED,
    result: {
      orderId: D.str(order.id),
      orderNumber: D.str(order.orderNumber),
      currentStatus: D.str(order.status),
      itemCount: timeline.length,
      timelineList: timeline.map(serializeOrderTimeline),
    },
  });
});

/**
 * @openapi
 * /orders/getTags/:id:
 *   get:
 *     tags: [Orders]
 *     summary: Tags carried by an order
 *     responses:
 *       200: { description: Tag list, oldest first }
 */
export const getTags = asyncHandler(async (req, res) => {
  const tags = await service.listOrderTags(D.str(req.params.id), req);
  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.TAGS_FETCHED,
    result: serializeOrderTagList(tags),
  });
});

/**
 * @openapi
 * /orders/addTags/:id:
 *   post:
 *     tags: [Orders]
 *     summary: Attach labels to an order
 *     description: >
 *       Admin or vendor only. Labels are upper-cased, and re-posting one that
 *       already exists updates its colour instead of failing.
 *     responses:
 *       200: { description: Tags now on the order }
 *       400: { description: No usable label supplied }
 *       422: { description: Tag ceiling for the order reached }
 */
export const addTags = asyncHandler(async (req, res) => {
  const tags = await service.addOrderTags(D.str(req.params.id), req.body, req.auth!.userId, req);
  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.TAGS_ADDED,
    result: serializeOrderTagList(tags),
  });
});

/**
 * @openapi
 * /orders/removeTag/:id/:tagId:
 *   delete:
 *     tags: [Orders]
 *     summary: Detach one label from an order
 *     responses:
 *       200: { description: Tag removed }
 *       404: { description: Order or tag not found }
 */
export const removeTag = asyncHandler(async (req, res) => {
  await service.removeOrderTag(D.str(req.params.id), D.str(req.params.tagId), userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.TAG_REMOVED,
    result: { isRemoved: true },
  });
});

/**
 * @openapi
 * /orders/addNote/:id:
 *   post:
 *     tags: [Orders]
 *     summary: Add an internal note to an order
 *     description: Admin or vendor only.
 *     responses:
 *       200: { description: Note added }
 *       400: { description: Note is required }
 *       404: { description: Order not found }
 */
export const addNote = asyncHandler(async (req, res) => {
  const note = await service.addOrderNote(D.str(req.params.id), req.auth!.userId, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.NOTE_ADDED,
    result: serializeOrderNote(note),
  });
});

/**
 * @openapi
 * /orders/getNotes/:id:
 *   get:
 *     tags: [Orders]
 *     summary: List internal notes for an order
 *     description: Admin or vendor only.
 *     responses:
 *       200: { description: Note list, newest first }
 *       404: { description: Order not found }
 */
export const getNotes = asyncHandler(async (req, res) => {
  const notes = await service.listOrderNotes(D.str(req.params.id), req);
  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.NOTES_FETCHED,
    result: serializeOrderNoteList(notes),
  });
});

/**
 * @openapi
 * /orders/removeNote/:id/:noteId:
 *   delete:
 *     tags: [Orders]
 *     summary: Remove an internal note from an order
 *     description: Admin only.
 *     responses:
 *       200: { description: Note removed }
 *       404: { description: Order or note not found }
 */
export const removeNote = asyncHandler(async (req, res) => {
  await service.deleteOrderNote(
    D.str(req.params.id),
    D.str(req.params.noteId),
    req.auth!.userId,
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.NOTE_REMOVED,
    result: { isRemoved: true },
  });
});

/**
 * @openapi
 * /orders/track/:id:
 *   get:
 *     tags: [Orders]
 *     summary: Public order tracking (no auth, no customer identity)
 *     responses:
 *       200: { description: Status, shipments and timeline }
 *       404: { description: Order not found }
 */
export const track = asyncHandler(async (req, res) => {
  const order = await service.trackOrder(D.str(req.params.id));
  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.TRACKED,
    result: serializeTrackOrder(order),
  });
});

/**
 * @openapi
 * /orders/cancelOrder/:id:
 *   post:
 *     tags: [Orders]
 *     summary: Cancel an order (or one vendor's portion)
 *     description: >
 *       Only allowed inside the configured cancellation window. Stock is
 *       restored and any wallet payment is refunded.
 *     responses:
 *       200: { description: Order cancelled }
 *       422: { description: Window passed, already cancelled, or delivered }
 */
export const cancelOrder = asyncHandler(async (req, res) => {
  const order = await service.cancelOrder(D.str(req.params.id), userId(req), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.CANCELLED,
    result: serializeOrder(order),
  });
});

/**
 * @openapi
 * /orders/reorder:
 *   post:
 *     tags: [Orders]
 *     summary: Refill the cart from a past order
 *     responses:
 *       200: { description: How many lines were added and which were skipped }
 */
export const reorder = asyncHandler(async (req, res) => {
  const { added, skipped } = await service.reorder(
    userId(req),
    { ...req.body, orderId: D.str(req.params.id) },
    req,
  );

  const cart = await (await import('../cart/cart.service')).getCart(userId(req));
  const totals = await (await import('../cart/cart.service')).calculateTotals(cart);

  return ApiResponse.success(res, {
    message: skipped.length ? SUCCESS.ORDER.REORDER_PARTIAL : SUCCESS.ORDER.REORDERED,
    result: {
      addedCount: D.num(added),
      skippedCount: D.arr(skipped).length,
      skippedList: D.arr(skipped).map((s: any) => ({
        productId: D.str(s?.productId),
        name: D.str(s?.name),
        reason: D.str(s?.reason),
      })),
      cart: (await import('../cart/cart.serializer')).serializeCartDetail(cart, totals),
    },
  });
});

/**
 * @openapi
 * /orders/getInvoice/:id:
 *   get:
 *     tags: [Orders]
 *     summary: Invoice for an order
 *     description: HTML by default; pass `?format=json` for a structured payload.
 *     responses:
 *       200: { description: Invoice }
 */
export const getInvoice = asyncHandler(async (req, res) => {
  const order = await service.getOrderById(D.str(req.params.id), userId(req));

  if (D.str(req.query.format as string) === 'json') {
    return ApiResponse.success(res, {
      message: SUCCESS.ORDER.INVOICE_GENERATED,
      result: serializeOrder(order),
    });
  }

  const { generateInvoicePdf, pdfFileName } = await import('../../services/pdf.service');

  const pdf = await generateInvoicePdf({
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt,
    customer: order.user,
    address: order.address,
    items: order.items,
    vendor: D.arr(order.subOrders)[0]?.vendor,
    totals: {
      subtotal: order.subtotal,
      discount: order.discount,
      couponDiscount: order.couponDiscount,
      taxAmount: order.taxAmount,
      shippingAmount: order.shippingAmount,
      walletAmount: order.walletAmount,
      total: order.total,
    },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${pdfFileName('INVOICE', order.orderNumber)}"`,
  );
  return res.send(pdf);
});

/**
 * @openapi
 * /orders/vendorOrders:
 *   get:
 *     tags: [Orders]
 *     summary: The signed-in vendor's slice of every order
 *     responses:
 *       200: { description: Paginated sub-orders with customer and address }
 */
export const vendorOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listVendorOrders(vendorId(req), {
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ORDER.VENDOR_ORDERS_FETCHED,
    result: { itemList: rows.map(serializeVendorOrder) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /orders/updateSubOrderStatus/:id:
 *   patch:
 *     tags: [Orders]
 *     summary: A vendor moves their own sub-order through the state machine
 *     responses:
 *       200: { description: Sub-order updated }
 *       422: { description: Transition not allowed from the current status }
 */
export const updateSubOrderStatus = asyncHandler(async (req, res) => {
  const sub = await service.updateSubOrderStatus(
    D.str(req.params.subOrderId),
    vendorId(req),
    req.body,
    req.auth!.userId,
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.VENDOR_STATUS_UPDATED,
    result: serializeSubOrder(sub),
  });
});

/**
 * @openapi
 * /orders/vendorBulkStatusUpdate:
 *   post:
 *     tags: [Orders]
 *     summary: Accept or reject many of the vendor's own sub-orders in one call
 *     description: >
 *       `ACCEPT` confirms, `REJECT` cancels and puts the stock back. Ids the
 *       vendor does not own, and ids whose current status blocks the move, come
 *       back in `skippedList` instead of failing the call.
 *     responses:
 *       200: { description: Updated sub-orders first, then the skipped ids }
 *       422: { description: None of the requested sub-orders could move }
 */
export const vendorBulkStatusUpdate = asyncHandler(async (req, res) => {
  const outcome = await service.bulkUpdateSubOrderStatus(
    vendorId(req),
    req.body,
    req.auth!.userId,
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.VENDOR_BULK_STATUS_UPDATED,
    result: {
      action: D.str(outcome.action),
      requestedCount: D.num(outcome.requested),
      updatedCount: D.num(outcome.updated.length),
      skippedCount: D.num(outcome.skipped.length),

      subOrderList: D.arr(outcome.updated).map(serializeSubOrder),

      skippedList: D.arr(outcome.skipped).map((s: any) => ({
        subOrderId: D.str(s?.subOrderId),
        reason: D.str(s?.reason),
      })),
    },
  });
});

/**
 * @openapi
 * /orders/vendorCancelSubOrder/:id:
 *   post:
 *     tags: [Orders]
 *     summary: A vendor cancels only their own portion of an order
 *     responses:
 *       200: { description: Sub-order cancelled, stock restored }
 */
export const vendorCancelSubOrder = asyncHandler(async (req, res) => {
  const sub = await service.cancelOrder(
    D.str(await findOrderIdForSub(D.str(req.params.id))),
    userId(req),
    { ...req.body, subOrderId: D.str(req.params.id) },
    req,
  );

  const updated = D.arr(sub.subOrders).find((s: any) => D.str(s.id) === D.str(req.params.id));

  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.CANCELLED,
    result: { orderId: D.str(sub.id), subOrder: serializeSubOrder(updated) },
  });
});

const findOrderIdForSub = async (subOrderId: string): Promise<string> => {
  const { prisma } = await import('../../services/prisma.service');
  const sub = await prisma.subOrder.findUnique({
    where: { id: subOrderId },
    select: { orderId: true },
  });
  return D.str(sub?.orderId);
};

/**
 * @openapi
 * /orders/updateStatus/:id:
 *   patch:
 *     tags: [Orders]
 *     summary: Move an order through the state machine (admin)
 *     description: >
 *       Rejects any transition not in the state machine. Delivering a COD order
 *       settles its payment; cancelling restores stock.
 *     responses:
 *       200: { description: Order updated }
 *       422: { description: Transition not allowed }
 */
export const updateStatus = asyncHandler(async (req, res) => {
  const order = await service.updateOrderStatus(
    D.str(req.params.id),
    req.body,
    req.auth!.userId,
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.STATUS_UPDATED,
    result: serializeOrder(order),
  });
});

/**
 * @openapi
 * /orders/assignDeliveryBoy/:id:
 *   post:
 *     tags: [Orders]
 *     summary: Assign a delivery boy to a sub-order
 *     responses:
 *       200: { description: Assigned }
 *       404: { description: Sub-order or delivery boy not found }
 */
export const assignDeliveryBoy = asyncHandler(async (req, res) => {
  const sub = await service.assignDeliveryBoy(
    D.str(req.params.subOrderId),
    D.str(req.body.deliveryBoyId),
    req.auth!.userId,
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.DELIVERY_BOY_ASSIGNED,
    result: serializeSubOrder(sub),
  });
});

/**
 * @openapi
 * /orders/verifyDeliveryOtp/:subOrderId:
 *   post:
 *     tags: [Orders]
 *     summary: Confirm a sub-order was delivered
 *     description: >
 *       Pass the OTP the customer was given; COD orders settle here, so also pass
 *       `collectedAmount` for the cash taken.
 *     responses:
 *       200: { description: Delivery confirmed }
 *       422: { description: Already delivered, wrong OTP, or transition not allowed }
 */
export const verifyDeliveryOtp = asyncHandler(async (req, res) => {
  const sub = await service.confirmDelivery(
    D.str(req.params.subOrderId),
    req.body,
    req.auth!.userId,
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.ORDER.DELIVERY_VERIFIED,
    result: serializeSubOrder(sub),
  });
});

/**
 * @openapi
 * /orders/getPackingSlip/:id:
 *   get:
 *     tags: [Orders]
 *     summary: Packing slip PDF for a sub-order (vendor)
 *     responses:
 *       200: { description: PDF, or JSON with ?format=json }
 */
export const getPackingSlip = asyncHandler(async (req, res) => {
  const subOrderId = D.str(req.params.id);

  const sub = await service.getSubOrderForVendor(subOrderId, vendorId(req));

  if (D.str(req.query.format as string) === 'json') {
    return ApiResponse.success(res, {
      message: SUCCESS.ORDER.PACKING_SLIP_GENERATED,
      result: serializeSubOrder(sub),
    });
  }

  const { generatePackingSlipPdf, pdfFileName } = await import('../../services/pdf.service');

  const pdf = await generatePackingSlipPdf({
    orderNumber: D.str(sub.order?.orderNumber),
    status: D.str(sub.status),
    createdAt: sub.createdAt,
    vendor: sub.vendor,
    address: sub.order?.address,
    items: sub.items,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${pdfFileName('PACKING_SLIP', D.str(sub.order?.orderNumber))}"`,
  );

  return res.send(pdf);
});

/**
 * @openapi
 * /orders/getShippingLabel/:subOrderId:
 *   get:
 *     tags: [Orders]
 *     summary: Shipping label PDF for a sub-order (vendor)
 *     responses:
 *       200: { description: PDF, or JSON with ?format=json }
 */
export const getShippingLabel = asyncHandler(async (req, res) => {
  const subOrderId = D.str(req.params.subOrderId);

  const sub = await service.getSubOrderForVendor(subOrderId, vendorId(req));
  const shipment: any = D.arr(sub.shipments)[0];

  if (D.str(req.query.format as string) === 'json') {
    return ApiResponse.success(res, {
      message: SUCCESS.ORDER.SHIPPING_LABEL_GENERATED,
      result: {
        subOrderId,
        hasLabel: Boolean(shipment),
        awb: D.str(shipment?.awb),
      },
    });
  }

  const { generateShippingLabelPdf, pdfFileName } = await import('../../services/pdf.service');

  const pdf = await generateShippingLabelPdf({
    subOrderId,
    orderNumber: D.str(sub.order?.orderNumber),
    awbNumber: D.str(shipment?.awb),
    remarks: D.str(shipment?.remarks),
    vendor: sub.vendor,
    address: sub.order?.address,
    items: sub.items,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${pdfFileName('SHIPPING_LABEL', D.str(sub.order?.orderNumber))}"`,
  );

  return res.send(pdf);
});

/**
 * @openapi
 * /orders/returnRequest/:id:
 *   post:
 *     tags: [Orders]
 *     summary: Raise a return against a delivered order
 *     responses:
 *       201: { description: Return requested }
 *       422: { description: Window passed, item not purchased, or reason missing }
 */
export const returnRequest = asyncHandler(async (req, res) => {
  const row = await service.requestReturnForOrder(
    userId(req),
    {
      ...req.body,
      orderId: D.str(req.params.id),
    },
    req,
  );

  return ApiResponse.created(res, SUCCESS.RETURN.REQUESTED, {
    returnId: D.str(row.id),
    returnNumber: D.str(row.returnNumber),
    status: D.str(row.status),
  });
});

export const approveReturn = asyncHandler(async (req, res) => {
  const row = await service.decideReturnForOrder(
    D.str(req.params.returnId),
    'APPROVED',
    req.auth!.userId,
    req.auth!.role === ROLES.VENDOR ? vendorId(req) : undefined,
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.RETURN.APPROVED,
    result: { returnId: D.str(row.id), status: D.str(row.status) },
  });
});

export const rejectReturn = asyncHandler(async (req, res) => {
  const row = await service.decideReturnForOrder(
    D.str(req.params.returnId),
    'REJECTED',
    req.auth!.userId,
    req.auth!.role === ROLES.VENDOR ? vendorId(req) : undefined,
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.RETURN.REJECTED,
    result: { returnId: D.str(row.id), status: D.str(row.status) },
  });
});
