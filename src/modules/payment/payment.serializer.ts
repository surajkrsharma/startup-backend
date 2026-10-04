import { D } from '../../utils/defaults';
import {
  serializePayment,
  serializeRefund,
  serializePayout,
  serializeVendorEarning,
  serializeReturnRequest,
  serializeReturnReason,
  serializeWalletTransaction,
} from '../../utils/serialize';

export {
  serializePayment,
  serializeRefund,
  serializePayout,
  serializeVendorEarning,
  serializeReturnRequest,
  serializeReturnReason,
  serializeWalletTransaction,
};

export const serializePaymentSummary = (p: any) => {
  const base = serializePayment(p);

  return {
    paymentId: D.str(p?.id),
    orderId: D.str(p?.orderId),
    amount: D.float(p?.amount),
    paidAmount: D.float(p?.paidAmount),
    method: D.str(p?.method),
    status: D.str(p?.status),
    reference: D.str(p?.reference),
    isTokenPayment: D.bool(p?.isTokenPayment),
    isBalancePayment: D.bool(p?.isBalancePayment),
    isPaid: ['PAID', 'COD_COLLECTED'].includes(D.str(p?.status)),
    paidAt: D.date(p?.paidAt),
    createdAt: D.date(p?.createdAt),

    orderData: p?.order
      ? {
          orderId: D.str(p.order.id),
          orderNumber: D.str(p.order.orderNumber),
          status: D.str(p.order.status),
          total: D.float(p.order.total),
        }
      : {},
  };

  void base;
};

export const serializePayoutDetail = (p: any) => {
  const base = serializePayout(p);

  return {
    ...base,
    requestedBy: D.str(p?.requestedBy),
    approvedBy: D.str(p?.approvedBy),
    isPending: D.str(p?.status) === 'PENDING',
    isApproved: D.str(p?.status) === 'APPROVED',
    isPaid: D.str(p?.status) === 'PAID',

    bankData:
      D.str(p?.method) === 'UPI'
        ? { upiId: D.str(p?.vendor?.upiId) }
        : {
            bankHolderName: D.str(p?.vendor?.bankHolderName),
            bankIfsc: D.str(p?.vendor?.bankIfsc),
            accountNo: D.str(p?.accountRef),
          },
  };
};

export const serializeWalletEntry = (t: any) => ({
  transactionId: D.str(t?.id),
  type: D.str(t?.type),
  amount: D.float(t?.amount),
  balanceAfter: D.float(t?.balanceAfter),
  orderId: D.str(t?.orderId),
  description: D.str(t?.description),
  reference: D.str(t?.reference),
  isCredit: ['CREDIT', 'REFUND', 'REWARD', 'ADJUSTMENT'].includes(D.str(t?.type)),
  createdAt: D.date(t?.createdAt),
});

export const serializeReturnDetail = (r: any, settlementDays = 0) => {
  const base = serializeReturnRequest(r);

  const inFlight = !['REFUNDED', 'REJECTED'].includes(D.str(r?.status));

  return {
    ...base,
    returnNumber: D.str(r?.returnNumber),
    settlementDays: D.num(settlementDays),
    expectedSettlementAt: inFlight
      ? new Date(Date.now() + D.num(settlementDays) * 86_400_000).toISOString()
      : '',

    vendorData: r?.vendor
      ? {
          vendorId: D.str(r.vendor.id),
          shopName: D.str(r.vendor.shopName),
          slug: D.str(r.vendor.slug),
        }
      : {},

    itemList: D.arr(r?.items).map((i: any) => ({
      returnItemId: D.str(i?.id),
      orderItemId: D.str(i?.orderItemId),
      qty: D.num(i?.qty),
      refundAmount: D.float(i?.refundAmount),
      isApproved: D.bool(i?.isApproved),

      productData: i?.orderItem
        ? {
            productId: D.str(i.orderItem.productId),
            name: D.str(i.orderItem.name),
            sku: D.str(i.orderItem.sku),
            image: D.str(i.orderItem.image),
            price: D.float(i.orderItem.price),
          }
        : {},
    })),
  };
};
