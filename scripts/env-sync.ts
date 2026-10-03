/**
 * Regenerates `.env.example` from `.env` so the two can never drift apart.
 *
 * A second hand-edited copy goes stale, and the failure is silent: a new
 * developer picks up the wrong database URL with nothing to point at it. The
 * copy is byte-identical apart from a header line at the top.
 *
 * Line endings are normalised before comparing — see `normalise` below.
 *
 * Usage:
 *   npm run env:sync    rewrite .env.example from .env
 *   npm run env:check   exit non-zero if the two differ
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, '.env');
const TARGET = path.join(ROOT, '.env.example');

const HEADER = [
  '####################################################################################',
  '#  .env.example — GENERATED FILE, DO NOT EDIT BY HAND',
  '#',
  '#  This is a copy of .env. Edit .env, then run `npm run env:sync`.',
  '#  `npm run env:check` fails if the two ever differ.',
  '#',
  '#  ⚠  It currently contains REAL credentials, identical to .env, so it is',
  '#     committed here. Before publishing a public repo, either replace the',
  '#     secrets below or add both files to .gitignore. See the "GOING PUBLIC"',
  '#     section at the bottom of .gitignore.',
  '####################################################################################',
  '',
  '',
].join('\n');

const main = (): void => {
  if (!fs.existsSync(SOURCE)) {
    // eslint-disable-next-line no-console
    console.error('[env:sync] .env not found — nothing to copy.');
    process.exit(1);
  }

  /**
   * Normalise to LF before comparing. A Windows checkout with core.autocrlf=true returns the
   * working-tree copy with CRLF while the header above is built with \n, so a raw byte comparison
   * fails on line endings alone. They carry no meaning in a dotenv file.
   */
  const normalise = (text: string): string => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  const source = normalise(fs.readFileSync(SOURCE, 'utf8'));
  const next = HEADER + source;

  const current = fs.existsSync(TARGET) ? normalise(fs.readFileSync(TARGET, 'utf8')) : '';

  if (process.argv.includes('--check')) {
    if (current === next) {
      // eslint-disable-next-line no-console
      console.log('[env:check] .env.example matches .env');
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[env:check] .env.example is stale — run: npm run env:sync');
    process.exit(1);
  }

  if (current === next) {
    // eslint-disable-next-line no-console
    console.log('[env:sync] .env.example is already up to date.');
    return;
  }

  fs.writeFileSync(TARGET, next, 'utf8');
  // eslint-disable-next-line no-console
  console.log('[env:sync] wrote .env.example from .env');
};

main();
