import { D } from '../../utils/defaults';
import {
  serializeProduct,
  serializeProductSummary,
  serializeProductList,
} from '../../utils/serialize';

/**
 * Product serializers.
 * Re-exports the shared catalog serializers so the module has a single import
 * surface, and adds the product-specific shapes used by bulk/stock responses.
 */
export { serializeProduct, serializeProductSummary, serializeProductList };

export const serializeProductWriteResult = (p: any) => ({
  productId: D.str(p?.id),
  vendorId: D.str(p?.vendorId),
  name: D.str(p?.name),
  slug: D.str(p?.slug),
  status: D.str(p?.status),
  isActive: D.str(p?.status) === 'ACTIVE',
  price: D.float(p?.price),
  mrpPrice: D.float(p?.mrpPrice),
  stock: D.num(p?.stock),
  imageCount: D.arr(p?.images).length,
  variantCount: D.arr(p?.variants).length,
  createdAt: D.date(p?.createdAt),
});

export const serializeStockResult = (r: any) => ({
  productId: D.str(r?.productId),
  variantId: D.str(r?.variantId),
  previousStock: D.num(r?.previousStock),
  stock: D.num(r?.stock),
  isLowStock: D.bool(r?.isLowStock),
});

export const serializeBulkResult = (r: any) => ({
  successCount: D.num(r?.successCount),
  failCount: D.num(r?.failCount),
  totalCount: D.num(r?.successCount) + D.num(r?.failCount),

  errorList: D.arr(r?.errors).map((e: any) => ({
    row: D.num(e?.row),
    message: D.str(e?.message),
  })),
});

export const serializeBulkPriceResult = (input: {
  updated: any[];
  failed: string[];
  type: string;
  value: number;
}) => ({
  type: D.str(input.type),
  value: D.float(input.value),
  updatedCount: D.arr(input.updated).length,
  failedCount: D.arr(input.failed).length,

  productList: D.arr(input.updated).map((p: any) => ({
    productId: D.str(p?.id),
    name: D.str(p?.name),
    previousPrice: D.float(p?.previousPrice),
    price: D.float(p?.price),
  })),

  failedIdList: D.arr(input.failed),
});

export const serializeProductFacets = (f: any) => ({
  categoryList: D.arr(f?.categories).map((c: any) => ({
    categoryId: D.str(c?.value),
    name: D.str(c?.label),
    count: D.num(c?.count),
  })),

  brandList: D.arr(f?.brands).map((b: any) => ({
    brandId: D.str(b?.value),
    name: D.str(b?.label),
    count: D.num(b?.count),
  })),

  vendorList: D.arr(f?.vendors).map((v: any) => ({
    vendorId: D.str(v?.value),
    shopName: D.str(v?.label),
    count: D.num(v?.count),
  })),

  priceRange: {
    minPrice: D.float(f?.priceRange?.min),
    maxPrice: D.float(f?.priceRange?.max),
  },

  attributeList: D.arr(f?.attributes).map((a: any) => ({
    attributeId: D.str(a?.attributeId),
    name: D.str(a?.name),
    valueList: D.arr(a?.values).map((v: any) => ({
      value: D.str(v?.value),
      label: D.str(v?.label),
      count: D.num(v?.count),
    })),
  })),
});

export const serializeRecentlyViewed = (rows: any[]) => ({
  productList: D.arr(rows).map((row: any) => ({
    viewedAt: D.date(row?.viewedAt),
    productData: row?.product ? serializeProductSummary(row.product) : {},
  })),
});

export const serializeFrequentlyBought = (rows: any[]) => ({
  productList: D.arr(rows).map((row: any) => ({
    boughtCount: D.num(row?.boughtCount),
    productData: row?.product ? serializeProductSummary(row.product) : {},
  })),
});

export const serializeImageResult = (r: any) => ({
  productId: D.str(r?.productId),
  imageCount: D.arr(r?.images).length,
  maxImages: D.num(r?.maxImages),
  isOverLimit: D.bool(r?.isOverLimit),

  imageList: D.arr(r?.images)
    .slice()
    .sort((a: any, b: any) => D.num(a?.sortOrder) - D.num(b?.sortOrder))
    .map((img: any) => ({
      imageId: D.str(img?.id),
      url: D.str(img?.url),
      altText: D.str(img?.altText),
      sortOrder: D.num(img?.sortOrder),
    })),
});
