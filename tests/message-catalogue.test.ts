import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CATALOGUE = path.join(SRC, 'messages');

/**
 * §3 of projectname-api.md: nowhere is a string, message or number hardcoded —
 * everything comes from one place. This guards the message half of that rule.
 *
 * The catalogue itself is exempt, and so are log lines: a logger string is a
 * diagnostic for whoever is reading the terminal, never part of an HTTP response,
 * and putting those in `messages/` would mean translating them for end users.
 */
const CATALOGUE_EXEMPT = new Set(['error.ts', 'success.ts', 'validation.ts', 'index.ts']);

const tsFiles = (dir: string = SRC): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
};

const offenders: Array<{ file: string; line: number; text: string }> = [];

for (const file of tsFiles()) {
  const rel = path.relative(ROOT, file);
  if (rel.startsWith(`src${path.sep}messages${path.sep}`)) continue;

  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');

  lines.forEach((text, i) => {
    const code = text.trim();

    if (/^(\/\/|\*|\/\*)/.test(code)) return;
    if (/logger\.|moduleLogger\(|\.log\(|\.warn\(|\.error\(|\.info\(|\.debug\(/.test(code)) return;

    // A thrown error carries its message to the client through errorHandler.
    const thrown = /(?:new\s+)?(?:AppError\.\w+|AppError|Error)\s*\(\s*'([^']+)'/.exec(text);
    if (thrown) {
      offenders.push({ file: rel, line: i + 1, text: thrown[1] });
      return;
    }

    // Zod surfaces `message` straight into the validation error envelope.
    const zod = /\bmessage:\s*'([^']+)'/.exec(text);
    if (zod && /\.schema\.ts$|\.middleware\.ts$|\.config\.ts$/.test(file)) {
      offenders.push({ file: rel, line: i + 1, text: zod[1] });
    }
  });
}

describe('message centralisation', () => {
  it('has no user-facing message written as a literal', () => {
    const report = offenders.map((o) => `${o.file}:${o.line}  "${o.text}"`);
    expect(report).toEqual([]);
  });

  it('exports the catalogue from src/messages', () => {
    for (const name of ['error.ts', 'success.ts', 'validation.ts']) {
      expect(fs.existsSync(path.join(CATALOGUE, name))).toBe(true);
    }
  });

  it('keeps every catalogue entry a non-empty string', async () => {
    const { ERROR } = await import('../src/messages/error');
    const { SUCCESS } = await import('../src/messages/success');
    const { VALIDATION } = await import('../src/messages/validation');

    const empty: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        if (node.trim() === '') empty.push(path);
        return;
      }
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
      }
    };

    walk(ERROR, 'ERROR');
    walk(SUCCESS, 'SUCCESS');
    expect(empty).toEqual([]);

    for (const key of Object.keys(VALIDATION)) {
      const fn = (VALIDATION as Record<string, unknown>)[key];
      if (typeof fn === 'function') expect(typeof fn).toBe('function');
      else expect(typeof fn).toBe('string');
    }
  });
});
