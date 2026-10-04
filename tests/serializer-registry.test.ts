import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

import * as canonical from '../src/utils/serialize';

const ROOT = path.join(__dirname, '..');
const MODULES_DIR = path.join(ROOT, 'src', 'modules');

/**
 * `src/utils/serialize.ts` is the single registry for entity serializers. A module
 * serializer may compose them and add its own view shapes, but it must never declare
 * an entity of its own: two definitions for one entity means the same record is
 * returned in two different shapes depending on which endpoint was called, which is
 * what the response contract forbids.
 */
const declaredNames = (file: string): string[] => {
  const src = fs.readFileSync(file, 'utf8');
  const names: string[] = [];
  const re = /^export const (serialize\w+)\s*=/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) names.push(match[1]);
  return names;
};

const moduleSerializerFiles = (dir: string = MODULES_DIR): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...moduleSerializerFiles(full));
    else if (entry.name.endsWith('.serializer.ts')) out.push(full);
  }
  return out;
};

const canonicalNames = Object.keys(canonical).filter((k) => k.startsWith('serialize'));
const canonicalSet = new Set(canonicalNames);

describe('serializer registry', () => {
  it('exports each entity serializer exactly once', () => {
    const names = declaredNames(path.join(ROOT, 'src', 'utils', 'serialize.ts'));
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    expect(dupes).toEqual([]);
  });

  it('has no module serializer that redeclares a canonical entity', () => {
    const collisions: string[] = [];
    for (const file of moduleSerializerFiles()) {
      const rel = path.relative(ROOT, file);
      for (const name of declaredNames(file)) {
        if (canonicalSet.has(name)) collisions.push(`${rel} → ${name}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it('re-exports the canonical function, not a look-alike', async () => {
    const shadowed: string[] = [];

    for (const file of moduleSerializerFiles()) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      const mod = (await import(/* @vite-ignore */ `../${rel}`)) as Record<string, unknown>;

      for (const [name, value] of Object.entries(mod)) {
        if (!name.startsWith('serialize')) continue;
        if (!canonicalSet.has(name)) continue;
        if (value !== (canonical as Record<string, unknown>)[name])
          shadowed.push(`${rel} → ${name}`);
      }
    }

    expect(shadowed).toEqual([]);
  });

  it('gives every entity serializer a non-null, no-null output shape', () => {
    const emptyRow: Record<string, unknown> = {};

    for (const name of canonicalNames) {
      const fn = (canonical as unknown as Record<string, (row: any) => unknown>)[name];
      if (typeof fn !== 'function') continue;
      if (name.endsWith('List') || name.endsWith('Tree')) continue;

      const out = fn(emptyRow);
      expect(typeof out, `${name} did not return an object`).toBe('object');
      expect(out, `${name} returned null`).not.toBeNull();

      const walk = (value: unknown, path: string): void => {
        if (value === null) throw new Error(`${name} produced null at ${path}`);
        if (Array.isArray(value)) return;
        if (typeof value === 'object') {
          for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
        }
      };
      walk(out, name);
    }
  });

  it('exposes an explicit summary projection for nested user references', () => {
    expect(canonicalSet.has('serializeUserSummary')).toBe(true);
    const summary = canonical.serializeUserSummary({ id: 'u1', name: 'Ravi' });
    expect(summary).toEqual({
      userId: 'u1',
      name: 'Ravi',
      email: '',
      phone: '',
      avatarUrl: '',
      isActive: false,
    });
  });
});
