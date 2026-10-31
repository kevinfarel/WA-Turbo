import pg from 'pg';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PG_DATABASE, PgServerError, pidFileInfo, serverArgs, WinPgServer } from '../../src/main/db/server-win';

// The Windows server manager, run here with the Mac build of the same Postgres (it ships pg_ctl too).
// Only the Windows-only lines (tasklist, .exe names) are not exercised on a Mac.
const BIN = resolve('node_modules/@embedded-postgres/darwin-arm64/native/bin');
const home = mkdtempSync(join(tmpdir(), 'wat-pgwin-test-'));
const paths = () => ({ home, bin: BIN });

async function ask(cfg: pg.PoolConfig, sql: string): Promise<unknown> {
  const c = new pg.Client(cfg);
  await c.connect();
  try { return (await c.query(sql)).rows[0]; } finally { await c.end(); }
}

describe('postmaster.pid and server flags', () => {
  it('reads pid and port', () => {
    expect(pidFileInfo('4242\r\nC:\\data\r\n1761900000\r\n54320\r\n\r\n127.0.0.1\r\n')).toEqual({ pid: 4242, port: 54320 });
    expect(pidFileInfo('')).toBeNull();
  });
  it('listens on 127.0.0.1 only, with no Unix socket', () => {
    const a = serverArgs('D', 54320);
    expect(a).toContain('listen_addresses=127.0.0.1');
    expect(a).toContain('unix_socket_directories=');
  });
  it('says so when the bundled binaries are missing', async () => {
    const s = new WinPgServer(() => ({ home, bin: join(home, 'no-bin') }));
    await expect(s.start({ password: 'x' })).rejects.toBeInstanceOf(PgServerError);
  });
});

describe.skipIf(!existsSync(join(BIN, 'postgres')))('bundled server lifecycle', () => {
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it('creates the database on first start and stops cleanly', async () => {
    const s = new WinPgServer(paths);
    const cfg = await s.start({ password: 'first' });
    expect(cfg).toMatchObject({ host: '127.0.0.1', database: PG_DATABASE, password: 'first' });
    expect(await ask(cfg, "SELECT to_tsvector('simple', 'Halo Dunia')::text t")).toEqual({ t: "'dunia':2 'halo':1" });
    await expect(ask({ ...cfg, password: 'wrong' }, 'SELECT 1')).rejects.toThrow(/password authentication failed/);
    expect(s.tools('first')).toMatchObject({ host: '127.0.0.1', port: cfg.port });
    await s.stop();
    expect(existsSync(join(home, 'data/postmaster.pid'))).toBe(false);
    await expect(ask(cfg, 'SELECT 1')).rejects.toThrow();
  }, 60_000);

  it('adopts a server left running by a WA Turbo that was force-quit', async () => {
    const first = new WinPgServer(paths);
    const cfg = await first.start({ password: 'first' });
    const second = new WinPgServer(paths);
    expect((await second.start({ password: 'first' })).port).toBe(cfg.port);
    await second.stop();
    // `first` stands in for the force-quit copy, which in real life is gone: it must not restart the server.
    await first.stop();
    await new Promise(r => setTimeout(r, 1500));
    await expect(ask(cfg, 'SELECT 1')).rejects.toThrow();
  }, 60_000);

  it('starts over a stale lock file from a crash', async () => {
    writeFileSync(join(home, 'data/postmaster.pid'), '999999\n' + join(home, 'data') + '\n0\n54320\n');
    const s = new WinPgServer(paths);
    const cfg = await s.start({ password: 'first' });
    expect(await ask(cfg, 'SELECT 1 AS ok')).toEqual({ ok: 1 });
    await s.stop();
  }, 60_000);

  it('recovers when config.json lost the password', async () => {
    const s = new WinPgServer(paths);
    const cfg = await s.start({ password: 'second' });
    expect(await ask(cfg, 'SELECT current_user u')).toEqual({ u: 'wa_turbo' });
    await expect(ask({ ...cfg, password: 'first' }, 'SELECT 1')).rejects.toThrow(/password authentication failed/);
    await s.stop();
  }, 90_000);
});
