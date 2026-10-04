import { D } from '../../utils/defaults';
import { serializeActivityLog, serializeAddress, serializeUser } from '../../utils/serialize';

export { serializeActivityLog, serializeAddress, serializeUser };

export const serializeUserList = (rows: any[]) => ({
  userList: D.arr(rows).map(serializeUser),
});

export const serializeAddressList = (rows: any[]) => ({
  addressList: D.arr(rows).map(serializeAddress),
});

export const serializeProfile = (user: any, extra: Record<string, any> = {}) => ({
  userData: serializeUser(user),
  vendorData: user?.vendorProfile
    ? {
        vendorId: D.str(user.vendorProfile.id),
        shopName: D.str(user.vendorProfile.shopName),
        slug: D.str(user.vendorProfile.slug),
        status: D.str(user.vendorProfile.status),
        commissionRate: D.float(user.vendorProfile.commissionRate),
      }
    : {},
  addressList: D.arr(user?.addresses).map(serializeAddress),
  socialProviderList: D.arr(user?.socialAccounts).map((s: any) => D.str(s?.provider)),
  rolesList: user?.role ? [D.str(user.role)] : [],
  ...extra,
});

export const serializeOrderSummary = (o: any) => ({
  orderId: D.str(o?.id),
  orderNumber: D.str(o?.orderNumber),
  status: D.str(o?.status),
  paymentMethod: D.str(o?.paymentMethod),
  paymentStatus: D.str(o?.paymentStatus),
  total: D.float(o?.total),
  itemCount: D.num(o?._count?.items),
  isCancelled: D.bool(o?.isCancelled),
  deliveredAt: D.date(o?.deliveredAt),
  createdAt: D.date(o?.createdAt),

  vendorList: D.arr(o?.subOrders).map((s: any) => ({
    subOrderId: D.str(s?.id),
    vendorId: D.str(s?.vendorId),
    status: D.str(s?.status),
    shopName: D.str(s?.vendor?.shopName),
  })),
});

export const serializeOrderSummaryList = (rows: any[]) => ({
  orderList: D.arr(rows).map(serializeOrderSummary),
});

export const serializeImpersonation = (input: {
  accessToken: string;
  expiresIn: number;
  target: any;
}) => ({
  accessToken: D.str(input.accessToken),
  expiresIn: D.num(input.expiresIn),
  expiresAt: new Date(Date.now() + input.expiresIn * 1000).toISOString(),
  isImpersonating: true,

  userData: serializeUser(input.target),
});
