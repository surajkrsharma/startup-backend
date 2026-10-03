import { Prisma } from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { ERROR_CODE } from '../../constants/http';
import { ADMIN_ACTION, PRODUCT_STATUS, COLLECTION_TYPE } from '../../constants/roles';
import { getPagination } from '../../utils/pagination';
import {
  uniqueBrandSlug,
  uniqueTagSlug,
  uniqueAttributeSlug,
  uniqueCollectionSlug,
} from '../../utils/slug';
import { writeAuditLog } from '../../services/audit.service';

// ═══════════════════════════════════════════════════════════════════════════
//  Brand
// ═══════════════════════════════════════════════════════════════════════════

export const listBrands = async (query: any): Promise<{ rows: any[]; total: number }> => {
  const { limit, skip } = getPagination(query);
  const withCounts = query?.withCounts !== false;

  const where: Prisma.BrandWhereInput = {
    deletedAt: null,
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

  const [rows, total] = await Promise.all([
    prisma.brand.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        description: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        ...(withCounts ? { _count: { select: { products: true } } } : {}),
      },
    }),
    prisma.brand.count({ where }),
  ]);

  return { rows, total };
};

export const getBrandById = async (id: string): Promise<any> => {
  const brand = await prisma.brand.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      logo: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { products: true } },
    },
  });

  if (!brand) throw AppError.notFound(ERROR.BRAND.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return brand;
};

export const getBrandBySlug = async (slug: string): Promise<any> => {
  const brand = await prisma.brand.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      logo: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { products: true } },
    },
  });

  if (!brand) throw AppError.notFound(ERROR.BRAND.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return brand;
};

export const createBrand = async (input: any, req?: any): Promise<any> => {
  const brand = await prisma.brand.create({
    data: {
      name: D.str(input.name),
      slug: await uniqueBrandSlug(D.str(input.slug) || D.str(input.name)),
      description: D.str(input.description),
      logo: D.str(input.logo),
      isActive: input.isActive !== false,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      logo: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { products: true } },
    },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.CREATE,
    entity: 'Brand',
    entityId: brand.id,
    description: `Brand created: ${brand.name}`,
  });

  return brand;
};

export const updateBrand = async (id: string, input: any, req?: any): Promise<any> => {
  await getBrandById(id);

  const data: Prisma.BrandUpdateInput = {};
  if (input.name !== undefined) data.name = D.str(input.name);
  if (input.description !== undefined) data.description = D.str(input.description);
  if (input.logo !== undefined) data.logo = D.str(input.logo);
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);

  if (input.slug !== undefined && D.str(input.slug) !== '') {
    const taken = await prisma.brand.findFirst({
      where: { slug: D.str(input.slug), NOT: { id } },
      select: { id: true },
    });
    if (taken) throw AppError.conflict(ERROR.COMMON.DUPLICATE, ERROR_CODE.DUPLICATE);
    data.slug = D.str(input.slug);
  }

  if (!Object.keys(data).length) {
    throw AppError.badRequest(ERROR.COMMON.VALIDATION_FAILED, ERROR_CODE.VALIDATION_ERROR);
  }

  return prisma.brand.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      slug: true,
      logo: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { products: true } },
    },
  });
};

export const deleteBrand = async (id: string, req?: any): Promise<any> => {
  const brand = await getBrandById(id);

  // Refused while products still reference it.
  if (brand._count.products > 0) {
    throw new AppError(ERROR.BRAND.IN_USE, 409, ERROR_CODE.BRAND_IN_USE);
  }

  await prisma.brand.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.DELETE,
    entity: 'Brand',
    entityId: id,
    description: `Brand deleted: ${brand.name}`,
    meta: { softDelete: true },
  });

  return { id, name: brand.name };
};

// ═══════════════════════════════════════════════════════════════════════════
//  Tag
// ═══════════════════════════════════════════════════════════════════════════

export const listTags = async (query: any): Promise<{ rows: any[]; total: number }> => {
  const { limit, skip } = getPagination(query);
  const withCounts = query?.withCounts !== false;

  const where: Prisma.TagWhereInput = {
    deletedAt: null,
    ...(D.str(query?.search)
      ? {
          OR: [
            { name: { contains: D.str(query.search), mode: 'insensitive' } },
            { slug: { contains: D.str(query.search), mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.tag.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        createdAt: true,
        ...(withCounts ? { _count: { select: { products: true } } } : {}),
      },
    }),
    prisma.tag.count({ where }),
  ]);

  return { rows, total };
};

export const createTag = async (input: any, req?: any): Promise<any> =>
  prisma.tag.create({
    data: {
      name: D.str(input.name),
      slug: await uniqueTagSlug(D.str(input.slug) || D.str(input.name)),
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      createdAt: true,
      _count: { select: { products: true } },
    },
  });

export const bulkCreateTags = async (input: {
  tags: any[];
  continueOnError: boolean;
}): Promise<{
  successCount: number;
  failCount: number;
  errors: { row: number; message: string }[];
}> => {
  const errors: { row: number; message: string }[] = [];
  const created: any[] = [];

  for (const [index, item] of input.tags.entries()) {
    try {
      const tag = await createTag(item);
      created.push(tag);
    } catch (err) {
      if (!input.continueOnError) throw err;
      errors.push({
        row: index + 1,
        message: (err as AppError)?.message ?? 'Failed to create tag.',
      });
    }
  }

  return { successCount: created.length, failCount: errors.length, errors };
};

export const deleteTag = async (id: string, req?: any): Promise<any> => {
  const tag = await prisma.tag.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, _count: { select: { products: true } } },
  });

  if (!tag) throw AppError.notFound(ERROR.TAG.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  if (tag._count.products > 0) {
    throw new AppError(ERROR.TAG.IN_USE, 409, ERROR_CODE.DUPLICATE);
  }

  await prisma.tag.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.DELETE,
    entity: 'Tag',
    entityId: id,
    description: `Tag deleted: ${tag.name}`,
  });

  return { id, name: tag.name };
};

// ═══════════════════════════════════════════════════════════════════════════
//  Attribute
// ═══════════════════════════════════════════════════════════════════════════

export const listAttributes = async (query: any): Promise<{ rows: any[]; total: number }> => {
  const { limit, skip } = getPagination(query);

  const where: Prisma.AttributeWhereInput = {
    deletedAt: null,
    ...(query?.isVariant === true || query?.isVariant === 'true' ? { isVariant: true } : {}),
    ...(query?.isActive === true || query?.isActive === 'true' ? { isActive: true } : {}),
    ...(D.str(query?.search)
      ? { name: { contains: D.str(query.search), mode: 'insensitive' } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.attribute.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        options: true,
        isVariant: true,
        isFilterable: true,
        isActive: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { values: true } },
      },
    }),
    prisma.attribute.count({ where }),
  ]);

  return { rows, total };
};

export const getAttributeById = async (id: string): Promise<any> => {
  const attribute = await prisma.attribute.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      options: true,
      isVariant: true,
      isFilterable: true,
      isActive: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { values: true } },
    },
  });

  if (!attribute) throw AppError.notFound(ERROR.ATTRIBUTE.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return attribute;
};

export const createAttribute = async (input: any, req?: any): Promise<any> => {
  const isVariant = Boolean(input.isVariant);

  let sortOrder = D.num(input.sortOrder);
  if (!input.sortOrder) {
    const last = await prisma.attribute.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    sortOrder = (last?.sortOrder ?? 0) + 1;
  }

  const attribute = await prisma.attribute.create({
    data: {
      name: D.str(input.name),
      slug: await uniqueAttributeSlug(D.str(input.slug) || D.str(input.name)),
      type: input.type,
      options: D.arr(input.options).map((o: any) => D.str(o)),
      isVariant,
      isFilterable: input.isFilterable !== false,
      isActive: input.isActive !== false,
      sortOrder,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      options: true,
      isVariant: true,
      isFilterable: true,
      isActive: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { values: true } },
    },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.CREATE,
    entity: 'Attribute',
    entityId: attribute.id,
    description: `Attribute created: ${attribute.name}`,
  });

  return attribute;
};

export const updateAttribute = async (id: string, input: any, req?: any): Promise<any> => {
  await getAttributeById(id);

  const data: Prisma.AttributeUpdateInput = {};
  if (input.name !== undefined) data.name = D.str(input.name);
  if (input.type !== undefined) data.type = input.type;
  if (input.options !== undefined) data.options = D.arr(input.options).map((o: any) => D.str(o));
  if (input.isVariant !== undefined) data.isVariant = Boolean(input.isVariant);
  if (input.isFilterable !== undefined) data.isFilterable = Boolean(input.isFilterable);
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  if (input.sortOrder !== undefined) data.sortOrder = D.num(input.sortOrder);

  if (input.slug !== undefined && D.str(input.slug) !== '') {
    const taken = await prisma.attribute.findFirst({
      where: { slug: D.str(input.slug), NOT: { id } },
      select: { id: true },
    });
    if (taken) throw AppError.conflict(ERROR.COMMON.DUPLICATE, ERROR_CODE.DUPLICATE);
    data.slug = D.str(input.slug);
  }

  if (!Object.keys(data).length) {
    throw AppError.badRequest(ERROR.COMMON.VALIDATION_FAILED, ERROR_CODE.VALIDATION_ERROR);
  }

  return prisma.attribute.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      options: true,
      isVariant: true,
      isFilterable: true,
      isActive: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { values: true } },
    },
  });
};

export const deleteAttribute = async (id: string, req?: any): Promise<any> => {
  const attribute = await getAttributeById(id);

  if (attribute._count.values > 0) {
    throw new AppError(ERROR.ATTRIBUTE.IN_USE, 409, ERROR_CODE.DUPLICATE);
  }

  await prisma.attribute.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.DELETE,
    entity: 'Attribute',
    entityId: id,
    description: `Attribute deleted: ${attribute.name}`,
  });

  return { id, name: attribute.name };
};

// ═══════════════════════════════════════════════════════════════════════════
//  Collection
// ═══════════════════════════════════════════════════════════════════════════

const COLLECTION_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  image: true,
  type: true,
  rules: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} satisfies Prisma.CollectionSelect;

export const listCollections = async (query: any): Promise<{ rows: any[]; total: number }> => {
  const { limit, skip } = getPagination(query);

  const where: Prisma.CollectionWhereInput = {
    deletedAt: null,
    ...(query?.isActive === true || query?.isActive === 'true' ? { isActive: true } : {}),
    ...(D.str(query?.type) ? { type: D.str(query.type) as any } : {}),
    ...(D.str(query?.search)
      ? { name: { contains: D.str(query.search), mode: 'insensitive' } }
      : {}),
  };

  const withProducts = query?.withProducts === true;

  const [rows, total] = await Promise.all([
    prisma.collection.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        ...COLLECTION_SELECT,
        ...(withProducts
          ? {
              products: {
                select: {
                  product: {
                    select: {
                      id: true,
                      name: true,
                      slug: true,
                      price: true,
                      mrpPrice: true,
                      stock: true,
                      status: true,
                      images: { select: { url: true, sortOrder: true } },
                    },
                  },
                  sortOrder: true,
                },
                orderBy: { sortOrder: 'asc' },
              },
            }
          : {}),
      },
    }),
    prisma.collection.count({ where }),
  ]);

  // `products` here is the join table, so flatten it for the serializer.
  return {
    rows: rows.map((row: any) => ({
      ...row,
      products: row.products?.map((entry: any) => ({
        ...entry.product,
        sortOrder: entry.sortOrder,
      })),
    })),
    total,
  };
};

export const getCollectionById = async (id: string, withProducts = false): Promise<any> => {
  const collection = await prisma.collection.findFirst({
    where: { id, deletedAt: null },
    select: {
      ...COLLECTION_SELECT,
      ...(withProducts
        ? {
            products: {
              select: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    price: true,
                    mrpPrice: true,
                    stock: true,
                    status: true,
                    images: { select: { url: true, sortOrder: true } },
                  },
                },
                sortOrder: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
          }
        : {}),
    },
  });

  if (!collection) throw AppError.notFound(ERROR.COLLECTION.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  return {
    ...collection,
    products: (collection as any).products?.map((e: any) => ({
      ...e.product,
      sortOrder: e.sortOrder,
    })),
  };
};

export const getCollectionBySlug = async (slug: string, withProducts = true): Promise<any> => {
  const collection = await prisma.collection.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true },
  });

  if (!collection) throw AppError.notFound(ERROR.COLLECTION.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return getCollectionById(collection.id, withProducts);
};

export const createCollection = async (input: any, req?: any): Promise<any> => {
  const type = D.str(input.type) || COLLECTION_TYPE.MANUAL;

  if (type === COLLECTION_TYPE.MANUAL && !D.arr(input.productIds).length) {
    throw AppError.badRequest(
      'A manual collection needs at least one productId.',
      ERROR_CODE.VALIDATION_ERROR,
    );
  }

  if (type === COLLECTION_TYPE.DYNAMIC && !Object.keys(D.obj(input.rules)).length) {
    throw AppError.badRequest(
      'A dynamic collection needs at least one rule.',
      ERROR_CODE.VALIDATION_ERROR,
    );
  }

  let sortOrder = D.num(input.sortOrder);
  if (!input.sortOrder) {
    const last = await prisma.collection.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    sortOrder = (last?.sortOrder ?? 0) + 1;
  }

  const productIds = D.arr(input.productIds).map((p: any) => String(p));

  const collection = await prisma.collection.create({
    data: {
      name: D.str(input.name),
      slug: await uniqueCollectionSlug(D.str(input.slug) || D.str(input.name)),
      description: D.str(input.description),
      image: D.str(input.image),
      type: type as any,
      rules: D.obj(input.rules) as Prisma.InputJsonValue,
      isActive: input.isActive !== false,
      sortOrder,
      ...(productIds.length
        ? {
            products: {
              create: productIds.map((productId, index) => ({ productId, sortOrder: index + 1 })),
            },
          }
        : {}),
    },
    select: COLLECTION_SELECT,
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.CREATE,
    entity: 'Collection',
    entityId: collection.id,
    description: `Collection created: ${collection.name}`,
  });

  return collection;
};

export const updateCollection = async (id: string, input: any, req?: any): Promise<any> => {
  await getCollectionById(id, false);

  const data: Prisma.CollectionUpdateInput = {};
  if (input.name !== undefined) data.name = D.str(input.name);
  if (input.description !== undefined) data.description = D.str(input.description);
  if (input.image !== undefined) data.image = D.str(input.image);
  if (input.type !== undefined) data.type = input.type as any;
  if (input.rules !== undefined) data.rules = D.obj(input.rules) as Prisma.InputJsonValue;
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  if (input.sortOrder !== undefined) data.sortOrder = D.num(input.sortOrder);

  if (input.slug !== undefined && D.str(input.slug) !== '') {
    const taken = await prisma.collection.findFirst({
      where: { slug: D.str(input.slug), NOT: { id } },
      select: { id: true },
    });
    if (taken) throw AppError.conflict(ERROR.COMMON.DUPLICATE, ERROR_CODE.DUPLICATE);
    data.slug = D.str(input.slug);
  }

  if (!Object.keys(data).length) {
    throw AppError.badRequest(ERROR.COMMON.VALIDATION_FAILED, ERROR_CODE.VALIDATION_ERROR);
  }

  return prisma.collection.update({ where: { id }, data, select: COLLECTION_SELECT });
};

export const deleteCollection = async (id: string, req?: any): Promise<any> => {
  const collection = await getCollectionById(id, false);

  // Soft delete: the product membership rows are removed so listings stay clean.
  await prisma.$transaction([
    prisma.collectionProduct.deleteMany({ where: { collectionId: id } }),
    prisma.collection.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    }),
  ]);

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.DELETE,
    entity: 'Collection',
    entityId: id,
    description: `Collection deleted: ${collection.name}`,
  });

  return { id, name: collection.name };
};

/** Replaces or appends the membership of a manual collection. */
export const setCollectionProducts = async (
  id: string,
  productIds: string[],
  replace: boolean,
  req?: any,
): Promise<{ collectionId: string; productCount: number }> => {
  const collection = await getCollectionById(id, false);

  if (collection.type !== COLLECTION_TYPE.MANUAL) {
    throw AppError.badRequest(
      'Products can only be managed on a MANUAL collection.',
      ERROR_CODE.VALIDATION_ERROR,
    );
  }

  // Reject ids that are not live products rather than silently dropping them.
  const valid = await prisma.product.findMany({
    where: { id: { in: productIds }, deletedAt: null },
    select: { id: true },
  });

  const validIds = valid.map((p) => p.id);
  const unknown = productIds.filter((pid) => !validIds.includes(pid));

  if (unknown.length) {
    throw AppError.notFound(`Product not found: ${unknown.join(', ')}`, ERROR_CODE.NOT_FOUND);
  }

  await prisma.$transaction(async (tx) => {
    if (replace) {
      await tx.collectionProduct.deleteMany({ where: { collectionId: id } });
    }

    const existing = await tx.collectionProduct.findMany({
      where: { collectionId: id },
      select: { productId: true },
    });
    const have = new Set(existing.map((e) => e.productId));

    const toInsert = validIds
      .filter((pid) => !have.has(pid))
      .map((productId, index) => ({ collectionId: id, productId, sortOrder: index + 1 }));

    if (toInsert.length) {
      await tx.collectionProduct.createMany({ data: toInsert, skipDuplicates: true });
    }
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.UPDATE,
    entity: 'Collection',
    entityId: id,
    description: `Collection membership updated (${validIds.length} products)`,
    meta: { replace },
  });

  return { collectionId: id, productCount: validIds.length };
};

/**
 * Resolves the products in a collection.
 * MANUAL uses the explicit membership table; DYNAMIC evaluates `rules`.
 */
export const getCollectionProducts = async (
  id: string,
  query: any,
): Promise<{ rows: any[]; total: number }> => {
  const collection = await getCollectionById(id, false);
  const { limit, skip } = getPagination(query);

  const rules = D.obj(collection.rules);
  const isDynamic = collection.type === COLLECTION_TYPE.DYNAMIC;

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    status: PRODUCT_STATUS.ACTIVE,
    vendor: { is: { status: 'APPROVED', deletedAt: null } },
    ...(isDynamic
      ? {
          ...(D.arr(rules.vendorIds).length ? { vendorId: { in: D.arr(rules.vendorIds) } } : {}),
          ...(D.arr(rules.categoryIds).length
            ? { categoryId: { in: D.arr(rules.categoryIds) } }
            : {}),
          ...(D.arr(rules.brandIds).length ? { brandId: { in: D.arr(rules.brandIds) } } : {}),
          ...(D.arr(rules.tagIds).length
            ? { tags: { some: { tagId: { in: D.arr(rules.tagIds) } } } }
            : {}),
          ...(rules.minPrice !== undefined || rules.maxPrice !== undefined
            ? {
                price: {
                  ...(rules.minPrice !== undefined ? { gte: Number(rules.minPrice) } : {}),
                  ...(rules.maxPrice !== undefined ? { lte: Number(rules.maxPrice) } : {}),
                },
              }
            : {}),
          ...(rules.minRating !== undefined ? { rating: { gte: Number(rules.minRating) } } : {}),
          ...(rules.inStockOnly === true ? { stock: { gt: 0 } } : {}),
          ...(rules.isFeatured === true ? { isFeatured: true } : {}),
        }
      : { id: { in: await membershipIds(id) } }),
  };

  const sortField = D.str(rules.sortBy) || 'createdAt';
  const sortDirection = D.str(rules.sortDirection) === 'asc' ? 'asc' : 'desc';

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: Math.min(limit, D.num(rules.limit) || 100),
      orderBy: [{ [sortField]: sortDirection } as any, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        price: true,
        mrpPrice: true,
        stock: true,
        status: true,
        images: { select: { url: true, sortOrder: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return { rows, total };
};

const membershipIds = async (collectionId: string): Promise<string[]> => {
  const rows = await prisma.collectionProduct.findMany({
    where: { collectionId },
    select: { productId: true },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((r) => r.productId);
};
