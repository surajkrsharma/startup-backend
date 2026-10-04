import {
  ROLES,
  Role,
  RegisterType,
  OtpType,
  SocialProvider,
  Platform,
} from '../../constants/roles';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  isActive: boolean;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  avatarUrl: string;
  twoFactorEnabled: boolean;
  createdAt: Date;
}

export interface VendorProfileLite {
  id: string;
  shopName: string;
  slug: string;
  status: string;
  commissionRate: number;
}

export interface AuthUserWithVendor extends AuthUser {
  vendorProfile: VendorProfileLite | null;
}

export const AUTH_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  isActive: true,
  isEmailVerified: true,
  isPhoneVerified: true,
  avatarUrl: true,
  twoFactorEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  vendorProfile: {
    select: {
      id: true,
      shopName: true,
      slug: true,
      status: true,
      commissionRate: true,
      logo: true,
    },
  },
} as const;

export interface DeviceContext {
  deviceId: string;
  platform: Platform | 'OTHER';
  ip: string;
  userAgent: string;
  sessionKey: string;
  appVersion?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshTokenId: string;
}

export interface SessionToken extends TokenPair {
  user: AuthUserWithVendor;
}

export interface RequestContext {
  userId: string;
  role: Role | string;
  vendorId: string;
  email: string;
  sessionKey: string;
  deviceId: string;
  ip: string;
  userAgent: string;
  platform: string;
  sessionId: string;
  requestId: string;
}

export const buildRequestContext = (req: any): RequestContext => ({
  userId: req?.auth?.userId ?? '',
  role: req?.auth?.role ?? '',
  vendorId: req?.auth?.vendorId ?? '',
  email: req?.auth?.email ?? '',
  sessionKey: req?.auth?.sessionKey ?? req?.sessionKey ?? '',
  deviceId: req?.deviceId ?? req?.auth?.deviceId ?? '',
  ip: req?.ip ?? '',
  userAgent: req?.headers?.['user-agent'] ?? '',
  platform: req?.device?.platform ?? 'WEB',
  sessionId: req?.sessionKey ?? '',
  requestId: req?.id ?? '',
});

export interface OtpRecord {
  identifier: string;
  type: OtpType;
  channel: string;
  attempts: number;
  isVerified: boolean;
  expiresAt: Date;
}

export type { RegisterType, SocialProvider, Role };

export const ADMIN_ROLES: string[] = [ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN];
