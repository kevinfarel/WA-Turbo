import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/wat', isPackaged: false, getAppPath: () => '/tmp' } }));
const { lockState, socketDir, PG_PORT } = await import('../../src/main/db/server');

describe('built-in Postgres socket folder', () => {
  it('uses the app folder when the socket path fits', () => {
    const ud = '/Users/someone/Library/Application Support/WA Turbo';
    expect(socketDir(ud, '/var/tmp')).toBe(ud + '/postgres/run');
  });

  it('falls back to a short per-folder temp path when macOS would reject the socket path', () => {
    const ud = '/private/tmp/claude-501/-Users-someone-Projects-WA-Turbo/0aae4777-8151-47ad-a1b5-40d600f8bdcf/scratchpad/ud3';
    const d = socketDir(ud, '/var/folders/x/T');
    expect(d).toMatch(/^\/var\/folders\/x\/T\/wat-[0-9a-f]{10}$/);
    expect(Buffer.byteLength(`${d}/.s.PGSQL.${PG_PORT}`)).toBeLessThanOrEqual(100);
    expect(socketDir(ud + '2', '/var/folders/x/T')).not.toBe(d);
  });
});

describe('postmaster.pid after a crash', () => {
  const pidFile = (pid: string) => `${pid}\n/data\n1730000000\n54320\n/run\n\n  54320001  65536\nready\n`;

  it('no file means no server', () => {
    expect(lockState(null, () => true)).toEqual({ state: 'none', pid: null });
  });

  it('a live postgres keeps its lock', () => {
    expect(lockState(pidFile('4242'), pid => pid === 4242)).toEqual({ state: 'alive', pid: 4242 });
  });

  it('a dead or reused pid is a leftover to clear', () => {
    expect(lockState(pidFile('4242'), () => false)).toEqual({ state: 'stale', pid: 4242 });
    expect(lockState('garbage', () => true)).toEqual({ state: 'stale', pid: null });
  });
});
