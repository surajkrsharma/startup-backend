import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';

const PORT = Number(process.env.PGLITE_PORT ?? 5432);
const HOST = '127.0.0.1';
const DATA_DIR = process.env.PGLITE_DATA_DIR ?? 'pglite-data';
const ROOT = path.join(__dirname, '..');
const PID_FILE = path.join(ROOT, '.pglite.pid');
const LOG_FILE = path.join(ROOT, '.pglite.log');
const CMD = process.argv[2] ?? 'up';

/* eslint-disable no-console */

const isPortOpen = (port: number, host: string): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });

const readPid = (): number | null => {
  if (!fs.existsSync(PID_FILE)) return null;
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  return Number.isFinite(pid) && pid > 0 ? pid : null;
};

const start = async (): Promise<void> => {
  if (await isPortOpen(PORT, HOST)) {
    console.log(`[db] port ${PORT} already in use — assuming database is running`);
    return;
  }

  console.log(`[db] starting PGlite on ${HOST}:${PORT} (dataDir=${DATA_DIR})`);

  const out = fs.openSync(LOG_FILE, 'a');

  const node = process.execPath;
  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const entry = path.join(ROOT, 'scripts', 'pglite-server.ts');

  const child = spawn(node, [tsxCli, entry], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      PGLITE_PORT: String(PORT),
      PGLITE_HOST: HOST,
      PGLITE_DATA_DIR: DATA_DIR,
    },
  });

  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    if (await isPortOpen(PORT, HOST)) {
      console.log(`[db] ready on ${HOST}:${PORT} (pid ${child.pid})`);
      console.log(`[db] DATABASE_URL=postgresql://postgres:postgres@${HOST}:${PORT}/postgres`);
      console.log(`[db] logs: ${LOG_FILE}`);
      return;
    }
  }

  console.error(`[db] failed to become ready — see ${LOG_FILE}`);
  process.exit(1);
};

const stop = async (): Promise<void> => {
  const pid = readPid();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[db] stopped pid ${pid}`);
    } catch {
      console.log(`[db] pid ${pid} not running`);
    }
    fs.rmSync(PID_FILE, { force: true });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await isPortOpen(PORT, HOST))) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return;
  }

  console.log('[db] no pid file — run `npx pkill -f pglite-server` if still running');
};

const restart = async (): Promise<void> => {
  await stop();
  await start();
};

const status = async (): Promise<void> => {
  const open = await isPortOpen(PORT, HOST);
  const pid = readPid();
  console.log(`[db] port ${PORT}: ${open ? 'LISTENING' : 'CLOSED'}`);
  console.log(`[db] pid file: ${pid ?? '(none)'}`);
  console.log(
    `[db] dataDir : ${fs.existsSync(DATA_DIR) ? DATA_DIR : `${DATA_DIR} (not created yet)`}`,
  );
};

const commands: Record<string, () => Promise<void>> = { up: start, down: stop, status, restart };

void (commands[CMD] ?? status)().catch((err) => {
  console.error('[db] error:', err?.message ?? err);
  process.exit(1);
});

/* eslint-enable no-console */
