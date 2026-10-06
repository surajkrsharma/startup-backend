import { Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D, money, round } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { ERROR_CODE } from '../../constants/http';
import { VALIDATION } from '../../messages/validation';
import {
  ADMIN_ACTION,
  PRODUCT_CONDITION,
  PRODUCT_STATUS,
  ProductStatus,
  isAdminRole,
} from '../../constants/roles';
import { getPagination } from '../../utils/pagination';
import { uniqueProductSlug, generateAwb, toSlug } from '../../utils/slug';
import { toDayKey } from '../../utils/dates';
import { writeActivityLog, writeAuditLog, diffChanges } from '../../services/audit.service';
import { uploadToCloudinary, deleteFromCloudinary } from '../../services/cloudinary.service';
import { deleteTempFiles } from '../../middlewares/upload.middleware';
import {
  getCatalogConfig,
  getDefaultGstPercent,
  getMaxImagesPerProduct,
  getVendorMaxProducts,
} from '../../services/settings.service';
import { BulkResult, ProductFilters, PriceChangeType, StockResult } from './product.types';

export const requireApprovedVendor = async (vendorId: string): Promise<any> => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: { id: true, status: true, shopName: true, deletedAt: true },
  });

  if (!vendor || vendor.deletedAt) {
    throw AppError.notFound(ERROR.VENDOR.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }

  if (vendor.status !== 'APPROVED') {
    throw new AppError(ERROR.VENDOR.NOT_APPROVED, 403, ERROR_CODE.VENDOR_NOT_APPROVED);
  }

  return vendor;
};

export const requireOwnProduct = async (
  productId: string,
  req: any,
): Promise<{ id: string; vendorId: string; status: string }> => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, vendorId: true, status: true, deletedAt: true },
  });

  if (!product || product.deletedAt) {
    throw AppError.notFound(ERROR.PRODUCT.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }

  const isAdmin = isAdminRole(D.str(req?.auth?.role));
  if (!isAdmin && product.vendorId !== req?.auth?.vendorId) {
    throw AppError.forbidden(ERROR.COMMON.FORBIDDEN, ERROR_CODE.FORBIDDEN);
  }

  return product;
};

const PRODUCT_INCLUDE = {
  images: { orderBy: { sortOrder: 'asc' } },
  variants: { orderBy: { sortOrder: 'asc' } },
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  vendor: { select: { id: true, shopName: true, slug: true, status: true, rating: true } },
  attributes: { include: { attribute: { select: { id: true, name: true } } } },
  tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
  reviews: {
    where: { status: 'APPROVED' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.ProductInclude;

const PRODUCT_SUMMARY_SELECT = {
  id: true,
  vendorId: true,
  name: true,
  slug: true,
  sku: true,
  price: true,
  mrpPrice: true,
  stock: true,
  condition: true,
  warrantyMonths: true,
  isNonReturnable: true,
  status: true,
  isFeatured: true,
  soldCount: true,
  viewCount: true,
  rating: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  vendor: { select: { id: true, shopName: true, slug: true } },
  images: { select: { url: true, sortOrder: true } },
} satisfies Prisma.ProductSelect;

const resolveStatus = async (input: any): Promise<ProductStatus> => {
  if (input.status) return input.status;

  const stock = D.num(input.stock);
  return stock > 0 ? PRODUCT_STATUS.ACTIVE : PRODUCT_STATUS.DRAFT;
};

const buildCreateData = async (
  vendorId: string,
  input: any,
): Promise<Prisma.ProductUncheckedCreateInput> => {
  const defaultTax = await getDefaultGstPercent();
  const slug = await uniqueProductSlug(D.str(input.slug) || D.str(input.name));
  const status = await resolveStatus(input);

  const variants = D.arr(input.variants).map((v: any, index: number) => ({
    sku: D.str(v?.sku),
    title: D.str(v?.title),
    attributes: D.obj(v?.attributes) as Prisma.InputJsonValue,
    price: money(v?.price ?? input.price),
    mrpPrice: money(v?.mrpPrice ?? input.mrpPrice ?? 0),
    stock: D.num(v?.stock),
    isActive: v?.isActive !== false,
    sortOrder: index,
  }));

  const images = D.arr(input.images).map((img: any, index: number) => ({
    url: D.str(img?.url),
    publicId: D.str(img?.publicId),
    altText: D.str(img?.altText) || D.str(input.name),
    sortOrder: D.num(img?.sortOrder) || index,
  }));

  const data: Prisma.ProductUncheckedCreateInput = {
    vendorId,
    categoryId: D.str(input.categoryId) || null,
    brandId: D.str(input.brandId) || null,
    name: D.str(input.name),
    slug,
    description: D.str(input.description),
    sku: D.str(input.sku),
    price: money(input.price),
    mrpPrice: money(input.mrpPrice ?? input.price),
    costPrice: money(input.costPrice ?? 0),
    taxPercent: Number(input.taxPercent ?? defaultTax),
    stock: D.num(input.stock),
    lowStockThreshold: D.num(input.lowStockThreshold ?? 5),
    weight: Number(input.weight ?? 0),
    allowBackorder: Boolean(input.allowBackorder),
    condition: D.str(input.condition) || PRODUCT_CONDITION.NEW,
    warrantyMonths: D.num(input.warrantyMonths),
    warrantySummary: D.str(input.warrantySummary),
    isNonReturnable: Boolean(input.isNonReturnable),
    status,
    isFeatured: Boolean(input.isFeatured),
  };

  if (images.length) {
    data.images = { create: images };
  }
  if (variants.length) {
    data.variants = { create: variants };
  }

  const attributes = D.arr(input.attributes);
  if (attributes.length) {
    data.attributes = {
      create: attributes.map((a: any) => ({
        attributeId: D.str(a?.attributeId),
        value: D.str(a?.value),
      })),
    };
  }

  const tagIds = D.arr(input.tagIds).map((t: any) => String(t));
  if (tagIds.length) {
    data.tags = { create: tagIds.map((tagId) => ({ tagId })) };
  }

  return data;
};

const validateReferences = async (input: any): Promise<void> => {
  const [category, brand, tags] = await Promise.all([
    D.str(input.categoryId)
      ? prisma.category.findUnique({
          where: { id: D.str(input.categoryId) },
          select: { id: true, deletedAt: true },
        })
      : null,
    D.str(input.brandId)
      ? prisma.brand.findUnique({
          where: { id: D.str(input.brandId) },
          select: { id: true, deletedAt: true },
        })
      : null,
    D.arr(input.tagIds).length
      ? prisma.tag.findMany({ where: { id: { in: D.arr(input.tagIds) } }, select: { id: true } })
      : [],
  ]);

  if (D.str(input.categoryId) && (!category || category.deletedAt)) {
    throw AppError.notFound(ERROR.CATEGORY.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }
  if (D.str(input.brandId) && (!brand || brand.deletedAt)) {
    throw AppError.notFound(ERROR.BRAND.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }
  if (D.arr(input.tagIds).length && tags.length !== new Set(D.arr(input.tagIds)).size) {
    throw AppError.notFound(ERROR.TAG.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }
};

export const createProduct = async (vendorId: string, input: any, req?: any): Promise<any> => {
  await requireApprovedVendor(vendorId);
  await validateReferences(input);

  const maxProducts = await getVendorMaxProducts();
  const existingCount = await prisma.product.count({
    where: { vendorId, deletedAt: null },
  });

  if (existingCount >= maxProducts) {
    throw AppError.unprocessable(ERROR.VENDOR.MAX_PRODUCTS_REACHED, ERROR_CODE.VALIDATION_ERROR);
  }

  const maxImages = await getMaxImagesPerProduct();
  if (D.arr(input.images).length > maxImages) {
    throw AppError.badRequest(ERROR.PRODUCT.IMAGE_LIMIT_EXCEEDED, ERROR_CODE.IMAGE_LIMIT_EXCEEDED);
  }

  const data = await buildCreateData(vendorId, input);

  const product = await prisma.product.create({
    data,
    include: PRODUCT_INCLUDE,
  });

  void writeActivityLog({
    req,
    userId: req?.auth?.userId,
    action: 'PRODUCT_CREATED',
    entity: 'Product',
    entityId: product.id,
    meta: { name: product.name, vendorId },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.CREATE,
    entity: 'Product',
    entityId: product.id,
    description: `Product created: ${product.name}`,
    meta: { vendorId, price: product.price, stock: product.stock },
  });

  return product;
};

export const getProductById = async (productId: string): Promise<any> => {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: PRODUCT_INCLUDE,
  });

  if (!product) throw AppError.notFound(ERROR.PRODUCT.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return product;
};

export const getProductBySlug = async (slug: string): Promise<any> => {
  const product = await prisma.product.findFirst({
    where: { slug, deletedAt: null },
    include: PRODUCT_INCLUDE,
  });

  if (!product) throw AppError.notFound(ERROR.PRODUCT.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  void prisma.product
    .update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } })
    .catch(() => undefined);

  return product;
};

export const updateProduct = async (productId: string, input: any, req?: any): Promise<any> => {
  await requireOwnProduct(productId, req);
  await validateReferences(input);

  const before = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      mrpPrice: true,
      stock: true,
      status: true,
      isFeatured: true,
      condition: true,
      warrantyMonths: true,
      isNonReturnable: true,
      categoryId: true,
      brandId: true,
      taxPercent: true,
    },
  });

  const data: Prisma.ProductUncheckedUpdateInput = {};

  if (input.name !== undefined) data.name = D.str(input.name);
  if (input.description !== undefined) data.description = D.str(input.description);
  if (input.sku !== undefined) data.sku = D.str(input.sku);
  if (input.price !== undefined) data.price = money(input.price);
  if (input.mrpPrice !== undefined) data.mrpPrice = money(input.mrpPrice);
  if (input.costPrice !== undefined) data.costPrice = money(input.costPrice);
  if (input.taxPercent !== undefined) data.taxPercent = Number(input.taxPercent);
  if (input.stock !== undefined) data.stock = D.num(input.stock);
  if (input.lowStockThreshold !== undefined)
    data.lowStockThreshold = D.num(input.lowStockThreshold);
  if (input.weight !== undefined) data.weight = Number(input.weight);
  if (input.allowBackorder !== undefined) data.allowBackorder = Boolean(input.allowBackorder);
  if (input.condition !== undefined) data.condition = D.str(input.condition);
  if (input.warrantyMonths !== undefined) data.warrantyMonths = D.num(input.warrantyMonths);
  if (input.warrantySummary !== undefined) data.warrantySummary = D.str(input.warrantySummary);
  if (input.isNonReturnable !== undefined) data.isNonReturnable = Boolean(input.isNonReturnable);
  if (input.status !== undefined) data.status = input.status as ProductStatus;
  if (input.isFeatured !== undefined) data.isFeatured = Boolean(input.isFeatured);
  if (input.categoryId !== undefined) data.categoryId = D.str(input.categoryId) || null;
  if (input.brandId !== undefined) data.brandId = D.str(input.brandId) || null;

  if (input.slug !== undefined && D.str(input.slug) !== '') {
    const taken = await prisma.product.findFirst({
      where: { slug: D.str(input.slug), NOT: { id: productId } },
      select: { id: true },
    });
    if (taken) throw AppError.conflict(ERROR.PRODUCT.SLUG_TAKEN, ERROR_CODE.DUPLICATE);
    data.slug = D.str(input.slug);
  }

  if (!Object.keys(data).length && !D.arr(input.images).length && !D.arr(input.variants).length) {
    throw AppError.badRequest(ERROR.COMMON.VALIDATION_FAILED, ERROR_CODE.VALIDATION_ERROR);
  }

  const product = await prisma.$transaction(async (tx) => {
    const variants = D.arr(input.variants) as any[];

    if (variants.length) {
      for (const variant of variants) {
        if (!D.str(variant?.id)) continue;
        await tx.productVariant.updateMany({
          where: { id: D.str(variant.id), productId },
          data: {
            ...(variant.price !== undefined ? { price: money(variant.price) } : {}),
            ...(variant.mrpPrice !== undefined ? { mrpPrice: money(variant.mrpPrice) } : {}),
            ...(variant.stock !== undefined ? { stock: D.num(variant.stock) } : {}),
            ...(variant.isActive !== undefined ? { isActive: Boolean(variant.isActive) } : {}),
            ...(variant.sku !== undefined ? { sku: D.str(variant.sku) } : {}),
            ...(variant.title !== undefined ? { title: D.str(variant.title) } : {}),
          },
        });
      }
    }

    if (D.arr(input.tagIds).length) {
      const nextTagIds = (D.arr(input.tagIds) as any[]).map((t) => String(t));
      await tx.productTag.deleteMany({ where: { productId } });
      await tx.productTag.createMany({
        data: nextTagIds.map((tagId) => ({ productId, tagId })),
        skipDuplicates: true,
      });
    }

    if (D.arr(input.attributes).length) {
      for (const attr of D.arr(input.attributes) as any[]) {
        await tx.productAttributeValue.upsert({
          where: { productId_attributeId: { productId, attributeId: D.str(attr?.attributeId) } },
          create: { productId, attributeId: D.str(attr?.attributeId), value: D.str(attr?.value) },
          update: { value: D.str(attr?.value) },
        });
      }
    }

    return tx.product.update({
      where: { id: productId },
      data: Object.keys(data).length ? data : {},
      include: PRODUCT_INCLUDE,
    });
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.UPDATE,
    entity: 'Product',
    entityId: productId,
    description: `Product updated: ${product.name}`,
    changes: diffChanges(before, product),
  });

  return product;
};

export const deleteProduct = async (productId: string, req?: any): Promise<boolean> => {
  await requireOwnProduct(productId, req);

  await prisma.product.update({
    where: { id: productId },
    data: { deletedAt: new Date(), status: PRODUCT_STATUS.ARCHIVED, isFeatured: false },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.DELETE,
    entity: 'Product',
    entityId: productId,
    description: 'Product soft deleted (archived)',
    meta: { softDelete: true },
  });

  return true;
};

export const updateStock = async (
  productId: string,
  input: { stock: number; variantId?: string; lowStockThreshold?: number },
  req?: any,
): Promise<StockResult> => {
  await requireOwnProduct(productId, req);

  const stock = D.num(input.stock);

  if (D.str(input.variantId)) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: D.str(input.variantId), productId },
      select: { id: true },
    });
    if (!variant) throw AppError.notFound(ERROR.PRODUCT.INVALID_VARIANT, ERROR_CODE.NOT_FOUND);

    await prisma.productVariant.update({ where: { id: variant.id }, data: { stock } });

    return {
      productId,
      variantId: variant.id,
      previousStock: 0,
      stock,
      isLowStock: stock <= 5,
    };
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { stock: true, lowStockThreshold: true },
  });

  if (!product) throw AppError.notFound(ERROR.PRODUCT.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const updated = await prisma.product.update({
    where: { id: productId },
    data: {
      stock,
      ...(input.lowStockThreshold !== undefined
        ? { lowStockThreshold: D.num(input.lowStockThreshold) }
        : {}),
    },
    select: { stock: true, lowStockThreshold: true },
  });

  void writeActivityLog({
    req,
    userId: req?.auth?.userId,
    action: 'STOCK_UPDATED',
    entity: 'Product',
    entityId: productId,
    meta: { from: product.stock, to: updated.stock },
  });

  return {
    productId,
    variantId: '',
    previousStock: product.stock,
    stock: updated.stock,
    isLowStock: updated.stock <= updated.lowStockThreshold,
  };
};

export const toggleStatus = async (
  productId: string,
  status: ProductStatus,
  req?: any,
): Promise<any> => {
  const before = await requireOwnProduct(productId, req);

  const product = await prisma.product.update({
    where: { id: productId },
    data: { status },
    include: PRODUCT_INCLUDE,
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.TOGGLE,
    entity: 'Product',
    entityId: productId,
    description: `Product status ${before.status} -> ${status}`,
    changes: { status: { from: before.status, to: status } },
  });

  return product;
};

export const uploadImages = async (
  productId: string,
  files: Express.Multer.File[],
  req?: any,
): Promise<any> => {
  await requireOwnProduct(productId, req);

  const maxImages = await getMaxImagesPerProduct();

  const current = await prisma.productImage.count({ where: { productId } });

  if (current + files.length > maxImages) {
    await deleteTempFiles(files);
    throw AppError.badRequest(ERROR.PRODUCT.IMAGE_LIMIT_EXCEEDED, ERROR_CODE.IMAGE_LIMIT_EXCEEDED);
  }

  const uploaded: { url: string; publicId: string; altText: string; sortOrder: number }[] = [];

  try {
    for (const file of files) {
      const asset = await uploadToCloudinary(file.path, 'products');
      uploaded.push({
        url: asset.url,
        publicId: asset.publicId,
        altText: toSlug(path.basename(file.originalname)) || '',
        sortOrder: current + uploaded.length,
      });
    }
  } finally {
    await deleteTempFiles(files);
  }

  if (uploaded.length) {
    await prisma.productImage.createMany({ data: uploaded.map((i) => ({ productId, ...i })) });
  }

  const images = await prisma.productImage.findMany({
    where: { productId },
    orderBy: { sortOrder: 'asc' },
  });

  void writeActivityLog({
    req,
    userId: req?.auth?.userId,
    action: 'PRODUCT_IMAGES_UPLOADED',
    entity: 'Product',
    entityId: productId,
    meta: { added: uploaded.length },
  });

  return { productId, images, maxImages, isOverLimit: images.length > maxImages };
};

export const deleteImage = async (
  productId: string,
  imageId: string,
  req?: any,
): Promise<boolean> => {
  await requireOwnProduct(productId, req);

  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
    select: { id: true, publicId: true },
  });

  if (!image) throw AppError.notFound(ERROR.COMMON.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  await prisma.productImage.delete({ where: { id: image.id } });

  if (D.str(image.publicId)) {
    void deleteFromCloudinary(image.publicId).catch(() => undefined);
  }

  return true;
};

export const listProducts = async (
  query: any,
  req?: any,
): Promise<{ rows: any[]; total: number; filters: ProductFilters }> => {
  const { page, limit, skip } = getPagination(query);
  const catalog = await getCatalogConfig();

  const filters: ProductFilters = {
    page,
    limit,
    skip,
    search: D.str(query?.search),
    categoryId: D.str(query?.categoryId),
    categorySlug: D.str(query?.categorySlug),
    brandId: D.str(query?.brandId),
    vendorId: D.str(query?.vendorId),
    tagIds: D.arr(query?.tagIds),
    minPrice: query?.minPrice !== undefined ? Number(query.minPrice) : null,
    maxPrice: query?.maxPrice !== undefined ? Number(query.maxPrice) : null,
    inStock: query?.inStock === true,
    isFeatured: query?.isFeatured === true,
    status: (D.str(query?.status) as ProductStatus) || '',
    rating: query?.rating !== undefined ? Number(query.rating) : null,
    excludeProductId: D.str(query?.excludeProductId),
  };

  let categoryIds: string[] = [];
  if (filters.categorySlug) {
    const category = await prisma.category.findUnique({
      where: { slug: filters.categorySlug },
      select: { id: true },
    });
    if (category) {
      const children = await prisma.category.findMany({
        where: { parentId: category.id, deletedAt: null },
        select: { id: true },
      });
      categoryIds = [category.id, ...children.map((c) => c.id)];
    }
  }

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,

    vendor: { is: { status: 'APPROVED', deletedAt: null } },
    ...(filters.categoryId
      ? { categoryId: filters.categoryId }
      : categoryIds.length
        ? { categoryId: { in: categoryIds } }
        : {}),
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
    ...(filters.vendorId ? { vendorId: filters.vendorId } : {}),
    ...(filters.tagIds.length ? { tags: { some: { tagId: { in: filters.tagIds } } } } : {}),
    ...(filters.minPrice !== null || filters.maxPrice !== null
      ? {
          price: {
            ...(filters.minPrice !== null ? { gte: filters.minPrice } : {}),
            ...(filters.maxPrice !== null ? { lte: filters.maxPrice } : {}),
          },
        }
      : {}),
    ...(filters.inStock ? { stock: { gt: 0 } } : {}),
    ...(filters.isFeatured ? { isFeatured: true } : {}),
    ...(filters.rating !== null ? { rating: { gte: filters.rating } } : {}),
    ...(filters.excludeProductId ? { NOT: { id: filters.excludeProductId } } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { description: { contains: filters.search, mode: 'insensitive' } },
            { sku: { contains: filters.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  if (req?.auth?.role === 'VENDOR' && req.auth.vendorId) {
    where.OR = undefined;
    where.vendorId = req.auth.vendorId;
    if (filters.status) {
      where.status = filters.status;
    }
  } else if (isAdminRole(D.str(req?.auth?.role))) {
    if (filters.status) {
      where.status = filters.status;
    }
  } else {
    where.status = filters.status || PRODUCT_STATUS.ACTIVE;

    if (!catalog.showOutOfStock) {
      where.stock = { gt: 0 };
    }
  }

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ createdAt: 'desc' }],
      select: PRODUCT_SUMMARY_SELECT,
    }),
    prisma.product.count({ where }),
  ]);

  return { rows, total, filters };
};

export const getFilters = async (query: any): Promise<any> => {
  const baseWhere: Prisma.ProductWhereInput = {
    deletedAt: null,
    status: PRODUCT_STATUS.ACTIVE,
    vendor: { is: { status: 'APPROVED', deletedAt: null } },
    ...(D.str(query?.categoryId) ? { categoryId: D.str(query.categoryId) } : {}),
    ...(D.str(query?.vendorId) ? { vendorId: D.str(query.vendorId) } : {}),
    ...(D.str(query?.brandId) ? { brandId: D.str(query.brandId) } : {}),
  };

  const [grouped, priceAgg, attributeValues] = await Promise.all([
    prisma.product.groupBy({
      by: ['categoryId', 'brandId', 'vendorId'],
      where: baseWhere,
      _count: { _all: true },
    }),
    prisma.product.aggregate({ where: baseWhere, _min: { price: true }, _max: { price: true } }),
    prisma.productAttributeValue.groupBy({
      by: ['attributeId', 'value'],
      where: { product: baseWhere },
      _count: { _all: true },
    }),
  ]);

  const categoryMap = new Map<string, number>();
  const brandMap = new Map<string, number>();
  const vendorMap = new Map<string, number>();

  for (const row of grouped) {
    if (row.categoryId)
      categoryMap.set(row.categoryId, (categoryMap.get(row.categoryId) ?? 0) + row._count._all);
    if (row.brandId) brandMap.set(row.brandId, (brandMap.get(row.brandId) ?? 0) + row._count._all);
    if (row.vendorId)
      vendorMap.set(row.vendorId, (vendorMap.get(row.vendorId) ?? 0) + row._count._all);
  }

  const [categories, brands, vendors, attributes] = await Promise.all([
    prisma.category.findMany({
      where: { id: { in: Array.from(categoryMap.keys()) } },
      select: { id: true, name: true },
    }),
    prisma.brand.findMany({
      where: { id: { in: Array.from(brandMap.keys()) } },
      select: { id: true, name: true },
    }),
    prisma.vendorProfile.findMany({
      where: { id: { in: Array.from(vendorMap.keys()) } },
      select: { id: true, shopName: true },
    }),
    prisma.attribute.findMany({
      where: { id: { in: Array.from(new Set(attributeValues.map((v) => v.attributeId))) } },
      select: { id: true, name: true },
    }),
  ]);

  return {
    categories: categories.map((c) => ({
      value: c.id,
      label: c.name,
      count: categoryMap.get(c.id) ?? 0,
    })),
    brands: brands.map((b) => ({ value: b.id, label: b.name, count: brandMap.get(b.id) ?? 0 })),
    vendors: vendors.map((v) => ({
      value: v.id,
      label: v.shopName,
      count: vendorMap.get(v.id) ?? 0,
    })),
    priceRange: {
      min: money(priceAgg._min.price ?? 0),
      max: money(priceAgg._max.price ?? 0),
    },
    attributes: attributes.map((attr) => ({
      attributeId: attr.id,
      name: attr.name,
      values: attributeValues
        .filter((v) => v.attributeId === attr.id)
        .map((v) => ({ value: v.value, label: v.value, count: v._count._all })),
    })),
  };
};

export const getRelated = async (productId: string, limit = 12): Promise<any[]> => {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, categoryId: true, brandId: true, vendorId: true },
  });

  if (!product) throw AppError.notFound(ERROR.PRODUCT.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const rows = await prisma.product.findMany({
    where: {
      id: { not: product.id },
      deletedAt: null,
      status: PRODUCT_STATUS.ACTIVE,
      vendor: { is: { status: 'APPROVED', deletedAt: null } },
      OR: [
        ...(product.categoryId ? [{ categoryId: product.categoryId }] : []),
        ...(product.brandId ? [{ brandId: product.brandId }] : []),
      ],
    },
    take: Math.min(limit, 50),
    orderBy: [{ isFeatured: 'desc' }, { rating: 'desc' }, { soldCount: 'desc' }],
    select: PRODUCT_SUMMARY_SELECT,
  });

  return rows;
};

export const getRecommended = async (query: any, req?: any): Promise<any[]> => {
  const { limit } = getPagination(query);

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    status: PRODUCT_STATUS.ACTIVE,
    vendor: { is: { status: 'APPROVED', deletedAt: null } },
    ...(req?.auth?.userId
      ? {
          OR: [
            { categoryId: { in: await recentCategoryIds(req.auth.userId) } },
            { brandId: { in: await recentBrandIds(req.auth.userId) } },
          ],
        }
      : {}),
  };

  return prisma.product.findMany({
    where,
    take: Math.min(limit, 50),
    orderBy: [{ isFeatured: 'desc' }, { rating: 'desc' }, { soldCount: 'desc' }],
    select: PRODUCT_SUMMARY_SELECT,
  });
};

const recentCategoryIds = async (userId: string): Promise<string[]> => {
  const viewed = await prisma.recentlyViewed.findMany({
    where: { userId },
    take: 20,
    orderBy: { viewedAt: 'desc' },
    select: { product: { select: { categoryId: true } } },
  });
  return Array.from(
    new Set(viewed.map((v) => v.product?.categoryId).filter((id): id is string => Boolean(id))),
  );
};

const recentBrandIds = async (userId: string): Promise<string[]> => {
  const viewed = await prisma.recentlyViewed.findMany({
    where: { userId },
    take: 20,
    orderBy: { viewedAt: 'desc' },
    select: { product: { select: { brandId: true } } },
  });
  return Array.from(
    new Set(viewed.map((v) => v.product?.brandId).filter((id): id is string => Boolean(id))),
  );
};

export const getFrequentlyBought = async (
  productId: string,
  limit = 10,
): Promise<{ product: any; boughtCount: number }[]> => {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, categoryId: true },
  });

  if (!product) throw AppError.notFound(ERROR.PRODUCT.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const orders = await prisma.orderItem.findMany({
    where: { productId },
    select: { orderId: true },
    take: 200,
    distinct: ['orderId'],
  });

  const orderIds = orders.map((o) => o.orderId);
  if (!orderIds.length) return [];

  const siblings = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: { orderId: { in: orderIds }, productId: { not: productId } },
    _count: { _all: true },
    orderBy: { _count: { productId: 'desc' } },
    take: Math.min(limit, 50),
  });

  if (!siblings.length) return [];

  const products = await prisma.product.findMany({
    where: {
      id: { in: siblings.map((s) => s.productId) },
      deletedAt: null,
      status: PRODUCT_STATUS.ACTIVE,
    },
    select: PRODUCT_SUMMARY_SELECT,
  });

  const countMap = new Map(siblings.map((s) => [s.productId, s._count._all]));

  return products
    .map((p) => ({ product: p, boughtCount: countMap.get(p.id) ?? 0 }))
    .sort((a, b) => b.boughtCount - a.boughtCount);
};

export const getRecentlyViewed = async (query: any, req?: any): Promise<any[]> => {
  const { limit } = getPagination(query);

  if (!req?.auth?.userId) return [];

  return prisma.recentlyViewed.findMany({
    where: { userId: req.auth.userId },
    take: Math.min(limit, 50),
    orderBy: { viewedAt: 'desc' },
    distinct: ['productId'],
    select: {
      viewedAt: true,
      product: { select: PRODUCT_SUMMARY_SELECT },
    },
  });
};

export const trackView = async (
  productId: string,
  req?: any,
): Promise<{ productId: string; viewCount: number }> => {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, viewCount: true },
  });

  if (!product) throw AppError.notFound(ERROR.PRODUCT.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const updated = await prisma.product.update({
    where: { id: productId },
    data: { viewCount: { increment: 1 } },
    select: { viewCount: true },
  });

  if (req?.auth?.userId || req?.sessionKey) {
    void prisma.recentlyViewed
      .create({
        data: {
          productId,
          userId: req?.auth?.userId ?? null,
          sessionKey: D.str(req?.sessionKey),
        },
      })
      .catch(() => undefined);
  }

  return { productId, viewCount: updated.viewCount };
};

export const bulkCreate = async (
  vendorId: string,
  input: { products: any[]; continueOnError: boolean },
  req?: any,
): Promise<BulkResult & { products: any[] }> => {
  await requireApprovedVendor(vendorId);

  const maxProducts = await getVendorMaxProducts();
  const currentCount = await prisma.product.count({ where: { vendorId, deletedAt: null } });

  if (currentCount + input.products.length > maxProducts) {
    throw AppError.unprocessable(ERROR.VENDOR.MAX_PRODUCTS_REACHED, ERROR_CODE.VALIDATION_ERROR);
  }

  const errors: { row: number; message: string }[] = [];
  const created: any[] = [];

  for (const [index, item] of input.products.entries()) {
    try {
      if (!(Number(item.price) > 0)) {
        throw AppError.badRequest(VALIDATION.INVALID_PRICE, ERROR_CODE.VALIDATION_ERROR);
      }
      if (Number(item.stock ?? 0) < 0) {
        throw AppError.badRequest(
          VALIDATION.NEGATIVE_NOT_ALLOWED('stock'),
          ERROR_CODE.VALIDATION_ERROR,
        );
      }

      await validateReferences(item);
      const product = await prisma.product.create({
        data: await buildCreateData(vendorId, item),
        select: { id: true, name: true, slug: true, price: true, stock: true, status: true },
      });
      created.push(product);
    } catch (err) {
      const message = (err as AppError)?.message ?? 'Failed to create product.';
      if (!input.continueOnError) throw err;
      errors.push({ row: index + 1, message });
    }
  }

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.IMPORT,
    entity: 'Product',
    entityId: vendorId,
    description: `Bulk created ${created.length}/${input.products.length} products`,
    meta: { failed: errors.length },
  });

  return { successCount: created.length, failCount: errors.length, errors, products: created };
};

export const bulkUpdate = async (
  input: { productIds: string[]; updates: Record<string, any> },
  req?: any,
): Promise<BulkResult & { updated: any[] }> => {
  const isAdmin = isAdminRole(D.str(req?.auth?.role));

  const owned = isAdmin
    ? input.productIds
    : (
        await prisma.product.findMany({
          where: { id: { in: input.productIds }, vendorId: D.str(req?.auth?.vendorId) },
          select: { id: true },
        })
      ).map((p) => p.id);

  const forbidden = input.productIds.filter((id) => !owned.includes(id));

  const data: Prisma.ProductUpdateManyMutationInput = {};
  if (input.updates.status !== undefined) data.status = input.updates.status as ProductStatus;
  if (input.updates.isFeatured !== undefined) data.isFeatured = Boolean(input.updates.isFeatured);
  if (input.updates.taxPercent !== undefined) data.taxPercent = Number(input.updates.taxPercent);
  if (input.updates.lowStockThreshold !== undefined)
    data.lowStockThreshold = D.num(input.updates.lowStockThreshold);

  const relationIds = {
    categoryId: input.updates.categoryId,
    brandId: input.updates.brandId,
  };
  const hasRelationUpdate =
    relationIds.categoryId !== undefined || relationIds.brandId !== undefined;

  if (!Object.keys(data).length && !hasRelationUpdate) {
    throw AppError.badRequest(ERROR.COMMON.VALIDATION_FAILED, ERROR_CODE.VALIDATION_ERROR);
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) {
      await tx.product.updateMany({ where: { id: { in: owned } }, data });
    }

    if (relationIds.categoryId !== undefined) {
      await tx.product.updateMany({
        where: { id: { in: owned } },
        data: { categoryId: relationIds.categoryId || null },
      });
    }
    if (relationIds.brandId !== undefined) {
      await tx.product.updateMany({
        where: { id: { in: owned } },
        data: { brandId: relationIds.brandId || null },
      });
    }

    return tx.product.findMany({
      where: { id: { in: owned } },
      select: {
        id: true,
        name: true,
        status: true,
        isFeatured: true,
        categoryId: true,
        brandId: true,
      },
    });
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.UPDATE,
    entity: 'Product',
    entityId: owned.join(','),
    description: `Bulk updated ${updated.length} products`,
    meta: { updates: Object.keys(input.updates) },
  });

  return {
    successCount: updated.length,
    failCount: forbidden.length,
    errors: forbidden.map((id) => ({ row: 0, message: `Not allowed for ${id}` })),
    updated,
  };
};

export const bulkDelete = async (productIds: string[], req?: any): Promise<BulkResult> => {
  const isAdmin = isAdminRole(D.str(req?.auth?.role));

  const owned = isAdmin
    ? productIds
    : (
        await prisma.product.findMany({
          where: { id: { in: productIds }, vendorId: D.str(req?.auth?.vendorId) },
          select: { id: true },
        })
      ).map((p) => p.id);

  const forbidden = productIds.filter((id) => !owned.includes(id));

  if (owned.length) {
    await prisma.product.updateMany({
      where: { id: { in: owned } },
      data: { deletedAt: new Date(), status: PRODUCT_STATUS.ARCHIVED, isFeatured: false },
    });
  }

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.DELETE,
    entity: 'Product',
    entityId: owned.join(','),
    description: `Bulk soft deleted ${owned.length} products`,
  });

  return {
    successCount: owned.length,
    failCount: forbidden.length,
    errors: forbidden.map((id) => ({ row: 0, message: `Not allowed for ${id}` })),
  };
};

export const bulkPriceUpdate = async (
  input: { productIds: string[]; type: PriceChangeType; value: number; roundTo: number },
  req?: any,
): Promise<{ updated: any[]; failed: string[] }> => {
  const isAdmin = isAdminRole(D.str(req?.auth?.role));

  const rows = await prisma.product.findMany({
    where: isAdmin
      ? { id: { in: input.productIds } }
      : { id: { in: input.productIds }, vendorId: D.str(req?.auth?.vendorId) },
    select: { id: true, name: true, price: true },
  });

  const failed = input.productIds.filter((id) => !rows.some((r) => r.id === id));

  const updated: any[] = [];

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const previousPrice = row.price;

      let next: number;
      if (input.type === 'FIXED') {
        next = money(row.price + input.value);
      } else if (input.type === 'PERCENT_UP') {
        next = money(row.price * (1 + input.value / 100));
      } else {
        next = money(row.price * (1 - input.value / 100));
      }

      next = Math.max(0.01, round(next, input.roundTo));

      await tx.product.update({ where: { id: row.id }, data: { price: next } });
      updated.push({ id: row.id, name: row.name, previousPrice, price: next });
    }
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.UPDATE,
    entity: 'Product',
    entityId: updated.map((u) => u.id).join(','),
    description: `Bulk price update (${input.type} ${input.value}) on ${updated.length} products`,
  });

  return { updated, failed };
};

const CSV_COLUMNS: Record<string, string[]> = {
  name: ['name', 'title', 'productname', 'product_name'],
  price: ['price', 'saleprice', 'sale_price'],
  mrpPrice: ['mrp', 'mrpprice', 'mrp_price'],
  stock: ['stock', 'quantity', 'qty', 'inventory'],
  sku: ['sku', 'code', 'productcode'],
  description: ['description', 'details'],
  categorySlug: ['category', 'categoryslug', 'category_slug'],
  brandName: ['brand', 'brandname', 'brand_name'],
};

const csvRowToProduct = (row: Record<string, any>): Record<string, any> => {
  const pick = (field: string): string => {
    for (const alias of CSV_COLUMNS[field]) {
      const key = Object.keys(row).find((k) => k.trim().toLowerCase() === alias);
      if (key && D.str(row[key])) return D.str(row[key]);
    }
    return '';
  };

  return {
    name: pick('name'),
    price: Number(pick('price')) || 0,
    ...(pick('mrpPrice') ? { mrpPrice: Number(pick('mrpPrice')) } : {}),
    stock: Number(pick('stock')) || 0,
    ...(pick('sku') ? { sku: pick('sku') } : {}),
    ...(pick('description') ? { description: pick('description') } : {}),
  };
};

export const importCsv = async (
  vendorId: string,
  filePath: string,
  input: { continueOnError?: boolean } = {},
  actorId?: string,
  req?: any,
): Promise<Record<string, any>> => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const parse = require('csv-parser');

  const rows: Record<string, any>[] = await new Promise((resolve, reject) => {
    const collected: Record<string, any>[] = [];

    fs.createReadStream(filePath)
      .pipe(parse({ headers: true, skip_empty_lines: true, trim: true }))
      .on('data', (row: Record<string, any>) => collected.push(row))
      .on('end', () => resolve(collected))
      .on('error', reject);
  });

  const products = rows.map(csvRowToProduct).filter((p) => D.str(p.name));

  if (!products.length) {
    throw AppError.badRequest(ERROR.BULK.NO_ROWS);
  }

  const result = await bulkCreate(
    vendorId,
    {
      products,
      continueOnError: input.continueOnError !== false,
    },
    req,
  );

  void writeAuditLog({
    req,
    actorId,
    action: ADMIN_ACTION.IMPORT,
    entity: 'Product',
    description: `CSV import created ${result.successCount} products (${result.failCount} failed)`,
  });

  return {
    fileName: path.basename(filePath),
    totalRowCount: rows.length,
    ...result,
  };
};

const CSV_HEADER = [
  'productId',
  'name',
  'slug',
  'sku',
  'category',
  'brand',
  'price',
  'mrpPrice',
  'stock',
  'status',
  'createdAt',
];

const csvCell = (value: unknown): string => {
  const text = D.str(value as string);

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const exportCsv = async (
  query: Record<string, any>,
  vendorId?: string,
): Promise<{ fileName: string; csv: string; totalRecord: number }> => {
  const limit = Math.min(10_000, D.num(query.limit) || 1000);

  const rows = await prisma.product.findMany({
    where: {
      deletedAt: null,
      ...(vendorId ? { vendorId } : {}),
      ...(D.str(query.categoryId) ? { categoryId: D.str(query.categoryId) } : {}),
      ...(D.str(query.status) ? { status: D.str(query.status) as ProductStatus } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  });

  const body = rows.map((p: any) =>
    [
      D.str(p.id),
      D.str(p.name),
      D.str(p.slug),
      D.str(p.sku),
      D.str(p.category?.name),
      D.str(p.brand?.name),
      D.float(p.price),
      D.float(p.mrpPrice),
      D.num(p.stock),
      D.str(p.status),
      D.date(p.createdAt),
    ]
      .map(csvCell)
      .join(','),
  );

  return {
    fileName: `products-${toDayKey(new Date()).toISOString().slice(0, 10)}.csv`,
    csv: [CSV_HEADER.join(','), ...body].join('\n'),
    totalRecord: rows.length,
  };
};

export { generateAwb };
