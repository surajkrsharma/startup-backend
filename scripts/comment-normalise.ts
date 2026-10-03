/**
 * Rewrites multi-line runs of `//` prose into doc blocks, in place.
 *
 * The project has one prose form for anything longer than a line. A run of two
 * or more line comments is the shape that drifts: it is only correct by
 * accident, it wraps at whatever column the author was editing, and it reads
 * differently from the doc block sitting directly above it.
 *
 * Preserved exactly:
 *   - indentation
 *   - word wrapping, reflowed to the surrounding width
 *   - blank `//` lines, which become the blank `*` separator
 *
 * Banners, ESLint directives and route markers are left alone.
 *
 * Usage: npx tsx scripts/comment-normalise.ts [--write]
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const DIRS = ['src', 'prisma', 'tests', 'scripts'];
const WRITE = process.argv.includes('--write');
const WIDTH = 92;

const BANNER = /[─═━┄┈▀▔]{3,}/;
const TOOLING = /eslint|no-console|ts-expect-error|ts-ignore|prettier-ignore/;

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...walk(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
};

const wrap = (text: string, width: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (!line.length) {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line.length) lines.push(line);
  return lines;
};

let changedFiles = 0;
let changedBlocks = 0;

for (const dir of DIRS) {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) continue;

  for (const file of walk(base)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const out: string[] = [];
    let i = 0;
    let touched = false;

    while (i < lines.length) {
      const trimmed = lines[i].trim();

      const isLineComment = trimmed.startsWith('//');
      const isSkip = BANNER.test(trimmed) || TOOLING.test(trimmed);

      if (!isLineComment || isSkip) {
        out.push(lines[i]);
        i += 1;
        continue;
      }

      // Collect the whole run of consecutive prose line comments.
      const run: Array<{ indent: string; text: string }> = [];
      let j = i;
      while (j < lines.length) {
        const t = lines[j].trim();
        if (!t.startsWith('//')) break;
        if (BANNER.test(t) || TOOLING.test(t)) break;
        run.push({
          indent: lines[j].match(/^\s*/)?.[0] ?? '',
          text: t.replace(/^\/\/\s?/, ''),
        });
        j += 1;
      }

      if (run.length < 2) {
        out.push(lines[i]);
        i += 1;
        continue;
      }

      /**
       * A run that opens a block, e.g. "// if (x) {" style continuation, is left alone: it is code
       * continuation, not prose.
       */
      const lastEndsOpen = /[{(,]$/.test(run[run.length - 1].text.trim());
      if (lastEndsOpen) {
        out.push(...run.map((r) => `${r.indent}// ${r.text}`.trimEnd()));
        i = j;
        continue;
      }

      const indent = run[0].indent;
      const body = run.map((r) => r.text);

      // Rebuild as paragraphs split on blank line comments.
      const paragraphs: string[][] = [[]];
      for (const line of body) {
        if (!line.trim()) {
          paragraphs.push([]);
        } else {
          paragraphs[paragraphs.length - 1].push(line);
        }
      }

      const rendered: string[] = [];
      paragraphs
        .filter((p) => p.length)
        .forEach((para, index) => {
          if (index > 0) rendered.push(`${indent} *`);
          rendered.push(...wrap(para.join(' '), WIDTH).map((l) => `${indent} * ${l}`));
        });

      out.push(`${indent}/**`);
      out.push(...rendered);
      out.push(`${indent} */`);

      touched = true;
      changedBlocks += 1;
      i = j;
    }

    if (touched) {
      changedFiles += 1;
      if (WRITE) {
        fs.writeFileSync(file, out.join('\n'), 'utf8');
      }
    }
  }
}

// eslint-disable-next-line no-console
console.log(
  `${WRITE ? 'Rewrote' : 'Would rewrite'} ${changedBlocks} block(s) across ${changedFiles} file(s).`,
);
if (!WRITE) {
  // eslint-disable-next-line no-console
  console.log('Re-run with --write to apply.');
}
