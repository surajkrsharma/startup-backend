import { Prisma } from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { VALIDATION } from '../../messages/validation';
import { ERROR_CODE } from '../../constants/http';
import { ADMIN_ACTION } from '../../constants/roles';
import { getPagination } from '../../utils/pagination';
import { uniqueCategorySlug } from '../../utils/slug';
import { writeActivityLog, writeAuditLog } from '../../services/audit.service';

const CATEGORY_INCLUDE = {
  parent: { select: { id: true, name: true, slug: true } },
  children: {
    select: {
      id: true,
      parentId: true,
      name: true,
      slug: true,
      image: true,
      isActive: true,
      sortOrder: true,
      _count: { select: { products: true } },
    },
    orderBy: { sortOrder: 'asc' },
  },
  _count: { select: { products: true } },
} satisfies Prisma.CategoryInclude;

const CATEGORY_SELECT = {
  id: true,
  parentId: true,
  name: true,
  slug: true,
  description: true,
  image: true,
  icon: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} satisfies Prisma.CategorySelect;

const assertNoCycle = async (categoryId: string, parentId: string): Promise<void> => {
  if (!parentId) return;

  if (parentId === categoryId) {
    throw AppError.badRequest('A category cannot be its own parent.', ERROR_CODE.VALIDATION_ERROR);
  }

  let cursor: string | null = parentId;
  const seen = new Set<string>();
  let depth = 0;

  while (cursor && depth < 20) {
    if (cursor === categoryId) {
      throw AppError.badRequest(
        'A category cannot be moved under one of its own children.',
        ERROR_CODE.VALIDATION_ERROR,
      );
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);

    const row: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = row?.parentId ?? null;
    depth += 1;
  }
};

export const listCategories = async (
  query: any,
): Promise<{ rows: any[]; total: number; tree: boolean }> => {
  const { limit, skip } = getPagination(query);
  const wantsTree = query?.tree === true;
  const withCounts = query?.withCounts !== false;

  const where: Prisma.CategoryWhereInput = {
    deletedAt: null,
    ...(query?.parentId ? { parentId: D.str(query.parentId) } : {}),

    ...(query?.parentId === 'null' || query?.rootsOnly === 'true' || query?.rootsOnly === true
      ? { parentId: null }
      : {}),
    ...(query?.isActive === true || query?.isActive === 'true' ? { isActive: true } : {}),
    ...(D.str(query?.search)
      ? {
          OR: [
            { name: { contains: D.str(query.search), mode: 'insensitive' } },
            { slug: { contains: D.str(query.search), mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  if (wantsTree) {
    const rows = await prisma.category.findMany({
      where: { ...where, parentId: where.parentId ?? null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        ...CATEGORY_SELECT,
        children: {
          select: {
            ...CATEGORY_SELECT,
            children: {
              select: {
                ...CATEGORY_SELECT,
                children: {
                  select: { ...CATEGORY_SELECT, children: false },
                  orderBy: { sortOrder: 'asc' },
                },
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return { rows, total: rows.length, tree: true };
  }

  const [rows, total] = await Promise.all([
    prisma.category.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: withCounts ? CATEGORY_SELECT : { ...CATEGORY_SELECT, _count: false },
    }),
    prisma.category.count({ where }),
  ]);

  return { rows, total, tree: false };
};

export const getCategoryById = async (categoryId: string): Promise<any> => {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, deletedAt: null },
    include: CATEGORY_INCLUDE,
  });

  if (!category) throw AppError.notFound(ERROR.CATEGORY.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return category;
};

export const getCategoryBySlug = async (slug: string): Promise<any> => {
  const category = await prisma.category.findFirst({
    where: { slug, deletedAt: null },
    include: CATEGORY_INCLUDE,
  });

  if (!category) throw AppError.notFound(ERROR.CATEGORY.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return category;
};

export const createCategory = async (input: any, req?: any): Promise<any> => {
  const parentId = D.str(input.parentId);

  if (parentId) {
    const parent = await prisma.category.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { id: true },
    });
    if (!parent) throw AppError.notFound(ERROR.CATEGORY.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }

  const slug = await uniqueCategorySlug(D.str(input.slug) || D.str(input.name));

  let sortOrder = D.num(input.sortOrder);
  if (!input.sortOrder) {
    const last = await prisma.category.findFirst({
      where: { parentId: parentId || null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    sortOrder = (last?.sortOrder ?? 0) + 1;
  }

  const category = await prisma.category.create({
    data: {
      name: D.str(input.name),
      slug,
      description: D.str(input.description),
      image: D.str(input.image),
      icon: D.str(input.icon),
      parentId: parentId || null,
      isActive: input.isActive !== false,
      sortOrder,
    },
    include: CATEGORY_INCLUDE,
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.CREATE,
    entity: 'Category',
    entityId: category.id,
    description: `Category created: ${category.name}`,
    meta: { slug: category.slug, parentId: category.parentId },
  });

  return category;
};

export const updateCategory = async (categoryId: string, input: any, req?: any): Promise<any> => {
  await getCategoryById(categoryId);

  const data: Prisma.CategoryUpdateInput = {};

  if (input.name !== undefined) data.name = D.str(input.name);
  if (input.description !== undefined) data.description = D.str(input.description);
  if (input.image !== undefined) data.image = D.str(input.image);
  if (input.icon !== undefined) data.icon = D.str(input.icon);
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  if (input.sortOrder !== undefined) data.sortOrder = D.num(input.sortOrder);

  if (input.slug !== undefined && D.str(input.slug) !== '') {
    const taken = await prisma.category.findFirst({
      where: { slug: D.str(input.slug), NOT: { id: categoryId } },
      select: { id: true },
    });
    if (taken) throw AppError.conflict(ERROR.COMMON.DUPLICATE, ERROR_CODE.DUPLICATE);
    data.slug = D.str(input.slug);
  }

  if (input.parentId !== undefined) {
    const parentId = D.str(input.parentId);
    if (parentId) await assertNoCycle(categoryId, parentId);
    data.parent = parentId ? { connect: { id: parentId } } : { disconnect: true };
  }

  if (!Object.keys(data).length) {
    throw AppError.badRequest(ERROR.COMMON.VALIDATION_FAILED, ERROR_CODE.VALIDATION_ERROR);
  }

  const category = await prisma.category.update({
    where: { id: categoryId },
    data,
    include: CATEGORY_INCLUDE,
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.UPDATE,
    entity: 'Category',
    entityId: categoryId,
    description: `Category updated: ${category.name}`,
    meta: { fields: Object.keys(input) },
  });

  return category;
};

export const deleteCategory = async (categoryId: string, req?: any): Promise<any> => {
  const category = await getCategoryById(categoryId);

  const [productCount, childCount] = await Promise.all([
    prisma.product.count({ where: { categoryId, deletedAt: null } }),
    prisma.category.count({ where: { parentId: categoryId, deletedAt: null } }),
  ]);

  if (childCount > 0) {
    throw AppError.conflict(ERROR.CATEGORY.HAS_CHILDREN, ERROR_CODE.DUPLICATE);
  }

  if (productCount > 0) {
    throw AppError.conflict(ERROR.CATEGORY.HAS_PRODUCTS, ERROR_CODE.DUPLICATE);
  }

  await prisma.category.update({
    where: { id: categoryId },
    data: { deletedAt: new Date(), isActive: false },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.DELETE,
    entity: 'Category',
    entityId: categoryId,
    description: `Category deleted: ${category.name}`,
    meta: { softDelete: true },
  });

  return { id: categoryId, name: category.name };
};

export const reorderCategories = async (
  categoryIds: string[],
  parentId: string,
  req?: any,
): Promise<number> => {
  const rows = await prisma.category.findMany({
    where: {
      id: { in: categoryIds },
      deletedAt: null,
      ...(parentId ? { parentId } : { parentId: null }),
    },
    select: { id: true },
  });

  const known = new Set(rows.map((r) => r.id));
  const unknown = categoryIds.filter((id) => !known.has(id));

  if (unknown.length) {
    throw AppError.notFound(
      `Category not found in this level: ${unknown.join(', ')}`,
      ERROR_CODE.NOT_FOUND,
    );
  }

  await prisma.$transaction(
    categoryIds.map((id, index) =>
      prisma.category.update({ where: { id }, data: { sortOrder: index + 1 } }),
    ),
  );

  void writeActivityLog({
    req,
    action: 'CATEGORIES_REORDERED',
    entity: 'Category',
    entityId: parentId || 'root',
    meta: { count: categoryIds.length },
  });

  return categoryIds.length;
};

export const bulkCreate = async (
  input: { categories: any[]; continueOnError: boolean },
  req?: any,
): Promise<{
  successCount: number;
  failCount: number;
  errors: { row: number; message: string }[];
}> => {
  const errors: { row: number; message: string }[] = [];
  let successCount = 0;

  for (const [index, item] of input.categories.entries()) {
    try {
      const itemName = D.str(item.name);
      if (itemName.length < 2) {
        throw AppError.badRequest(VALIDATION.MIN_LENGTH('name', 2), ERROR_CODE.VALIDATION_ERROR);
      }

      const parentId = D.str(item.parentId);
      if (parentId) {
        const parent = await prisma.category.findFirst({
          where: { id: parentId, deletedAt: null },
          select: { id: true },
        });
        if (!parent) {
          throw AppError.notFound(ERROR.CATEGORY.NOT_FOUND, ERROR_CODE.NOT_FOUND);
        }
      }

      await prisma.category.create({
        data: {
          name: itemName,
          slug: await uniqueCategorySlug(D.str(item.slug) || D.str(item.name)),
          description: D.str(item.description),
          parentId: parentId || null,
          isActive: item.isActive !== false,
          sortOrder: D.num(item.sortOrder) || index + 1,
        },
      });
      successCount += 1;
    } catch (err) {
      if (!input.continueOnError) throw err;
      errors.push({ row: index + 1, message: (err as AppError)?.message ?? 'Failed to create.' });
    }
  }

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.IMPORT,
    entity: 'Category',
    entityId: 'bulk',
    description: `Bulk created ${successCount}/${input.categories.length} categories`,
  });

  return { successCount, failCount: errors.length, errors };
};
