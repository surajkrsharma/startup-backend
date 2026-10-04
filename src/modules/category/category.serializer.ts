import { D } from '../../utils/defaults';
import { serializeCategory } from '../../utils/serialize';

export { serializeCategory };

export const serializeCategoryList = (rows: any[]) => ({
  categoryList: D.arr(rows).map(serializeCategory),
});

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
