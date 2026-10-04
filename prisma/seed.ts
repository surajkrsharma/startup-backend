import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { SETTINGS } from '../src/config/setting-defaults';
import slugify from 'slugify';

const prisma = new PrismaClient();

const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  SUB_ADMIN: [
    'dashboard:view',
    'settings:view',
    'user:list',
    'user:view',
    'user:suspend',
    'vendor:list',
    'vendor:view',
    'vendor:approve',
    'vendor:reject',
    'vendor:suspend',
    'vendor:kyc:verify',
    'category:manage',
    'brand:manage',
    'tag:manage',
    'attribute:manage',
    'collection:manage',
    'product:view:all',
    'order:list',
    'order:view',
    'order:status:update',
    'order:delivery:assign',
    'return:list',
    'return:approve',
    'return:reject',
    'payment:list',
    'payment:confirm',
    'payout:list',
    'payout:approve',
    'payout:reject',
    'payout:generate',
    'coupon:manage',
    'flashsale:manage',
    'banner:manage',
    'review:moderate',
    'question:moderate',
    'page:manage',
    'blog:manage',
    'faq:manage',
    'content:view',
    'ticket:list',
    'ticket:reply',
    'ticket:assign',
    'contact:view',
    'newsletter:manage',
    'notification:send',
    'analytics:view',
    'analytics:export',
    'report:view',
    'report:export',
    'device:view',
    'tracking:view',
    'auditlog:view',
    'activitylog:view',
    'bulk:import',
    'shipping:manage',
    'deliveryboy:manage',
  ],
  VENDOR: [
    'product:create',
    'product:update',
    'product:delete',
    'order:list',
    'order:view',
    'return:list',
    'return:approve',
    'return:reject',
    'review:moderate',
    'question:moderate',
    'ticket:list',
    'ticket:reply',
    'chat:view',
    'report:view',
    'vendor:view',
  ],
  CUSTOMER: [],
  DELIVERY_BOY: [],
};

const toSlug = (value: string): string =>
  slugify(value, { lower: true, strict: true, trim: true, replacement: '-' });

const uniqueSlug = async (
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> => {
  const root = toSlug(base);
  if (!(await exists(root))) return root;
  for (let i = 2; i <= 50; i += 1) {
    const candidate = `${root}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${Date.now()}`;
};

const seedSettings = async (): Promise<number> => {
  for (const setting of SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      create: {
        key: setting.key,
        value: setting.value as any,
        category: setting.category,
        isPublic: setting.isPublic,
      },

      update: { category: setting.category },
    });
  }
  return SETTINGS.length;
};

const seedRolePermissions = async (): Promise<number> => {
  let count = 0;
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { role_permission: { role: role as any, permission } },
        create: { role: role as any, permission, isAllowed: true },
        update: {},
      });
      count += 1;
    }
  }
  return count;
};

const seedSuperAdmin = async (): Promise<string> => {
  const email = (process.env.SUPER_ADMIN_EMAIL || 'superadmin@projectname.com').toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || 'SuperSecret@123';

  const user = await prisma.user.upsert({
    where: { email },

    update: { isEmailVerified: true, isActive: true },
    create: {
      email,
      name: 'Super Admin',
      phone: '',
      passwordHash: await bcrypt.hash(password, 12),
      role: 'SUPER_ADMIN',
      isActive: true,
      isEmailVerified: true,
    },
    select: { id: true },
  });

  // eslint-disable-next-line no-console
  console.log(`[seed] SUPER_ADMIN ready -> ${email}`);

  return user.id;
};

const seedDemoData = async (superAdminId: string): Promise<void> => {
  const demoEnabled = process.env.SEED_DEMO_DATA !== 'false';

  const india = await prisma.country.upsert({
    where: { code: 'IN' },
    create: { code: 'IN', name: 'India', dialCode: '+91', currency: 'INR' },
    update: {},
  });

  const demoStates = [
    { code: 'DL', name: 'Delhi' },
    { code: 'MH', name: 'Maharashtra' },
    { code: 'KA', name: 'Karnataka' },
    { code: 'UP', name: 'Uttar Pradesh' },
    { code: 'TN', name: 'Tamil Nadu' },
    { code: 'GJ', name: 'Gujarat' },
  ];

  for (const state of demoStates) {
    await prisma.state.upsert({
      where: { code: state.code },
      create: { countryCode: india.code, code: state.code, name: state.name },
      update: {},
    });
  }

  const demoCities = [
    { stateCode: 'DL', name: 'New Delhi', pincode: '110001' },
    { stateCode: 'MH', name: 'Mumbai', pincode: '400001' },
    { stateCode: 'KA', name: 'Bengaluru', pincode: '560001' },
    { stateCode: 'UP', name: 'Lucknow', pincode: '226001' },
    { stateCode: 'TN', name: 'Chennai', pincode: '600001' },
    { stateCode: 'GJ', name: 'Ahmedabad', pincode: '380001' },
  ];

  for (const city of demoCities) {
    const existing = await prisma.city.findFirst({
      where: { stateCode: city.stateCode, name: city.name },
      select: { id: true },
    });
    if (!existing) {
      await prisma.city.create({ data: city });
    }
  }

  await prisma.currency.upsert({
    where: { code: 'INR' },
    create: {
      code: 'INR',
      name: 'Indian Rupee',
      symbol: '₹',
      decimals: 2,
      rate: 1,
      isDefault: true,
    },
    update: {},
  });

  const taxConfigs = [
    {
      name: 'GST 18%',
      slug: 'gst-18',
      percent: 18,
      cgstPercent: 9,
      sgstPercent: 9,
      igstPercent: 18,
    },
    {
      name: 'GST 12%',
      slug: 'gst-12',
      percent: 12,
      cgstPercent: 6,
      sgstPercent: 6,
      igstPercent: 12,
    },
    {
      name: 'GST 5%',
      slug: 'gst-5',
      percent: 5,
      cgstPercent: 2.5,
      sgstPercent: 2.5,
      igstPercent: 5,
    },
  ];

  for (const tax of taxConfigs) {
    await prisma.taxConfig.upsert({ where: { slug: tax.slug }, create: tax, update: {} });
  }

  const dropdowns = [
    { type: 'INDUSTRY', label: 'Fashion', value: 'fashion' },
    { type: 'INDUSTRY', label: 'Electronics', value: 'electronics' },
    { type: 'INDUSTRY', label: 'Grocery', value: 'grocery' },
    { type: 'INDUSTRY', label: 'Home & Kitchen', value: 'home-kitchen' },
    { type: 'INDUSTRY', label: 'Beauty', value: 'beauty' },
    { type: 'PRODUCT_TYPE', label: 'Physical', value: 'physical' },
    { type: 'PRODUCT_TYPE', label: 'Digital', value: 'digital' },
    { type: 'TITLE', label: 'Mr', value: 'mr' },
    { type: 'TITLE', label: 'Mrs', value: 'mrs' },
    { type: 'TITLE', label: 'Ms', value: 'ms' },
    { type: 'TITLE', label: 'Dr', value: 'dr' },
  ];

  for (const dropdown of dropdowns) {
    await prisma.dropdown.upsert({
      where: { type_value: { type: dropdown.type, value: dropdown.value } },
      create: dropdown,
      update: {},
    });
  }

  const translations: Record<string, Record<string, string>> = {
    en: {
      'app.name': 'ProjectName',
      'cart.empty': 'Your cart is empty.',
      'order.placed': 'Order placed successfully.',
      'checkout.title': 'Checkout',
    },
    hi: {
      'app.name': 'प्रोजेक्टनेम',
      'cart.empty': 'आपकी कार्ट खाली है।',
      'order.placed': 'ऑर्डर सफलतापूर्वक दिया गया।',
      'checkout.title': 'चेकआउट',
    },
  };

  for (const [locale, entries] of Object.entries(translations)) {
    for (const [key, value] of Object.entries(entries)) {
      await prisma.translation.upsert({
        where: { locale_key_namespace: { locale, key, namespace: 'common' } },
        create: { locale, key, value, namespace: 'common' },
        update: {},
      });
    }
  }

  const categorySeeds = [
    { name: 'Men', slug: 'men', parentId: null, sortOrder: 1 },
    { name: 'Women', slug: 'women', parentId: null, sortOrder: 2 },
    { name: 'Electronics', slug: 'electronics', parentId: null, sortOrder: 3 },
    { name: 'Home & Kitchen', slug: 'home-kitchen', parentId: null, sortOrder: 4 },
  ];

  for (const category of categorySeeds) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      create: { ...category, description: `${category.name} products`, isActive: true },
      update: {},
    });
  }

  const menId = (await prisma.category.findUnique({
    where: { slug: 'men' },
    select: { id: true },
  }))!.id;

  const subCategories = [
    { name: 'Shirts', slug: 'shirts', parentId: menId, sortOrder: 1 },
    { name: 'Trousers', slug: 'trousers', parentId: menId, sortOrder: 2 },
    { name: 'T-Shirts', slug: 't-shirts', parentId: menId, sortOrder: 3 },
  ];

  for (const category of subCategories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      create: { ...category, isActive: true },
      update: {},
    });
  }

  for (const brand of [
    { name: 'ProjectName Basics', slug: 'projectname-basics' },
    { name: 'Urban Threads', slug: 'urban-threads' },
    { name: 'TechNova', slug: 'technova' },
  ]) {
    await prisma.brand.upsert({ where: { slug: brand.slug }, create: brand, update: {} });
  }

  for (const tag of [
    { name: 'new-arrival', slug: 'new-arrival' },
    { name: 'sale', slug: 'sale' },
  ]) {
    await prisma.tag.upsert({ where: { slug: tag.slug }, create: tag, update: {} });
  }

  for (const attribute of [
    {
      name: 'Size',
      slug: 'size',
      type: 'SIZE' as const,
      options: ['S', 'M', 'L', 'XL'],
      isVariant: true,
    },
    {
      name: 'Colour',
      slug: 'colour',
      type: 'COLOR' as const,
      options: ['Black', 'White', 'Blue'],
      isVariant: true,
    },
    {
      name: 'Material',
      slug: 'material',
      type: 'SELECT' as const,
      options: ['Cotton', 'Polyester'],
    },
  ]) {
    await prisma.attribute.upsert({
      where: { slug: attribute.slug },
      create: { ...attribute, isFilterable: true, isActive: true },
      update: {},
    });
  }

  await prisma.collection.upsert({
    where: { slug: 'featured' },
    create: {
      name: 'Featured',
      slug: 'featured',
      type: 'MANUAL',
      description: 'Curated picks',
      isActive: true,
    },
    update: {},
  });

  const returnReasons = [
    { title: 'Wrong size', slug: 'wrong-size' },
    { title: 'Damaged product', slug: 'damaged-product' },
    { title: 'Defective product', slug: 'defective-product' },
    { title: 'Changed mind', slug: 'changed-mind' },
    { title: 'Not as described', slug: 'not-as-described' },
  ];

  for (const reason of returnReasons) {
    await prisma.returnReason.upsert({
      where: { slug: reason.slug },
      create: reason,
      update: {},
    });
  }

  for (const category of [
    { name: 'Order Issue', slug: 'order-issue' },
    { name: 'Payment Issue', slug: 'payment-issue' },
    { name: 'Return / Refund', slug: 'return-refund' },
    { name: 'Account Issue', slug: 'account-issue' },
    { name: 'Other', slug: 'other' },
  ]) {
    await prisma.ticketCategory.upsert({
      where: { slug: category.slug },
      create: category,
      update: {},
    });
  }

  await prisma.shippingZone.upsert({
    where: { id: 'seed-zone-india' },
    create: {
      id: 'seed-zone-india',
      name: 'India',
      countries: ['IN'],
      states: ['DL', 'MH', 'KA', 'UP', 'TN', 'GJ'],
      pincodes: [],
      isActive: true,
    },
    update: {},
  });

  const zone = await prisma.shippingZone.findUnique({ where: { id: 'seed-zone-india' } });

  const shippingMethods = [
    { name: 'Standard', code: 'STANDARD', baseCharge: 49, minDays: 3, maxDays: 6, freeAbove: 999 },
    { name: 'Express', code: 'EXPRESS', baseCharge: 99, minDays: 1, maxDays: 3, freeAbove: 1999 },
  ];

  for (const method of shippingMethods) {
    await prisma.shippingMethod.upsert({
      where: { code: method.code },
      create: { ...method, zoneId: zone?.id, isCodAllowed: true, isActive: true },
      update: {},
    });
  }

  await prisma.shippingPartner.upsert({
    where: { code: 'manual' },
    create: { name: 'Manual / Self Shipped', code: 'manual', isActive: true },
    update: {},
  });

  const demoPassword = await bcrypt.hash('Demo@12345', 12);

  const vendorUser = await prisma.user.upsert({
    where: { email: 'vendor@projectname.com' },
    update: { isPhoneVerified: true, isEmailVerified: true },
    create: {
      email: 'vendor@projectname.com',
      name: 'Ravi Kumar',
      phone: '+919876543210',
      passwordHash: demoPassword,
      role: 'VENDOR',
      isActive: true,
      isPhoneVerified: true,
    },
    select: { id: true },
  });

  const vendorSlug = await uniqueSlug('Ravi Store', async (slug) => {
    const row = await prisma.vendorProfile.findUnique({ where: { slug }, select: { id: true } });
    return Boolean(row);
  });

  const vendor = await prisma.vendorProfile.upsert({
    where: { userId: vendorUser.id },
    create: {
      userId: vendorUser.id,
      shopName: 'Ravi Store',
      slug: vendorSlug,
      description: 'Everyday wear and essentials.',
      gstNumber: '27ABCDE1234F1Z5',
      panNumber: 'ABCDE1234F',
      bankHolderName: 'Ravi Kumar',
      bankAccountNo: '000123456789',
      bankIfsc: 'HDFC0000001',
      upiId: 'ravistore@upi',
      commissionRate: 10,
      status: 'APPROVED',
      approvedAt: new Date(),
    },
    update: {},
  });

  const customerUser = await prisma.user.upsert({
    where: { email: 'customer@projectname.com' },
    update: { isPhoneVerified: true, isEmailVerified: true },
    create: {
      email: 'customer@projectname.com',
      name: 'Amit Sharma',
      phone: '+919812345678',
      passwordHash: demoPassword,
      role: 'CUSTOMER',
      isActive: true,
      isPhoneVerified: true,
    },
    select: { id: true },
  });

  const addressCount = await prisma.address.count({ where: { userId: customerUser.id } });
  if (addressCount === 0) {
    await prisma.address.create({
      data: {
        userId: customerUser.id,
        type: 'HOME',
        fullName: 'Amit Sharma',
        phone: '+919812345678',
        line1: '123 Main Street',
        line2: 'Near Central Park',
        city: 'New Delhi',
        state: 'Delhi',
        stateCode: 'DL',
        country: 'India',
        countryCode: 'IN',
        pincode: '110001',
        isDefault: true,
      },
    });
  }

  await prisma.user.upsert({
    where: { email: 'subadmin@projectname.com' },

    update: { isEmailVerified: true },
    create: {
      email: 'subadmin@projectname.com',
      name: 'Sub Admin',
      phone: '',
      passwordHash: demoPassword,
      role: 'SUB_ADMIN',
      isActive: true,
      isEmailVerified: true,
    },
  });

  if (!demoEnabled) return;

  const shirtsId = (await prisma.category.findUnique({
    where: { slug: 'shirts' },
    select: { id: true },
  }))!.id;
  const techNovaId = (await prisma.brand.findUnique({
    where: { slug: 'technova' },
    select: { id: true },
  }))!.id;

  const productSeeds = [
    {
      name: 'Classic Cotton Shirt',
      slugSeed: 'classic-cotton-shirt',
      description: 'Breathable cotton shirt for everyday wear.',
      sku: 'SHIRT-CLS-001',
      price: 799,
      mrpPrice: 1299,
      stock: 50,
      categoryId: shirtsId,
      brandId: null,
    },
    {
      name: 'Slim Fit Trousers',
      slugSeed: 'slim-fit-trousers',
      description: 'Tailored slim fit trousers.',
      sku: 'TROUSER-SLM-002',
      price: 1199,
      mrpPrice: 1899,
      stock: 35,
      categoryId: shirtsId,
      brandId: null,
    },
    {
      name: 'Wireless Headphones',
      slugSeed: 'wireless-headphones',
      description: 'Over-ear wireless headphones with 30h battery.',
      sku: 'ELEC-WH-100',
      price: 2499,
      mrpPrice: 3999,
      stock: 20,
      categoryId: null,
      brandId: techNovaId,
    },
    {
      name: 'Cotton T-Shirt',
      slugSeed: 'cotton-t-shirt',
      description: 'Soft combed cotton t-shirt.',
      sku: 'TSHIRT-CTN-003',
      price: 499,
      mrpPrice: 899,
      stock: 80,
      categoryId: shirtsId,
      brandId: null,
    },
  ];

  for (const product of productSeeds) {
    const slug = toSlug(product.slugSeed);

    await prisma.product.upsert({
      where: { slug },
      create: {
        vendorId: vendor.id,
        categoryId: product.categoryId,
        brandId: product.brandId,
        name: product.name,
        slug,
        description: product.description,
        sku: product.sku,
        price: product.price,
        mrpPrice: product.mrpPrice,
        taxPercent: 18,
        stock: product.stock,
        lowStockThreshold: 5,
        status: 'ACTIVE',
        isFeatured: false,
      },
      update: {},
    });
  }

  await prisma.coupon.upsert({
    where: { code: 'WELCOME100' },
    create: {
      code: 'WELCOME100',
      title: 'Welcome offer',
      description: 'Flat 100 off on your first order',
      type: 'FLAT',
      value: 100,
      minOrderAmount: 500,
      maxUsage: 1000,
      maxUsagePerUser: 1,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 90 * 86400000),
      isActive: true,
      status: 'ACTIVE',
    },
    update: {},
  });

  await prisma.coupon.upsert({
    where: { code: 'SAVE10' },
    create: {
      code: 'SAVE10',
      title: '10% off',
      description: '10% off up to 300',
      type: 'PERCENT',
      value: 10,
      maxDiscount: 300,
      minOrderAmount: 300,
      maxUsage: 5000,
      maxUsagePerUser: 3,
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86400000),
      isActive: true,
      status: 'ACTIVE',
    },
    update: {},
  });

  for (const faq of [
    {
      question: 'How long does delivery take?',
      answer: 'Standard delivery takes 3-6 business days. Express delivery takes 1-3 days.',
    },
    {
      question: 'Can I return a product?',
      answer: 'Yes. Returns are accepted within the return window shown on the product page.',
    },
    {
      question: 'What payment methods are accepted?',
      answer: 'Cash on delivery, UPI, bank transfer, card and net banking.',
    },
    {
      question: 'How do I track my order?',
      answer: 'Open Orders in the app to see live tracking for your order.',
    },
  ]) {
    const existing = await prisma.faq.findFirst({
      where: { question: faq.question },
      select: { id: true },
    });
    if (!existing) await prisma.faq.create({ data: faq });
  }

  await prisma.page.upsert({
    where: { slug: 'about-us' },
    create: {
      title: 'About Us',
      slug: 'about-us',
      content:
        'ProjectName is a multi-vendor marketplace connecting shoppers with independent sellers.',
      isPublished: true,
    },
    update: {},
  });

  await prisma.page.upsert({
    where: { slug: 'terms-and-conditions' },
    create: {
      title: 'Terms & Conditions',
      slug: 'terms-and-conditions',
      content: 'By using this platform you agree to these terms.',
      isPublished: true,
    },
    update: {},
  });

  await prisma.banner.upsert({
    where: { slug: 'home-hero' },
    create: {
      title: 'Homepage hero',
      slug: 'home-hero',
      image: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      type: 'HOME',
      linkUrl: '/products',
      isActive: true,
      sortOrder: 1,
    },
    update: {},
  });

  await prisma.flashSale.upsert({
    where: { slug: 'weekend-flash-sale' },
    create: {
      name: 'Weekend Flash Sale',
      slug: 'weekend-flash-sale',
      startsAt: new Date(Date.now() - 86400000),
      endsAt: new Date(Date.now() + 6 * 86400000),
      discountType: 'PERCENT',
      discountValue: 20,
      isActive: true,
    },
    update: {},
  });

  void superAdminId;
};

const main = async (): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log('[seed] starting...');

  const settings = await seedSettings();
  const permissions = await seedRolePermissions();
  const superAdminId = await seedSuperAdmin();
  await seedDemoData(superAdminId);

  const counts = {
    settings,
    rolePermissions: permissions,
    users: await prisma.user.count(),
    vendors: await prisma.vendorProfile.count(),
    products: await prisma.product.count(),
    categories: await prisma.category.count(),
    coupons: await prisma.coupon.count(),
  };

  // eslint-disable-next-line no-console
  console.log('[seed] complete:', counts);

  const adminEmail = (process.env.SUPER_ADMIN_EMAIL || 'superadmin@projectname.com').toLowerCase();
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD || 'SuperSecret@123';
  // eslint-disable-next-line no-console
  console.log(`[seed] super admin -> ${adminEmail} / ${adminPassword}`);
  // eslint-disable-next-line no-console
  console.log(
    '[seed] demo logins -> subadmin@ / vendor@ / customer@ (all @projectname.com, password: Demo@12345)',
  );
};

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
