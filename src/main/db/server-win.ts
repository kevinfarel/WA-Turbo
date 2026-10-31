import pg from 'pg';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

// The Postgres server the Windows build ships (Plan B), started and stopped by WA Turbo itself.
// server.ts exports it as pgServer on Windows, with the same surface as the Mac's PgServer: start() returns
// the pg.PoolConfig to connect with, stop() only stops a server this copy of WA Turbo started or adopted.
// Windows differences: Node can't reach Postgres over a Unix socket there, so the server listens on
// 127.0.0.1 only, with scram passwords for every login; and Node's kill() on Windows is a hard kill,
// so the server is always stopped through pg_ctl, which asks it to shut down cleanly.
// Nothing here imports Electron, so tests can run it with the Mac's binaries.

export const PG_PORT = 54320;
export const PG_USER = 'wa_turbo';
export const PG_DATABASE = 'wa_turbo';
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const EXE = process.platform === 'win32' ? '.exe' : '';

/** Message is "<what went wrong>\n<the log lines that explain it>", like the Mac's. */
export class PgServerError extends Error {}

export interface PgPaths {
  /** Folder that holds data/, server.log and the temporary files. */
  home: string;
  /** Folder with postgres, initdb and pg_ctl. */
  bin: string;
}

/** Pid and port from postmaster.pid (lines 1 and 4), or null when the file is unreadable. */
export function pidFileInfo(text: string): { pid: number; port: number } | null {
  const lines = text.split(/\r?\n/);
  const pid = Number(lines[0]), port = Number(lines[3]);
  return Number.isInteger(pid) && pid > 0 && Number.isInteger(port) && port > 0 ? { pid, port } : null;
}

export function initdbArgs(data: string, pwfile: string): string[] {
  return ['-D', data, '-U', PG_USER, '--pwfile', pwfile, '-E', 'UTF8', '--locale=C', '--locale-provider=builtin', '--builtin-locale=C.UTF-8',
    '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--no-instructions'];
}

export function serverArgs(data: string, port: number, hbaFile?: string): string[] {
  return ['-D', data, '-p', String(port), '-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories=',
    '-c', 'max_connections=30', '-c', 'shared_buffers=64MB', '-c', 'logging_collector=off', ...(hbaFile ? ['-c', 'hba_file=' + hbaFile] : [])];
}

const run = (file: string, args: string[], timeout = 60_000) => new Promise<string>((resolve, reject) => {
  execFile(file, args, { timeout, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout, stderr) => {
    if (err) reject(new Error((stderr || stdout || err.message).trim()));
    else resolve(stdout);
  });
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Whether pid is a Postgres process (pids get reused after a crash or reboot). */
async function isPostgres(pid: number): Promise<boolean> {
  try {
    if (process.platform === 'win32') return /"postgres\.exe"/i.test(await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], 10_000));
    return /postgres$/.test((await run('ps', ['-p', String(pid), '-o', 'comm='], 10_000)).trim());
  } catch {
    return false;
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

/** PG_PORT when it's free, otherwise any free port on 127.0.0.1. */
async function pickPort(): Promise<number> {
  if (await portFree(PG_PORT)) return PG_PORT;
  return new Promise((resolve, reject) => {
    const s = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export class WinPgServer {
  private child: ChildProcess | null = null;
  private port = 0;
  private pid = 0;
  private stopping = false;
  private respawns: number[] = [];
  private password = '';
  /** Windows always listens on 127.0.0.1, so there is no tools port to be refused. */
  readonly toolsError: string | null = null;

  constructor(private readonly paths: () => PgPaths) {}

  private get data(): string { return join(this.paths().home, 'data'); }
  private get logFile(): string { return join(this.paths().home, 'server.log'); }
  private bin(name: string): string { return join(this.paths().bin, name + EXE); }

  config(database = PG_DATABASE): pg.PoolConfig {
    return { host: '127.0.0.1', port: this.port, user: PG_USER, password: this.password, database };
  }

  /** Starts the server (or adopts one left running by a force-quit WA Turbo) and returns how to connect. `tcp` is always on here. */
  async start(o: { tcp?: boolean; password: string }): Promise<pg.PoolConfig> {
    this.password = o.password;
    this.stopping = false;
    if (!existsSync(this.bin('postgres'))) throw new PgServerError("WA Turbo's database files are missing. Reinstall WA Turbo.");
    mkdirSync(this.paths().home, { recursive: true });
    if (!existsSync(join(this.data, 'PG_VERSION'))) await this.initdb();

    if (!(await this.adopt())) await this.spawn();
    if (!(await this.answers('postgres'))) await this.resetPassword();
    const c = new pg.Client(this.config('postgres'));
    await c.connect();
    try {
      const has = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [PG_DATABASE]);
      if (!has.rowCount) await c.query(`CREATE DATABASE ${PG_DATABASE} OWNER ${PG_USER}`);
    } finally {
      await c.end();
    }
    return this.config();
  }

  /** Asks the server to shut down cleanly (fast mode), and hard-stops it only if that doesn't work within 15 s. */
  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child && !this.pid) return;
    try {
      await run(this.bin('pg_ctl'), ['stop', '-D', this.data, '-m', 'fast', '-w', '-t', '15'], 20_000);
    } catch {
      if (this.pid && alive(this.pid)) {
        if (process.platform === 'win32') await run(this.bin('pg_ctl'), ['kill', 'QUIT', String(this.pid)]).catch(() => {});
        else process.kill(this.pid, 'SIGQUIT');
      }
    }
    if (child && child.exitCode === null) await Promise.race([new Promise(r => child.once('exit', r)), sleep(5000)]);
    child?.kill();
    this.child = null;
    this.pid = 0;
  }

  /** Connection details for a database tool such as DBeaver. Windows always listens on 127.0.0.1, so they work whenever the server runs. */
  tools(password: string): { host: string; port: number; database: string; user: string; password: string } | null {
    return this.pid ? { host: '127.0.0.1', port: this.port, database: PG_DATABASE, user: PG_USER, password } : null;
  }

  version(): string | null {
    try { return readFileSync(join(this.paths().bin, '..', 'VERSION'), 'utf8').replace(/^postgres \(PostgreSQL\)\s*/, '').trim(); } catch { return null; }
  }

  /** The lines that explain a failed start: the last FATAL/ERROR with its DETAIL and HINT, else the log's last few lines. */
  logTail(): string {
    let lines: string[];
    try { lines = readFileSync(this.logFile, 'utf8').trim().split(/\r?\n/).slice(-60); } catch { return ''; }
    const why = lines.filter(l => /\b(FATAL|PANIC|ERROR|DETAIL|HINT):/.test(l)).slice(-6);
    return [...new Set((why.length ? why : lines.slice(-6)).map(l => l.replace(/^\S+ \S+ \S+ \[\d+\] /, '')))].join('\n');
  }

  private async initdb(): Promise<void> {
    const next = this.data + '.new';
    const pwfile = join(this.paths().home, 'initdb.pw');
    rmSync(next, { recursive: true, force: true });
    writeFileSync(pwfile, this.password, { mode: 0o600 });
    try {
      await run(this.bin('initdb'), initdbArgs(next, pwfile), 120_000);
    } catch (e) {
      throw new PgServerError("WA Turbo couldn't create its database: " + (e as Error).message.split(/\r?\n/).pop());
    } finally {
      rmSync(pwfile, { force: true });
    }
    // Antivirus scanners briefly hold new files on Windows, so the rename gets a few tries.
    for (let i = 0; ; i++) {
      try { renameSync(next, this.data); break; } catch (e) { if (i >= 9) throw e; await sleep(500); }
    }
  }

  /** Reuses a server still running on our data folder; clears the lock of one that died. */
  private async adopt(): Promise<boolean> {
    const pidFile = join(this.data, 'postmaster.pid');
    if (!existsSync(pidFile)) return false;
    const info = pidFileInfo(readFileSync(pidFile, 'utf8'));
    if (info && alive(info.pid) && (await isPostgres(info.pid))) {
      this.port = info.port;
      this.pid = info.pid;
      for (let i = 0; i < 40; i++) {
        if (await this.reachable()) return true;
        await sleep(500);
      }
      await this.stop(); // running but never answering: stop it and start fresh
      this.stopping = false;
      return false;
    }
    rmSync(pidFile, { force: true });
    return false;
  }

  private async spawn(hbaFile?: string): Promise<void> {
    // A respawn keeps its port, so the open connection pool reconnects to it.
    this.port = this.port && (await portFree(this.port)) ? this.port : await pickPort();
    this.rotateLog();
    const log = openSync(this.logFile, 'a');
    const child = spawn(this.bin('postgres'), serverArgs(this.data, this.port, hbaFile), {
      stdio: ['ignore', log, log], windowsHide: true, env: { ...process.env, LC_ALL: 'C' },
    });
    closeSync(log);
    this.child = child;
    this.pid = child.pid ?? 0;
    let exited = false;
    child.once('exit', () => {
      exited = true;
      if (this.child !== child) return;
      this.child = null;
      this.pid = 0;
      if (!this.stopping) this.respawn();
    });
    for (let i = 0; i < 120; i++) {
      if (exited) break;
      if (await this.reachable()) return;
      await sleep(500);
    }
    const tail = this.logTail();
    if (!exited) { await this.stop(); this.stopping = false; }
    const admin = /administrative permissions/i.test(tail);
    throw new PgServerError((admin
      ? 'WA Turbo was started "as administrator", and its database refuses to run that way. Close it and open it normally.'
      : "WA Turbo's database didn't start.") + '\n' + (tail || 'No log was written.'));
  }

  /** Restarts a server that exited on its own, at most 3 times a minute. */
  private respawn(): void {
    const now = Date.now();
    this.respawns = this.respawns.filter(t => now - t < 60_000);
    if (this.respawns.length >= 3) return;
    this.respawns.push(now);
    setTimeout(() => { if (!this.stopping) void this.spawn().catch(() => {}); }, 1000);
  }

  /** Accepts connections at all (a wrong password still counts: the server is up). */
  private async reachable(): Promise<boolean> {
    const c = new pg.Client({ ...this.config('postgres'), connectionTimeoutMillis: 2000 });
    try {
      await c.connect();
      await c.end();
      return true;
    } catch (e) {
      return (e as { code?: string }).code === '28P01';
    }
  }

  private async answers(database: string): Promise<boolean> {
    const c = new pg.Client({ ...this.config(database), connectionTimeoutMillis: 4000 });
    try {
      await c.connect();
      await c.end();
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === '28P01') return false;
      throw e;
    }
  }

  /**
   * config.json lost the password (deleted, restored from an old copy): restart once with a
   * pg_hba that trusts 127.0.0.1, set the current password, then restart with the normal rules.
   */
  private async resetPassword(): Promise<void> {
    const hba = join(this.paths().home, 'reset_hba.conf');
    writeFileSync(hba, 'host all all 127.0.0.1/32 trust\n', { mode: 0o600 });
    try {
      await this.stop();
      this.stopping = false;
      await this.spawn(hba);
      const c = new pg.Client({ ...this.config('postgres'), password: undefined });
      await c.connect();
      try {
        await c.query(`ALTER ROLE ${PG_USER} PASSWORD ${pg.escapeLiteral(this.password)}`);
      } finally {
        await c.end();
      }
    } finally {
      await this.stop();
      this.stopping = false;
      rmSync(hba, { force: true });
    }
    await this.spawn();
  }

  private rotateLog(): void {
    try {
      if (statSync(this.logFile).size > LOG_MAX_BYTES) renameSync(this.logFile, this.logFile + '.1');
    } catch { /* no log yet */ }
  }
}
