export type Row = Record<string, any>;

const matches = (row: Row, where: Row = {}): boolean => {
  for (const [key, expected] of Object.entries(where)) {
    if (expected === undefined) continue;

    if (key === 'OR') {
      if (!(expected as Row[]).some((clause) => matches(row, clause))) return false;
      continue;
    }

    const actual = row[key] ?? null;

    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const { gt, gte, lt, lte, in: allowed } = expected as Row;

      if (allowed !== undefined) {
        if (!allowed.some((value: unknown) => value === actual)) return false;
        continue;
      }

      if (gt !== undefined && !(actual > gt)) return false;
      if (gte !== undefined && !(actual >= gte)) return false;
      if (lt !== undefined && !(actual < lt)) return false;
      if (lte !== undefined && !(actual <= lte)) return false;
      continue;
    }

    if (actual !== expected) return false;
  }
  return true;
};

const applyData = (row: Row, data: Row): void => {
  for (const [key, value] of Object.entries(data)) {
    row[key] =
      value && typeof value === 'object' && 'increment' in (value as Row)
        ? (row[key] ?? 0) + Number((value as Row).increment)
        : value;
  }
};

const collection = (rows: Row[], nextId: () => string) => ({
  findFirst: async ({ where, orderBy }: Row = {}) => {
    const hit = rows.filter((r) => matches(r, where));
    if (!hit.length) return null;
    const sorted = [...hit];
    if (orderBy?.createdAt) sorted.reverse();
    return { ...sorted[0] };
  },
  findUnique: async ({ where }: Row = {}) => {
    const hit = rows.find((r) => matches(r, where));
    return hit ? { ...hit } : null;
  },
  findUniqueOrThrow: async ({ where }: Row = {}) => {
    const hit = rows.find((r) => matches(r, where));
    if (!hit) throw new Error(`findUniqueOrThrow matched no row: ${JSON.stringify(where)}`);
    return { ...hit };
  },
  findMany: async ({ where, orderBy, skip, take }: Row = {}) => {
    let hits = rows.filter((r) => matches(r, where)).map((r) => ({ ...r }));
    if (orderBy?.createdAt) hits.reverse();
    if (skip !== undefined) hits = hits.slice(Number(skip));
    if (take !== undefined) hits = hits.slice(0, Number(take));
    return hits;
  },
  create: async ({ data }: Row) => {
    const row = { id: nextId(), attempts: 0, isVerified: false, createdAt: new Date(), ...data };
    rows.push(row);
    return { ...row };
  },
  updateMany: async ({ where, data }: Row) => {
    let count = 0;
    for (const row of rows) {
      if (!matches(row, where)) continue;
      applyData(row, data);
      count += 1;
    }
    return { count };
  },
  update: async ({ where, data }: Row) => {
    const row = rows.find((r) => matches(r, where));
    if (!row) throw new Error(`update matched no row: ${JSON.stringify(where)}`);
    applyData(row, data);
    return { ...row };
  },
  delete: async ({ where }: Row) => {
    const idx = rows.findIndex((r) => matches(r, where));
    if (idx >= 0) rows.splice(idx, 1);
    return {};
  },
  deleteMany: async ({ where }: Row = {}) => {
    let count = 0;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (matches(rows[i], where)) {
        rows.splice(i, 1);
        count += 1;
      }
    }
    return { count };
  },
  upsert: async ({ where, create, update }: Row) => {
    const hit = rows.find((r) => matches(r, where.identifier_type_channel ?? {}));
    if (hit) {
      applyData(hit, update);
      return { ...hit };
    }
    const row = { id: nextId(), attempts: 0, isVerified: false, createdAt: new Date(), ...create };
    rows.push(row);
    return { ...row };
  },
  count: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).length,
});

export interface FakeStore {
  db: {
    users: Row[];
    otps: Row[];
    verifications: Row[];
    refreshTokens: Row[];
    passwordHistory: Row[];
    vendors: Row[];
    devices: Row[];
    bans: Row[];
    seq: number;
  };
  prisma: Record<string, any>;
  reset: () => void;
}

export const createFakeStore = (): FakeStore => {
  const db = {
    users: [] as Row[],
    otps: [] as Row[],
    verifications: [] as Row[],
    refreshTokens: [] as Row[],
    passwordHistory: [] as Row[],
    vendors: [] as Row[],
    devices: [] as Row[],
    bans: [] as Row[],
    seq: 0,
  };

  const id = () => `id_${(db.seq += 1)}`;

  const prisma = {
    user: {
      ...collection(db.users, id),
      findFirst: async (args: Row = {}) => {
        const hit = db.users.find((r) => matches(r, args.where));
        return hit ? { ...hit, vendorProfile: null } : null;
      },
    },
    otp: collection(db.otps, id),
    authVerification: collection(db.verifications, id),
    refreshToken: collection(db.refreshTokens, id),
    passwordHistory: collection(db.passwordHistory, id),
    vendorProfile: collection(db.vendors, id),
    device: collection(db.devices, id),
    customerBan: collection(db.bans, id),

    $transaction: async (arg: any) => {
      if (typeof arg === 'function') return arg(prisma);
      return Promise.all(arg);
    },
  };

  return {
    db,
    prisma,
    reset: () => {
      db.users.length = 0;
      db.otps.length = 0;
      db.verifications.length = 0;
      db.refreshTokens.length = 0;
      db.passwordHistory.length = 0;
      db.vendors.length = 0;
      db.devices.length = 0;
      db.bans.length = 0;
      db.seq = 0;
    },
  };
};

export const TEST_CODE = '424242';

export const store: FakeStore = createFakeStore();

export const makeUser = (over: Row = {}): Row => ({
  id: 'user-1',
  name: 'Ravi',
  email: 'ravi@example.com',
  phone: '+919876543210',
  role: 'CUSTOMER',
  isActive: true,
  isEmailVerified: true,
  isPhoneVerified: false,
  avatarUrl: '',
  twoFactorEnabled: false,
  lastLoginAt: null,
  createdAt: new Date(),
  vendorProfile: null,
  passwordHash: 'Secret@123$bcrypt$',
  failedLoginAttempts: 0,
  lockedUntil: null,
  ...over,
});
