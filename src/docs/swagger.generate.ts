import type { Application } from 'express';
import { zodToParameters, zodToRequestSchema } from './zod-to-openapi';

type Json = Record<string, any>;

interface RouteFacts {
  path: string;
  methods: Set<string>;
  params?: any;
  query?: any;
  body?: any;
  headers?: any;
  requiresAuth: boolean;
  optionalAuth: boolean;
  roles: string[];

  multipart: boolean;
}

const SEGMENT_TAGS: Record<string, string> = {
  auth: 'Auth',
  users: 'Users',
  vendors: 'Vendors',
  products: 'Products',
  categories: 'Categories',
  brands: 'Brands',
  attributes: 'Attributes',
  collections: 'Collections',
  cart: 'Cart',
  wishlist: 'Wishlist',
  orders: 'Orders',
  payments: 'Payments',
  payouts: 'Payouts',
  returns: 'Returns',
  reviews: 'Reviews',
  questions: 'Questions',
  coupons: 'Coupons',
  flashSales: 'Flash Sales',
  loyalty: 'Loyalty',
  referral: 'Referrals',
  giftCards: 'Gift Cards',
  templates: 'Templates',
  pages: 'Content',
  blogs: 'Content',
  faqs: 'Content',
  banners: 'Content',
  contact: 'Content',
  newsletter: 'Content',
  countries: 'Countries',
  currencies: 'Currencies',
  tax: 'Tax',
  i18n: 'Content',
  content: 'Content',
  webhooks: 'Webhooks',
  bulk: 'Content',
  reports: 'Reports',
  apiKeys: 'API Keys',
  notifications: 'Notifications',
  chat: 'Chat',
  tickets: 'Tickets',
  shipping: 'Shipping',
  deliveryBoys: 'Delivery',
  settings: 'Settings',
  admin: 'Admin',
  auditLogs: 'Admin',
  activityLogs: 'Admin',
  track: 'Tracking',
  devices: 'Tracking',
  analytics: 'Analytics',
  search: 'Search',
  uploads: 'Upload',
  health: 'Health',
  version: 'Health',
  docs: 'Health',
};

const tagFor = (specPath: string): string => {
  const segment = specPath.split('/').filter(Boolean)[0] ?? '';
  if (SEGMENT_TAGS[segment]) return SEGMENT_TAGS[segment];

  return segment
    .replace(/[-_](\w)/g, (_m, c: string) => c.toUpperCase())
    .replace(/^./, (c: string) => c.toUpperCase());
};

/**
 * Builds a readable summary for a route that has no hand-written one.
 *
 * Without this, operations whose module never wrote an `@openapi` summary render as a
 * bare path with an empty summary column, which reads as unfinished. The action name is
 * taken from the last meaningful segment, so `POST /auth/changePassword` becomes
 * "Change password" rather than a restated URL.
 */
const summaryFor = (method: string, specPath: string): string => {
  const segments = specPath.split('/').filter(Boolean);

  while (segments.length && /^\{.+\}$/.test(segments[segments.length - 1])) segments.pop();
  const action = segments[segments.length - 1] ?? specPath;

  const words = action
    .replace(/[-_]+/g, ' ')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    /*
     * Splits camelCase only. `([a-z0-9])([A-Z])` would turn `disable2FA` into
     * "Disable2 FA", so digits stay attached to the letter that follows them.
     */
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  const verb =
    method === 'get' ? 'Get' : method === 'post' ? '' : method === 'patch' ? '' : 'Delete';

  const sentence = `${verb ? `${verb} ` : ''}${words}`.trim();
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const withResponseEnvelopes = (responses: Json, paginated: boolean): Json => {
  const out: Json = {};

  for (const [code, value] of Object.entries<any>(responses)) {
    const status = Number(code);
    const isError = status >= 400;
    const ref = isError
      ? '#/components/schemas/ErrorResponse'
      : paginated
        ? '#/components/schemas/PaginatedResponse'
        : '#/components/schemas/SuccessResponse';

    out[code] = value?.content
      ? value
      : {
          ...value,
          content: {
            'application/json': {
              schema: {
                $ref: ref,
                ...(paginated && !isError
                  ? { description: `Pagination block plus this endpoint's own payload keys.` }
                  : {}),
              },
            },
          },
        };
  }

  return out;
};

const mountPath = (src: string): string => {
  const decoded = src.replace(/\\\//g, '/').replace(/^\^/, '');
  const at = decoded.search(/\(\?=/);
  const body = at === -1 ? decoded : decoded.slice(0, at);
  return body.replace(/\$$/, '').replace(/\/\?$/, '').replace(/\/$/, '');
};

const ERROR_STATUSES: [number, string][] = [
  [400, 'The request failed validation'],
  [401, 'Not signed in, or the token is missing or expired'],
  [403, 'Signed in, but not allowed to do this'],
  [404, 'No such record'],
  [409, 'Conflicts with something that already exists'],
  [413, 'The payload is too large'],
  [422, 'The request was well formed but cannot be processed'],
  [429, 'Rate limit reached'],
];

export const buildFromRouter = (app: Application, stripPrefix: string): Json => {
  const facts = new Map<string, RouteFacts>();

  const walk = (stack: any[], pathPrefix: string): void => {
    for (const layer of stack ?? []) {
      if (layer.route) {
        const full = `${pathPrefix}${layer.route.path}`.replace(/\/{2,}/g, '/');
        const entry =
          facts.get(full) ??
          ({
            path: full,
            methods: new Set<string>(),
            requiresAuth: false,
            optionalAuth: false,
            roles: [],
            multipart: false,
          } as RouteFacts);
        facts.set(full, entry);

        for (const m of Object.keys(layer.route.methods ?? {})) {
          if (layer.route.methods[m]) entry.methods.add(m);
        }

        for (const handler of layer.route.stack ?? []) {
          const fn = handler.handle;
          if (!fn) continue;

          if (fn.validatedSchemas) {
            entry.params = entry.params ?? fn.validatedSchemas.params;
            entry.query = entry.query ?? fn.validatedSchemas.query;
            entry.body = entry.body ?? fn.validatedSchemas.body;
            entry.headers = entry.headers ?? fn.validatedSchemas.headers;
          }

          if (fn.requiresAuth) entry.requiresAuth = true;
          if (fn.optionalAuth) entry.optionalAuth = true;
          if (Array.isArray(fn.requiredRoles)) entry.roles.push(...fn.requiredRoles);

          const name = fn.name ?? '';
          if (
            name.includes('multer') ||
            name.includes('uploadSingle') ||
            name.includes('uploadFiles')
          ) {
            entry.multipart = true;
          }
        }

        continue;
      }

      if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, `${pathPrefix}${mountPath(layer.regexp?.source ?? '')}`);
      }
    }
  };

  walk((app as any)._router?.stack ?? [], '');

  const paths: Json = {};

  for (const entry of facts.values()) {
    const withoutPrefix =
      stripPrefix && entry.path.startsWith(stripPrefix)
        ? entry.path.slice(stripPrefix.length) || '/'
        : entry.path;

    const specPath = withoutPrefix.replace(/:([A-Za-z_]\w*)/g, '{$1}');
    const declared = [...specPath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

    const parameters: Json[] = [];

    const fromParams = entry.params ? zodToParameters(entry.params, 'path') : [];
    for (const declaredName of declared) {
      const match = fromParams.find((p) => p.name === declaredName);
      parameters.push(
        match ?? { name: declaredName, in: 'path', required: true, schema: { type: 'string' } },
      );
    }

    if (entry.query) parameters.push(...zodToParameters(entry.query, 'query'));
    if (entry.headers) parameters.push(...zodToParameters(entry.headers, 'header'));

    const security: Json[] = entry.requiresAuth
      ? [{ bearerAuth: [] }]
      : entry.optionalAuth
        ? [{ bearerAuth: [] }, {}]
        : [];

    const securityForOperation = security.length ? security : [];

    const roleNote = entry.roles.length
      ? ` Requires one of: ${[...new Set(entry.roles)].join(', ')}.`
      : '';
    const authNote = entry.requiresAuth
      ? ' Requires a bearer token.'
      : entry.optionalAuth
        ? ' A bearer token is optional.'
        : '';

    const isWrite = ['post', 'put', 'patch'];

    const isPaginated = Object.keys((entry.query?.shape ?? {}) as Json).some(
      (k) => k === 'page' || k === 'limit',
    );

    for (const method of METHODS) {
      if (!entry.methods.has(method)) continue;

      const operation: Json = { tags: [tagFor(specPath)] };
      if (parameters.length) operation.parameters = parameters;

      operation.security = securityForOperation;

      const responses: Json = {};

      if (method === 'get') {
        responses['200'] = { description: 'Request succeeded' };
      } else if (entry.multipart) {
        responses['201'] = { description: 'Created' };
      } else {
        responses['201'] = { description: 'Created' };
      }

      if (entry.requiresAuth) responses['401'] = { description: 'Not signed in' };
      if (entry.roles.length) responses['403'] = { description: 'Not allowed for this role' };

      if (entry.params) {
        responses['404'] = { description: 'No such record' };
      }
      if (method === 'delete' || method === 'put' || method === 'patch') {
        responses['409'] = { description: 'Conflicts with existing data' };
      }

      if (entry.params || entry.query || entry.body) {
        responses['400'] = { description: 'Validation failed' };
      }

      operation.responses = withResponseEnvelopes(responses, isPaginated);

      if (isWrite.includes(method as any) && entry.body) {
        operation.requestBody = {
          required: true,
          content: {
            'application/json': { schema: zodToRequestSchema(entry.body) },
          },
        };
      } else if (entry.multipart) {
        operation.requestBody = {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary', example: 'photo.jpg' },
                  ...(method === 'post' && entry.path.includes('uploadImages')
                    ? {
                        files: {
                          type: 'array',
                          items: { type: 'string', format: 'binary' },
                          example: ['photo.jpg'],
                        },
                      }
                    : {}),
                },
              },
            },
          },
        };
      } else if (isWrite.includes(method as any)) {
        operation.requestBody = {
          required: false,
          content: { 'application/json': { schema: { type: 'object', properties: {} } } },
        };
      }

      // The hand-written `@openapi` summary wins; the derived notes are appended only

      const existing = paths[specPath]?.[method];
      if (existing?.description) {
        operation.description = `${existing.description}${authNote}${roleNote}`;
      } else if (authNote || roleNote) {
        operation.description = `${authNote}${roleNote}`.trim();
      }
      if (existing?.summary) operation.summary = existing.summary;
      if (existing?.tags) operation.tags = existing.tags;

      if (!operation.summary && !operation.description) {
        operation.description = `${method.toUpperCase()} ${specPath}`;
      }
      if (!operation.summary) operation.summary = summaryFor(method, specPath);
      if (existing?.requestBody && !operation.requestBody)
        operation.requestBody = existing.requestBody;
      if (existing?.responses) {
        operation.responses = { ...responses, ...existing.responses };
      }

      paths[specPath] = paths[specPath] ?? {};
      paths[specPath][method] = operation;
    }
  }

  void ERROR_STATUSES;
  return paths;
};
