import { D } from '../../utils/defaults';

/**
 * Category serializers.
 * Key order: singles -> objects -> arrays. No nulls anywhere.
 */
export const serializeCategory = (c: any) => ({
  categoryId: D.str(c?.id),
  parentId: D.str(c?.parentId),
  name: D.str(c?.name),
  slug: D.str(c?.slug),
  description: D.str(c?.description),
  image: D.str(c?.image),
  icon: D.str(c?.icon),
  isActive: D.bool(c?.isActive),
  sortOrder: D.num(c?.sortOrder),
  productCount: D.num(c?._count?.products),
  createdAt: D.date(c?.createdAt),
  updatedAt: D.date(c?.updatedAt),

  parentData: c?.parent
    ? {
        categoryId: D.str(c.parent.id),
        name: D.str(c.parent.name),
        slug: D.str(c.parent.slug),
      }
    : {},

  childList: D.arr(c?.children).map((child: any) => ({
    categoryId: D.str(child?.id),
    parentId: D.str(child?.parentId),
    name: D.str(child?.name),
    slug: D.str(child?.slug),
    image: D.str(child?.image),
    isActive: D.bool(child?.isActive),
    sortOrder: D.num(child?.sortOrder),
    productCount: D.num(child?._count?.products),
  })),
});

export const serializeCategoryList = (rows: any[]) => ({
  categoryList: D.arr(rows).map(serializeCategory),
});

/** Nested tree node, used by `?tree=1`. */
export const serializeCategoryNode = (node: any, depth = 0): Record<string, any> => ({
  categoryId: D.str(node?.id),
  parentId: D.str(node?.parentId),
  name: D.str(node?.name),
  slug: D.str(node?.slug),
  image: D.str(node?.image),
  icon: D.str(node?.icon),
  isActive: D.bool(node?.isActive),
  sortOrder: D.num(node?.sortOrder),
  productCount: D.num(node?._count?.products),
  level: Math.max(0, depth),

  childList: D.arr(node?.children).map((child: any) => serializeCategoryNode(child, depth + 1)),
});

export const serializeCategoryTree = (rows: any[]) => ({
  categoryList: D.arr(rows).map((node: any) => serializeCategoryNode(node)),
  totalCount: D.arr(rows).length,
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
