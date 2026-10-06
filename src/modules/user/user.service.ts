import { Prisma } from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { VALIDATION } from '../../messages/validation';
import { ERROR_CODE } from '../../constants/http';
import { Role, ADMIN_ACTION, ADDRESS_TYPE } from '../../constants/roles';
import { signAccessToken } from '../../utils/crypto';
import { getPagination } from '../../utils/pagination';
import { diffChanges, writeActivityLog, writeAuditLog } from '../../services/audit.service';
import { COUNTRY_CODE, EMAIL_REGEX } from '../../constants/countries';
import { normalisePhone } from '../../utils/validate';
import { ListUsersFilters, UserActivityFilters, AddressWrite } from './user.types';

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

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: now,
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
    meta: { softDelete: true },
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
      'User has order history — deactivate instead of deleting.',
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
    description: `Impersonated ${target.email} for ${expiresIn / 60} min — ${D.str(input.reason)}`,
    meta: { reason: D.str(input.reason), expiresIn, targetRole: target.role },
    impersonatedById: req?.auth?.userId,
  });

  return { accessToken, expiresIn, target };
};
