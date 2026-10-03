import { VendorStatus } from '../../constants/roles';

export interface ListVendorFilters {
  page: number;
  limit: number;
  skip: number;
  search: string;
  status: VendorStatus | 'all' | '';
  hasDocuments: boolean;
}

export interface VendorStats {
  productCount: number;
  activeProductCount: number;
  outOfStockCount: number;
  subOrderCount: number;
  deliveredCount: number;
  totalRevenue: number;
  totalEarnings: number;
  commissionPaid: number;
  pendingAmount: number;
  paidOutAmount: number;
  reviewCount: number;
  rating: number;
  returnCount: number;
}

export interface VendorEarningsSummary {
  grossEarnings: number;
  commission: number;
  platformFee: number;
  netEarnings: number;
  pendingAmount: number;
  paidOutAmount: number;
  lastPayoutAt: string;
}

export interface KycUpload {
  docType: string;
  number: string;
  fileUrl: string;
  publicId: string;
}

export interface PayoutRequestResult {
  payoutId: string;
  amount: number;
  status: string;
  method: string;
  period: string;
}
