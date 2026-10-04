process.env.LOG_LEVEL = 'silent';

import { createApp } from '../src/app';

const app = createApp();

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack: any[] };
  regexp?: RegExp;
};

const rows: string[] = [];

const walk = (stack: any[], prefix: string) => {
  for (const layer of stack as Layer[]) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods)
        .filter((m) => layer.route!.methods[m])
        .map((m) => m.toUpperCase())
        .sort()
        .join('|');
      rows.push(`${methods.padEnd(12)} ${prefix}${layer.route.path}`.replace(/\/+/g, '/'));
    } else if (layer.name === 'router' && layer.handle?.stack) {
      walk(layer.handle.stack, `${prefix}${mountPath(layer.regexp?.source ?? '')}`);
    }
  }
};

const mountPath = (src: string): string => {
  const decoded = src.replace(/\\\//g, '/').replace(/^\^/, '');
  const lookahead = decoded.search(/\(\?=/);
  const body = lookahead === -1 ? decoded : decoded.slice(0, lookahead);
  const cleaned = body.replace(/\$$/, '').replace(/\/\?$/, '').replace(/\/$/, '');
  return cleaned === '' ? '' : cleaned;
};

walk((app as any)._router?.stack ?? [], '/api/v1');

rows.sort();
for (const r of rows) console.log(r.replace(/\/api\/v1/, ''));
console.log(`\nTOTAL ${rows.length}`);
