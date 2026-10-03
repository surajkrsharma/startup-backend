/**
 * Cross-checks every route's path params against the params its controller reads.
 *
 * A route declares `/foo/:subOrderId` but a handler that reads `req.params.id` gets
 * `undefined`, because `validate({ params })` replaces `req.params` with the parsed
 * object — so the id never arrives and the lookup 404s. This prints every mismatch.
 *
 * Usage: npx tsx scripts/route-param-audit.ts
 */
import fs from 'fs';
import path from 'path';

const modulesDir = 'src/modules';

const readParamsUsed = (file: string, fnName: string): string[] => {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.search(new RegExp(`export const ${fnName}\\s*=`));
  if (start === -1) return [];

  // Take the handler body up to the next top-level `export const`.
  const rest = src.slice(start);
  const next = rest.slice(1).search(/\nexport const /);
  const body = next === -1 ? rest : rest.slice(0, next + 1);

  return [...new Set([...body.matchAll(/req\.params\.([A-Za-z_]\w*)/g)].map((m) => m[1]))];
};

let mismatches = 0;

/** Middleware and route decorators are not controller handlers. */
const NOT_HANDLERS = new Set([
  'authenticate',
  'requireRole',
  'requirePermission',
  'validate',
  'asyncHandler',
  'router',
  'app',
]);

for (const mod of fs.readdirSync(modulesDir)) {
  const routesFile = path.join(modulesDir, mod, `${mod}.routes.ts`);
  if (!fs.existsSync(routesFile)) continue;

  const lines = fs.readFileSync(routesFile, 'utf8').split(/\r?\n/);
  const controllerFile = path.join(modulesDir, mod, `${mod}.controller.ts`);
  const hasController = fs.existsSync(controllerFile);
  if (!hasController) continue;

  const controllerSrc = fs.readFileSync(controllerFile, 'utf8');
  const exported = new Set(
    [...controllerSrc.matchAll(/export const ([A-Za-z_]\w*)\s*=/g)].map((m) => m[1]),
  );

  for (let i = 0; i < lines.length; i++) {
    const routeMatch = lines[i].match(/^\s*'(\/[^']*)'\s*,?\s*$/);
    if (!routeMatch) continue;

    const declared = [...routeMatch[1].matchAll(/:([A-Za-z_]\w*)/g)].map((m) => m[1]);
    if (declared.length === 0) continue;

    // The handler is the next reference that is actually an exported controller fn.
    let fnName: string | undefined;
    for (let j = i + 1; j < Math.min(i + 14, lines.length); j++) {
      const m = lines[j].match(/^\s*(?:controller\.)?([A-Za-z_]\w*),?\s*$/);
      if (m && exported.has(m[1]) && !NOT_HANDLERS.has(m[1])) {
        fnName = m[1];
        break;
      }
      if (/^\s*\);?\s*$/.test(lines[j])) break;
    }
    if (!fnName) continue;

    const used = readParamsUsed(controllerFile, fnName);
    if (used.length === 0) continue;

    for (const u of used) {
      if (!declared.includes(u)) {
        mismatches++;
        console.log(
          `${routesFile}:${i + 1}  ${fnName}() reads req.params.${u}  but route declares ${routeMatch[1]}`,
        );
      }
    }
  }
}

console.log(`\n${mismatches} mismatch(es)`);
