import { D } from '../../utils/defaults';

/**
 * User serializers.
 * Key order: singles -> objects -> arrays. No nulls anywhere.
 */
export const serializeUser = (u: any) => ({
  userId: D.str(u?.id),
  name: D.str(u?.name),
  email: D.str(u?.email),
  phone: D.str(u?.phone),
  avatarUrl: D.str(u?.avatarUrl),
  role: D.str(u?.role),
  isActive: D.bool(u?.isActive),
  isEmailVerified: D.bool(u?.isEmailVerified),
  isPhoneVerified: D.bool(u?.isPhoneVerified),
  isTwoFactorEnabled: D.bool(u?.twoFactorEnabled),
  loyaltyTier: D.str(u?.loyaltyTier),
  lastLoginAt: D.date(u?.lastLoginAt),
  createdAt: D.date(u?.createdAt),
  updatedAt: D.date(u?.updatedAt),

  vendorData: u?.vendorProfile
    ? {
        vendorId: D.str(u.vendorProfile.id),
        shopName: D.str(u.vendorProfile.shopName),
        slug: D.str(u.vendorProfile.slug),
        status: D.str(u.vendorProfile.status),
      }
    : {},

  addressList: D.arr(u?.addresses).map((a: any) => ({
    addressId: D.str(a?.id),
    type: D.str(a?.type),
    fullName: D.str(a?.fullName),
    phone: D.str(a?.phone),
    line1: D.str(a?.line1),
    line2: D.str(a?.line2),
    landmark: D.str(a?.landmark),
    city: D.str(a?.city),
    state: D.str(a?.state),
    stateCode: D.str(a?.stateCode),
    country: D.str(a?.country),
    countryCode: D.str(a?.countryCode),
    pincode: D.str(a?.pincode),
    isDefault: D.bool(a?.isDefault),
  })),

  statsData: u?._count
    ? {
        orderCount: D.num(u._count.orders),
        reviewCount: D.num(u._count.reviews),
      }
    : {},

  rolesList: u?.role ? [D.str(u.role)] : [],
});

export const serializeUserList = (rows: any[]) => ({
  userList: D.arr(rows).map(serializeUser),
});

export const serializeAddress = (a: any) => ({
  addressId: D.str(a?.id),
  type: D.str(a?.type),
  fullName: D.str(a?.fullName),
  phone: D.str(a?.phone),
  line1: D.str(a?.line1),
  line2: D.str(a?.line2),
  landmark: D.str(a?.landmark),
  city: D.str(a?.city),
  state: D.str(a?.state),
  stateCode: D.str(a?.stateCode),
  country: D.str(a?.country),
  countryCode: D.str(a?.countryCode),
  pincode: D.str(a?.pincode),
  isDefault: D.bool(a?.isDefault),
  createdAt: D.date(a?.createdAt),
  updatedAt: D.date(a?.updatedAt),
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

export const serializeActivityLog = (a: any) => ({
  activityLogId: D.str(a?.id),
  userId: D.str(a?.userId),
  action: D.str(a?.action),
  entity: D.str(a?.entity),
  entityId: D.str(a?.entityId),
  meta: D.obj(a?.meta),
  ip: D.str(a?.ip),
  deviceId: D.str(a?.deviceId),
  createdAt: D.date(a?.createdAt),

  userData: a?.user
    ? {
        userId: D.str(a.user.id),
        name: D.str(a.user.name),
        email: D.str(a.user.email),
      }
    : {},
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
