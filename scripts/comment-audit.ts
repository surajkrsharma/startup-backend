import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const DIRS = ['src', 'prisma', 'tests', 'scripts'];

const BANNER = /[─═━┄┈▀▔]{3,}/;

const TOOLING = /eslint|no-console|ts-expect-error|ts-ignore|prettier-ignore/;

const NARRATIVE = [
  /\bpreviously\b/i,
  /\bused to\b/i,
  /\bhad to\b/i,
  /\bbefore this\b/i,
  /\bthe old \w+ (was|were)\b/i,
  /\bwould have\b/i,
  /\bsilently (degrad|stop|fail|drop|break|ignor)\w*\s+(into|to|when a|the app|every)/i,
  /\bon (the )?floor\b/i,
  /\bthis (repo|commit|change|branch) (tracks|introduces|removes|adds)\b/i,
  /\breported (a|an) \w+ (file )?(on|every)\b/i,
  /\bcame back as\b/i,
  /\bwas (never|not) (read|persisted|written|persisted)\b/i,
  /\bcould not be (used|found)\b/i,
  /\binstead of maintaining\b/i,
];

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

interface Finding {
  file: string;
  line: number;
  kind: string;
  text: string;
}

const findings: Finding[] = [];

for (const dir of DIRS) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;

  for (const file of walk(full)) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

    let i = 0;
    while (i < lines.length) {
      const trimmed = lines[i].trim();

      const isCommentStart = /^\/\//.test(trimmed) || /^\/\*\*/.test(trimmed);

      if (isCommentStart && /^\/\//.test(trimmed)) {
        if (BANNER.test(trimmed) || TOOLING.test(trimmed)) {
          i += 1;
          continue;
        }

        const start = i;
        const run: string[] = [trimmed];
        let j = i + 1;
        while (
          j < lines.length &&
          /^\/\//.test(lines[j].trim()) &&
          !BANNER.test(lines[j].trim()) &&
          !TOOLING.test(lines[j].trim())
        ) {
          run.push(lines[j].trim());
          j += 1;
        }

        if (run.length > 1) {
          findings.push({
            file: rel,
            line: start + 1,
            kind: 'MULTILINE_SHOULD_BE_DOC',
            text: run.map((r) => r.replace(/^\/\/\s*/, '')).join(' '),
          });
        }
        i = j;
        continue;
      }

      if (/^\/\*\*\s*$/.test(trimmed)) {
        const next = (lines[i + 1] ?? '').trim();
        if (next === '*/') {
          findings.push({ file: rel, line: i + 1, kind: 'EMPTY_DOC', text: '/** */' });
        }
      }

      if (/^(\/\/|\/\*\*|\s\*|\*)/.test(trimmed)) {
        for (const re of NARRATIVE) {
          if (re.test(trimmed)) {
            findings.push({ file: rel, line: i + 1, kind: 'NARRATIVE', text: trimmed });
            break;
          }
        }
      }

      i += 1;
    }
  }
}

const order = ['MULTILINE_SHOULD_BE_DOC', 'NARRATIVE', 'EMPTY_DOC'];
let total = 0;

for (const kind of order) {
  const group = findings.filter((f) => f.kind === kind);
  if (!group.length) continue;
  total += group.length;
  // eslint-disable-next-line no-console
  console.log(`\n=== ${kind}: ${group.length} ===`);
  for (const f of group.slice(0, 30)) {
    // eslint-disable-next-line no-console
    console.log(`  ${f.file}:${f.line}\n      ${f.text.slice(0, 160)}`);
  }
  if (group.length > 30) {
    // eslint-disable-next-line no-console
    console.log(`  … and ${group.length - 30} more`);
  }
}

// eslint-disable-next-line no-console
console.log(`\nTotal: ${total}`);
process.exit(total ? 1 : 0);
