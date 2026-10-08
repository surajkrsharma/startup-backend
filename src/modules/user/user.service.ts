import { Prisma } from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D, money } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { VALIDATION } from '../../messages/validation';
import { ERROR_CODE } from '../../constants/http';
import { Role, ADMIN_ACTION, ADDRESS_TYPE, ROLES } from '../../constants/roles';
import { RETURN_STATUS, TICKET_STATUS } from '../../constants/statuses';
import { randomString, sha256, signAccessToken } from '../../utils/crypto';
import { getPagination } from '../../utils/pagination';
import { addDays } from '../../utils/dates';
import { getSecurityConfig as getSecuritySettings } from '../../services/settings.service';
import { sendMailNotification } from '../../services/notification.service';
import { diffChanges, writeActivityLog, writeAuditLog } from '../../services/audit.service';
import { COUNTRY_CODE, EMAIL_REGEX } from '../../constants/countries';
import { normalisePhone } from '../../utils/validate';
import { uniqueCustomerSegmentSlug } from '../../utils/slug';
import {
  AUTO_SEGMENT_KINDS,
  SEGMENT_KIND,
  SEGMENT_SOURCE,
  isAutoSegmentKind,
} from '../../constants/segments';
import { banDaysRemaining, evaluateSegmentKinds, isBanActive } from '../../utils/segments';
import { getBanConfig, getSegmentConfig } from '../../services/settings.service';
import { DELIVERED_ORDER_STATUSES, type OrderStatus } from '../../constants/statuses';
import {
  ListUsersFilters,
  UserActivityFilters,
  AddressWrite,
  TimelineEvent,
  TimelineType,
  TIMELINE_TYPE,
  CustomerExport,
} from './user.types';

/** The notification tail of an export is capped; the rest is a full history. */
const EXPORT_NOTIFICATION_LIMIT = 200;

const PROFILE_INCLUDE: Prisma.UserInclude = {
  vendorProfile: {
    select: { id: true, shopName: true, slug: true, status: true, commissionRate: true },
  },
  addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] },
  socialAccounts: { select: { id: true, provider: true } },
};

const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatarUrl: true,
  role: true,
  isActive: true,
  isEmailVerified: true,
  isPhoneVerified: true,
  twoFactorEnabled: true,
  loyaltyTier: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

export const getProfile = async (userId: string): Promise<any> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...PROFILE_SELECT, ...PROFILE_INCLUDE },
  });

  if (!user) throw AppError.notFound(ERROR.USER.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return user;
};

export const updateProfile = async (
  userId: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: PROFILE_SELECT,
  });

  if (!before) throw AppError.notFound(ERROR.USER.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const data: Prisma.UserUpdateInput = {};

  if (input.name !== undefined) data.name = D.str(input.name);
  if (input.avatarUrl !== undefined) data.avatarUrl = D.str(input.avatarUrl);
  if (input.loyaltyTier !== undefined) data.loyaltyTier = D.str(input.loyaltyTier);

  if (input.email !== undefined && input.email !== '') {
    const email = D.str(input.email).toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      throw AppError.badRequest(VALIDATION.INVALID_EMAIL, ERROR_CODE.VALIDATION_ERROR);
    }
    const clash = await prisma.user.findFirst({
      where: { email, NOT: { id: userId } },
      select: { id: true },
    });
    if (clash) throw AppError.conflict(ERROR.AUTH.EMAIL_EXISTS, ERROR_CODE.EMAIL_EXISTS);
    data.email = email;

    data.isEmailVerified = false;
  }

  if (input.phone !== undefined) {
    const phone = normalisePhone(D.str(input.phone));
    if (phone) {
      const clash = await prisma.user.findFirst({
        where: { phone, NOT: { id: userId } },
        select: { id: true },
      });
      if (clash) throw AppError.conflict(ERROR.AUTH.PHONE_EXISTS, ERROR_CODE.PHONE_EXISTS);
      data.phone = phone;
      data.isPhoneVerified = false;
    } else {
      data.phone = '';
    }
  }

  if (!Object.keys(data).length) {
    throw AppError.badRequest(ERROR.COMMON.VALIDATION_FAILED, ERROR_CODE.VALIDATION_ERROR);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: { ...PROFILE_SELECT, ...PROFILE_INCLUDE },
  });

  void writeActivityLog({
    req,
    userId,
    action: 'PROFILE_UPDATED',
    entity: 'User',
    entityId: userId,
    meta: { fields: Object.keys(data) },
  });

  void writeAuditLog({
    req,
    actorId: userId,
    actorRole: updated.role,
    action: ADMIN_ACTION.UPDATE,
    entity: 'User',
    entityId: userId,
    description: 'User updated own profile',
    changes: diffChanges(before, updated),
  });

  return updated;
};

export const updateAvatar = async (userId: string, avatarUrl: string, req?: any): Promise<any> => {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: D.str(avatarUrl) },
    select: PROFILE_SELECT,
  });

  void writeActivityLog({
    req,
    userId,
    action: 'AVATAR_UPDATED',
    entity: 'User',
    entityId: userId,
  });

  return updated;
};

export const deleteAccount = async (
  userId: string,
  input: { password?: string; reason?: string },
  req?: any,
): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, vendorProfile: { select: { id: true } } },
  });

  if (!user) throw AppError.notFound(ERROR.USER.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  if (user.vendorProfile) {
    throw AppError.conflict(ERROR.VENDOR.PROFILE_EXISTS, ERROR_CODE.FORBIDDEN);
  }

  const now = new Date();

  const security = await getSecuritySettings();
  const restoreToken = randomString(32);
  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, phone: true },
  });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: now,
        purgeAfter: addDays(security.accountPurgeDays, now),
        deletionReason: D.str(input?.reason),
        deletionTokenHash: sha256(restoreToken),
        deletionEmailHash: sha256(D.str(previous?.email).toLowerCase()),
        deletionPhone: D.str(previous?.phone),
        isActive: false,
        email: `${D.str(user.id)}-deleted-${now.getTime()}@deleted.local`,
        phone: '',
        passwordHash: null,
        avatarUrl: '',
        twoFactorSecret: null,
        twoFactorBackupCodes: [],
      },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.session.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false, endedAt: now },
    }),
  ]);

  void writeAuditLog({
    req,
    actorId: userId,
    action: ADMIN_ACTION.DELETE,
    entity: 'User',
    entityId: userId,
    description: `Self account deleted: ${D.str(input?.reason)}`,
    meta: { softDelete: true, purgeAfterDays: security.accountPurgeDays },
  });

  await sendMailNotification({
    to: D.str(previous?.email),
    subject: 'Your account has been scheduled for deletion',
    text: `You can restore your account for ${security.accountPurgeDays} days using this token: ${restoreToken}`,
  });

  return true;
};

const toAddressData = (
  input: AddressWrite,
): Omit<Prisma.AddressUncheckedCreateInput, 'userId'> => ({
  type: (D.str(input.type) || ADDRESS_TYPE.HOME) as any,
  fullName: D.str(input.fullName),
  phone: normalisePhone(D.str(input.phone)) || D.str(input.phone),
  line1: D.str(input.line1),
  line2: D.str(input.line2),
  landmark: D.str(input.landmark),
  deliveryInstructions: D.str(input.deliveryInstructions),
  city: D.str(input.city),
  state: D.str(input.state),
  stateCode: D.str(input.stateCode).toUpperCase(),
  country: D.str(input.country) || COUNTRY_CODE.IN,
  countryCode: D.str(input.countryCode).toUpperCase() || COUNTRY_CODE.IN,
  pincode: D.str(input.pincode),
  isDefault: Boolean(input.isDefault),
});

export const listAddresses = async (userId: string): Promise<any[]> =>
  prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });

export const getAddress = async (userId: string, addressId: string): Promise<any> => {
  const address = await prisma.address.findFirst({ where: { id: addressId, userId } });
  if (!address) throw AppError.notFound(ERROR.ADDRESS.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return address;
};

export const addAddress = async (userId: string, input: AddressWrite, req?: any): Promise<any> => {
  const existingCount = await prisma.address.count({ where: { userId } });
  const isFirst = existingCount === 0;

  const address = await prisma.$transaction(async (tx) => {
    if (input.isDefault || isFirst) {
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }

    return tx.address.create({
      data: { ...toAddressData(input), userId, isDefault: input.isDefault || isFirst },
    });
  });

  void writeActivityLog({
    req,
    userId,
    action: 'ADDRESS_ADDED',
    entity: 'Address',
    entityId: address.id,
  });

  return address;
};

export const updateAddress = async (
  userId: string,
  addressId: string,
  input: Partial<AddressWrite>,
  req?: any,
): Promise<any> => {
  const existing = await prisma.address.findFirst({ where: { id: addressId, userId } });
  if (!existing) throw AppError.notFound(ERROR.ADDRESS.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const data = toAddressData({ ...existing, ...input } as AddressWrite);
  delete (data as any).userId;

  const address = await prisma.$transaction(async (tx) => {
    if (input.isDefault === true) {
      await tx.address.updateMany({
        where: { userId, NOT: { id: addressId } },
        data: { isDefault: false },
      });
    }

    return tx.address.update({ where: { id: addressId }, data });
  });

  void writeActivityLog({
    req,
    userId,
    action: 'ADDRESS_UPDATED',
    entity: 'Address',
    entityId: addressId,
    meta: { fields: Object.keys(input) },
  });

  return address;
};

export const deleteAddress = async (
  userId: string,
  addressId: string,
  req?: any,
): Promise<boolean> => {
  const existing = await prisma.address.findFirst({
    where: { id: addressId, userId },
    select: { id: true, isDefault: true },
  });

  if (!existing) throw AppError.notFound(ERROR.ADDRESS.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const usedByOrders = await prisma.order.count({ where: { addressId } });
  if (usedByOrders > 0) {
    throw AppError.conflict(
      'This address is used by an existing order and cannot be deleted.',
      ERROR_CODE.FORBIDDEN,
    );
  }

  await prisma.address.delete({ where: { id: addressId } });

  if (existing.isDefault) {
    const next = await prisma.address.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (next) {
      await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }

  void writeActivityLog({
    req,
    userId,
    action: 'ADDRESS_DELETED',
    entity: 'Address',
    entityId: addressId,
  });

  return true;
};

export const setDefaultAddress = async (userId: string, addressId: string): Promise<any> => {
  const existing = await prisma.address.findFirst({ where: { id: addressId, userId } });
  if (!existing) throw AppError.notFound(ERROR.ADDRESS.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  return prisma.$transaction(async (tx) => {
    await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    return tx.address.update({ where: { id: addressId }, data: { isDefault: true } });
  });
};

export const listUsers = async (
  query: any,
): Promise<{ rows: any[]; total: number; filters: ListUsersFilters }> => {
  const { page, limit, skip } = getPagination(query);

  const filters: ListUsersFilters = {
    page,
    limit,
    skip,
    search: D.str(query?.search),
    role: D.str(query?.role) as Role | '',
    status: D.str(query?.status) as ListUsersFilters['status'],
    vendorStatus: D.str(query?.vendorStatus),
    isVerified: D.str(query?.isVerified) === '' ? '' : Boolean(query?.isVerified),
    createdFrom: query?.createdFrom ? new Date(query.createdFrom) : null,
    createdTo: query?.createdTo ? new Date(query.createdTo) : null,
  };

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search, mode: 'insensitive' } },
            { phone: { contains: filters.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(filters.role ? { role: filters.role as Role } : {}),
    ...(filters.status === 'active' ? { isActive: true } : {}),
    ...(filters.status === 'inactive' ? { isActive: false } : {}),
    ...(filters.vendorStatus
      ? { vendorProfile: { is: { status: filters.vendorStatus as any } } }
      : {}),
    ...(filters.isVerified === true
      ? { OR: undefined, AND: [{ OR: [{ isEmailVerified: true }, { isPhoneVerified: true }] }] }
      : {}),
    ...(filters.createdFrom ? { createdAt: { gte: filters.createdFrom } } : {}),
    ...(filters.createdTo ? { createdAt: { lte: filters.createdTo } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ createdAt: 'desc' }],
      select: {
        ...PROFILE_SELECT,
        vendorProfile: { select: { id: true, shopName: true, slug: true, status: true } },
        _count: { select: { orders: true, reviews: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { rows, total, filters };
};

export const getUserById = async (userId: string): Promise<any> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...PROFILE_SELECT,
      ...PROFILE_INCLUDE,
      _count: { select: { orders: true, reviews: true, addresses: true } },
    },
  });

  if (!user) throw AppError.notFound(ERROR.USER.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return user;
};

export const updateUser = async (
  targetUserId: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const before = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: PROFILE_SELECT,
  });

  if (!before) throw AppError.notFound(ERROR.USER.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const data: Prisma.UserUpdateInput = {};

  if (input.name !== undefined) data.name = D.str(input.name);
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  if (input.isEmailVerified !== undefined) data.isEmailVerified = Boolean(input.isEmailVerified);
  if (input.isPhoneVerified !== undefined) data.isPhoneVerified = Boolean(input.isPhoneVerified);
  if (input.avatarUrl !== undefined) data.avatarUrl = D.str(input.avatarUrl);
  if (input.role !== undefined) data.role = input.role as Role;

  if (input.email !== undefined && input.email !== '') {
    const email = D.str(input.email).toLowerCase();
    const clash = await prisma.user.findFirst({
      where: { email, NOT: { id: targetUserId } },
      select: { id: true },
    });
    if (clash) throw AppError.conflict(ERROR.AUTH.EMAIL_EXISTS, ERROR_CODE.EMAIL_EXISTS);
    data.email = email;
  }

  if (input.phone !== undefined && D.str(input.phone) !== '') {
    const phone = normalisePhone(D.str(input.phone));
    const clash = await prisma.user.findFirst({
      where: { phone, NOT: { id: targetUserId } },
      select: { id: true },
    });
    if (clash) throw AppError.conflict(ERROR.AUTH.PHONE_EXISTS, ERROR_CODE.PHONE_EXISTS);
    data.phone = phone;
  }

  if (!Object.keys(data).length) {
    throw AppError.badRequest(ERROR.COMMON.VALIDATION_FAILED, ERROR_CODE.VALIDATION_ERROR);
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data,
    select: { ...PROFILE_SELECT, ...PROFILE_INCLUDE },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.UPDATE,
    entity: 'User',
    entityId: targetUserId,
    description: `Admin updated user ${updated.email}`,
    changes: diffChanges(before, updated),
  });

  return updated;
};

export const toggleUserStatus = async (
  targetUserId: string,
  input: { isActive: boolean; reason?: string },
  req?: any,
): Promise<any> => {
  const before = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, isActive: true, email: true },
  });

  if (!before) throw AppError.notFound(ERROR.USER.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  if (!input.isActive && req?.auth?.userId === targetUserId) {
    throw AppError.forbidden(ERROR.USER.NOT_ALLOWED, ERROR_CODE.FORBIDDEN);
  }

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: targetUserId },
      data: { isActive: input.isActive },
      select: PROFILE_SELECT,
    });

    if (!input.isActive) {
      await tx.refreshToken.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.session.updateMany({
        where: { userId: targetUserId, isActive: true },
        data: { isActive: false, endedAt: now },
      });
    }

    return user;
  });

  void writeAuditLog({
    req,
    action: input.isActive ? ADMIN_ACTION.ACTIVATE : ADMIN_ACTION.SUSPEND,
    entity: 'User',
    entityId: targetUserId,
    description: `${input.isActive ? 'Activated' : 'Suspended'} user ${before.email}: ${D.str(input.reason)}`,
    changes: { isActive: { from: before.isActive, to: input.isActive } },
  });

  return updated;
};

export const hardDeleteUser = async (targetUserId: string, req?: any): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      vendorProfile: { select: { id: true } },
      _count: { select: { orders: true } },
    },
  });

  if (!user) throw AppError.notFound(ERROR.USER.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  if (req?.auth?.userId === targetUserId) {
    throw AppError.forbidden(ERROR.USER.NOT_ALLOWED, ERROR_CODE.FORBIDDEN);
  }

  if (user._count.orders > 0) {
    throw AppError.conflict(
      'User has order history â€” deactivate instead of deleting.',
      ERROR_CODE.FORBIDDEN,
    );
  }

  if (user.vendorProfile) {
    throw AppError.conflict(ERROR.VENDOR.PROFILE_EXISTS, ERROR_CODE.FORBIDDEN);
  }

  await prisma.user.delete({ where: { id: targetUserId } });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.DELETE,
    entity: 'User',
    entityId: targetUserId,
    description: `Hard deleted user ${user.email}`,
  });

  return true;
};

export const getUserActivity = async (
  targetUserId: string,
  query: any,
): Promise<{ rows: any[]; total: number; filters: UserActivityFilters }> => {
  const { page, limit, skip } = getPagination(query);

  const filters: UserActivityFilters = {
    page,
    limit,
    skip,
    action: D.str(query?.action),
    from: query?.from ? new Date(query.from) : null,
    to: query?.to ? new Date(query.to) : null,
  };

  const where: Prisma.ActivityLogWhereInput = {
    userId: targetUserId,
    ...(filters.action ? { action: { contains: filters.action, mode: 'insensitive' } } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        action: true,
        entity: true,
        entityId: true,
        meta: true,
        ip: true,
        deviceId: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.activityLog.count({ where }),
  ]);

  return { rows, total, filters };
};

export const getUserOrders = async (
  targetUserId: string,
  query: any,
): Promise<{ rows: any[]; total: number }> => {
  const { limit, skip } = getPagination(query);
  const status = D.str(query?.status);

  const where: Prisma.OrderWhereInput = {
    userId: targetUserId,
    deletedAt: null,
    ...(status ? { status: status as any } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        total: true,
        isCancelled: true,
        deliveredAt: true,
        createdAt: true,
        _count: { select: { items: true } },
        subOrders: {
          select: {
            id: true,
            vendorId: true,
            status: true,
            vendor: { select: { shopName: true } },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return { rows, total };
};

export const impersonateUser = async (
  targetUserId: string,
  input: { reason: string; durationMin?: number },
  req?: any,
): Promise<{ accessToken: string; expiresIn: number; target: any }> => {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      ...PROFILE_SELECT,
      vendorProfile: { select: { id: true, status: true } },
    },
  });

  if (!target) throw AppError.notFound(ERROR.USER.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  if (!target.isActive) {
    throw AppError.forbidden(ERROR.AUTH.ACCOUNT_SUSPENDED, ERROR_CODE.ACCOUNT_SUSPENDED);
  }
  if (targetUserId === req?.auth?.userId) {
    throw AppError.forbidden(ERROR.USER.SELF_IMPERSONATION, ERROR_CODE.FORBIDDEN);
  }

  const expiresIn = Number(input?.durationMin ?? 30) * 60;

  const accessToken = signAccessToken({
    sub: target.id,
    role: target.role,
    vendorId: target.vendorProfile?.id ?? '',
    email: target.email,
    sessionKey: `imp_${req?.auth?.userId ?? ''}`,
    deviceId: D.str(req?.deviceId),
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.IMPERSONATE,
    entity: 'User',
    entityId: target.id,
    description: `Impersonated ${target.email} for ${expiresIn / 60} min â€” ${D.str(input.reason)}`,
    meta: { reason: D.str(input.reason), expiresIn, targetRole: target.role },
    impersonatedById: req?.auth?.userId,
  });

  return { accessToken, expiresIn, target };
};

// â”€â”€ Internal customer notes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const addCustomerNote = async (
  targetUserId: string,
  actorId: string,
  input: { note: string },
  req?: any,
): Promise<any> => {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  });

  if (!user) throw AppError.notFound(ERROR.USER.NOT_FOUND);

  const note = await prisma.customerNote.create({
    data: {
      userId: targetUserId,
      createdById: D.str(actorId) || null,
      note: D.str(input.note),
    },
    select: { id: true, userId: true, createdById: true, note: true, createdAt: true },
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'CUSTOMER_NOTE_ADDED',
    entity: 'User',
    entityId: targetUserId,
    meta: { noteId: note.id },
  });

  return note;
};

export const listCustomerNotes = async (targetUserId: string): Promise<any[]> => {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  });

  if (!user) throw AppError.notFound(ERROR.USER.NOT_FOUND);

  return prisma.customerNote.findMany({
    where: { userId: targetUserId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, userId: true, createdById: true, note: true, createdAt: true },
  });
};

export const deleteCustomerNote = async (
  targetUserId: string,
  noteId: string,
  actorId: string,
  req?: any,
): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  });

  if (!user) throw AppError.notFound(ERROR.USER.NOT_FOUND);

  const note = await prisma.customerNote.findFirst({
    where: { id: noteId, userId: targetUserId },
  });
  if (!note) throw AppError.notFound(ERROR.COMMON.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  await prisma.customerNote.delete({ where: { id: noteId } });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'CUSTOMER_NOTE_DELETED',
    entity: 'User',
    entityId: targetUserId,
    meta: { noteId },
  });

  return true;
};

// â”€â”€ Customer ban â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BAN_SELECT = {
  id: true,
  userId: true,
  reason: true,
  expiresAt: true,
  revokedAt: true,
  revokeReason: true,
  createdById: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

const withBanState = (ban: any): Record<string, any> => ({
  ...ban,
  isActive: isBanActive(ban),
  daysRemaining: banDaysRemaining(ban),
});

export const banCustomer = async (
  targetUserId: string,
  actorId: string,
  input: { reason: string; durationDays?: number },
  req?: any,
): Promise<any> => {
  if (targetUserId === actorId) {
    throw AppError.forbidden(ERROR.USER.SELF_BAN, ERROR_CODE.FORBIDDEN);
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true },
  });

  if (!target) throw AppError.notFound(ERROR.USER.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const config = await getBanConfig();
  const days = D.num(input.durationDays);
  const expiresAt = days > 0 ? addDays(Math.min(days, config.maxDays), new Date()) : null;
  const now = new Date();

  const ban = await prisma.$transaction(async (tx) => {
    const row = await tx.customerBan.upsert({
      where: { userId: targetUserId },
      create: {
        userId: targetUserId,
        reason: D.str(input.reason),
        expiresAt,
        createdById: D.str(actorId) || null,
      },
      update: {
        reason: D.str(input.reason),
        expiresAt,
        revokedAt: null,
        revokeReason: '',
        createdById: D.str(actorId) || null,
      },
      select: BAN_SELECT,
    });

    await tx.user.update({ where: { id: targetUserId }, data: { isActive: false } });
    await tx.refreshToken.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.session.updateMany({
      where: { userId: targetUserId, isActive: true },
      data: { isActive: false, endedAt: now },
    });

    return row;
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.SUSPEND,
    entity: 'CustomerBan',
    entityId: ban.id,
    description: `Blocked customer ${target.email}: ${D.str(input.reason)}`,
    meta: { userId: targetUserId, durationDays: days, isPermanent: !days },
  });

  return withBanState(ban);
};

export const unbanCustomer = async (
  targetUserId: string,
  actorId: string,
  input: { reason?: string },
  req?: any,
): Promise<any> => {
  const existing = await prisma.customerBan.findUnique({
    where: { userId: targetUserId },
    select: BAN_SELECT,
  });

  if (!existing) throw AppError.notFound(ERROR.USER.NOT_BANNED, ERROR_CODE.NOT_FOUND);

  const ban = await prisma.$transaction(async (tx) => {
    const row = await tx.customerBan.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), revokeReason: D.str(input.reason) },
      select: BAN_SELECT,
    });

    await tx.user.update({ where: { id: targetUserId }, data: { isActive: true } });

    return row;
  });

  void writeAuditLog({
    req,
    actorId,
    action: ADMIN_ACTION.ACTIVATE,
    entity: 'CustomerBan',
    entityId: ban.id,
    description: `Lifted the block on customer ${targetUserId}: ${D.str(input.reason)}`,
  });

  return withBanState(ban);
};

export const listCustomerBans = async (
  query: any,
): Promise<{ rows: any[]; total: number; filters: { search: string; isActive: string } }> => {
  const { limit, skip } = getPagination(query);
  const search = D.str(query?.search);
  const isActiveFilter = D.str(query?.isActive);

  const where: Prisma.CustomerBanWhereInput = {
    ...(search
      ? {
          OR: [
            { reason: { contains: search, mode: 'insensitive' } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { user: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [all, total] = await Promise.all([
    prisma.customerBan.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { ...BAN_SELECT, user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.customerBan.count({ where }),
  ]);

  /**
   * `isActive` is derived from `expiresAt` against the clock rather than a stored
   * column, so it cannot be filtered in SQL â€” the page is narrowed first and the
   * filter applied to it, which means `totalRecord` counts bans of both states.
   */
  const decorated = all.map(withBanState);
  const rows =
    isActiveFilter === 'true'
      ? decorated.filter((b) => b.isActive)
      : isActiveFilter === 'false'
        ? decorated.filter((b) => !b.isActive)
        : decorated;

  return { rows, total, filters: { search, isActive: isActiveFilter } };
};

/**
 * Banning flips `isActive` off, so an expired ban has to put it back or the
 * customer is locked out forever with no row saying why. Runs on a schedule
 * rather than on read because the account state is what has to change.
 */
export const liftExpiredBans = async (): Promise<number> => {
  const now = new Date();

  const expired = await prisma.customerBan.findMany({
    where: { revokedAt: null, expiresAt: { lte: now } },
    select: { id: true, userId: true, expiresAt: true },
  });

  if (!expired.length) return 0;

  await prisma.$transaction(async (tx) => {
    await tx.customerBan.updateMany({
      where: { id: { in: expired.map((b) => b.id) } },
      data: { revokedAt: now, revokeReason: 'Ban period ended' },
    });

    for (const ban of expired) {
      await tx.user.update({ where: { id: ban.userId }, data: { isActive: true } });
    }
  });

  void writeAuditLog({
    action: ADMIN_ACTION.ACTIVATE,
    entity: 'CustomerBan',
    description: `Auto-lifted ${expired.length} expired customer ban(s)`,
    meta: { userIds: expired.map((b) => b.userId) },
  });

  return expired.length;
};

// â”€â”€ Customer segments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SEGMENT_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  color: true,
  kind: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const AUTO_SEGMENT_NAMES: Record<string, string> = {
  NEW: 'New customers',
  REPEAT: 'Repeat customers',
  VIP: 'VIP customers',
  WHOLESALE: 'Wholesale buyers',
  BLOCKED: 'Blocked customers',
};

export const listSegments = async (
  query: any,
): Promise<{
  rows: any[];
  total: number;
  filters: { kind: string; isActive: string; search: string };
}> => {
  const { limit, skip } = getPagination(query);
  const kind = D.str(query?.kind);
  const isActive = D.str(query?.isActive);
  const search = D.str(query?.search);

  const where: Prisma.CustomerSegmentWhereInput = {
    ...(kind ? { kind: kind as any } : {}),
    ...(isActive === 'true' ? { isActive: true } : {}),
    ...(isActive === 'false' ? { isActive: false } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.customerSegment.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { ...SEGMENT_SELECT, _count: { select: { members: true } } },
    }),
    prisma.customerSegment.count({ where }),
  ]);

  return { rows, total, filters: { kind, isActive, search } };
};

export const getSegmentById = async (segmentId: string): Promise<any> => {
  const segment = await prisma.customerSegment.findUnique({
    where: { id: segmentId },
    select: { ...SEGMENT_SELECT, _count: { select: { members: true } } },
  });

  if (!segment) {
    throw AppError.notFound(
      ERROR.CUSTOMER_SEGMENT.NOT_FOUND,
      ERROR_CODE.CUSTOMER_SEGMENT_NOT_FOUND,
    );
  }

  return segment;
};

const requireManualSegment = async (segmentId: string): Promise<any> => {
  const segment = await getSegmentById(segmentId);
  if (isAutoSegmentKind(D.str(segment.kind))) {
    throw AppError.forbidden(
      ERROR.CUSTOMER_SEGMENT.KIND_LOCKED,
      ERROR_CODE.CUSTOMER_SEGMENT_KIND_LOCKED,
    );
  }
  return segment;
};

export const createSegment = async (
  input: { name: string; description?: string; color?: string },
  actorId: string,
  req?: any,
): Promise<any> => {
  const name = D.str(input.name);
  const slug = await uniqueCustomerSegmentSlug(name);

  const segment = await prisma.customerSegment.create({
    data: {
      name,
      slug,
      description: D.str(input.description),
      color: D.str(input.color),
      kind: SEGMENT_KIND.MANUAL as any,
      isActive: true,
    },
    select: { ...SEGMENT_SELECT, _count: { select: { members: true } } },
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'CUSTOMER_SEGMENT_CREATED',
    entity: 'CustomerSegment',
    entityId: segment.id,
    meta: { name },
  });

  return segment;
};

export const updateSegment = async (
  segmentId: string,
  input: { name?: string; description?: string; color?: string; isActive?: boolean },
  actorId: string,
  req?: any,
): Promise<any> => {
  const existing = await getSegmentById(segmentId);

  if (input.name !== undefined && D.str(input.name) !== existing.name) {
    const clash = await prisma.customerSegment.findFirst({
      where: { name: D.str(input.name), id: { not: segmentId } },
      select: { id: true },
    });
    if (clash) {
      throw AppError.conflict(
        ERROR.CUSTOMER_SEGMENT.ALREADY_EXISTS,
        ERROR_CODE.CUSTOMER_SEGMENT_DUPLICATE,
      );
    }
  }

  const data: Prisma.CustomerSegmentUpdateInput = {};
  if (input.name !== undefined) {
    data.name = D.str(input.name);
    data.slug = await uniqueCustomerSegmentSlug(D.str(input.name), segmentId);
  }
  if (input.description !== undefined) data.description = D.str(input.description);
  if (input.color !== undefined) data.color = D.str(input.color);
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);

  const segment = await prisma.customerSegment.update({
    where: { id: segmentId },
    data,
    select: { ...SEGMENT_SELECT, _count: { select: { members: true } } },
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'CUSTOMER_SEGMENT_UPDATED',
    entity: 'CustomerSegment',
    entityId: segmentId,
    meta: { fields: Object.keys(data) },
  });

  return segment;
};

export const deleteSegment = async (
  segmentId: string,
  actorId: string,
  req?: any,
): Promise<boolean> => {
  await getSegmentById(segmentId);

  await prisma.customerSegment.delete({ where: { id: segmentId } });

  void writeAuditLog({
    req,
    actorId,
    action: ADMIN_ACTION.DELETE,
    entity: 'CustomerSegment',
    entityId: segmentId,
    description: 'Deleted customer segment',
  });

  return true;
};

export const listSegmentMembers = async (
  segmentId: string,
  query: any,
): Promise<{ rows: any[]; total: number }> => {
  await getSegmentById(segmentId);
  const { limit, skip } = getPagination(query);

  const where: Prisma.CustomerSegmentMemberWhereInput = { segmentId };

  const [rows, total] = await Promise.all([
    prisma.customerSegmentMember.findMany({
      where,
      skip,
      take: limit,
      orderBy: { assignedAt: 'desc' },
      select: {
        id: true,
        segmentId: true,
        userId: true,
        source: true,
        assignedAt: true,
        user: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } },
      },
    }),
    prisma.customerSegmentMember.count({ where }),
  ]);

  return { rows, total };
};

export const addSegmentMembers = async (
  segmentId: string,
  input: { userIds: string[] },
  actorId: string,
  req?: any,
): Promise<number> => {
  const segment = await requireManualSegment(segmentId);
  const userIds = Array.from(new Set(D.arr(input.userIds).map(String)));

  const found = await prisma.user.count({
    where: { id: { in: userIds }, deletedAt: null },
  });

  if (found !== userIds.length) {
    throw AppError.unprocessable(ERROR.USER.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }

  const result = await prisma.customerSegmentMember.createMany({
    data: userIds.map((userId) => ({
      segmentId: segment.id,
      userId,
      source: SEGMENT_SOURCE.MANUAL as any,
      assignedById: D.str(actorId) || null,
    })),
    skipDuplicates: true,
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'CUSTOMER_SEGMENT_MEMBERS_ADDED',
    entity: 'CustomerSegment',
    entityId: segmentId,
    meta: { added: result.count, requested: userIds.length },
  });

  return result.count;
};

export const removeSegmentMembers = async (
  segmentId: string,
  input: { userIds: string[] },
  actorId: string,
  req?: any,
): Promise<number> => {
  await requireManualSegment(segmentId);
  const userIds = Array.from(new Set(D.arr(input.userIds).map(String)));

  const result = await prisma.customerSegmentMember.deleteMany({
    where: { segmentId, userId: { in: userIds } },
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'CUSTOMER_SEGMENT_MEMBERS_REMOVED',
    entity: 'CustomerSegment',
    entityId: segmentId,
    meta: { removed: result.count },
  });

  return result.count;
};

/**
 * Auto segments are recomputed rather than hand-maintained, so each run first
 * makes sure the row for every auto kind exists â€” a deleted segment comes back
 * empty instead of the rule silently going unrouted.
 */
const ensureAutoSegments = async (): Promise<Map<string, string>> => {
  const rows = await prisma.customerSegment.findMany({
    where: { kind: { in: AUTO_SEGMENT_KINDS as any[] } },
    select: { id: true, kind: true },
  });

  const byKind = new Map(rows.map((r) => [D.str(r.kind), r.id]));

  for (const kind of AUTO_SEGMENT_KINDS) {
    if (byKind.has(kind)) continue;

    const created = await prisma.customerSegment.create({
      data: {
        name: AUTO_SEGMENT_NAMES[kind] ?? kind,
        slug: `${kind.toLowerCase()}-customers`,
        kind: kind as any,
        isActive: true,
      },
      select: { id: true, kind: true },
    });

    byKind.set(kind, created.id);
  }

  return byKind;
};

/**
 * Membership is a full recompute, not a diff: each customer's qualifying kinds
 * are derived from one aggregate query, and the RULE-sourced rows for those
 * segments are replaced wholesale. Manual assignments live in separate rows with
 * a different `source`, so they survive untouched. Runs in batches because the
 * aggregate is a grouped query over every order and a single unbounded pass is
 * what makes this job expensive.
 */
export const refreshCustomerSegments = async (
  req?: any,
): Promise<{ processed: number; assigned: number; removed: number }> => {
  const config = await getSegmentConfig();
  const segmentIds = await ensureAutoSegments();
  const autoIds = Array.from(segmentIds.values());

  let processed = 0;
  let assigned = 0;
  let removed = 0;

  let cursor: string | undefined;
  for (;;) {
    const users = await prisma.user.findMany({
      where: { deletedAt: null, role: ROLES.CUSTOMER },
      orderBy: { id: 'asc' },
      take: config.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    });

    if (!users.length) break;

    const userIds = users.map((u) => u.id);

    const [orders, bans, existing] = await Promise.all([
      prisma.order.groupBy({
        by: ['userId', 'status'],
        where: { userId: { in: userIds }, deletedAt: null },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.customerBan.findMany({
        where: { userId: { in: userIds }, revokedAt: null },
        select: { userId: true, expiresAt: true },
      }),
      prisma.customerSegmentMember.findMany({
        where: { segmentId: { in: autoIds }, source: SEGMENT_SOURCE.RULE as any },
        select: { id: true, userId: true, segmentId: true },
      }),
    ]);

    const live = new Map(bans.filter((b) => isBanActive(b)).map((b) => [b.userId, true] as const));
    const current = new Map<string, { id: string }>(
      existing.map((m) => [`${m.userId}:${m.segmentId}`, { id: m.id }]),
    );

    const add: Array<{ segmentId: string; userId: string }> = [];
    const drop: string[] = [];

    for (const userId of userIds) {
      const mine = orders.filter((o) => o.userId === userId);
      const orderCount = mine.reduce((sum, o) => sum + D.num(o._count._all), 0);
      const delivered = mine.filter((o) =>
        DELIVERED_ORDER_STATUSES.includes(D.str(o.status) as OrderStatus),
      );
      const deliveredCount = delivered.reduce((sum, o) => sum + D.num(o._count._all), 0);
      const totalSpent = delivered.reduce((sum, o) => sum + D.float(o._sum.total), 0);

      const kinds = evaluateSegmentKinds(
        { orderCount, deliveredOrderCount: deliveredCount, totalSpent, isBanned: live.has(userId) },
        config.thresholds,
      );

      for (const [kind, segmentId] of segmentIds) {
        const key = `${userId}:${segmentId}`;
        const shouldHave = kinds.includes(kind as any);
        const has = current.has(key);
        if (shouldHave && !has) add.push({ segmentId, userId });
        else if (!shouldHave && has) drop.push(key);
      }
    }

    if (add.length) {
      await prisma.customerSegmentMember.createMany({
        data: add.map((row) => ({ ...row, source: SEGMENT_SOURCE.RULE as any })),
        skipDuplicates: true,
      });
      assigned += add.length;
    }

    if (drop.length) {
      const dropIds = drop
        .map((key) => current.get(key)?.id)
        .filter((id): id is string => Boolean(id));
      if (dropIds.length) {
        await prisma.customerSegmentMember.deleteMany({ where: { id: { in: dropIds } } });
        removed += dropIds.length;
      }
    }

    processed += users.length;
    cursor = users[users.length - 1].id;
  }

  void writeActivityLog({
    req,
    action: 'CUSTOMER_SEGMENTS_REFRESHED',
    entity: 'CustomerSegment',
    meta: { processed, assigned, removed },
  });

  return { processed, assigned, removed };
};

// â”€â”€ Customer data export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * DPDP/GDPR access request: everything the customer holds, in one payload.
 * Secrets are never selected, so they cannot leak through a serializer â€” the
 * ban row is included because the customer is entitled to know they are
 * blocked and why, but the note is only ever the admin's own free text.
 */
export const exportCustomerData = async (targetUserId: string): Promise<CustomerExport> => {
  const [user, addresses, orders, reviews, wishlist, notifications, consents, ban, memberships] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: targetUserId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatarUrl: true,
          role: true,
          isActive: true,
          isEmailVerified: true,
          isPhoneVerified: true,
          twoFactorEnabled: true,
          loyaltyTier: true,
          lastLoginAt: true,
          lastLoginIp: true,
          createdAt: true,
          updatedAt: true,
          vendorProfile: {
            select: { id: true, shopName: true, slug: true, status: true, gstNumber: true },
          },
          socialAccounts: { select: { provider: true, createdAt: true } },
        },
      }),
      prisma.address.findMany({ where: { userId: targetUserId }, orderBy: { createdAt: 'asc' } }),
      prisma.order.findMany({
        where: { userId: targetUserId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          items: true,
          subOrders: {
            select: { id: true, status: true, total: true, vendor: { select: { shopName: true } } },
          },
          payments: true,
          refunds: true,
        },
      }),
      prisma.review.findMany({
        where: { userId: targetUserId },
        orderBy: { createdAt: 'asc' },
        include: { product: { select: { name: true } } },
      }),
      prisma.wishlistItem.findMany({
        where: { wishlist: { userId: targetUserId } },
        include: { product: { select: { name: true, slug: true, price: true } } },
      }),
      prisma.notification.findMany({
        where: { userId: targetUserId },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_NOTIFICATION_LIMIT,
      }),
      prisma.userConsent.findMany({
        where: { userId: targetUserId },
        orderBy: { acceptedAt: 'asc' },
      }),
      prisma.customerBan.findUnique({ where: { userId: targetUserId }, select: BAN_SELECT }),
      prisma.customerSegmentMember.findMany({
        where: { userId: targetUserId },
        select: { segment: { select: { id: true, name: true, slug: true, kind: true } } },
      }),
    ]);

  if (!user) throw AppError.notFound(ERROR.USER.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  return {
    profile: {
      userId: D.str(user.id),
      name: D.str(user.name),
      email: D.str(user.email),
      phone: D.str(user.phone),
      avatarUrl: D.str(user.avatarUrl),
      role: D.str(user.role),
      isActive: D.bool(user.isActive),
      isEmailVerified: D.bool(user.isEmailVerified),
      isPhoneVerified: D.bool(user.isPhoneVerified),
      twoFactorEnabled: D.bool(user.twoFactorEnabled),
      loyaltyTier: D.str(user.loyaltyTier),
      lastLoginAt: D.date(user.lastLoginAt),
      lastLoginIp: D.str(user.lastLoginIp),
      createdAt: D.date(user.createdAt),
      updatedAt: D.date(user.updatedAt),

      vendorData: user.vendorProfile
        ? {
            vendorId: D.str(user.vendorProfile.id),
            shopName: D.str(user.vendorProfile.shopName),
            slug: D.str(user.vendorProfile.slug),
            status: D.str(user.vendorProfile.status),
            gstNumber: D.str(user.vendorProfile.gstNumber),
          }
        : {},
      socialProviderList: D.arr(user.socialAccounts).map((s: any) => D.str(s.provider)),
      segmentList: D.arr(memberships).map((m: any) => ({
        segmentId: D.str(m.segment.id),
        name: D.str(m.segment.name),
        slug: D.str(m.segment.slug),
        kind: D.str(m.segment.kind),
      })),
      banData: ban
        ? {
            isBlocked: true,
            reason: D.str(ban.reason),
            expiresAt: D.date(ban.expiresAt),
            blockedAt: D.date(ban.createdAt),
          }
        : {},
    },
    addresses: D.arr(addresses),
    orders: D.arr(orders),
    reviews: D.arr(reviews),
    wishlist: D.arr(wishlist),
    notifications: D.arr(notifications),
    consents: D.arr(consents),
    bans: ban ? [withBanState(ban)] : [],
    segments: D.arr(memberships).map((m: any) => m.segment),
    stats: {
      orderCount: D.num(orders.length),
      addressCount: D.num(addresses.length),
      reviewCount: D.num(reviews.length),
      wishlistCount: D.num(wishlist.length),
      segmentCount: D.num(memberships.length),
    },
  };
};

export const serializeCustomerExport = (data: CustomerExport) => ({
  exportedAt: new Date().toISOString(),

  profileData: D.obj(data.profile),

  statsData: D.obj(data.stats),

  addressList: D.arr(data.addresses),
  orderList: D.arr(data.orders),
  reviewList: D.arr(data.reviews),
  wishlistList: D.arr(data.wishlist),
  notificationList: D.arr(data.notifications),
  consentList: D.arr(data.consents),
  banList: D.arr(data.bans),
  segmentList: D.arr(data.segments),
});

// â”€â”€ Customer timeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Each source is read up to `skip + limit` rows rather than `limit`. The merged
 * list is sorted afterwards, so a page boundary cannot be known before the
 * merge; taking that much from every source guarantees the union's first
 * `skip + limit` rows are all present, which is what makes the slice correct.
 * The window is capped so a deep page cannot become five unbounded queries.
 */
const TIMELINE_MAX_WINDOW = 200;

const SETTLED_RETURN_STATUSES: string[] = [RETURN_STATUS.REFUNDED, RETURN_STATUS.REJECTED];
const CLOSED_TICKET_STATUSES: string[] = [TICKET_STATUS.RESOLVED, TICKET_STATUS.CLOSED];

export const getUserTimeline = async (
  targetUserId: string,
  query: any,
): Promise<{ rows: TimelineEvent[]; total: number; page: number; limit: number; skip: number }> => {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  });

  if (!user) throw AppError.notFound(ERROR.USER.NOT_FOUND);

  const { page, limit, skip } = getPagination(query);
  const take = Math.min(skip + limit, TIMELINE_MAX_WINDOW);

  const from = query?.from ? new Date(query.from) : null;
  const to = query?.to ? new Date(query.to) : null;
  const fromAt = from && !Number.isNaN(from.getTime()) ? from : null;
  const toAt = to && !Number.isNaN(to.getTime()) ? to : null;

  const inRange = {
    ...(fromAt || toAt ? { gte: fromAt ?? undefined, lte: toAt ?? undefined } : {}),
  };
  const typeFilter = D.str(query?.type).toUpperCase();
  const wants = (type: TimelineType) => !typeFilter || typeFilter === type;

  const orderWhere = { userId: targetUserId, createdAt: inRange };
  const returnWhere = { userId: targetUserId, requestedAt: inRange };
  const ticketWhere = { userId: targetUserId, createdAt: inRange };
  const chatWhere = { userId: targetUserId, createdAt: inRange };
  const loginWhere = { userId: targetUserId, createdAt: inRange };

  const [orders, returns, tickets, chats, logins, counts] = await Promise.all([
    wants(TIMELINE_TYPE.ORDER)
      ? prisma.order.findMany({
          where: orderWhere,
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            isCancelled: true,
            createdAt: true,
            _count: { select: { items: true } },
          },
        })
      : [],
    wants(TIMELINE_TYPE.RETURN)
      ? prisma.returnRequest.findMany({
          where: returnWhere,
          orderBy: { requestedAt: 'desc' },
          take,
          select: {
            id: true,
            returnNumber: true,
            status: true,
            refundAmount: true,
            requestedAt: true,
            _count: { select: { items: true } },
          },
        })
      : [],
    wants(TIMELINE_TYPE.TICKET)
      ? prisma.ticket.findMany({
          where: ticketWhere,
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            ticketNumber: true,
            subject: true,
            status: true,
            priority: true,
            createdAt: true,
            _count: { select: { messages: true } },
          },
        })
      : [],
    wants(TIMELINE_TYPE.CHAT)
      ? prisma.conversationParticipant.findMany({
          where: chatWhere,
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            conversationId: true,
            lastReadAt: true,
            conversation: {
              select: {
                lastMessageAt: true,
                isActive: true,
                _count: { select: { messages: true } },
              },
            },
          },
        })
      : [],
    wants(TIMELINE_TYPE.LOGIN)
      ? prisma.refreshToken.findMany({
          where: loginWhere,
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, ip: true, deviceId: true, createdAt: true },
        })
      : [],

    Promise.all([
      wants(TIMELINE_TYPE.ORDER) ? prisma.order.count({ where: orderWhere }) : 0,
      wants(TIMELINE_TYPE.RETURN) ? prisma.returnRequest.count({ where: returnWhere }) : 0,
      wants(TIMELINE_TYPE.TICKET) ? prisma.ticket.count({ where: ticketWhere }) : 0,
      wants(TIMELINE_TYPE.CHAT) ? prisma.conversationParticipant.count({ where: chatWhere }) : 0,
      wants(TIMELINE_TYPE.LOGIN) ? prisma.refreshToken.count({ where: loginWhere }) : 0,
    ]),
  ]);

  const events: TimelineEvent[] = [
    ...orders.map((o) => ({
      id: o.id,
      type: TIMELINE_TYPE.ORDER as TimelineType,
      title: `Order ${o.orderNumber}`,
      referenceNo: o.orderNumber,
      status: o.status,
      amount: money(o.total),
      isActive: !o.isCancelled,
      occurredAt: o.createdAt,
      meta: { itemCount: D.num(o._count.items), isCancelled: o.isCancelled },
    })),
    ...returns.map((r) => ({
      id: r.id,
      type: TIMELINE_TYPE.RETURN as TimelineType,
      title: `Return ${r.returnNumber}`,
      referenceNo: r.returnNumber,
      status: r.status,
      amount: money(r.refundAmount),
      isActive: !SETTLED_RETURN_STATUSES.includes(r.status),
      occurredAt: r.requestedAt,
      meta: { itemCount: D.num(r._count.items) },
    })),
    ...tickets.map((t) => ({
      id: t.id,
      type: TIMELINE_TYPE.TICKET as TimelineType,
      title: D.str(t.subject) || `Ticket ${t.ticketNumber}`,
      referenceNo: t.ticketNumber,
      status: t.status,
      amount: 0,
      isActive: !CLOSED_TICKET_STATUSES.includes(t.status),
      occurredAt: t.createdAt,
      meta: { priority: t.priority, messageCount: D.num(t._count.messages) },
    })),
    ...chats.map((c) => ({
      id: c.conversationId,
      type: TIMELINE_TYPE.CHAT as TimelineType,
      title: 'Chat conversation',
      referenceNo: '',
      status: '',
      amount: 0,
      isActive: c.conversation.isActive,
      occurredAt: c.conversation.lastMessageAt,
      meta: {
        messageCount: D.num(c.conversation._count.messages),
        lastReadAt: D.date(c.lastReadAt),
      },
    })),
    ...logins.map((l) => ({
      id: l.id,
      type: TIMELINE_TYPE.LOGIN as TimelineType,
      title: 'Login',
      referenceNo: '',
      status: '',
      amount: 0,
      isActive: false,
      occurredAt: l.createdAt,
      meta: { ip: D.str(l.ip), deviceId: D.str(l.deviceId) },
    })),
  ];

  const merged = events
    .filter((e) => !fromAt || e.occurredAt >= fromAt)
    .filter((e) => !toAt || e.occurredAt <= toAt)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  return {
    rows: merged.slice(skip, skip + limit),
    total: counts.reduce((sum, n) => sum + D.num(n), 0),
    page,
    limit,
    skip,
  };
};
