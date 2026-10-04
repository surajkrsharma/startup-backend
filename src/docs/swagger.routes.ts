import { Router, RequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUiDist from 'swagger-ui-dist';
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
 * Where swagger-ui's own assets are served from.
 *
 * The page used to pull CSS and JS from unpkg.com. That works on a developer
 * machine and fails behind a network that blocks the CDN — the symptom being a
 * blank /docs page, because the HTML arrives but the bundle never does.
 *
 * `swagger-ui-dist` already ships with the app as a dependency of
 * `swagger-ui-express`, so the exact same files are on disk. Serving them from here
 * removes the CDN entirely: the docs then work offline, behind a corporate proxy,
 * and on a network that blocks unpkg.
 *
 * Note that `require('swagger-ui-dist')` resolves to the *helpers*
 * (SwaggerUIBundle, absolutePath, ...), not to a map of assets, so the files are
 * read from `getAbsoluteFSPath()` rather than imported.
 */
const SWAGGER_ASSET_DIR = swaggerUiDist.getAbsoluteFSPath();

const swaggerAsset =
  (file: string): RequestHandler =>
  (_req, res) => {
    const full = path.join(SWAGGER_ASSET_DIR, file);

    if (!fs.existsSync(full)) {
      res.status(404).json({ status: false, message: 'Not found.', result: {} });
      return;
    }

    res
      .type(file.endsWith('.css') ? 'text/css' : 'application/javascript')
      .send(fs.readFileSync(full));
  };

/**
 * Root-relative paths for the page's own assets.
 *
 * Relative ones look right but are not: the page is served from `/api/v1/docs`
 * with no trailing slash, so a browser resolves `./swagger-ui.css` against the
 * directory `/api/v1/` and requests `/api/v1/swagger-ui.css`, which is not a
 * route. Every asset 404s and the page renders blank. Deriving the prefix from
 * APP.API_PREFIX keeps this correct if the prefix ever changes.
 */
const ASSET_BASE = `${APP.API_PREFIX}/docs`;

/**
 * The Swagger UI page, inlined as a string.
 *
 * It used to be a separate `swagger-ui.html` file read with `res.sendFile`. tsc only
 * emits `.ts`, so the HTML never reached `dist/` and every `/docs` request in a built
 * (deployed) app was a 500 — `ENOENT ... dist/docs/swagger-ui.html`. Keeping it here
 * means the compiler carries it into `dist/docs/swagger.routes.js` on its own.
 *
 * Two faults are guarded here, both of which produce a blank page with no visible
 * error and no failed request in the network tab:
 *
 *  1. Relative asset paths. The page is served from `/api/v1/docs` with no trailing
 *     slash, so a browser resolves `./swagger-ui.css` against `/api/v1/` and asks for
 *     `/api/v1/swagger-ui.css`, which is not a route. Paths are root-relative.
 *
 *  2. `plugins`. swagger-ui-dist 5.x does not export a DownloadUrl plugin from
 *     SwaggerUIStandalonePreset, so `SwaggerUIStandalonePreset.plugins.DownloadUrl`
 *     throws "Cannot read properties of undefined" inside window.onload and nothing
 *     renders at all. The plugin is optional (it only adds a download button), so it
 *     is left off rather than referenced from the wrong object.
 *
 * The loading panel is a deliberate safety net: if the bundle ever fails to execute
 * again, the page says so instead of showing an empty coloured rectangle.
 *
 * Theming: swagger-ui-dist ships no dark stylesheet and its CSS is hardcoded hex,
 * so the dark palette below is a set of overrides keyed off [data-theme="dark"] on
 * <html>. Light is the default; the choice is remembered in localStorage and
 * applied by an inline script that runs before the bundles, so the page never
 * flashes the wrong theme.
 */
const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${packageJson.name} API — Swagger UI</title>
    <link rel="stylesheet" href="${ASSET_BASE}/swagger-ui.css" />
    <style>
      /* ── Theme tokens ──────────────────────────────────────────────────────
         Everything below reads these, so a palette change is a one-line edit. */
      :root {
        --bg: #ffffff;
        --fg: #3b4151;
        --muted: #6b7280;
        --panel: #f7f8fa;
        --border: #d9dde3;
        --accent: #1b6ac9;
      }
      [data-theme='dark'] {
        --bg: #0b1020;
        --fg: #e6edf7;
        --muted: #9aa7bd;
        --panel: #131a2e;
        --border: #2b3550;
        --accent: #7cc4ff;
      }

      html,
      body {
        margin: 0;
        background: var(--bg);
        color: var(--fg);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .topbar {
        display: none;
      }

      /* ── Theme toggle ──────────────────────────────────────────────────── */
      #theme-toggle {
        position: fixed;
        top: 12px;
        right: 14px;
        z-index: 9999;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 7px 13px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--panel);
        color: var(--fg);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      #theme-toggle:hover {
        border-color: var(--accent);
        color: var(--accent);
      }

      /* ── Swagger surface, themed ─────────────────────────────────────────
         swagger-ui.css hardcodes its palette, so each container is overridden. */
      .swagger-ui,
      .swagger-ui .info .title,
      .swagger-ui .info p,
      .swagger-ui .info li,
      .swagger-ui .info a,
      .swagger-ui .opblock-tag,
      .swagger-ui .opblock .opblock-summary-path,
      .swagger-ui .opblock .opblock-summary-description,
      .swagger-ui .opblock .opblock-section-header,
      .swagger-ui .parameter__name,
      .swagger-ui .parameter__type,
      .swagger-ui table thead tr td,
      .swagger-ui table thead tr th,
      .swagger-ui .response-col_status,
      .swagger-ui .response-col_description,
      .swagger-ui label,
      .swagger-ui h1,
      .swagger-ui h2,
      .swagger-ui h3,
      .swagger-ui h4,
      .swagger-ui h5,
      .swagger-ui p {
        color: var(--fg);
      }
      .swagger-ui .info .base-url,
      .swagger-ui .model-title,
      .swagger-ui .prop-type {
        color: var(--muted);
      }
      .swagger-ui .scheme-container,
      .swagger-ui .opblock .opblock-section-header,
      .swagger-ui .opblock.opblock-get,
      .swagger-ui .opblock.opblock-post,
      .swagger-ui .opblock.opblock-put,
      .swagger-ui .opblock.opblock-patch,
      .swagger-ui .opblock.opblock-delete,
      .swagger-ui .opblock.opblock-head,
      .swagger-ui .opblock.opblock-options {
        background: var(--panel);
        border-color: var(--border);
        box-shadow: none;
      }
      .swagger-ui .opblock .opblock-summary-method,
      .swagger-ui .opblock.opblock-get .opblock-summary-method {
        background: var(--bg);
      }
      .swagger-ui select,
      .swagger-ui input[type='text'],
      .swagger-ui input[type='password'],
      .swagger-ui textarea {
        background: var(--bg);
        color: var(--fg);
        border-color: var(--border);
      }
      .swagger-ui .btn {
        background: var(--bg);
        color: var(--fg);
        border-color: var(--border);
      }
      .swagger-ui .btn.authorize {
        color: var(--accent);
        border-color: var(--accent);
      }
      .swagger-ui table tbody tr td {
        border-color: var(--border);
      }
      .swagger-ui .microlight,
      .swagger-ui code,
      .swagger-ui pre {
        background: var(--panel) !important;
        color: var(--fg) !important;
      }

      /* ── Failure panel ──────────────────────────────────────────────────────
         Also themed, so it stays readable if Swagger ever fails to boot. */
      #swagger-fallback {
        max-width: 780px;
        margin: 64px auto;
        padding: 24px 28px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--panel);
        color: var(--fg);
        line-height: 1.7;
      }
      #swagger-fallback h1 {
        margin: 0 0 12px;
        font-size: 17px;
        color: var(--accent);
      }
      #swagger-fallback code {
        background: var(--bg);
        padding: 2px 6px;
        border-radius: 4px;
      }
      #swagger-fallback ul {
        margin: 10px 0 0;
        padding-left: 20px;
      }
    </style>
    <script>
      // Applied before the bundles load so the page never flashes the wrong theme.
      (function () {
        try {
          var saved = window.localStorage.getItem('swagger-theme');
          if (saved === 'dark' || saved === 'light') {
            document.documentElement.setAttribute('data-theme', saved);
          }
        } catch (e) {
          /* private mode: fall back to the light default */
        }
      })();
    </script>
  </head>
  <body>
    <button id="theme-toggle" type="button" aria-label="Toggle colour theme">
      <span id="theme-toggle-icon">&#9789;</span>
      <span id="theme-toggle-text">Dark</span>
    </button>
    <div id="swagger-fallback">
      <h1>Swagger UI is loading...</h1>
      <div>
        If this message is still here, the swagger-ui JavaScript did not run. Open the
        browser console (F12) and check for a blocked script or a JavaScript error,
        then confirm these three URLs return <code>200</code>:
        <ul>
          <li><code>${ASSET_BASE}/swagger-ui-bundle.js</code></li>
          <li><code>${ASSET_BASE}/swagger-ui-standalone-preset.js</code></li>
          <li><code>${APP.API_PREFIX}/docs.json</code></li>
        </ul>
      </div>
    </div>
    <div id="swagger-ui"></div>
    <script src="${ASSET_BASE}/swagger-ui-bundle.js"></script>
    <script src="${ASSET_BASE}/swagger-ui-standalone-preset.js"></script>
    <script>
      window.onload = function () {
        var root = document.documentElement;
        var button = document.getElementById('theme-toggle');
        var icon = document.getElementById('theme-toggle-icon');
        var text = document.getElementById('theme-toggle-text');

        var paint = function () {
          var dark = root.getAttribute('data-theme') === 'dark';
          icon.innerHTML = dark ? '&#9788;' : '&#9789;';
          text.innerHTML = dark ? 'Light' : 'Dark';
        };

        button.addEventListener('click', function () {
          var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
          root.setAttribute('data-theme', next);
          try {
            window.localStorage.setItem('swagger-theme', next);
          } catch (e) {
            /* ignore: the theme just will not persist */
          }
          paint();
        });

        paint();

        try {
          window.ui = SwaggerUIBundle({
            url: '${APP.API_PREFIX}/docs.json',
            dom_id: '#swagger-ui',
            deepLinking: true,
            displayRequestDuration: true,
            persistAuthorization: true,
            tryItOutEnabled: true,
            presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
            layout: 'BaseLayout',
          });

          // Only reached once Swagger has taken over #swagger-ui.
          var fallback = document.getElementById('swagger-fallback');
          if (fallback && fallback.parentNode) fallback.parentNode.removeChild(fallback);
        } catch (err) {
          var box = document.getElementById('swagger-fallback');
          if (box) {
            box.innerHTML =
              '<h1>Swagger UI failed to start</h1><div>' +
              String(err && err.message ? err.message : err) +
              '</div>';
          }
          throw err;
        }
      };
    </script>
  </body>
</html>`;

/** Serves Swagger UI at /docs and the raw spec at /docs.json. */
export const docsRouter = Router();

docsRouter.get('/swagger-ui.css', swaggerAsset('swagger-ui.css'));
docsRouter.get('/swagger-ui-bundle.js', swaggerAsset('swagger-ui-bundle.js'));
docsRouter.get('/swagger-ui-standalone-preset.js', swaggerAsset('swagger-ui-standalone-preset.js'));

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
