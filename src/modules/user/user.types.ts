import { Role } from '../../constants/roles';

export interface ListUsersFilters {
  page: number;
  limit: number;
  skip: number;
  search: string;
  role: Role | '';
  status: 'active' | 'inactive' | 'suspended' | 'all' | '';
  vendorStatus: string;
  isVerified: boolean | '';
  createdFrom: Date | null;
  createdTo: Date | null;
}

export interface AddressWrite {
  type: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  deliveryInstructions: string;
  city: string;
  state: string;
  stateCode: string;
  country: string;
  countryCode: string;
  pincode: string;
  isDefault: boolean;
}

export interface UserActivityFilters {
  page: number;
  limit: number;
  skip: number;
  action: string;
  from: Date | null;
  to: Date | null;
}

/**
 * The five streams the customer timeline merges. Each maps onto a different
 * table, which is why the union is built in memory rather than in SQL.
 */
export const TIMELINE_TYPE = {
  ORDER: 'ORDER',
  RETURN: 'RETURN',
  TICKET: 'TICKET',
  CHAT: 'CHAT',
  LOGIN: 'LOGIN',
} as const;

export type TimelineType = keyof typeof TIMELINE_TYPE;

export interface TimelineEvent {
  id: string;
  type: TimelineType;
  title: string;
  referenceNo: string;
  status: string;
  amount: number;
  isActive: boolean;
  occurredAt: Date;
  meta: Record<string, any>;
}

export interface ImpersonationResult {
  accessToken: string;
  expiresIn: number;
  targetUser: Record<string, any>;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  isActive: boolean;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  avatarUrl: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  vendorProfile?: { id: string; shopName: string; slug: string; status: string } | null;
  _count?: { orders: number; reviews: number };
}
