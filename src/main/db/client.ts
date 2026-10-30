import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// timestamptz → epoch ms everywhere, so rows map straight onto the shared types.
pg.types.setTypeParser(1184, v => (v === null ? null : v === 'infinity' ? Infinity : v === '-infinity' ? -Infinity : Date.parse(v)));
pg.types.setTypeParser(20, v => (v === null ? null : Number(v))); // bigint counts and ids that fit

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) throw new Error('Database is not connected');
  return pool;
}

export async function connect(url: string): Promise<void> {
  await disconnect();
  const p = new pg.Pool({ connectionString: url, max: 6, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 4_000 });
  p.on('error', () => { /* a dropped idle client; the next query reconnects */ });
  await p.query('select 1');
  pool = p;
}

export async function disconnect(): Promise<void> {
  const p = pool;
  pool = null;
  await p?.end().catch(() => {});
}

export const isConnected = (): boolean => pool !== null;

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const r = await db().query<T>(text, values);
  return r.rows;
}

export async function q1<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, values);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Applies migrations/NNN_*.sql in order, each once, inside a transaction. */
export async function migrate(dir: string): Promise<string[]> {
  await q('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await q<{ version: string }>('SELECT version FROM schema_migrations')).map(r => r.version));
  const files = readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    await tx(async c => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
    });
    applied.push(f);
  }
  return applied;
}
