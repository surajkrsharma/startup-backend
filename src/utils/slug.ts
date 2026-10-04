import slugifyLib from 'slugify';
import { nanoid } from 'nanoid';
import { SLUG } from '../config/password.config';
import { prisma } from '../services/prisma.service';
import {
  ORDER_NUMBER_PREFIX,
  RETURN_NUMBER_PREFIX,
  TICKET_NUMBER_PREFIX,
} from '../constants/countries';

export const toSlug = (value: string): string =>
  slugifyLib(String(value ?? ''), {
    lower: true,
    strict: true,
    trim: true,
    replacement: SLUG.SEPARATOR,
  }).slice(0, SLUG.MAX_LENGTH);

export const uniqueSlug = async (
  value: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> => {
  const base = toSlug(value) || nanoid(8).toLowerCase();

  if (!(await exists(base))) return base;

  for (let suffix = 2; suffix <= SLUG.MAX_SUFFIX; suffix += 1) {
    const candidate = `${base}${SLUG.SEPARATOR}${suffix}`.slice(0, SLUG.MAX_LENGTH);
    if (!(await exists(candidate))) return candidate;
  }

  return `${base}${SLUG.SEPARATOR}${nanoid(6).toLowerCase()}`.slice(0, SLUG.MAX_LENGTH);
};

export const uniqueProductSlug = (value: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

export const uniqueCategorySlug = (value: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

export const uniqueBrandSlug = (value: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.brand.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

export const uniqueCollectionSlug = (value: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.collection.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

export const uniqueTagSlug = (value: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.tag.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

export const uniqueBannerSlug = (value: string, excludeId?: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.banner.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row) && row!.id !== excludeId;
  });

export const uniqueBlogSlug = (value: string, excludeId?: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.blog.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row) && row!.id !== excludeId;
  });

export const uniquePageSlug = (value: string, excludeId?: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.page.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row) && row!.id !== excludeId;
  });

export const uniqueAttributeSlug = (value: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.attribute.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

export const uniqueVendorSlug = (value: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.vendorProfile.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

export const uniqueFlashSaleSlug = (value: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.flashSale.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

export const uniqueReturnReasonSlug = (value: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.returnReason.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

export const uniqueTicketCategorySlug = (value: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.ticketCategory.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

export const uniqueFunnelSlug = (value: string) =>
  uniqueSlug(value, async (slug) => {
    const row = await prisma.funnel.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

export const generateOrderNumber = (): string =>
  `${ORDER_NUMBER_PREFIX}${Date.now().toString().slice(-8)}${nanoid(6).toUpperCase()}`;

export const generateReturnNumber = (): string =>
  `${RETURN_NUMBER_PREFIX}${Date.now().toString().slice(-8)}${nanoid(4).toUpperCase()}`;

export const generateTicketNumber = (): string =>
  `${TICKET_NUMBER_PREFIX}${Date.now().toString().slice(-8)}${nanoid(4).toUpperCase()}`;

export const generateAwb = (): string => `AWB${nanoid(14).toUpperCase()}`;

export const generateCode = (length = 10): string =>
  nanoid(length)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .padEnd(length, 'X');
