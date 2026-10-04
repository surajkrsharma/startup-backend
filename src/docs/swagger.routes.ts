import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import fs from 'fs';
import path from 'path';
import { APP } from '../config/app.config';
import { packageJson } from '../config/package.meta';
import { SERVER_SCHEMA } from './schemas';

/**
 * Every module is documented with `@openapi` blocks, and different modules put
 * them in different files, so both route and controller files are scanned.
 * Missing one of the two silently drops that module's paths from the spec.
 *
 * After `tsc` this module runs from `dist/docs`, so the sibling modules live in
 * `dist/modules` and carry a `.js` extension; under `tsx` they are `.ts`. Both
 * extensions are matched so the spec is identical in dev and in a deployed build.
 */
const DOC_EXTENSIONS = ['.ts', '.js'];

const docFiles = (): string[] => {
  const modulesDir = path.join(__dirname, '..', 'modules');
  const files: string[] = [];

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        DOC_EXTENSIONS.some(
          (ext) => entry.name.endsWith(`.routes${ext}`) || entry.name.endsWith(`.controller${ext}`),
        )
      ) {
        files.push(full);
      }
    }
  };

  walk(modulesDir);
  return files;
};

export const swaggerSpec: swaggerJsdoc.OAS3Definition = {
  openapi: '3.0.3',
  info: {
    title: `${packageJson.name} API`,
    version: packageJson.version,
    description: [
      'Multi-vendor marketplace API — Node + Express + TypeScript + Prisma + PostgreSQL + Redis.',
      '',
      '## Response envelope (strict)',
      'Every response has exactly three top-level keys, in this order:',
      '1. `status`  — boolean',
      '2. `message` — string (never empty)',
      '3. `result`  — object (never null, never a bare array)',
      '',
      'Errors append the code to the message: `"Product not found. Error Code (NOT_FOUND)"` and always return `result: {}`.',
      'Request correlation is returned in the `X-Request-Id` response header, never in the body.',
      '',
      '## Pagination',
      '`?page=1&limit=20&sort=-createdAt&search=`. Pagination numbers appear first inside `result`,',
      'only when an `xxxList` is present.',
      '',
      '## Optional transport encryption',
      'Set `ENCRYPTION_ENABLED=true` on the server and send `x-encrypted: 1` with a body of',
      '`{ iv, tag, data }` (AES-256-GCM). The response is then `{ encrypted: true, iv, tag, data }`.',
      'Skipped for `/health`, `/docs`, `/webhooks` and `/track`.',
      '',
      '## Naming',
      'CRUD resources are REST-style (`GET /products`); self-operations are camelCase verbs',
      '(`updateProfile`, `cancelOrder`, `getAll`). Multi-word modules are camelCase.',
    ].join('\n'),
  },
  servers: [
    {
      url:
        process.env.PUBLIC_API_URL ??
        `http://localhost:${process.env.PORT ?? APP.DEFAULT_PORT}${APP.API_PREFIX}`,
      description: process.env.PUBLIC_API_URL ? 'Server' : 'Local',
    },
  ],
  tags: [
    { name: 'Auth' },
    { name: 'Users' },
    { name: 'Vendors' },
    { name: 'Products' },
    { name: 'Categories' },
    { name: 'Brands' },
    { name: 'Attributes' },
    { name: 'Collections' },
    { name: 'Orders' },
    { name: 'Payments' },
    { name: 'Payouts' },
    { name: 'Returns' },
    { name: 'Cart' },
    { name: 'Wishlist' },
    { name: 'Coupons' },
    { name: 'Flash Sales' },
    { name: 'Reviews' },
    { name: 'Questions' },
    { name: 'Shipping' },
    { name: 'Delivery' },
    { name: 'Settings' },
    { name: 'Admin' },
    { name: 'Notifications' },
    { name: 'Chat' },
    { name: 'Tickets' },
    { name: 'Analytics' },
    { name: 'Tracking' },
    { name: 'Search' },
    { name: 'Upload' },
    { name: 'Content' },
    { name: 'Loyalty' },
    { name: 'Referrals' },
    { name: 'Gift Cards' },
    { name: 'Templates' },
    { name: 'Health' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    },
    schemas: SERVER_SCHEMA,
  },
};

const spec = swaggerJsdoc({
  swaggerDefinition: swaggerSpec as any,
  apis: docFiles(),
});

/**
 * The Swagger UI page, inlined as a string.
 *
 * It used to be a separate `swagger-ui.html` file read with `res.sendFile`. tsc only
 * emits `.ts`, so the HTML never reached `dist/` and every `/docs` request in a built
 * (deployed) app was a 500 — `ENOENT ... dist/docs/swagger-ui.html`. Keeping it here
 * means the compiler carries it into `dist/docs/swagger.routes.js` on its own.
 *
 * It loads swagger-ui-dist from a CDN, so it needs outbound internet. That is fine
 * for the internal API docs; if this ever has to work air-gapped, vendor the three
 * assets instead.
 */
const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${packageJson.name} API — Swagger UI</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
      crossorigin="anonymous"
    />
    <style>
      body {
        margin: 0;
        background: #fafafa;
      }
      .topbar {
        display: none;
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin="anonymous"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js" crossorigin="anonymous"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: './docs.json',
          dom_id: '#swagger-ui',
          deepLinking: true,
          displayRequestDuration: true,
          persistAuthorization: true,
          tryItOutEnabled: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          plugins: [SwaggerUIStandalonePreset.plugins.DownloadUrl],
          layout: 'BaseLayout',
        });
      };
    </script>
  </body>
</html>`;

/** Serves Swagger UI at /docs and the raw spec at /docs.json. */
export const docsRouter = Router();

docsRouter.get('/', (_req, res) => {
  res.type('html').send(SWAGGER_UI_HTML);
});

docsRouter.use(
  swaggerUi.serveFiles(undefined, {
    explorer: true,
    customSiteTitle: `${packageJson.name} API`,
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  }),
);

docsRouter.get('/docs.json', (_req, res) => {
  res.json(spec);
});

export const getSpec = () => spec;
