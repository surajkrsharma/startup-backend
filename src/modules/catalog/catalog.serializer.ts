import { D } from '../../utils/defaults';

/** Brand serializers. Key order: singles -> objects -> arrays. */
export const serializeBrand = (b: any) => ({
  brandId: D.str(b?.id),
  name: D.str(b?.name),
  slug: D.str(b?.slug),
  logo: D.str(b?.logo),
  description: D.str(b?.description),
  isActive: D.bool(b?.isActive),
  productCount: D.num(b?._count?.products),
  createdAt: D.date(b?.createdAt),
  updatedAt: D.date(b?.updatedAt),
});

export const serializeBrandList = (rows: any[]) => ({
  brandList: D.arr(rows).map(serializeBrand),
});

/** Tag serializers. */
export const serializeTag = (t: any) => ({
  tagId: D.str(t?.id),
  name: D.str(t?.name),
  slug: D.str(t?.slug),
  isActive: D.bool(t?.isActive),
  productCount: D.num(t?._count?.products),
  createdAt: D.date(t?.createdAt),
});

export const serializeTagList = (rows: any[]) => ({
  tagList: D.arr(rows).map(serializeTag),
});

/** Attribute serializers. */
export const serializeAttribute = (a: any) => ({
  attributeId: D.str(a?.id),
  name: D.str(a?.name),
  slug: D.str(a?.slug),
  type: D.str(a?.type),
  options: D.strArr(a?.options),
  isVariant: D.bool(a?.isVariant),
  isFilterable: D.bool(a?.isFilterable),
  isActive: D.bool(a?.isActive),
  sortOrder: D.num(a?.sortOrder),
  usageCount: D.num(a?._count?.values),
  createdAt: D.date(a?.createdAt),
  updatedAt: D.date(a?.updatedAt),
});

export const serializeAttributeList = (rows: any[]) => ({
  attributeList: D.arr(rows).map(serializeAttribute),
});

/** Collection serializers. */
export const serializeCollection = (c: any) => ({
  collectionId: D.str(c?.id),
  name: D.str(c?.name),
  slug: D.str(c?.slug),
  description: D.str(c?.description),
  image: D.str(c?.image),
  type: D.str(c?.type),
  rules: D.obj(c?.rules),
  isActive: D.bool(c?.isActive),
  sortOrder: D.num(c?.sortOrder),
  productCount: D.num(c?._count?.products ?? c?.products?.length),
  createdAt: D.date(c?.createdAt),
  updatedAt: D.date(c?.updatedAt),

  productList: D.arr(c?.products).map((p: any) => ({
    productId: D.str(p?.id),
    name: D.str(p?.name),
    slug: D.str(p?.slug),
    price: D.float(p?.price),
    mrpPrice: D.float(p?.mrpPrice),
    stock: D.num(p?.stock),
    isActive: D.str(p?.status) === 'ACTIVE',
    sortOrder: D.num(p?.sortOrder),
    imageList: D.arr(p?.images)
      .slice()
      .sort((a: any, b: any) => D.num(a?.sortOrder) - D.num(b?.sortOrder))
      .map((i: any) => D.str(i?.url)),
  })),
});

export const serializeCollectionList = (rows: any[]) => ({
  collectionList: D.arr(rows).map(serializeCollection),
});

/** Shared shape for any bulk operation that reports per-row failures. */
export const serializeBulkResult = (r: any) => ({
  successCount: D.num(r?.successCount),
  failCount: D.num(r?.failCount),
  totalCount: D.num(r?.successCount) + D.num(r?.failCount),

  errorList: D.arr(r?.errors).map((e: any) => ({
    row: D.num(e?.row),
    message: D.str(e?.message),
  })),
});
