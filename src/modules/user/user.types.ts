import { Role } from '../../constants/roles';

/** Filters accepted by the admin user list. */
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

export interface ImpersonationResult {
  accessToken: string;
  expiresIn: number;
  targetUser: Record<string, any>;
}

/** Shape returned by admin list queries, before serialization. */
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
