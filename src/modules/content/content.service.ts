import { Prisma } from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D, money } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { ERROR_CODE } from '../../constants/http';
import { COUNTRIES } from '../../constants/countries';
import { CURRENCY } from '../../config/currency.config';
import { generateCode, uniquePageSlug, uniqueBlogSlug, uniqueBannerSlug } from '../../utils/slug';
import { WebhookProvider } from '@prisma/client';
import { hmacSha256, safeCompare, hashPassword, sha256 } from '../../utils/crypto';
import { ENV } from '../../config/env.config';
import { API_KEY } from '../../config/jwt.config';
import { writeAuditLog, writeActivityLog } from '../../services/audit.service';
import { isFuture, isPast } from '../../utils/dates';
import { startOfDay, endOfDay, subtractDays } from '../../utils/dates';

/**
 * Content (pages, blog, faq, banners), contact and newsletter, geo/currency/tax
 * references, translations, dropdowns, webhooks, bulk jobs and reports.
 *
 * Content rows are soft-deleted rather than removed so an old inbound link keeps
 * resolving to a tombstone instead of a 404 that hides a real regression.
 */

// ═══ Pages ═══════════════════════════════════════════════════════════════════

export const listPages = async (
  query: Record<string, any>,
  isStaff = false,
): Promise<{ rows: any[]; total: number }> => {
  // A public caller only ever sees published pages.
  const where: Prisma.PageWhereInput = {
    deletedAt: null,
    ...(isStaff ? {} : { isPublished: true }),
  };

  if (D.str(query.isPublished) === 'true') where.isPublished = true;
  if (D.str(query.isPublished) === 'false') where.isPublished = false;

  const [rows, total] = await Promise.all([
    prisma.page.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.page.count({ where }),
  ]);

  return { rows, total };
};

export const getPageBySlug = async (slug: string, isStaff = false): Promise<any> => {
  const page = await prisma.page.findFirst({
    where: { slug: D.str(slug), deletedAt: null, ...(isStaff ? {} : { isPublished: true }) },
  });

  if (!page) throw AppError.notFound(ERROR.CONTENT.PAGE_NOT_FOUND);

  return page;
};

export const createPage = async (input: Record<string, any>, req?: any): Promise<any> => {
  const slug = await uniquePageSlug(D.str(input.slug) || D.str(input.title));

  const row = await prisma.page.create({
    data: {
      title: D.str(input.title),
      slug,
      content: D.str(input.content),
      image: D.str(input.image),
      isPublished: input.isPublished !== false,
      metaTitle: D.str(input.metaTitle),
      metaDescription: D.str(input.metaDescription),
    },
  });

  void writeAuditLog({ req, action: 'CREATE', entity: 'Page', entityId: row.id, meta: { slug } });

  return row;
};

export const updatePage = async (
  pageId: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const existing = await prisma.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.CONTENT.PAGE_NOT_FOUND);

  const row = await prisma.page.update({
    where: { id: pageId },
    data: {
      ...(input.title === undefined ? {} : { title: D.str(input.title) }),
      ...(input.slug ? { slug: await uniquePageSlug(D.str(input.slug), pageId) } : {}),
      ...(input.content === undefined ? {} : { content: D.str(input.content) }),
      ...(input.image === undefined ? {} : { image: D.str(input.image) }),
      ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }),
      ...(input.metaTitle === undefined ? {} : { metaTitle: D.str(input.metaTitle) }),
      ...(input.metaDescription === undefined
        ? {}
        : { metaDescription: D.str(input.metaDescription) }),
    },
  });

  void writeAuditLog({ req, action: 'UPDATE', entity: 'Page', entityId: pageId });

  return row;
};

export const deletePage = async (pageId: string, req?: any): Promise<void> => {
  const existing = await prisma.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.CONTENT.PAGE_NOT_FOUND);

  await prisma.page.update({
    where: { id: pageId },
    data: { deletedAt: new Date(), isPublished: false },
  });

  void writeAuditLog({ req, action: 'DELETE', entity: 'Page', entityId: pageId });
};

// ═══ Blog ════════════════════════════════════════════════════════════════════

export const listBlogs = async (
  query: Record<string, any>,
  isStaff = false,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.BlogWhereInput = {
    deletedAt: null,
    ...(isStaff ? {} : { isPublished: true }),
  };

  if (D.str(query.isPublished) === 'true') where.isPublished = true;
  if (D.str(query.isPublished) === 'false') where.isPublished = false;
  if (D.str(query.authorId)) where.authorId = D.str(query.authorId);

  // Tags are a string array, so a containment filter matches the array itself.
  if (D.str(query.tag)) where.tags = { has: D.str(query.tag) };

  const [rows, total] = await Promise.all([
    prisma.blog.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.blog.count({ where }),
  ]);

  return { rows, total };
};

export const getBlogBySlug = async (slug: string, isStaff = false): Promise<any> => {
  const post = await prisma.blog.findFirst({
    where: { slug: D.str(slug), deletedAt: null, ...(isStaff ? {} : { isPublished: true }) },
  });

  if (!post) throw AppError.notFound(ERROR.CONTENT.BLOG_NOT_FOUND);

  return post;
};

export const createBlog = async (
  input: Record<string, any>,
  authorId?: string,
  req?: any,
): Promise<any> => {
  if (D.str(input.authorId)) {
    const author = await prisma.user.findUnique({
      where: { id: D.str(input.authorId) },
      select: { id: true },
    });
    if (!author) throw AppError.notFound(ERROR.USER.NOT_FOUND);
  }

  const slug = await uniqueBlogSlug(D.str(input.slug) || D.str(input.title));

  const row = await prisma.blog.create({
    data: {
      title: D.str(input.title),
      slug,
      excerpt: D.str(input.excerpt),
      content: D.str(input.content),
      coverImage: D.str(input.coverImage),
      authorId: D.str(input.authorId) || D.str(authorId) || null,
      tags: D.strArr(input.tags),
      isPublished: input.isPublished !== false,
      publishedAt: input.isPublished === false ? null : new Date(),
    },
  });

  void writeAuditLog({ req, action: 'CREATE', entity: 'Blog', entityId: row.id, meta: { slug } });

  return row;
};

export const updateBlog = async (
  blogId: string,
  input: Record<string, any>,
  req?: any,
): Promise<Record<string, any>> => {
  const existing = await prisma.blog.findFirst({
    where: { id: blogId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.CONTENT.BLOG_NOT_FOUND);

  if (D.str(input.authorId)) {
    const author = await prisma.user.findUnique({
      where: { id: D.str(input.authorId) },
      select: { id: true },
    });
    if (!author) throw AppError.notFound(ERROR.USER.NOT_FOUND);
  }

  const row = await prisma.blog.update({
    where: { id: blogId },
    data: {
      ...(input.title === undefined ? {} : { title: D.str(input.title) }),
      ...(input.slug ? { slug: await uniqueBlogSlug(D.str(input.slug), blogId) } : {}),
      ...(input.excerpt === undefined ? {} : { excerpt: D.str(input.excerpt) }),
      ...(input.content === undefined ? {} : { content: D.str(input.content) }),
      ...(input.coverImage === undefined ? {} : { coverImage: D.str(input.coverImage) }),
      ...(input.authorId === undefined ? {} : { authorId: D.str(input.authorId) }),
      ...(input.tags === undefined ? {} : { tags: D.strArr(input.tags) }),
      ...(input.isPublished === undefined
        ? {}
        : {
            isPublished: input.isPublished,
            ...(input.isPublished ? { publishedAt: new Date() } : {}),
          }),
    },
  });

  void writeAuditLog({ req, action: 'UPDATE', entity: 'Blog', entityId: blogId });

  return row;
};

export const deleteBlog = async (blogId: string, req?: any): Promise<void> => {
  const existing = await prisma.blog.findFirst({
    where: { id: blogId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.CONTENT.BLOG_NOT_FOUND);

  await prisma.blog.update({
    where: { id: blogId },
    data: { deletedAt: new Date(), isPublished: false },
  });

  void writeAuditLog({ req, action: 'DELETE', entity: 'Blog', entityId: blogId });
};

// ═══ FAQ ═════════════════════════════════════════════════════════════════════

export const listFaqs = async (
  query: Record<string, any>,
  isStaff = false,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.FaqWhereInput = isStaff ? {} : { isActive: true };

  if (D.str(query.category)) where.category = D.str(query.category);
  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;

  const [rows, total] = await Promise.all([
    prisma.faq.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.faq.count({ where }),
  ]);

  return { rows, total };
};

export const createFaq = async (input: Record<string, any>, req?: any): Promise<any> => {
  const row = await prisma.faq.create({
    data: {
      question: D.str(input.question),
      answer: D.str(input.answer),
      category: D.str(input.category),
      sortOrder: D.num(input.sortOrder),
      isActive: input.isActive !== false,
    },
  });

  void writeAuditLog({ req, action: 'CREATE', entity: 'Faq', entityId: row.id });

  return row;
};

export const updateFaq = async (
  faqId: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const existing = await prisma.faq.findUnique({ where: { id: faqId }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.CONTENT.FAQ_NOT_FOUND);

  const row = await prisma.faq.update({
    where: { id: faqId },
    data: {
      ...(input.question === undefined ? {} : { question: D.str(input.question) }),
      ...(input.answer === undefined ? {} : { answer: D.str(input.answer) }),
      ...(input.category === undefined ? {} : { category: D.str(input.category) }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: D.num(input.sortOrder) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });

  void writeAuditLog({ req, action: 'UPDATE', entity: 'Faq', entityId: faqId });

  return row;
};

export const deleteFaq = async (faqId: string, req?: any): Promise<void> => {
  const existing = await prisma.faq.findUnique({ where: { id: faqId }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.CONTENT.FAQ_NOT_FOUND);

  await prisma.faq.delete({ where: { id: faqId } });

  void writeAuditLog({ req, action: 'DELETE', entity: 'Faq', entityId: faqId });
};

// ═══ Banners ═════════════════════════════════════════════════════════════════

/** A banner is live only inside its window, so an expired one is filtered out. */
const isBannerLive = (b: any): boolean => {
  if (!D.bool(b?.isActive)) return false;
  if (b?.startsAt && isFuture(b.startsAt)) return false;
  if (b?.endsAt && isPast(b.endsAt)) return false;
  return true;
};

export const listBanners = async (
  query: Record<string, any>,
  isStaff = false,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.BannerWhereInput = {};

  if (D.str(query.type)) where.type = D.str(query.type);
  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;

  // A public caller only sees banners inside their window.
  if (!isStaff) {
    where.isActive = true;
    where.AND = [
      { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.banner.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.banner.count({ where }),
  ]);

  return { rows, total };
};

export const createBanner = async (input: Record<string, any>, req?: any): Promise<any> => {
  if (
    D.str(input.startsAt) &&
    D.str(input.endsAt) &&
    new Date(D.str(input.endsAt)) <= new Date(D.str(input.startsAt))
  ) {
    throw AppError.unprocessable('Banner end time must be after start time.');
  }

  const slug = await uniqueBannerSlug(D.str(input.slug) || D.str(input.title));

  const row = await prisma.banner.create({
    data: {
      title: D.str(input.title),
      slug,
      image: D.str(input.image),
      mobileImage: D.str(input.mobileImage),
      type: D.str(input.type) || 'HOME',
      linkUrl: D.str(input.linkUrl),
      isActive: input.isActive !== false,
      sortOrder: D.num(input.sortOrder),
      startsAt: D.str(input.startsAt) ? new Date(D.str(input.startsAt)) : null,
      endsAt: D.str(input.endsAt) ? new Date(D.str(input.endsAt)) : null,
    },
  });

  void writeAuditLog({ req, action: 'CREATE', entity: 'Banner', entityId: row.id });

  return row;
};

export const updateBanner = async (
  bannerId: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const existing = await prisma.banner.findUnique({
    where: { id: bannerId },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.BANNER.NOT_FOUND);

  const startsAt =
    input.startsAt === undefined
      ? undefined
      : D.str(input.startsAt)
        ? new Date(D.str(input.startsAt))
        : null;
  const endsAt =
    input.endsAt === undefined
      ? undefined
      : D.str(input.endsAt)
        ? new Date(D.str(input.endsAt))
        : null;

  const current = await prisma.banner.findUnique({
    where: { id: bannerId },
    select: { startsAt: true, endsAt: true },
  });

  const nextStart = startsAt === undefined ? current?.startsAt : startsAt;
  const nextEnd = endsAt === undefined ? current?.endsAt : endsAt;

  if (nextStart && nextEnd && nextEnd <= nextStart) {
    throw AppError.unprocessable('Banner end time must be after start time.');
  }

  const row = await prisma.banner.update({
    where: { id: bannerId },
    data: {
      ...(input.title === undefined ? {} : { title: D.str(input.title) }),
      ...(input.slug ? { slug: await uniqueBannerSlug(D.str(input.slug), bannerId) } : {}),
      ...(input.image === undefined ? {} : { image: D.str(input.image) }),
      ...(input.mobileImage === undefined ? {} : { mobileImage: D.str(input.mobileImage) }),
      ...(input.type === undefined ? {} : { type: D.str(input.type) }),
      ...(input.linkUrl === undefined ? {} : { linkUrl: D.str(input.linkUrl) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: D.num(input.sortOrder) }),
      ...(startsAt === undefined ? {} : { startsAt }),
      ...(endsAt === undefined ? {} : { endsAt }),
    },
  });

  void writeAuditLog({ req, action: 'UPDATE', entity: 'Banner', entityId: bannerId });

  return row;
};

export const deleteBanner = async (bannerId: string, req?: any): Promise<void> => {
  const existing = await prisma.banner.findUnique({
    where: { id: bannerId },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.BANNER.NOT_FOUND);

  await prisma.banner.delete({ where: { id: bannerId } });

  void writeAuditLog({ req, action: 'DELETE', entity: 'Banner', entityId: bannerId });
};

// ═══ Contact / Newsletter ════════════════════════════════════════════════════

export const submitContact = async (
  input: Record<string, any>,
  userId?: string,
  req?: any,
): Promise<any> => {
  const row = await prisma.contactSubmission.create({
    data: {
      userId: D.str(userId) || null,
      name: D.str(input.name),
      email: D.str(input.email).toLowerCase(),
      phone: D.str(input.phone),
      subject: D.str(input.subject),
      message: D.str(input.message),
    },
  });

  void writeActivityLog({
    req,
    userId,
    action: 'CONTACT_SUBMITTED',
    entity: 'ContactSubmission',
    entityId: row.id,
  });

  return row;
};

export const listContacts = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.ContactSubmissionWhereInput = {};

  if (D.str(query.isRead) === 'true') where.isRead = true;
  if (D.str(query.isRead) === 'false') where.isRead = false;

  const [rows, total] = await Promise.all([
    prisma.contactSubmission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.contactSubmission.count({ where }),
  ]);

  return { rows, total };
};

export const markContactRead = async (id: string, isRead: boolean, req?: any): Promise<any> => {
  const existing = await prisma.contactSubmission.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.CONTACT.NOT_FOUND);

  const row = await prisma.contactSubmission.update({ where: { id }, data: { isRead } });

  void writeAuditLog({ req, action: 'UPDATE', entity: 'ContactSubmission', entityId: id });

  return row;
};

/**
 * Subscribes an address. Re-subscribing after an unsubscribe reactivates the
 * same row rather than colliding on the unique email.
 */
export const subscribe = async (email: string, req?: any): Promise<Record<string, any>> => {
  const address = D.str(email).toLowerCase();

  const existing = await prisma.newsletterSubscriber.findUnique({ where: { email: address } });

  if (existing) {
    if (existing.isSubscribed && existing.isActive) {
      throw AppError.conflict('This email is already subscribed.', ERROR_CODE.DUPLICATE);
    }

    const row = await prisma.newsletterSubscriber.update({
      where: { email: address },
      data: { isSubscribed: true, isActive: true, unsubscribedAt: null },
    });

    return { email: D.str(row.email), isSubscribed: true };
  }

  const row = await prisma.newsletterSubscriber.create({
    data: { email: address, isSubscribed: true, isActive: true, token: generateCode(32) },
  });

  void writeActivityLog({
    req,
    action: 'NEWSLETTER_SUBSCRIBED',
    entity: 'NewsletterSubscriber',
    entityId: row.id,
  });

  return { email: D.str(row.email), isSubscribed: true };
};

/** Unsubscribe by token, so a link in an email works without a session. */
export const unsubscribe = async (token: string): Promise<Record<string, any>> => {
  const row = await prisma.newsletterSubscriber.findFirst({ where: { token: D.str(token) } });

  if (!row) throw AppError.notFound(ERROR.NEWSLETTER.SUBSCRIBER_NOT_FOUND);

  if (!row.isSubscribed) {
    throw AppError.unprocessable('This address is already unsubscribed.');
  }

  await prisma.newsletterSubscriber.update({
    where: { id: row.id },
    data: { isSubscribed: false, isActive: false, unsubscribedAt: new Date() },
  });

  return { email: D.str(row.email), isSubscribed: false };
};

export const listSubscribers = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.NewsletterSubscriberWhereInput = {};

  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;

  const [rows, total] = await Promise.all([
    prisma.newsletterSubscriber.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.newsletterSubscriber.count({ where }),
  ]);

  return { rows, total };
};

// ═══ Geo ═════════════════════════════════════════════════════════════════════

export const listCountries = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.CountryWhereInput = {};

  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;
  if (D.str(query.search)) {
    const term = D.str(query.search);
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { code: { contains: term.toUpperCase() } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.country.findMany({
      where,
      include: { _count: { select: { states: true } } },
      orderBy: { name: 'asc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.country.count({ where }),
  ]);

  return { rows, total };
};

export const listStates = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.StateWhereInput = {};

  if (D.str(query.countryCode)) where.countryCode = D.str(query.countryCode).toUpperCase();
  if (D.str(query.isActive) === 'true') where.isActive = true;

  /**
   * The nested cityList is only for a state -> city dropdown, so it stays opt-in; a plain list
   * would otherwise ship every city of every state.
   */
  const includeCities = D.str(query.includeCities) === 'true';

  const [rows, total] = await Promise.all([
    prisma.state.findMany({
      where,
      include: {
        _count: { select: { cities: true } },
        ...(includeCities
          ? { cities: { where: { isActive: true }, orderBy: { name: 'asc' } } }
          : {}),
      },
      orderBy: { name: 'asc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.state.count({ where }),
  ]);

  return { rows, total };
};

export const listCities = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.CityWhereInput = {};

  if (D.str(query.stateCode)) where.stateCode = D.str(query.stateCode);
  if (D.str(query.isServiceable) === 'true') where.isServiceable = true;
  if (D.str(query.isServiceable) === 'false') where.isServiceable = false;

  const [rows, total] = await Promise.all([
    prisma.city.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.city.count({ where }),
  ]);

  return { rows, total };
};

export const checkPincode = async (pincode: string): Promise<Record<string, any>> => {
  const city = await prisma.city.findFirst({
    where: { pincode: D.str(pincode) },
    include: { state: { include: { country: true } } },
  });

  if (!city) {
    return {
      pincode: D.str(pincode),
      isKnown: false,
      isServiceable: false,
      cityName: '',
      stateName: '',
      stateCode: '',
      countryCode: '',
    };
  }

  return {
    pincode: D.str(pincode),
    isKnown: true,
    isServiceable:
      D.bool(city.isServiceable) && D.bool(city.isActive) && D.bool(city.state.isActive),
    cityName: D.str(city.name),
    stateName: D.str(city.state.name),
    stateCode: D.str(city.state.code),
    countryCode: D.str(city.state.countryCode),
  };
};

/** Seeds the country/state reference list from the shared constants. */
export const seedCountries = async (
  req?: any,
): Promise<{ countries: number; states: number; cities: number }> => {
  let states = 0;
  let cities = 0;

  for (const country of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: country.code },
      create: {
        code: country.code,
        name: country.name,
        dialCode: country.dialCode,
        currency: country.currency,
        isActive: true,
      },
      update: { name: country.name, dialCode: country.dialCode, currency: country.currency },
    });
  }

  for (const state of INDIAN_STATES) {
    const existing = await prisma.state.findUnique({
      where: { code: state.code },
      select: { id: true },
    });

    await prisma.state.upsert({
      where: { code: state.code },
      create: { code: state.code, name: state.name, countryCode: 'IN', isActive: true },
      update: { name: state.name, isActive: true },
    });

    if (!existing) states += 1;

    // Cities carry the pincodes that serviceability and checkout both need.
    for (const city of INDIAN_CITIES.filter((c) => c.stateCode === state.code)) {
      const known = await prisma.city.findFirst({
        where: { pincode: city.pincode },
        select: { id: true },
      });

      await prisma.city.upsert({
        where: { id: known?.id ?? `seed_${city.pincode}` },
        create: {
          id: `seed_${city.pincode}`,
          name: city.name,
          stateCode: state.code,
          pincode: city.pincode,
          isServiceable: true,
          isActive: true,
        },
        update: { name: city.name, stateCode: state.code, isActive: true },
      });

      if (!known) cities += 1;
    }
  }

  void writeAuditLog({
    req,
    action: 'IMPORT',
    entity: 'Country',
    entityId: 'seed',
    meta: { states, cities },
  });

  return { countries: COUNTRIES.length, states, cities };
};

const INDIAN_STATES: { code: string; name: string }[] = [
  { code: 'MH', name: 'Maharashtra' },
  { code: 'KA', name: 'Karnataka' },
  { code: 'DL', name: 'Delhi' },
  { code: 'TN', name: 'Tamil Nadu' },
  { code: 'GJ', name: 'Gujarat' },
  { code: 'UP', name: 'Uttar Pradesh' },
  { code: 'WB', name: 'West Bengal' },
  { code: 'RJ', name: 'Rajasthan' },
  { code: 'AP', name: 'Andhra Pradesh' },
  { code: 'KL', name: 'Kerala' },
  { code: 'TS', name: 'Telangana' },
  { code: 'HR', name: 'Haryana' },
  { code: 'PB', name: 'Punjab' },
  { code: 'MP', name: 'Madhya Pradesh' },
  { code: 'BR', name: 'Bihar' },
];

/**
 * A few real pincodes per state. Without cities the pincode lookup and the serviceability
 * check have nothing to resolve against.
 */
const INDIAN_CITIES: { name: string; stateCode: string; pincode: string }[] = [
  { name: 'Mumbai', stateCode: 'MH', pincode: '400001' },
  { name: 'Pune', stateCode: 'MH', pincode: '411001' },
  { name: 'Nagpur', stateCode: 'MH', pincode: '440001' },
  { name: 'Bengaluru', stateCode: 'KA', pincode: '560001' },
  { name: 'Mysuru', stateCode: 'KA', pincode: '570001' },
  { name: 'Delhi', stateCode: 'DL', pincode: '110001' },
  { name: 'Dwarka', stateCode: 'DL', pincode: '110075' },
  { name: 'Chennai', stateCode: 'TN', pincode: '600001' },
  { name: 'Coimbatore', stateCode: 'TN', pincode: '641001' },
  { name: 'Ahmedabad', stateCode: 'GJ', pincode: '380001' },
  { name: 'Surat', stateCode: 'GJ', pincode: '395001' },
  { name: 'Lucknow', stateCode: 'UP', pincode: '226001' },
  { name: 'Kanpur', stateCode: 'UP', pincode: '208001' },
  { name: 'Kolkata', stateCode: 'WB', pincode: '700001' },
  { name: 'Jaipur', stateCode: 'RJ', pincode: '302001' },
  { name: 'Jodhpur', stateCode: 'RJ', pincode: '342001' },
  { name: 'Visakhapatnam', stateCode: 'AP', pincode: '530001' },
  { name: 'Kochi', stateCode: 'KL', pincode: '682001' },
  { name: 'Thiruvananthapuram', stateCode: 'KL', pincode: '695001' },
  { name: 'Hyderabad', stateCode: 'TS', pincode: '500001' },
  { name: 'Gurugram', stateCode: 'HR', pincode: '122001' },
  { name: 'Faridabad', stateCode: 'HR', pincode: '121001' },
  { name: 'Ludhiana', stateCode: 'PB', pincode: '141001' },
  { name: 'Amritsar', stateCode: 'PB', pincode: '143001' },
  { name: 'Bhopal', stateCode: 'MP', pincode: '462001' },
  { name: 'Indore', stateCode: 'MP', pincode: '452001' },
  { name: 'Patna', stateCode: 'BR', pincode: '800001' },
];

// ═══ Currency / tax / translation / dropdown ═════════════════════════════════

export const listCurrencies = async (isActiveOnly = false): Promise<any[]> =>
  prisma.currency.findMany({
    where: isActiveOnly ? { isActive: true } : {},
    orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
  });

export const createCurrency = async (input: Record<string, any>, req?: any): Promise<any> => {
  const code = D.str(input.code).toUpperCase();

  const existing = await prisma.currency.findUnique({ where: { code }, select: { id: true } });

  if (existing) throw AppError.conflict(ERROR.CURRENCY.ALREADY_EXISTS, ERROR_CODE.DUPLICATE);

  const row = await prisma.$transaction(async (tx) => {
    // Only one default currency is allowed at a time.
    if (input.isDefault) {
      await tx.currency.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }

    return tx.currency.create({
      data: {
        code,
        name: D.str(input.name),
        symbol: D.str(input.symbol),
        decimals: D.num(input.decimals),
        rate: D.float(input.rate),
        isDefault: D.bool(input.isDefault),
        isActive: input.isActive !== false,
      },
    });
  });

  void writeAuditLog({
    req,
    action: 'CREATE',
    entity: 'Currency',
    entityId: row.id,
    meta: { code },
  });

  return row;
};

export const updateCurrency = async (
  id: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const existing = await prisma.currency.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.CURRENCY.NOT_FOUND);

  const row = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.currency.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    return tx.currency.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: D.str(input.name) }),
        ...(input.symbol === undefined ? {} : { symbol: D.str(input.symbol) }),
        ...(input.decimals === undefined ? {} : { decimals: D.num(input.decimals) }),
        ...(input.rate === undefined ? {} : { rate: D.float(input.rate) }),
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
    });
  });

  void writeAuditLog({ req, action: 'UPDATE', entity: 'Currency', entityId: id });

  return row;
};

/**
 * Deletes a currency. The default one is kept because every conversion is
 * anchored to it, so it has to be demoted before it can be removed.
 */
export const deleteCurrency = async (id: string, req?: any): Promise<void> => {
  const existing = await prisma.currency.findUnique({
    where: { id },
    select: { id: true, isDefault: true },
  });

  if (!existing) throw AppError.notFound(ERROR.CURRENCY.NOT_FOUND);

  if (existing.isDefault) throw AppError.unprocessable(ERROR.CURRENCY.CANNOT_DELETE_DEFAULT);

  await prisma.currency.delete({ where: { id } });

  void writeAuditLog({ req, action: 'DELETE', entity: 'Currency', entityId: id });
};

/** Converts an amount using a currency rate. */
export const convertCurrency = async (
  amount: number,
  toCode: string,
): Promise<Record<string, any>> => {
  const code = D.str(toCode).toUpperCase();

  const target = await prisma.currency.findFirst({ where: { code, isActive: true } });

  if (!target) throw AppError.notFound(ERROR.CURRENCY.NOT_FOUND);

  const base = await prisma.currency.findFirst({ where: { isDefault: true } });

  const fromRate = D.float(base?.rate) || 1;
  const converted = money(D.float(amount) * (D.float(target.rate) / fromRate));

  return {
    fromCurrency: D.str(base?.code) || CURRENCY.CODE,
    toCurrency: code,
    amount: D.float(amount),
    rate: D.float(target.rate) / fromRate,
    convertedAmount: converted,
    symbol: D.str(target.symbol),
    decimals: D.num(target.decimals),
  };
};

export const listTaxConfigs = async (isActiveOnly = false): Promise<any[]> =>
  prisma.taxConfig.findMany({
    where: isActiveOnly ? { isActive: true } : {},
    orderBy: { name: 'asc' },
  });

export const createTaxConfig = async (input: Record<string, any>, req?: any): Promise<any> => {
  const slug = toSlugValue(D.str(input.slug) || D.str(input.name));

  const existing = await prisma.taxConfig.findUnique({ where: { slug }, select: { id: true } });

  if (existing)
    throw AppError.conflict('A tax config with this slug exists.', ERROR_CODE.DUPLICATE);

  if (D.str(input.vendorId)) {
    const vendor = await prisma.vendorProfile.findUnique({
      where: { id: D.str(input.vendorId) },
      select: { id: true },
    });
    if (!vendor) throw AppError.notFound(ERROR.VENDOR.NOT_FOUND);
  }

  const row = await prisma.taxConfig.create({
    data: {
      name: D.str(input.name),
      slug,
      percent: D.float(input.percent),
      cgstPercent: D.float(input.cgstPercent),
      sgstPercent: D.float(input.sgstPercent),
      igstPercent: D.float(input.igstPercent),
      isInclusive: D.bool(input.isInclusive),
      vendorId: D.str(input.vendorId) || null,
      stateCode: D.str(input.stateCode),
      isActive: input.isActive !== false,
    },
  });

  void writeAuditLog({
    req,
    action: 'CREATE',
    entity: 'TaxConfig',
    entityId: row.id,
    meta: { slug },
  });

  return row;
};

export const updateTaxConfig = async (
  id: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const existing = await prisma.taxConfig.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.TAX.NOT_FOUND);

  const row = await prisma.taxConfig.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: D.str(input.name) }),
      ...(input.percent === undefined ? {} : { percent: D.float(input.percent) }),
      ...(input.cgstPercent === undefined ? {} : { cgstPercent: D.float(input.cgstPercent) }),
      ...(input.sgstPercent === undefined ? {} : { sgstPercent: D.float(input.sgstPercent) }),
      ...(input.igstPercent === undefined ? {} : { igstPercent: D.float(input.igstPercent) }),
      ...(input.isInclusive === undefined ? {} : { isInclusive: input.isInclusive }),
      ...(input.vendorId === undefined ? {} : { vendorId: D.str(input.vendorId) || null }),
      ...(input.stateCode === undefined ? {} : { stateCode: D.str(input.stateCode) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });

  void writeAuditLog({ req, action: 'UPDATE', entity: 'TaxConfig', entityId: id });

  return row;
};

export const deleteTaxConfig = async (id: string, req?: any): Promise<void> => {
  const existing = await prisma.taxConfig.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.TAX.NOT_FOUND);

  await prisma.taxConfig.delete({ where: { id } });

  void writeAuditLog({ req, action: 'DELETE', entity: 'TaxConfig', entityId: id });
};

const toSlugValue = (value: string): string =>
  D.str(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const listTranslations = async (locale?: string, namespace?: string): Promise<any[]> =>
  prisma.translation.findMany({
    where: {
      ...(D.str(locale) ? { locale: D.str(locale) } : {}),
      ...(D.str(namespace) ? { namespace: D.str(namespace) } : {}),
    },
    orderBy: [{ namespace: 'asc' }, { key: 'asc' }],
  });

/** Applies a batch of translations; one bad entry does not lose the rest. */
export const upsertTranslations = async (
  input: { locale: string; namespace?: string; entries: { key: string; value: string }[] },
  req?: any,
): Promise<number> => {
  const locale = D.str(input.locale);
  const namespace = D.str(input.namespace) || 'common';

  let written = 0;

  await prisma.$transaction(async (tx) => {
    for (const entry of D.arr(input.entries) as any[]) {
      await tx.translation.upsert({
        where: { locale_key_namespace: { locale, key: D.str(entry.key), namespace } },
        create: { locale, namespace, key: D.str(entry.key), value: D.str(entry.value) },
        update: { value: D.str(entry.value) },
      });

      written += 1;
    }
  });

  void writeAuditLog({
    req,
    action: 'UPDATE',
    entity: 'Translation',
    entityId: locale,
    meta: { written },
  });

  return written;
};

export const listDropdowns = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.DropdownWhereInput = {};

  if (D.str(query.type)) where.type = D.str(query.type);
  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;

  const [rows, total] = await Promise.all([
    prisma.dropdown.findMany({
      where,
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.dropdown.count({ where }),
  ]);

  return { rows, total };
};

export const createDropdown = async (input: Record<string, any>, req?: any): Promise<any> => {
  const type = D.str(input.type);
  const value = D.str(input.value);

  const existing = await prisma.dropdown.findUnique({
    where: { type_value: { type, value } },
    select: { id: true },
  });

  if (existing)
    throw AppError.conflict('This dropdown option already exists.', ERROR_CODE.DUPLICATE);

  const row = await prisma.dropdown.create({
    data: {
      type,
      value,
      label: D.str(input.label) || value,
      sortOrder: D.num(input.sortOrder),
      isActive: input.isActive !== false,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });

  void writeAuditLog({
    req,
    action: 'CREATE',
    entity: 'Dropdown',
    entityId: row.id,
    meta: { type, value },
  });

  return row;
};

export const updateDropdown = async (
  id: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const existing = await prisma.dropdown.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.DROPDOWN.NOT_FOUND);

  const row = await prisma.dropdown.update({
    where: { id },
    data: {
      ...(input.label === undefined ? {} : { label: D.str(input.label) }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: D.num(input.sortOrder) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.metadata === undefined
        ? {}
        : { metadata: input.metadata as Prisma.InputJsonValue }),
    },
  });

  void writeAuditLog({ req, action: 'UPDATE', entity: 'Dropdown', entityId: id });

  return row;
};

export const deleteDropdown = async (id: string, req?: any): Promise<void> => {
  const existing = await prisma.dropdown.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.DROPDOWN.NOT_FOUND);

  await prisma.dropdown.delete({ where: { id } });

  void writeAuditLog({ req, action: 'DELETE', entity: 'Dropdown', entityId: id });
};

// ═══ Webhooks ════════════════════════════════════════════════════════════════

export const listWebhooks = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.WebhookEndpointWhereInput = {};

  if (D.str(query.provider)) where.provider = query.provider as any;
  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;

  const [rows, total] = await Promise.all([
    prisma.webhookEndpoint.findMany({
      where,
      // The signing secret is a credential and is never selected.
      select: {
        id: true,
        url: true,
        events: true,
        provider: true,
        isActive: true,
        failureCount: true,
        lastFiredAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.webhookEndpoint.count({ where }),
  ]);

  return { rows, total };
};

export const createWebhook = async (input: Record<string, any>, req?: any): Promise<any> => {
  // The signing secret is revealed once here and never on reads or updates.
  const secret = generateCode(40);

  const row = await prisma.webhookEndpoint.create({
    data: {
      url: D.str(input.url),
      events: D.strArr(input.events),
      provider: (D.str(input.provider) || 'CUSTOM') as WebhookProvider,
      secret,
      isActive: input.isActive !== false,
    },
    select: { id: true, url: true, events: true, provider: true, isActive: true, createdAt: true },
  });

  void writeAuditLog({
    req,
    action: 'CREATE',
    entity: 'WebhookEndpoint',
    entityId: row.id,
    meta: { url: row.url },
  });

  return { ...row, secret, note: 'Store this signing secret now — it is not shown again.' };
};

export const updateWebhook = async (
  id: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.WEBHOOK.ENDPOINT_NOT_FOUND);

  const row = await prisma.webhookEndpoint.update({
    where: { id },
    data: {
      ...(input.url === undefined ? {} : { url: D.str(input.url) }),
      ...(input.events === undefined ? {} : { events: D.strArr(input.events) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
    select: { id: true, url: true, events: true, provider: true, isActive: true, createdAt: true },
  });

  void writeAuditLog({ req, action: 'UPDATE', entity: 'WebhookEndpoint', entityId: id });

  return row;
};

/** Rotates the signing secret, which is how a leaked key is dealt with. */
export const rotateWebhookSecret = async (id: string, req?: any): Promise<Record<string, any>> => {
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.WEBHOOK.ENDPOINT_NOT_FOUND);

  const secret = generateCode(40);

  await prisma.webhookEndpoint.update({ where: { id }, data: { secret } });

  void writeAuditLog({
    req,
    action: 'UPDATE',
    entity: 'WebhookEndpoint',
    entityId: id,
    meta: { rotated: true },
  });

  return { webhookId: id, secret, note: 'Store this now — it is not shown again.' };
};

export const deleteWebhook = async (id: string, req?: any): Promise<void> => {
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.WEBHOOK.ENDPOINT_NOT_FOUND);

  await prisma.webhookEndpoint.delete({ where: { id } });

  void writeAuditLog({ req, action: 'DELETE', entity: 'WebhookEndpoint', entityId: id });
};

/** Verifies an inbound signature against the endpoint's stored secret. */
export const verifyWebhookSignature = async (
  endpointId: string,
  rawBody: string,
  signature: string,
): Promise<boolean> => {
  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { id: endpointId },
    select: { secret: true, isActive: true },
  });

  if (!endpoint || !endpoint.isActive) return false;

  return safeCompare(hmacSha256(rawBody, endpoint.secret), D.str(signature));
};

/**
 * Verifies an inbound provider's signature.
 *
 * Each provider keeps its secret in its own environment variable, so a leaked Razorpay secret
 * cannot be replayed against the shipping endpoint.
 */
export const verifyProviderSignature = async (
  provider: string,
  rawBody: string,
  signature: string,
): Promise<boolean> => {
  const secrets: Record<string, string> = {
    RAZORPAY: D.str(ENV.RAZORPAY_WEBHOOK_SECRET),
    STRIPE: D.str(ENV.STRIPE_WEBHOOK_SECRET),
    SHIPPING: D.str(ENV.SHIPPING_PARTNER_WEBHOOK_SECRET),
  };

  const secret = secrets[D.str(provider).toUpperCase()];

  // Without a configured secret the delivery is recorded but cannot be trusted.
  if (!secret) return false;

  return safeCompare(hmacSha256(rawBody, secret), D.str(signature));
};

export const listWebhookLogs = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.WebhookLogWhereInput = {};

  if (D.str(query.direction)) where.direction = D.str(query.direction);
  if (D.str(query.event)) where.event = D.str(query.event);
  if (D.str(query.isProcessed) === 'true') where.isProcessed = true;
  if (D.str(query.isProcessed) === 'false') where.isProcessed = false;

  const [rows, total] = await Promise.all([
    prisma.webhookLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.webhookLog.count({ where }),
  ]);

  return { rows, total };
};

/** Records an inbound webhook, marking it processed when the signature held. */
export const recordWebhook = async (
  input: {
    endpointId?: string;
    event: string;
    eventId?: string;
    payload: any;
    signature?: string;
    direction?: string;
  },
  isProcessed: boolean,
): Promise<Record<string, any>> => {
  const row = await prisma.webhookLog.create({
    data: {
      endpointId: D.str(input.endpointId) || null,
      direction: D.str(input.direction) || 'INBOUND',
      event: D.str(input.event),
      eventId: D.str(input.eventId),
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      signature: D.str(input.signature),
      isProcessed,
      ...(isProcessed ? {} : { error: 'Signature verification failed' }),
    },
    select: { id: true, event: true, isProcessed: true, createdAt: true },
  });

  return { logId: D.str(row.id), event: D.str(row.event), isProcessed: D.bool(row.isProcessed) };
};

// ═══ Bulk jobs ═══════════════════════════════════════════════════════════════

/**
 * Imports products row by row.
 * With `continueOnError` a bad row is reported and the rest still land, which is
 * what makes a spreadsheet import usable on real data.
 */
export const bulkImportProducts = async (
  vendorId: string,
  input: { rows: any[]; continueOnError?: boolean },
  actorId?: string,
  req?: any,
): Promise<Record<string, any>> => {
  const jobId = `bulk_${generateCode(12)}`;
  const errors: { row: number; message: string }[] = [];
  let successCount = 0;

  await prisma.bulkJob.create({
    data: {
      jobId,
      type: 'PRODUCT_IMPORT',
      totalRows: D.arr(input.rows).length,
      status: 'RUNNING',
      vendorId: D.str(vendorId),
      createdById: D.str(actorId),
      startedAt: new Date(),
    },
  });

  const rows = D.arr(input.rows) as any[];

  for (let i = 0; i < rows.length; i += 1) {
    try {
      const row = rows[i];

      const { createProduct } = await import('../product/product.service');
      await createProduct(
        D.str(vendorId),
        {
          name: D.str(row.name),
          price: D.float(row.price),
          mrpPrice: row.mrpPrice === undefined ? undefined : D.float(row.mrpPrice),
          stock: D.num(row.stock),
          sku: D.str(row.sku),
          categoryId: D.str(row.categoryId),
          brandId: D.str(row.brandId),
          taxPercent: row.taxPercent === undefined ? undefined : D.float(row.taxPercent),
        },
        req,
      );

      successCount += 1;
    } catch (err: any) {
      errors.push({ row: i + 1, message: D.str(err?.message) });

      if (!D.bool(input.continueOnError)) break;
    }
  }

  const failCount = errors.length;

  await prisma.bulkJob.update({
    where: { jobId },
    data: {
      successCount,
      failCount,
      errors: errors as unknown as Prisma.InputJsonValue,
      status: failCount === 0 ? 'COMPLETED' : successCount > 0 ? 'COMPLETED' : 'FAILED',
      completedAt: new Date(),
    },
  });

  void writeAuditLog({
    req,
    actorId,
    action: 'IMPORT',
    entity: 'BulkJob',
    entityId: jobId,
    meta: { totalRows: rows.length, successCount, failCount },
  });

  return {
    jobId,
    totalRows: rows.length,
    successCount,
    failCount,
    errorList: errors,
  };
};

export const listBulkJobs = async (
  query: Record<string, any>,
  vendorId?: string,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.BulkJobWhereInput = {};

  if (vendorId) where.vendorId = vendorId;
  if (D.str(query.type)) where.type = D.str(query.type);
  if (D.str(query.status)) where.status = query.status as any;

  const [rows, total] = await Promise.all([
    prisma.bulkJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.bulkJob.count({ where }),
  ]);

  return { rows, total };
};

export const getBulkJob = async (jobId: string): Promise<any> => {
  const job = await prisma.bulkJob.findUnique({ where: { jobId: D.str(jobId) } });

  if (!job) throw AppError.notFound(ERROR.BULK.JOB_NOT_FOUND);

  return job;
};

// ═══ Reports ════════════════════════════════════════════════════════════════

const reportRange = (query: Record<string, any>): { from: Date; to: Date } => ({
  from: D.str(query.from) ? startOfDay(D.str(query.from)) : startOfDay(subtractDays(29)),
  to: D.str(query.to) ? endOfDay(D.str(query.to)) : endOfDay(new Date()),
});

/**
 * Builds a flat object list plus a CSV rendering of the same rows. When `summary`
 * is supplied it is returned alongside the rows and appended as a TOTAL row in
 * the CSV, so aggregate columns are not silently dropped.
 */
const toReport = (
  columns: string[],
  rows: Record<string, any>[],
  summary?: Record<string, any>,
): Record<string, any> => {
  const csvRows = rows.map((r) =>
    columns
      .map((c) => {
        const value = String(r[c] ?? '').replace(/"/g, '""');
        return /[",\n]/.test(value) ? `"${value}"` : value;
      })
      .join(','),
  );

  if (summary) {
    const label = String(summary.__label ?? 'TOTAL');
    csvRows.push(
      columns
        .map((c) => {
          if (c === columns[0]) return label;
          const value = summary[c] === undefined ? '' : String(summary[c]);
          return /[",\n]/.test(value) ? `"${value}"` : value;
        })
        .join(','),
    );
  }

  const csv = [columns.join(',')].concat(csvRows).join('\n');

  if (!summary) return { totalRecord: rows.length, columnList: columns, rowList: rows, csv };

  const { __label, ...totals } = summary;

  return { totalRecord: rows.length, columnList: columns, rowList: rows, summary: totals, csv };
};

export const salesReport = async (query: Record<string, any>): Promise<Record<string, any>> => {
  const { from, to } = reportRange(query);

  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      createdAt: { gte: from, lte: to },
      ...(D.str(query.vendorId)
        ? { subOrders: { some: { vendorId: D.str(query.vendorId) } } }
        : {}),
    },
    select: {
      orderNumber: true,
      createdAt: true,
      paymentMethod: true,
      paymentStatus: true,
      status: true,
      total: true,
      couponDiscount: true,
      taxAmount: true,
      shippingAmount: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const revenue = money(orders.reduce((s, o) => s + D.float(o.total), 0));

  return toReport(
    [
      'orderNumber',
      'date',
      'status',
      'paymentMethod',
      'paymentStatus',
      'subtotal',
      'discount',
      'tax',
      'shipping',
      'total',
    ],
    orders.map((o) => ({
      orderNumber: D.str(o.orderNumber),
      date: new Date(o.createdAt).toISOString().slice(0, 10),
      status: D.str(o.status),
      paymentMethod: D.str(o.paymentMethod),
      paymentStatus: D.str(o.paymentStatus),
      subtotal: money(
        D.float(o.total) -
          D.float(o.taxAmount) -
          D.float(o.shippingAmount) +
          D.float(o.couponDiscount),
      ),
      discount: money(D.float(o.couponDiscount)),
      tax: money(D.float(o.taxAmount)),
      shipping: money(D.float(o.shippingAmount)),
      total: money(D.float(o.total)),
    })),
    {
      __label: 'TOTAL',
      subtotal: money(
        orders.reduce(
          (s, o) =>
            s +
            D.float(o.total) -
            D.float(o.taxAmount) -
            D.float(o.shippingAmount) +
            D.float(o.couponDiscount),
          0,
        ),
      ),
      discount: money(orders.reduce((s, o) => s + D.float(o.couponDiscount), 0)),
      tax: money(orders.reduce((s, o) => s + D.float(o.taxAmount), 0)),
      shipping: money(orders.reduce((s, o) => s + D.float(o.shippingAmount), 0)),
      total: revenue,
    },
  );
};

export const ordersReport = async (query: Record<string, any>): Promise<Record<string, any>> => {
  const { from, to } = reportRange(query);

  const orders = await prisma.order.findMany({
    where: { deletedAt: null, createdAt: { gte: from, lte: to } },
    select: {
      orderNumber: true,
      createdAt: true,
      status: true,
      total: true,
      items: { select: { qty: true } },
    },
  });

  return toReport(
    ['orderNumber', 'date', 'status', 'items', 'total'],
    orders.map((o: any) => ({
      orderNumber: D.str(o.orderNumber),
      date: new Date(o.createdAt).toISOString().slice(0, 10),
      status: D.str(o.status),
      items: D.arr(o.items).reduce((s: number, i: any) => s + D.num(i.qty), 0),
      total: D.float(o.total),
    })),
  );
};

export const productsReport = async (): Promise<Record<string, any>> => {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      name: true,
      sku: true,
      price: true,
      stock: true,
      soldCount: true,
      viewCount: true,
      rating: true,
      status: true,
      vendor: { select: { shopName: true } },
    },
    orderBy: { soldCount: 'desc' },
    take: 500,
  });

  return toReport(
    ['name', 'sku', 'shop', 'price', 'stock', 'sold', 'views', 'rating', 'status'],
    products.map((p: any) => ({
      name: D.str(p.name),
      sku: D.str(p.sku),
      shop: D.str(p.vendor?.shopName),
      price: D.float(p.price),
      stock: D.num(p.stock),
      sold: D.num(p.soldCount),
      views: D.num(p.viewCount),
      rating: D.float(p.rating),
      status: D.str(p.status),
    })),
  );
};

export const customersReport = async (): Promise<Record<string, any>> => {
  const users = await prisma.user.findMany({
    select: {
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      orders: { select: { total: true, paymentStatus: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  return toReport(
    ['name', 'email', 'role', 'orders', 'lifetimeValue', 'joined'],
    users.map((u: any) => {
      const paid = D.arr(u.orders).filter((o: any) => D.str(o.paymentStatus) === 'PAID');

      return {
        name: D.str(u.name),
        email: D.str(u.email),
        role: D.str(u.role),
        orders: D.arr(u.orders).length,
        lifetimeValue: money(paid.reduce((s: number, o: any) => s + D.float(o.total), 0)),
        joined: new Date(u.createdAt).toISOString().slice(0, 10),
      };
    }),
  );
};

export const vendorsReport = async (): Promise<Record<string, any>> => {
  const vendors = await prisma.vendorProfile.findMany({
    select: {
      shopName: true,
      slug: true,
      status: true,
      commissionRate: true,
      rating: true,
      ratingCount: true,
      totalSales: true,
      pendingAmount: true,
      subOrders: { select: { total: true } },
    },
    orderBy: { totalSales: 'desc' },
    take: 500,
  });

  return toReport(
    ['shop', 'slug', 'status', 'commission', 'rating', 'reviews', 'sales', 'pending', 'orders'],
    vendors.map((v: any) => ({
      shop: D.str(v.shopName),
      slug: D.str(v.slug),
      status: D.str(v.status),
      commission: D.float(v.commissionRate),
      rating: D.float(v.rating),
      reviews: D.num(v.ratingCount),
      sales: D.float(v.totalSales),
      pending: D.float(v.pendingAmount),
      orders: D.arr(v.subOrders).length,
    })),
  );
};

export const payoutsReport = async (): Promise<Record<string, any>> => {
  const payouts = await prisma.payout.findMany({
    select: {
      amount: true,
      method: true,
      status: true,
      period: true,
      reference: true,
      createdAt: true,
      processedAt: true,
      vendor: { select: { shopName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  return toReport(
    ['shop', 'amount', 'method', 'status', 'period', 'reference', 'requested', 'processed'],
    payouts.map((p: any) => ({
      shop: D.str(p.vendor?.shopName),
      amount: D.float(p.amount),
      method: D.str(p.method),
      status: D.str(p.status),
      period: D.str(p.period),
      reference: D.str(p.reference),
      requested: new Date(p.createdAt).toISOString().slice(0, 10),
      processed: p.processedAt ? new Date(p.processedAt).toISOString().slice(0, 10) : '',
    })),
  );
};

export const inventoryReport = async (): Promise<Record<string, any>> => {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      name: true,
      sku: true,
      stock: true,
      lowStockThreshold: true,
      status: true,
      vendor: { select: { shopName: true } },
    },
    orderBy: { stock: 'asc' },
    take: 500,
  });

  return toReport(
    ['name', 'sku', 'shop', 'stock', 'threshold', 'status', 'isLow'],
    products.map((p: any) => ({
      name: D.str(p.name),
      sku: D.str(p.sku),
      shop: D.str(p.vendor?.shopName),
      stock: D.num(p.stock),
      threshold: D.num(p.lowStockThreshold),
      status: D.str(p.status),
      isLow: D.num(p.stock) <= D.num(p.lowStockThreshold),
    })),
  );
};

export const returnsReport = async (): Promise<Record<string, any>> => {
  const returns = await prisma.returnRequest.findMany({
    select: {
      returnNumber: true,
      status: true,
      refundAmount: true,
      refundMode: true,
      requestedAt: true,
      refundedAt: true,
      vendor: { select: { shopName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  return toReport(
    ['returnNumber', 'shop', 'status', 'refundAmount', 'mode', 'requested', 'refunded'],
    returns.map((r: any) => ({
      returnNumber: D.str(r.returnNumber),
      shop: D.str(r.vendor?.shopName),
      status: D.str(r.status),
      refundAmount: D.float(r.refundAmount),
      mode: D.str(r.refundMode),
      requested: new Date(r.requestedAt).toISOString().slice(0, 10),
      refunded: r.refundedAt ? new Date(r.refundedAt).toISOString().slice(0, 10) : '',
    })),
  );
};

export const taxReport = async (query: Record<string, any>): Promise<Record<string, any>> => {
  const { from, to } = reportRange(query);

  const orders = await prisma.order.findMany({
    where: { deletedAt: null, createdAt: { gte: from, lte: to } },
    select: { orderNumber: true, taxAmount: true, total: true },
  });

  const totalTax = money(orders.reduce((s, o) => s + D.float(o.taxAmount), 0));

  return toReport(
    ['orderNumber', 'tax', 'total'],
    orders.map((o) => ({
      orderNumber: D.str(o.orderNumber),
      tax: money(D.float(o.taxAmount)),
      total: money(D.float(o.total)),
    })),
    {
      __label: 'TOTAL',
      tax: totalTax,
      total: money(orders.reduce((s, o) => s + D.float(o.total), 0)),
    },
  );
};

export const listReportSchedules = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.ReportScheduleWhereInput = {};

  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;

  const [rows, total] = await Promise.all([
    prisma.reportSchedule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.reportSchedule.count({ where }),
  ]);

  return { rows, total };
};

export const createReportSchedule = async (
  input: Record<string, any>,
  actorId?: string,
  req?: any,
): Promise<any> => {
  const row = await prisma.reportSchedule.create({
    data: {
      name: D.str(input.name),
      reportType: D.str(input.reportType),
      cron: D.str(input.cron),
      recipients: D.strArr(input.recipients).map((r) => r.toLowerCase()),
      format: D.str(input.format) || 'CSV',
      isActive: input.isActive !== false,
      createdById: D.str(actorId),
    },
  });

  void writeAuditLog({
    req,
    actorId,
    action: 'CREATE',
    entity: 'ReportSchedule',
    entityId: row.id,
    meta: { type: row.reportType },
  });

  return row;
};

export const updateReportSchedule = async (
  id: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const existing = await prisma.reportSchedule.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.REPORT.SCHEDULE_NOT_FOUND);

  const row = await prisma.reportSchedule.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: D.str(input.name) }),
      ...(input.cron === undefined ? {} : { cron: D.str(input.cron) }),
      ...(input.recipients === undefined
        ? {}
        : { recipients: D.strArr(input.recipients).map((r) => r.toLowerCase()) }),
      ...(input.format === undefined ? {} : { format: D.str(input.format) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });

  void writeAuditLog({ req, action: 'UPDATE', entity: 'ReportSchedule', entityId: id });

  return row;
};

export const deleteReportSchedule = async (id: string, req?: any): Promise<void> => {
  const existing = await prisma.reportSchedule.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.REPORT.SCHEDULE_NOT_FOUND);

  await prisma.reportSchedule.delete({ where: { id } });

  void writeAuditLog({ req, action: 'DELETE', entity: 'ReportSchedule', entityId: id });
};

/** Dispatches a report request to its builder. */
export const runReport = async (
  type: string,
  query: Record<string, any>,
): Promise<Record<string, any>> => {
  switch (D.str(type).toUpperCase()) {
    case 'SALES':
      return salesReport(query);
    case 'ORDERS':
      return ordersReport(query);
    case 'PRODUCTS':
      return productsReport();
    case 'CUSTOMERS':
      return customersReport();
    case 'VENDORS':
      return vendorsReport();
    case 'PAYOUTS':
      return payoutsReport();
    case 'INVENTORY':
      return inventoryReport();
    case 'RETURNS':
      return returnsReport();
    case 'TAX':
      return taxReport(query);
    default:
      throw AppError.badRequest(ERROR.REPORT.TYPE_INVALID);
  }
};

// ═══ Newsletter campaign ══════════════════════════════════════════════════════

/**
 * Queues one email per active subscriber.
 *
 * Delivery goes through the email queue one job per recipient rather than a single fan-out job,
 * so a retry after a partial failure cannot resend to somebody who already got the mail.
 */
export const sendCampaign = async (
  input: { subject: string; body: string; templateKey?: string },
  actorId?: string,
  req?: any,
): Promise<Record<string, any>> => {
  const subscribers = await prisma.newsletterSubscriber.findMany({
    where: { isActive: true },
    select: { id: true, email: true },
  });

  const jobId = `campaign_${generateCode(12)}`;
  const { enqueueEmail } = await import('../../jobs/queues');

  await prisma.bulkJob.create({
    data: {
      jobId,
      type: 'NEWSLETTER_CAMPAIGN',
      status: 'QUEUED',
      totalRows: subscribers.length,
      successCount: 0,
      failCount: 0,
      createdById: D.str(actorId) || null,
      errors: [],
    },
  });

  for (const subscriber of subscribers) {
    await enqueueEmail({
      to: D.str(subscriber.email),
      subject: D.str(input.subject),
      html: D.str(input.body),
      templateKey: D.str(input.templateKey) || 'newsletter_campaign',
      templateData: { jobId, campaignSubject: D.str(input.subject) },
    });
  }

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'CAMPAIGN_SENT',
    entity: 'NewsletterSubscriber',
    meta: { jobId, recipientCount: subscribers.length },
  });

  return { jobId, recipientCount: subscribers.length, status: 'QUEUED' };
};

// ═══ Bulk import — orders and users ════════════════════════════════════════════

const openBulkJob = async (type: string, totalRows: number, actorId?: string): Promise<string> => {
  const jobId = `bulk_${generateCode(12)}`;

  await prisma.bulkJob.create({
    data: {
      jobId,
      type,
      status: 'RUNNING',
      totalRows,
      successCount: 0,
      failCount: 0,
      createdById: D.str(actorId) || null,
      startedAt: new Date(),
      errors: [],
    },
  });

  return jobId;
};

const closeBulkJob = async (
  jobId: string,
  successCount: number,
  errors: { row: number; message: string }[],
): Promise<void> => {
  await prisma.bulkJob.update({
    where: { jobId },
    data: {
      // A run with some bad rows is still a completed run; FAILED is reserved for a crash.
      status: 'COMPLETED',
      successCount,
      failCount: errors.length,
      completedAt: new Date(),
      errors: errors as unknown as Prisma.InputJsonValue,
    },
  });
};

export const bulkImportOrders = async (
  input: { rows: any[]; continueOnError?: boolean },
  actorId?: string,
  req?: any,
): Promise<Record<string, any>> => {
  const rows = D.arr(input.rows) as any[];
  const errors: { row: number; message: string }[] = [];
  let successCount = 0;

  const jobId = await openBulkJob('ORDERS', rows.length, actorId);

  for (const [index, row] of rows.entries()) {
    try {
      const user = await prisma.user.findUnique({
        where: { email: D.str(row.email).toLowerCase() },
        select: { id: true },
      });

      if (!user) throw new Error(`No user with email ${D.str(row.email)}`);

      const order = await prisma.order.create({
        data: {
          orderNumber: `IMP${D.str(row.orderNumber) || generateCode(10)}`,
          userId: user.id,
          status: (D.str(row.status).toUpperCase() || 'CONFIRMED') as any,
          paymentMethod: (D.str(row.paymentMethod).toUpperCase() || 'COD') as any,
          paymentStatus: (D.str(row.paymentStatus).toUpperCase() || 'PAID') as any,
          subtotal: D.float(row.subtotal ?? row.total),
          total: D.float(row.total),
          notes: D.str(row.notes),
        },
      });

      for (const item of D.arr(row.items) as any[]) {
        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            productId: D.str(item.productId),
            name: D.str(item.name),
            sku: D.str(item.sku),
            qty: Math.max(1, D.num(item.qty)),
            price: D.float(item.price),
            total: money(D.num(item.qty) * D.float(item.price)),
          },
        });
      }

      successCount += 1;
    } catch (err) {
      errors.push({ row: index + 1, message: (err as Error)?.message ?? 'unknown error' });
      if (input.continueOnError === false) break;
    }
  }

  await closeBulkJob(jobId, successCount, errors);

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'ORDERS_IMPORTED',
    entity: 'Order',
    meta: { jobId, successCount, failCount: errors.length },
  });

  return {
    jobId,
    type: 'ORDERS',
    totalCount: rows.length,
    successCount,
    failCount: errors.length,
    errorList: errors,
  };
};

export const bulkImportUsers = async (
  input: { rows: any[]; continueOnError?: boolean },
  actorId?: string,
  req?: any,
): Promise<Record<string, any>> => {
  const rows = D.arr(input.rows) as any[];
  const errors: { row: number; message: string }[] = [];
  let successCount = 0;

  const jobId = await openBulkJob('USERS', rows.length, actorId);

  for (const [index, row] of rows.entries()) {
    try {
      const email = D.str(row.email).toLowerCase();

      if (!email) throw new Error('email is required');

      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });

      if (existing) throw new Error(`${email} already exists`);

      await prisma.user.create({
        data: {
          email,
          name: D.str(row.name) || email,
          phone: D.str(row.phone),
          passwordHash: await hashPassword(D.str(row.password) || generateCode(16)),
          role: (D.str(row.role).toUpperCase() || 'CUSTOMER') as any,
          isActive: row.isActive !== false,
          isEmailVerified: D.bool(row.isEmailVerified),
        },
      });

      successCount += 1;
    } catch (err) {
      errors.push({ row: index + 1, message: (err as Error)?.message ?? 'unknown error' });
      if (input.continueOnError === false) break;
    }
  }

  await closeBulkJob(jobId, successCount, errors);

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'USERS_IMPORTED',
    entity: 'User',
    meta: { jobId, successCount, failCount: errors.length },
  });

  return {
    jobId,
    type: 'USERS',
    totalCount: rows.length,
    successCount,
    failCount: errors.length,
    errorList: errors,
  };
};

// ═══ Translations (single-key CRUD) ═════════════════════════════════════════════

/** Locales that actually have at least one key, plus how many keys each holds. */
export const listLocales = async (): Promise<any[]> => {
  const grouped = await prisma.translation.groupBy({
    by: ['locale'],
    _count: { _all: true },
    orderBy: { locale: 'asc' },
  });

  return grouped.map((g: any) => ({ locale: D.str(g.locale), keyCount: D.num(g._count._all) }));
};

export const getTranslationsByLocale = async (
  locale: string,
): Promise<{ locale: string; namespaceList: any[] }> => {
  const rows = await listTranslations(locale);

  const byNamespace = new Map<string, any[]>();

  for (const row of rows) {
    const namespace = D.str(row.namespace) || 'common';
    const bucket = byNamespace.get(namespace) ?? [];
    bucket.push({
      translationId: D.str(row.id),
      key: D.str(row.key),
      value: D.str(row.value),
      updatedAt: D.date(row.updatedAt),
    });
    byNamespace.set(namespace, bucket);
  }

  return {
    locale: D.str(locale),
    namespaceList: Array.from(byNamespace.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([namespace, entryList]) => ({
        namespace,
        keyCount: entryList.length,
        entryList,
      })),
  };
};

export const createTranslation = async (
  input: { locale: string; key: string; value: string; namespace?: string },
  actorId?: string,
  req?: any,
): Promise<any> => {
  const locale = D.str(input.locale);
  const namespace = D.str(input.namespace) || 'common';

  const existing = await prisma.translation.findFirst({
    where: { locale, key: D.str(input.key), namespace },
    select: { id: true },
  });

  if (existing) throw AppError.conflict(ERROR.I18N.ALREADY_EXISTS, ERROR_CODE.DUPLICATE);

  const row = await prisma.translation.create({
    data: {
      locale,
      key: D.str(input.key),
      value: D.str(input.value),
      namespace,
    },
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'CREATE',
    entity: 'Translation',
    entityId: row.id,
    meta: { locale, key: input.key },
  });

  return row;
};

export const updateTranslation = async (
  id: string,
  input: { value: string; key?: string },
  actorId?: string,
  req?: any,
): Promise<any> => {
  const existing = await prisma.translation.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.I18N.NOT_FOUND);

  const row = await prisma.translation.update({
    where: { id },
    data: {
      value: D.str(input.value),
      ...(input.key === undefined ? {} : { key: D.str(input.key) }),
    },
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'UPDATE',
    entity: 'Translation',
    entityId: id,
  });

  return row;
};

export const deleteTranslation = async (id: string, req?: any): Promise<void> => {
  const existing = await prisma.translation.findUnique({ where: { id }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.I18N.NOT_FOUND);

  await prisma.translation.delete({ where: { id } });

  void writeActivityLog({ req, action: 'DELETE', entity: 'Translation', entityId: id });
};

export { isBannerLive };

// ═══ API keys ══════════════════════════════════════════════════════════════════

export const listApiKeys = async (): Promise<any[]> =>
  // The secret is never selected - only the prefix, which is safe to show.
  prisma.apiKey.findMany({
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      isActive: true,
      expiresAt: true,
      lastUsedAt: true,
      usageCount: true,
      createdAt: true,
      revokedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

/**
 * Creates a key and returns the secret exactly once.
 * Only a hash is stored, so a lost key cannot be recovered and must be rotated.
 */
export const createApiKey = async (
  input: { name: string; scopes?: string[]; expiresInDays?: number },
  actorId?: string,
  req?: any,
): Promise<Record<string, any>> => {
  const secret = generateCode(40);
  const prefix = secret.slice(0, API_KEY.PREFIX_LENGTH);

  const row = await prisma.apiKey.create({
    data: {
      name: D.str(input.name),
      key: `pn_${prefix}_${secret.slice(API_KEY.PREFIX_LENGTH, 20)}`,
      secretHash: sha256(secret),
      prefix,
      scopes: D.strArr(input.scopes),
      isActive: true,
      expiresAt: D.num(input.expiresInDays)
        ? new Date(Date.now() + D.num(input.expiresInDays) * 86_400_000)
        : null,
      createdById: D.str(actorId) || null,
    },
    select: {
      id: true,
      name: true,
      key: true,
      prefix: true,
      scopes: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  void writeAuditLog({
    req,
    actorId,
    action: 'CREATE',
    entity: 'ApiKey',
    entityId: row.id,
    description: `API key "${row.name}" created`,
  });

  return { ...row, secret, note: 'Store this secret now - it is not shown again.' };
};

export const revokeApiKey = async (keyId: string, actorId?: string, req?: any): Promise<any> => {
  const existing = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { id: true, name: true, revokedAt: true },
  });

  if (!existing) throw AppError.notFound(ERROR.API_KEY.NOT_FOUND);

  if (existing.revokedAt) {
    throw AppError.unprocessable(ERROR.API_KEY.REVOKED);
  }

  const row = await prisma.apiKey.update({
    where: { id: keyId },
    data: { isActive: false, revokedAt: new Date() },
    select: { id: true, name: true, prefix: true, scopes: true, isActive: true, revokedAt: true },
  });

  void writeAuditLog({
    req,
    actorId,
    action: 'DELETE',
    entity: 'ApiKey',
    entityId: keyId,
    description: `API key "${existing.name}" revoked`,
  });

  return row;
};

export const deleteApiKey = async (keyId: string, actorId?: string, req?: any): Promise<void> => {
  const existing = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: { id: true, name: true },
  });

  if (!existing) throw AppError.notFound(ERROR.API_KEY.NOT_FOUND);

  await prisma.apiKey.delete({ where: { id: keyId } });

  void writeAuditLog({
    req,
    actorId,
    action: 'DELETE',
    entity: 'ApiKey',
    entityId: keyId,
    description: `API key "${existing.name}" deleted`,
  });
};

/** Per-key call counters, so an integrator can see whether a key is still in use. */
export const getApiKeyUsage = async (keyId: string): Promise<Record<string, any>> => {
  const key = await prisma.apiKey.findUnique({
    where: { id: keyId },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      isActive: true,
      usageCount: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  if (!key) throw AppError.notFound(ERROR.API_KEY.NOT_FOUND);

  const calls = await prisma.auditLog.count({ where: { actorId: keyId } });

  return {
    apiKeyId: D.str(key.id),
    name: D.str(key.name),
    prefix: D.str(key.prefix),
    scopes: D.arr(key.scopes),
    isActive: D.bool(key.isActive),
    usageCount: D.num(key.usageCount),
    auditedCallCount: calls,
    lastUsedAt: D.date(key.lastUsedAt),
    expiresAt: D.date(key.expiresAt),
    revokedAt: D.date(key.revokedAt),
    createdAt: D.date(key.createdAt),
  };
};
