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
