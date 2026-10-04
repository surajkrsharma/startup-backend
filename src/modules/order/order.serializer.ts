import { D } from '../../utils/defaults';
import {
  serializeOrder,
  serializeSubOrder,
  serializeOrderItem,
  serializeOrderTimeline,
  serializeShipment,
  serializeDelivery,
  serializeDeliveryBoy,
  serializePayment,
} from '../../utils/serialize';

export const serializeOrderSummary = (o: any) => {
  const base = serializeOrder(o);

  return {
    orderId: D.str(o?.id),
    orderNumber: D.str(o?.orderNumber),
    status: D.str(o?.status),
    paymentMethod: D.str(o?.paymentMethod),
    paymentStatus: D.str(o?.paymentStatus),
    itemCount: D.arr(o?.items).length,
    totalQty: D.arr(o?.items).reduce((sum: number, i: any) => sum + D.num(i?.qty), 0),
    subtotal: D.float(o?.subtotal),
    discount: D.float(o?.discount),
    couponDiscount: D.float(o?.couponDiscount),
    taxAmount: D.float(o?.taxAmount),
    shippingAmount: D.float(o?.shippingAmount),
    walletAmount: D.float(o?.walletAmount),
    total: D.float(o?.total),
    balanceAmount: D.float(o?.balanceAmount),
    isCancelled: D.bool(o?.isCancelled),
    createdAt: D.date(o?.createdAt),
    deliveredAt: D.date(o?.deliveredAt),

    vendorCount: D.arr(o?.subOrders).length,

    thumbnailList: D.arr(o?.items)
      .slice(0, 4)
      .map((i: any) => D.str(i?.image))
      .filter((url: string) => url !== ''),

    subOrderList: D.arr(o?.subOrders).map((s: any) => ({
      subOrderId: D.str(s?.id),
      vendorId: D.str(s?.vendorId),
      status: D.str(s?.status),
      total: D.float(s?.total),
      vendorData: s?.vendor
        ? {
            vendorId: D.str(s.vendor.id),
            shopName: D.str(s.vendor.shopName),
            slug: D.str(s.vendor.slug),
          }
        : {},
    })),
  };

  void base;
};

export const serializeVendorOrder = (s: any) => {
  const base = serializeSubOrder(s);
  const order = s?.order;

  return {
    ...base,
    orderNumber: D.str(order?.orderNumber),
    orderStatus: D.str(order?.status),
    paymentStatus: D.str(order?.paymentStatus),
    paymentMethod: D.str(order?.paymentMethod),
    placedAt: D.date(order?.createdAt),
    orderTotal: D.float(order?.total),

    customerData: order?.user
      ? {
          userId: D.str(order.user.id),
          name: D.str(order.user.name),

          phone: D.str(order.user.phone),
        }
      : {},

    shippingAddress: order?.address
      ? {
          fullName: D.str(order.address.fullName),
          phone: D.str(order.address.phone),
          line1: D.str(order.address.line1),
          line2: D.str(order.address.line2),
          landmark: D.str(order.address.landmark),
          city: D.str(order.address.city),
          state: D.str(order.address.state),
          pincode: D.str(order.address.pincode),
          country: D.str(order.address.country),
        }
      : {},
  };
};

export const serializePlaceOrderResult = (order: any, skipped: any[] = []) => {
  const base = serializeOrder(order);

  return {
    ...base,
    vendorCount: D.arr(order?.subOrders).length,
    skippedCount: D.arr(skipped).length,

    skippedList: D.arr(skipped).map((s: any) => ({
      productId: D.str(s?.productId),
      name: D.str(s?.name),
      reason: D.str(s?.reason),
    })),
  };
};

export const serializeTrackOrder = (o: any) => ({
  orderNumber: D.str(o?.orderNumber),
  status: D.str(o?.status),
  paymentStatus: D.str(o?.paymentStatus),
  paymentMethod: D.str(o?.paymentMethod),
  total: D.float(o?.total),
  isDelivered: D.str(o?.status) === 'DELIVERED',
  placedAt: D.date(o?.createdAt),
  deliveredAt: D.date(o?.deliveredAt),

  addressData: o?.address
    ? {
        city: D.str(o.address.city),
        state: D.str(o.address.state),
        pincode: D.str(o.address.pincode),
      }
    : {},

  shipmentList: D.arr(o?.subOrders).map((s: any) => {
    const shipment: any = D.arr<any>(s?.shipments)[0];
    return {
      subOrderId: D.str(s?.id),
      status: D.str(s?.status),
      shopName: D.str(s?.vendor?.shopName),
      trackingNumber: D.str(s?.trackingNumber),
      awb: D.str(shipment?.awb),
      trackingUrl: D.str(shipment?.trackingUrl),
      shipmentStatus: D.str(shipment?.status),
      estimatedDays: D.num(shipment?.estimatedDays),
    };
  }),

  timelineList: D.arr(o?.timelines).map((t: any) => ({
    status: D.str(t?.status),
    remark: D.str(t?.remark),
    location: D.str(t?.location),
    at: D.date(t?.createdAt),
  })),
});

export {
  serializeOrder,
  serializeSubOrder,
  serializeOrderItem,
  serializeOrderTimeline,
  serializeShipment,
  serializeDelivery,
  serializeDeliveryBoy,
  serializePayment,
};
