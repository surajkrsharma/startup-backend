import { ProductStatus } from '../../constants/roles';

export interface ProductWrite {
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  brandId: string;
  tagIds: string[];
  sku: string;
  price: number;
  mrpPrice: number;
  costPrice: number;
  taxPercent: number;
  stock: number;
  lowStockThreshold: number;
  weight: number;
  allowBackorder: boolean;
  status: ProductStatus;
  isFeatured: boolean;
  images: { url: string; publicId: string; altText: string; sortOrder: number }[];
  variants: {
    id?: string;
    sku: string;
    title: string;
    attributes: Record<string, string>;
    price: number;
    mrpPrice: number;
    stock: number;
    isActive: boolean;
  }[];
  attributes: { attributeId: string; value: string }[];
}

export interface ProductFilters {
  page: number;
  limit: number;
  skip: number;
  search: string;
  categoryId: string;
  categorySlug: string;
  brandId: string;
  vendorId: string;
  tagIds: string[];
  minPrice: number | null;
  maxPrice: number | null;
  inStock: boolean;
  isFeatured: boolean;
  status: ProductStatus | '';
  rating: number | null;
  excludeProductId: string;
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export interface ProductFacets {
  categories: FacetValue[];
  brands: FacetValue[];
  vendors: FacetValue[];
  priceRange: { min: number; max: number };
  attributes: { attributeId: string; name: string; values: FacetValue[] }[];
}

export interface BulkResult {
  successCount: number;
  failCount: number;
  errors: { row: number; message: string }[];
}

export interface StockResult {
  productId: string;
  previousStock: number;
  stock: number;
  variantId: string;
  isLowStock: boolean;
}

export type PriceChangeType = 'FIXED' | 'PERCENT_UP' | 'PERCENT_DOWN';
