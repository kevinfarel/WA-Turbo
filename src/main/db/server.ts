import { app } from 'electron';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

// The Postgres server shipped inside WA Turbo (vendor/postgres, copied in by scripts/prepare-postgres.mjs).
// Data lives in ~/Library/Application Support/WA Turbo/postgres/data. The app talks to it over a Unix socket in
// a folder only this Mac user can open; TCP on 127.0.0.1 is opened only when "database tools" is switched on.
// If WA Turbo was force-quit, the server keeps running and the next launch adopts it through the same socket.

export const PG_PORT = 54320;
export const PG_USER = 'wa_turbo';
export const PG_DATABASE = 'wa_turbo';
export const TOOLS_HOST = '127.0.0.1';

export const pgHome = (): string => join(app.getPath('userData'), 'postgres');
const dataPath = (): string => join(pgHome(), 'data');
const logPath = (): string => join(pgHome(), 'server.log');

export function binDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'postgres', 'bin') : join(app.getAppPath(), 'vendor', 'postgres', 'bin');
}

/** macOS caps a socket path at 104 bytes, so a long userData folder falls back to a per-user temp folder. */
export function socketDir(userData: string, tmp = tmpdir()): string {
  const preferred = join(userData, 'postgres', 'run');
  if (Buffer.byteLength(join(preferred, `.s.PGSQL.${PG_PORT}`)) <= 100) return preferred;
  return join(tmp, 'wat-' + createHash('sha1').update(userData).digest('hex').slice(0, 10));
}

/** What postmaster.pid says: no server, a leftover file from a crash, or a postgres that is still alive. */
export function lockState(pidFile: string | null, isPostgres: (pid: number) => boolean): { state: 'none' | 'stale' | 'alive'; pid: number | null } {
  if (pidFile === null) return { state: 'none', pid: null };
  const pid = Number(pidFile.split('\n')[0]);
  if (!Number.isInteger(pid) || pid <= 0) return { state: 'stale', pid: null };
  return isPostgres(pid) ? { state: 'alive', pid } : { state: 'stale', pid };
}

function isPostgresPid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return /postgres$/.test(execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim());
  } catch {
    return false;
  }
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const readMaybe = (p: string): string | null => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

/** The lines that explain a failed start: the last FATAL/ERROR with its DETAIL and HINT, else the log's last few lines. */
function logTail(): string {
  const lines = (readMaybe(logPath()) ?? '').trim().split('\n').slice(-60);
  const why = lines.filter(l => /\b(FATAL|PANIC|ERROR|DETAIL|HINT):/.test(l)).slice(-6);
  return [...new Set((why.length ? why : lines.slice(-6)).map(l => l.replace(/^\S+ \S+ \S+ \[\d+\] /, '')))].join('\n');
}

export function portFree(port: number, host: string): Promise<boolean> {
  return new Promise(resolve => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

export class PgServerError extends Error {}

export interface ToolsAccess { host: string; port: number; database: string; user: string; password: string }

class PgServer {
  private child: ChildProcess | null = null;
  private stopping = false;
  private crashes: number[] = [];
  private args: string[] = [];
  private tcp = false;
  /** Only the copy of WA Turbo that started (or adopted) the server stops it; a second launch that quits at once must not. */
  private owned = false;
  toolsError: string | null = null;

  get sockDir(): string { return socketDir(app.getPath('userData')); }

  /** Starts (or adopts) the server and returns how to connect. Calling it again with a different `tcp` restarts it. */
  async start(opts: { tcp: boolean; password: string }): Promise<pg.PoolConfig> {
    const home = pgHome();
    mkdirSync(home, { recursive: true, mode: 0o700 });
    mkdirSync(this.sockDir, { recursive: true, mode: 0o700 });
    chmodSync(this.sockDir, 0o700);
    if (!existsSync(join(dataPath(), 'PG_VERSION'))) this.initdb(opts.password);

    // A busy port only costs the tools access; the app itself always gets its database.
    let tcp = opts.tcp;
    this.toolsError = null;
    const running = await this.answering();
    if (tcp && running !== true && !(await portFree(PG_PORT, TOOLS_HOST))) {
      tcp = false;
      this.toolsError = `Port ${PG_PORT} is already used by another program on this Mac, so database tools can't connect.`;
    }
    this.owned = true;
    if (running !== tcp) {
      if (running !== null) await this.stop();
      await this.launch(tcp);
    }
    this.tcp = tcp;
    await this.prepare(opts.password);
    return { host: this.sockDir, port: PG_PORT, user: PG_USER, database: PG_DATABASE };
  }

  /** Fast shutdown: open transactions roll back, everything committed is already on disk. */
  async stop(): Promise<void> {
    if (!this.owned) return;
    this.stopping = true;
    try {
      const pid = this.child?.pid ?? lockState(readMaybe(join(dataPath(), 'postmaster.pid')), isPostgresPid).pid;
      if (!pid || !isPostgresPid(pid)) return;
      process.kill(pid, 'SIGINT');
      for (let i = 0; i < 75 && isPostgresPid(pid); i++) await sleep(200);
      if (isPostgresPid(pid)) process.kill(pid, 'SIGQUIT');
      for (let i = 0; i < 25 && isPostgresPid(pid); i++) await sleep(200);
    } finally {
      this.child = null;
      this.stopping = false;
    }
  }

  tools(password: string): ToolsAccess | null {
    return this.tcp ? { host: TOOLS_HOST, port: PG_PORT, database: PG_DATABASE, user: PG_USER, password } : null;
  }

  version(): string | null {
    return readMaybe(join(binDir(), '..', 'VERSION'))?.replace(/^postgres \(PostgreSQL\)\s*/, '').trim() ?? null;
  }

  private initdb(password: string): void {
    const tmp = dataPath() + '.new';
    rmSync(tmp, { recursive: true, force: true });
    const pw = join(pgHome(), '.pw');
    writeFileSync(pw, password, { mode: 0o600 });
    try {
      execFileSync(join(binDir(), 'initdb'), ['-D', tmp, '-U', PG_USER, '--pwfile', pw, '-E', 'UTF8', '--locale=C',
        '--locale-provider=builtin', '--builtin-locale=C.UTF-8', '--auth-local=trust', '--auth-host=scram-sha-256', '--no-instructions'],
      { stdio: 'pipe', encoding: 'utf8' });
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      throw new PgServerError("WA Turbo couldn't create its database: " + (err.stderr?.trim().split('\n').pop() || err.message));
    } finally {
      rmSync(pw, { force: true });
    }
    renameSync(tmp, dataPath());
  }

  /** null = nothing answering on our socket; otherwise whether that server listens on TCP. */
  private async answering(): Promise<boolean | null> {
    const c = new pg.Client({ host: this.sockDir, port: PG_PORT, user: PG_USER, database: 'postgres', connectionTimeoutMillis: 1500 });
    try {
      await c.connect();
      const r = await c.query<{ listen_addresses: string }>('SHOW listen_addresses');
      return r.rows[0].listen_addresses.trim() !== '';
    } catch {
      return null;
    } finally {
      await c.end().catch(() => {});
    }
  }

  private async launch(tcp: boolean): Promise<void> {
    const lock = lockState(readMaybe(join(dataPath(), 'postmaster.pid')), isPostgresPid);
    if (lock.state === 'alive') {
      // Starting up, recovering after a crash, or shutting down: give it time before forcing it.
      for (let i = 0; i < 100 && (await this.answering()) === null && isPostgresPid(lock.pid!); i++) await sleep(200);
      if ((await this.answering()) !== null) await this.stop();
      else if (isPostgresPid(lock.pid!)) { process.kill(lock.pid!, 'SIGQUIT'); await sleep(1000); }
    }
    if (lockState(readMaybe(join(dataPath(), 'postmaster.pid')), isPostgresPid).state !== 'alive') {
      rmSync(join(dataPath(), 'postmaster.pid'), { force: true });
      rmSync(join(this.sockDir, `.s.PGSQL.${PG_PORT}`), { force: true });
      rmSync(join(this.sockDir, `.s.PGSQL.${PG_PORT}.lock`), { force: true });
    }
    try { if (statSync(logPath()).size > 5e6) renameSync(logPath(), logPath() + '.1'); } catch { /* no log yet */ }

    this.args = ['-D', dataPath(), '-k', this.sockDir, '-p', String(PG_PORT),
      '-c', `listen_addresses=${tcp ? TOOLS_HOST : ''}`, '-c', 'unix_socket_permissions=0700',
      '-c', 'max_connections=30', '-c', 'shared_buffers=64MB', '-c', 'logging_collector=off'];
    this.spawn();
    for (let i = 0; i < 300; i++) {
      if ((await this.answering()) !== null) return;
      if (!this.child) break;
      await sleep(200);
    }
    throw new PgServerError("WA Turbo's database didn't start.\n" + (logTail() || 'No log was written.'));
  }

  private spawn(): void {
    const fd = openSync(logPath(), 'a');
    const child = spawn(join(binDir(), 'postgres'), this.args, { stdio: ['ignore', fd, fd], env: { ...process.env, LC_ALL: 'C' } });
    closeSync(fd);
    this.child = child;
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.stopping) return;
      // An unexpected exit: restart it, unless it keeps dying (then the next query shows the error screen).
      const now = Date.now();
      this.crashes = [...this.crashes.filter(t => now - t < 60_000), now];
      console.error(`Postgres exited (${signal ?? code}); ${this.crashes.length <= 3 ? 'restarting' : 'giving up'}`);
      if (this.crashes.length <= 3) setTimeout(() => { if (!this.child && !this.stopping) this.spawn(); }, 1000);
    });
  }

  /** Creates the wa_turbo database on first run and keeps the tools password in step with config.json. */
  private async prepare(password: string): Promise<void> {
    const c = new pg.Client({ host: this.sockDir, port: PG_PORT, user: PG_USER, database: 'postgres' });
    await c.connect();
    try {
      const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [PG_DATABASE]);
      if (!exists.rowCount) await c.query(`CREATE DATABASE ${PG_DATABASE}`);
      await c.query(`ALTER ROLE ${PG_USER} PASSWORD ${pg.escapeLiteral(password)}`);
    } finally {
      await c.end();
    }
  }
}

export const pgServer = new PgServer();
