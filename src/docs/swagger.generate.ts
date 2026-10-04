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
  /** Set when multer is in the chain, so the body is described as multipart. */
  multipart: boolean;
}

/**
 * Maps a route's first path segment onto one of the declared tags.
 *
 * Without a tag Swagger UI drops an operation into a single unnamed "default" group,
 * so 400+ endpoints become one unusable list. Deriving the tag from the mount point
 * keeps the grouping correct without a hand-written tag on every route.
 */
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

  // `flash-sales`, `gift-cards`, `api-keys` and friends read better title-cased.
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
  // Drop a trailing `{id}`-style segment: it says nothing about the action.
  while (segments.length && /^\{.+\}$/.test(segments[segments.length - 1])) segments.pop();
  const action = segments[segments.length - 1] ?? specPath;

  const words = action
    .replace(/[-_]+/g, ' ')
    // Split an acronym off the word that follows it: `HTTPResponse` -> `HTTP Response`.
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // Then split camelCase. Deliberately not `([a-z0-9])([A-Z])`: that turns
    // `disable2FA` into "Disable2 FA" instead of "Disable2FA".
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

  const verb =
    method === 'get' ? 'Get' : method === 'post' ? '' : method === 'patch' ? '' : 'Delete';

  const sentence = `${verb ? `${verb} ` : ''}${words}`.trim();
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * Gives every documented status a response body schema.
 *
 * Without this a response is just a sentence, and Swagger's "Try it out" shows an
 * empty pane - which is how 2000+ documented responses ended up describing nothing.
 * Every handler in this service answers through `ApiResponse`, so the envelope is the
 * same everywhere and can be referenced rather than restated per endpoint.
 */
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

/**
 * Decodes an Express mount path out of its regexp source.
 *
 * A mount compiles to `^\/api(?=\/|$)` and a root mount to `^\/?(?=\/|$)`, so the
 * lookahead tail has to come off before the rest can be used as a prefix.
 */
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

/**
 * Reads the real Express routing table and derives what each operation accepts.
 *
 * Everything here comes off the handlers themselves - the Zod schemas hung on
 * `validate()` and the markers on the auth guards - so the spec describes the code
 * rather than a copy of it.
 */
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

          // multer marks its handler by name on the wrapped function.
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
    /*
     * The spec's `servers[0].url` already ends with the API prefix, so a path key must
     * NOT repeat it. Emitting `/api/v1/auth/register` next to jsdoc's
     * `/auth/register` produced two entries for every single endpoint.
     */
    const withoutPrefix =
      stripPrefix && entry.path.startsWith(stripPrefix)
        ? entry.path.slice(stripPrefix.length) || '/'
        : entry.path;

    // The spec keys paths by the Express form with `:id` turned into `{id}`.
    const specPath = withoutPrefix.replace(/:([A-Za-z_]\w*)/g, '{$1}');
    const declared = [...specPath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);

    const parameters: Json[] = [];

    // A path param is required by definition, whatever the schema says.
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

    /*
     * An empty array is meaningful, not an omission: it states "this endpoint is
     * public". Leaving `security` off an operation leaves it ambiguous, since a global
     * `security` elsewhere in the spec would silently apply to it.
     */
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

    /*
     * A `page`/`limit` pair in the query schema is what makes `ApiResponse.paginated`
     * come back instead of a plain result, so it is the only reliable signal.
     */
    const isPaginated = Object.keys((entry.query?.shape ?? {}) as Json).some(
      (k) => k === 'page' || k === 'limit',
    );

    for (const method of METHODS) {
      if (!entry.methods.has(method)) continue;

      const operation: Json = { tags: [tagFor(specPath)] };
      if (parameters.length) operation.parameters = parameters;
      // Always set it: `[]` is how a public endpoint says so explicitly.
      operation.security = securityForOperation;

      const responses: Json = {};

      if (method === 'get') {
        responses['200'] = { description: 'Request succeeded' };
      } else if (entry.multipart) {
        responses['201'] = { description: 'Created' };
      } else {
        responses['201'] = { description: 'Created' };
      }

      // Errors implied by the guards this route actually carries.
      if (entry.requiresAuth) responses['401'] = { description: 'Not signed in' };
      if (entry.roles.length) responses['403'] = { description: 'Not allowed for this role' };
      /*
       * 404 needs a record to miss. Tying it to the write verb instead put
       * "No such record" on every POST, including `/auth/register` and `/cart/addItem`,
       * which have no identifier to look up and can never return it.
       */
      if (entry.params) {
        responses['404'] = { description: 'No such record' };
      }
      if (method === 'delete' || method === 'put' || method === 'patch') {
        responses['409'] = { description: 'Conflicts with existing data' };
      }
      // Validation can fail on any endpoint that declares a schema.
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
        // multer routes take files, not a JSON body.
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
        /*
         * A write verb with no body schema takes no input - logout, clear, unblock and
         * friends. Saying so explicitly is better than omitting requestBody, where
         * Swagger's "Try it out" would leave a caller guessing.
         */
        operation.requestBody = {
          required: false,
          content: { 'application/json': { schema: { type: 'object', properties: {} } } },
        };
      }

      // The hand-written `@openapi` summary wins; the derived notes are appended only
      // when there is no prose yet, so nothing already written gets clobbered.
      const existing = paths[specPath]?.[method];
      if (existing?.description) {
        operation.description = `${existing.description}${authNote}${roleNote}`;
      } else if (authNote || roleNote) {
        operation.description = `${authNote}${roleNote}`.trim();
      }
      if (existing?.summary) operation.summary = existing.summary;
      if (existing?.tags) operation.tags = existing.tags;
      /*
       * Last resort so no operation renders as a bare URL in the UI. Written as a
       * description rather than a summary, since guessing a noun ("Fetches the
       * order") from a route path would be a guess the reader cannot check.
       */
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
