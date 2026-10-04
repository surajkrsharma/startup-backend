/**
 * Generates a Postman collection (v2.1) plus Local/Live environments from the
 * OpenAPI spec this app already serves.
 *
 * Reading the spec rather than re-deriving from the router is deliberate: the spec is
 * what `/api/v1/docs.json` publishes, so the collection can never drift from the docs,
 * and it inherits the Zod-derived examples without a second converter to maintain.
 *
 * Run: npx tsx scripts/generate-postman.ts [outputDir]
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/app';
import { getSpec } from '../src/docs/swagger.routes';

const OUT_DIR = process.argv[2] ?? join(process.env.USERPROFILE ?? '.', 'Desktop', 'postman');

const COLLECTION_NAME = 'Startup Marketplace API';
const LIVE_URL = 'https://startup-backend-m2uh.onrender.com/api/v1';
const LOCAL_URL = 'http://localhost:5000/api/v1';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Folders first: everything else is easier to reach once a session exists. */
const TAG_ORDER = ['Auth', 'Users', 'Vendors', 'Products', 'Categories', 'Cart', 'Orders'];

type Json = Record<string, any>;

const uuid = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/**
 * Resolves a local `#/components/schemas/...` pointer against the spec.
 *
 * Walks the pointer segment by segment from the document root. Rewriting the pointer
 * into a bare name and indexing `spec.components` looks equivalent and is not: the
 * schemas live one level deeper, under `components.schemas`, so every `$ref` silently
 * resolved to `undefined` and the request lost its body.
 */
const resolveRef = (ref: string, spec: Json): Json =>
  ref
    .replace(/^#\//, '')
    .split('/')
    .reduce<any>((node, key) => (node == null ? node : node[key]), spec) ?? {};

/** Collapses `oneOf`/`allOf` so a union request body still produces one usable object. */
const flatten = (schema: any, spec: Json, depth = 0): Json => {
  if (!schema || depth > 8) return {};
  if (schema.$ref) return flatten(resolveRef(schema.$ref, spec), spec, depth + 1);

  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    // First branch: for `/auth/register` that is the CUSTOMER shape, which is the
    // simplest valid body. Picking a later branch would send shopName to a
    // CUSTOMER-only endpoint and earn a 400.
    return flatten(schema.oneOf?.[0] ?? schema.anyOf?.[0], spec, depth + 1);
  }

  if (Array.isArray(schema.allOf)) {
    const merged: Json = {};
    for (const part of schema.allOf) {
      Object.assign(merged, flatten(part, spec, depth + 1));
    }
    return merged;
  }

  return schema;
};

/**
 * Turns a JSON Schema into a concrete request body.
 *
 * Includes optional properties too, matching what Swagger's own example pane shows,
 * so the collection doubles as a field reference.
 */
const exampleFor = (schema: any, spec: Json, depth = 0): any => {
  const s = flatten(schema, spec, depth);
  if (!s || depth > 10) return null;

  if (s.enum?.length) return s.enum[0];

  switch (s.type) {
    case 'object': {
      const out: Json = {};
      for (const [key, prop] of Object.entries<any>(s.properties ?? {})) {
        out[key] = exampleFor(prop, spec, depth + 1);
      }
      return out;
    }
    case 'array':
      return [exampleFor(s.items, spec, depth + 1)];
    case 'integer':
    case 'number':
      return s.example ?? s.default ?? 1;
    case 'boolean':
      return s.example ?? s.default ?? true;
    case 'string':
    default: {
      if (s.example !== undefined) return s.example;
      if (s.default !== undefined) return s.default;
      if (s.format === 'date-time') return '2026-01-15T10:30:00.000Z';
      if (s.format === 'date') return '2026-01-15';
      if (s.format === 'email') return 'user@example.com';
      if (s.format === 'uuid') return '3f1b7c2e-9a44-4d1b-8f6a-2c9e5d7b1a03';
      if (s.format === 'uri' || s.format === 'url') return 'https://example.com';
      if (s.format === 'binary') return 'photo.jpg';
      return 'string';
    }
  }
};

const headerRows = (op: Json): Json[] => {
  const rows: Json[] = [];

  const accepts = Object.keys(op.requestBody?.content ?? {});
  if (accepts.includes('application/json')) {
    rows.push({ key: 'Content-Type', value: 'application/json' });
  } else if (accepts.includes('multipart/form-data')) {
    rows.push({ key: 'Content-Type', value: 'multipart/form-data' });
  }

  rows.push({ key: 'Accept', value: 'application/json' });
  return rows;
};

const bodyFor = (op: Json, spec: Json): Json | undefined => {
  const content = op.requestBody?.content ?? {};

  if (content['multipart/form-data']) {
    const schema = flatten(content['multipart/form-data'].schema, spec);
    const entries = Object.entries<any>(schema.properties ?? {}).map(([key, prop]) => ({
      key,
      type: prop.type === 'array' || prop.format === 'binary' ? 'file' : 'text',
      value: prop.format === 'binary' ? 'photo.jpg' : String(exampleFor(prop, spec) ?? ''),
      ...(prop.description ? { description: prop.description } : {}),
    }));
    return { mode: 'formdata', formdata: entries };
  }

  const schema = content['application/json']?.schema;
  if (!schema) return undefined;

  const example = exampleFor(schema, spec);
  if (example === null || typeof example !== 'object') return undefined;

  return {
    mode: 'raw',
    raw: JSON.stringify(example, null, 2),
    options: { raw: { language: 'json' } },
  };
};

/** Renders a schema example as a query-string value. */
const queryValue = (param: Json): string => {
  const raw = param.example ?? param.schema?.example ?? param.schema?.default;
  if (raw === undefined || raw === null) return '';
  if (Array.isArray(raw)) return raw.join(',');
  return String(raw);
};

const urlFor = (path: string, op: Json): Json => {
  const pathSegments: string[] = [];
  const variables: Json[] = [];

  for (const segment of path.split('/').filter(Boolean)) {
    const match = segment.match(/^\{(.+)\}$/);
    if (match) {
      const param = (op.parameters ?? []).find((p: Json) => p.in === 'path' && p.name === match[1]);
      const value = param?.example ?? param?.schema?.example ?? 'value';
      pathSegments.push(`:${match[1]}`);
      variables.push({
        key: match[1],
        value: String(value),
        ...(param?.description ? { description: param.description } : {}),
      });
    } else {
      pathSegments.push(segment);
    }
  }

  /*
   * A documented query param is not automatically a required one. Params the schema
   * gave no usable value for are kept in the list for discoverability but shipped
   * disabled, so the generated URL stays clean and a run does not fail on a literal
   * `sort=string` that no server would accept.
   */
  const allQuery = (op.parameters ?? []).filter((p: Json) => p.in === 'query');
  const query = allQuery.map((p: Json) => {
    const value = queryValue(p);
    const usable = value !== '' && value !== 'string';
    return {
      key: p.name,
      value,
      ...(usable ? {} : { disabled: true }),
      ...(p.description ? { description: p.description } : {}),
    };
  });

  const active = query.filter((q: Json) => !q.disabled);
  const raw = `{{baseUrl}}/${pathSegments.join('/')}${
    active.length ? `?${active.map((q: Json) => `${q.key}=${q.value}`).join('&')}` : ''
  }`;

  const url: Json = {
    raw,
    host: ['{{baseUrl}}'],
    path: pathSegments,
  };
  if (query.length) url.query = query;
  if (variables.length) url.variable = variables;
  return url;
};

/**
 * One collection-level test script instead of 492 copies.
 *
 * It captures whatever a response happens to return, so `{{accessToken}}`,
 * `{{refreshToken}}` and the id-style variables fill themselves in as soon as
 * register/login/refresh has been run once - no per-request wiring to maintain.
 */
const COLLECTION_TESTS = [
  'const j = pm.response.json();',
  'const r = (j && j.result) || {};',
  "if (r.accessToken) pm.environment.set('accessToken', r.accessToken);",
  "if (r.identifier) pm.environment.set('identifier', r.identifier);",
  "const rt = pm.cookies.get('refreshToken');",
  "if (rt) pm.environment.set('refreshToken', rt);",
  "for (const k of ['id', 'userId', 'vendorId', 'productId', 'orderId', 'cartItemId', 'couponId', 'conversationId']) {",
  "  if (typeof r[k] === 'string' && r[k]) { pm.environment.set(k, r[k]); break; }",
  '}',
  'if (j && j.status === false) console.warn(j.message);',
];

const environment = (name: string, baseUrl: string): Json => ({
  id: uuid(),
  name,
  values: [
    { key: 'baseUrl', value: baseUrl, enabled: true },
    { key: 'accessToken', value: '', enabled: true },
    { key: 'refreshToken', value: '', enabled: true },
    { key: 'otp', value: '111111', enabled: true },
    { key: 'identifier', value: 'user@example.com', enabled: true },
    { key: 'email', value: 'user@example.com', enabled: true },
    { key: 'phone', value: '+919876543210', enabled: true },
    { key: 'password', value: 'Secret@123', enabled: true },
    { key: 'name', value: 'Test User', enabled: true },
    { key: 'shopName', value: 'Test Store', enabled: true },
  ],
  _postman_variable_scope: 'environment',
});

const main = (): void => {
  process.env.LOG_LEVEL = 'silent';
  const spec: Json = getSpec(createApp());

  const folders = new Map<string, Json[]>();
  let count = 0;

  for (const [path, methods] of Object.entries<any>(spec.paths ?? {})) {
    for (const method of METHODS) {
      const op = methods[method];
      if (!op) continue;

      const tag = op.tags?.[0] ?? 'Other';
      const body = bodyFor(op, spec);

      const request: Json = {
        method: method.toUpperCase(),
        header: headerRows(op),
        url: urlFor(path, op),
      };
      if (body) request.body = body;
      // `security: []` is how the spec marks a public endpoint, so it must not inherit
      // the collection's bearer token.
      if (Array.isArray(op.security) && op.security.length === 0) {
        request.auth = { type: 'noauth' };
      }

      const description = [op.summary, op.description].filter(Boolean).join('\n\n');
      const lines = [
        `${method.toUpperCase()} {{baseUrl}}${path}`,
        '',
        description,
        '',
        ...(op.security?.length
          ? ['Requires a bearer token (`{{accessToken}}`).']
          : ['Public - no token needed.']),
      ].filter((line) => line !== undefined);

      const item: Json = { name: `${method.toUpperCase()} ${path}`, request };
      if (lines.join('\n').trim()) item.request.description = lines.join('\n');

      if (!folders.has(tag)) folders.set(tag, []);
      folders.get(tag)!.push(item);
      count += 1;
    }
  }

  const item = [...folders.entries()]
    .sort((a, b) => {
      const ai = TAG_ORDER.indexOf(a[0]);
      const bi = TAG_ORDER.indexOf(b[0]);
      if (ai === -1 && bi === -1) return a[0].localeCompare(b[0]);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(([tag, items]) => ({
      name: tag,
      item: items.sort((a, b) => a.name.localeCompare(b.name)),
    }));

  const collection = {
    info: {
      _postman_id: uuid(),
      name: COLLECTION_NAME,
      description: [
        "Generated from the API's own OpenAPI spec (`/api/v1/docs.json`), so it cannot drift from the docs.",
        '',
        'Pick the **Local** or **Live** environment from the environment selector (top right) before running anything.',
        '',
        'Run the **Auth** folder first. The collection-level test script captures `accessToken`, `refreshToken` and the id variables automatically from whatever responses return them, so every protected request below works without manual wiring.',
        '',
        '`{{otp}}` is the one variable you must fill in by hand: OTPs are sent to the email/phone, never returned in a response. Send it via `POST /auth/sendOtp`, read the code, then paste it into the environment.',
      ].join('\n'),
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    },
    event: [
      {
        listen: 'test',
        script: { type: 'text/javascript', exec: COLLECTION_TESTS },
      },
    ],
    item,
  };

  mkdirSync(OUT_DIR, { recursive: true });

  const files = [
    [`${COLLECTION_NAME}.postman_collection.json`, JSON.stringify(collection, null, 2)],
    [
      'Environment-Local.postman_environment.json',
      JSON.stringify(environment('Local', LOCAL_URL), null, 2),
    ],
    [
      'Environment-Live.postman_environment.json',
      JSON.stringify(environment('Live', LIVE_URL), null, 2),
    ],
  ] as const;

  for (const [name, content] of files) {
    writeFileSync(join(OUT_DIR, name), content, 'utf8');
  }

  process.stdout.write(`requests : ${count}\nfolders  : ${folders.size}\noutput   : ${OUT_DIR}\n`);
};

main();
