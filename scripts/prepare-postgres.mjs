// Copies the Postgres server WA Turbo ships inside the app into vendor/postgres, trimmed for size:
// arm64 slice only, one file per library (the package stores each dylib under 2–3 names), no Perl/Python/Tcl
// languages, no pg_ctl. Every Mach-O is re-signed ad hoc because thinning breaks the vendor signature.
// Ends with a smoke test: initdb, start on a private socket, run a query, stop.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@embedded-postgres/darwin-arm64/native');
const out = join(root, 'vendor/postgres');
const SKIP_EXT = /^(pl(perl|python3|tcl)|.*_pl(perl|python3))\.dylib$/;

if (!existsSync(join(src, 'bin/postgres'))) {
  console.error('Postgres binaries missing. Run npm install first (@embedded-postgres/darwin-arm64).');
  process.exit(1);
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
// Bundled libraries are referenced as @rpath/<name> or @loader_path/../lib/<name>, depending on the package version.
const deps = f => run('otool', ['-arch', 'arm64', '-L', f]).split('\n').slice(1)
  .map(l => /^\s+(@rpath\/|@loader_path\/\.\.\/lib\/)(\S+)/.exec(l)).filter(Boolean).map(m => ({ prefix: m[1], name: m[2] }));

rmSync(out, { recursive: true, force: true });
for (const d of ['bin', 'lib/postgresql', 'share']) mkdirSync(join(out, d), { recursive: true });
cpSync(join(src, 'share/postgresql'), join(out, 'share/postgresql'), { recursive: true });

// Library names that are byte-identical copies collapse onto the first name seen.
const canonical = new Map(); // sha → name
const alias = new Map();     // name → canonical name
const libName = name => {
  if (alias.has(name)) return alias.get(name);
  const h = sha(join(src, 'lib', name));
  if (!canonical.has(h)) canonical.set(h, name);
  alias.set(name, canonical.get(h));
  return alias.get(name);
};

const todo = [
  ...['postgres', 'initdb'].map(b => ({ from: join(src, 'bin', b), to: join(out, 'bin', b) })),
  ...readdirSync(join(src, 'lib/postgresql')).filter(f => f.endsWith('.dylib') && !SKIP_EXT.test(f))
    .map(f => ({ from: join(src, 'lib/postgresql', f), to: join(out, 'lib/postgresql', f) })),
];
const done = new Set();
while (todo.length) {
  const { from, to } = todo.shift();
  if (done.has(to)) continue;
  done.add(to);
  const archs = run('lipo', ['-archs', from]).trim().split(/\s+/);
  if (archs.length > 1) run('lipo', [from, '-thin', 'arm64', '-output', to]);
  else cpSync(from, to);
  for (const { prefix, name } of deps(to)) {
    const c = libName(name);
    if (c !== name) run('install_name_tool', ['-change', prefix + name, prefix + c, to]);
    todo.push({ from: join(src, 'lib', c), to: join(out, 'lib', c) });
  }
  execFileSync('codesign', ['--force', '--sign', '-', to], { stdio: 'ignore' });
}

const size = d => readdirSync(d, { withFileTypes: true })
  .reduce((s, e) => s + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
const version = run(join(out, 'bin/postgres'), ['--version']).trim();
writeFileSync(join(out, 'VERSION'), version + '\n');
console.log(`${version}: ${done.size} binaries, ${(size(out) / 1e6).toFixed(1)} MB in vendor/postgres`);

// Smoke test the trimmed copy exactly the way the app starts it.
const tmp = mkdtempSync(join(tmpdir(), 'wat-pg-'));
try {
  run(join(out, 'bin/initdb'), ['-D', join(tmp, 'data'), '-U', 'wa_turbo', '-E', 'UTF8', '--locale=C', '--locale-provider=builtin',
    '--builtin-locale=C.UTF-8', '--auth-local=trust', '--auth-host=scram-sha-256', '--no-instructions']);
  const pg = spawn(join(out, 'bin/postgres'), ['-D', join(tmp, 'data'), '-k', tmp, '-p', '54399', '-c', 'listen_addresses='], { stdio: 'ignore' });
  let ok = '';
  for (let i = 0; i < 50 && !ok; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      ok = await query(tmp);
    } catch { /* still starting */ }
  }
  pg.kill('SIGINT');
  await new Promise(r => pg.once('exit', r));
  if (!ok) throw new Error('Bundled Postgres did not answer a query');
  console.log('Smoke test passed:', ok);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

async function query(sock) {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ host: sock, port: 54399, user: 'wa_turbo', database: 'postgres' });
  await c.connect();
  try {
    const r = await c.query("SELECT current_setting('server_version') v, to_tsvector('simple', 'Halo Dunia') t, lower('ÇA VA') l");
    return `${r.rows[0].v}, ${r.rows[0].t}, ${r.rows[0].l}`;
  } finally {
    await c.end();
  }
}
