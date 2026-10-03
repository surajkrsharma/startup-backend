/**
 * Verifies the seed output against a live database.
 * Usage: npx tsx scripts/seed-check.ts
 */
import { PGlite } from '@electric-sql/pglite';

const DATA_DIR = process.env.PGLITE_DATA_DIR ?? 'pglite-data';

interface Count {
  label: string;
  sql: string;
}

const CHECKS: Count[] = [
  { label: 'settings', sql: 'SELECT count(*)::int AS c FROM "SystemSetting"' },
  { label: 'rolePermissions', sql: 'SELECT count(*)::int AS c FROM "RolePermission"' },
  { label: 'users', sql: 'SELECT count(*)::int AS c FROM "User"' },
  { label: 'superAdmins', sql: `SELECT count(*)::int AS c FROM "User" WHERE role = 'SUPER_ADMIN'` },
  { label: 'vendors', sql: 'SELECT count(*)::int AS c FROM "VendorProfile"' },
  { label: 'categories', sql: 'SELECT count(*)::int AS c FROM "Category"' },
  { label: 'brands', sql: 'SELECT count(*)::int AS c FROM "Brand"' },
  { label: 'products', sql: 'SELECT count(*)::int AS c FROM "Product"' },
  { label: 'coupons', sql: 'SELECT count(*)::int AS c FROM "Coupon"' },
  { label: 'countries', sql: 'SELECT count(*)::int AS c FROM "Country"' },
  { label: 'cities', sql: 'SELECT count(*)::int AS c FROM "City"' },
  { label: 'taxConfigs', sql: 'SELECT count(*)::int AS c FROM "TaxConfig"' },
  { label: 'returnReasons', sql: 'SELECT count(*)::int AS c FROM "ReturnReason"' },
  { label: 'ticketCategories', sql: 'SELECT count(*)::int AS c FROM "TicketCategory"' },
  { label: 'shippingMethods', sql: 'SELECT count(*)::int AS c FROM "ShippingMethod"' },
  { label: 'addresses', sql: 'SELECT count(*)::int AS c FROM "Address"' },
];

const main = async (): Promise<void> => {
  const db = await PGlite.create({ dataDir: DATA_DIR });

  try {
    /* eslint-disable no-console */
    console.log('entity                count');
    console.log('---------------------------------');
    for (const check of CHECKS) {
      const result = await db.query<{ c: number }>(check.sql);
      console.log(`${check.label.padEnd(22)} ${result.rows[0].c}`);
    }

    const settings = await db.query<{ category: string; c: number }>(
      'SELECT category, count(*)::int AS c FROM "SystemSetting" GROUP BY category ORDER BY category',
    );
    console.log('\nsettings by category:');
    for (const row of settings.rows) {
      console.log(`  ${row.category.padEnd(14)} ${row.c}`);
    }

    const pub = await db.query<{ c: number }>(
      'SELECT count(*)::int AS c FROM "SystemSetting" WHERE "isPublic" = true',
    );
    console.log(`\npublic settings      ${pub.rows[0].c}`);

    const superAdmins = await db.query<{ email: string; name: string }>(
      `SELECT email, name FROM "User" WHERE role = 'SUPER_ADMIN'`,
    );
    console.log('\nsuper admin:');
    for (const row of superAdmins.rows) {
      console.log(`  ${row.email} (${row.name})`);
    }
    /* eslint-enable no-console */
  } finally {
    await db.close();
  }
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed-check] failed:', err?.message ?? err);
  process.exit(1);
});
