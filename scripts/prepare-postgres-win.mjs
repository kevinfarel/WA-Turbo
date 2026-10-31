// Copies the Postgres server the Windows build ships into vendor/postgres-win32-x64, trimmed for size.
// The npm package is Windows-only (npm refuses to install it on a Mac), so the pinned tarball is fetched
// straight from the registry and checked against its sha512. Keeps postgres.exe, initdb.exe and pg_ctl.exe
// (Windows stops the server only through pg_ctl) plus every DLL they or the extension libraries import,
// found by reading each PE import table. Drops the Perl/Python/Tcl languages, link libraries, docs and
// message translations. The ICU libraries need the Visual C++ runtime, which a clean Windows doesn't
// have, so its three DLLs are copied next to postgres.exe (app-local deployment, which Microsoft allows),
// taken from conda-forge's pinned vc14_runtime package. The smoke test runs only on Windows.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, zstdDecompressSync } from 'node:zlib';

const VERSION = '18.4.0-beta.17'; // same server as the Mac build (@embedded-postgres/darwin-arm64)
const URL = `https://registry.npmjs.org/@embedded-postgres/windows-x64/-/windows-x64-${VERSION}.tgz`;
const INTEGRITY = 'sha512-AwRerliA4IGWyW5jWBvHt5vidVUSB0QQW9Tt2y7ScnmifnCb/awfxZr4BkBSTv+gNt8Djcddqs+xSF5Z6/CkTg==';
const VC_URL = 'https://conda.anaconda.org/conda-forge/win-64/vc14_runtime-14.44.35208-h818238b_41.conda';
const VC_SHA256 = 'ec706fe9368b837fbd05af4851f5ebef12bef8c471a273f4805f7af788407317';
const VC_DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'vendor/postgres-win32-x64');
const SKIP_LIB = /^(pl(perl|python3|tcl)|.*_pl(perl|python3))\.dll$/i;
const SKIP_SHARE = new Set(['doc', 'locale']);

const tmp = mkdtempSync(join(tmpdir(), 'wat-pgwin-'));
try {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${URL}`);
  const tgz = Buffer.from(await res.arrayBuffer());
  const got = 'sha512-' + createHash('sha512').update(tgz).digest('base64');
  if (got !== INTEGRITY) throw new Error(`Checksum mismatch for ${URL}`);
  writeFileSync(join(tmp, 'pkg.tgz'), tgz);
  execFileSync('tar', ['-xzf', join(tmp, 'pkg.tgz'), '-C', tmp]);
  const src = join(tmp, 'package/native');

  rmSync(out, { recursive: true, force: true });
  for (const d of ['bin', 'lib', 'share']) mkdirSync(join(out, d), { recursive: true });
  for (const e of readdirSync(join(src, 'share'))) {
    if (!SKIP_SHARE.has(e)) cpSync(join(src, 'share', e), join(out, 'share', e), { recursive: true });
  }

  // DLL names in import tables are case-insensitive; map them onto the files in bin/.
  const inBin = new Map(readdirSync(join(src, 'bin')).map(f => [f.toLowerCase(), f]));
  const todo = [
    ...['postgres.exe', 'initdb.exe', 'pg_ctl.exe'].map(f => ({ from: join(src, 'bin', f), to: join(out, 'bin', f) })),
    ...readdirSync(join(src, 'lib')).filter(f => /\.dll$/i.test(f) && !SKIP_LIB.test(f))
      .map(f => ({ from: join(src, 'lib', f), to: join(out, 'lib', f) })),
  ];
  const done = new Set();
  while (todo.length) {
    const { from, to } = todo.shift();
    if (done.has(to)) continue;
    done.add(to);
    cpSync(from, to);
    for (const dll of peImports(readFileSync(from))) {
      const f = inBin.get(dll.toLowerCase());
      if (f) todo.push({ from: join(src, 'bin', f), to: join(out, 'bin', f) });
    }
  }

  await copyVcRuntime(join(out, 'bin'));

  const size = d => readdirSync(d, { withFileTypes: true })
    .reduce((s, e) => s + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
  const version = `postgres (PostgreSQL) ${VERSION.split('-')[0].split('.').slice(0, 2).join('.')}`;
  writeFileSync(join(out, 'VERSION'), version + '\n');
  console.log(`${version}: ${done.size} binaries, ${(size(out) / 1e6).toFixed(1)} MB in vendor/postgres-win32-x64`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (process.platform === 'win32') await smokeTest();
else console.log('Smoke test skipped: it runs the .exe files, so it needs Windows.');

/** DLL names a PE32+ file imports, from its import and delay-import tables. */
function peImports(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') return [];
  const coff = pe + 4;
  const sections = buf.readUInt16LE(coff + 2);
  const optSize = buf.readUInt16LE(coff + 16);
  const opt = coff + 20;
  const dirs = opt + (buf.readUInt16LE(opt) === 0x20b ? 112 : 96);
  const table = [];
  for (let i = 0, s = opt + optSize; i < sections; i++, s += 40) {
    table.push({ va: buf.readUInt32LE(s + 12), size: Math.max(buf.readUInt32LE(s + 8), buf.readUInt32LE(s + 16)), raw: buf.readUInt32LE(s + 20) });
  }
  const at = rva => { const s = table.find(t => rva >= t.va && rva < t.va + t.size); return s ? rva - s.va + s.raw : -1; };
  const names = [];
  // [data directory index, descriptor size, offset of the DLL name RVA]
  for (const [dir, step, nameAt] of [[1, 20, 12], [13, 32, 4]]) {
    const rva = buf.readUInt32LE(dirs + dir * 8);
    if (!rva) continue;
    for (let o = at(rva); o >= 0; o += step) {
      const name = buf.readUInt32LE(o + nameAt);
      if (!name) break;
      const p = at(name);
      names.push(buf.toString('latin1', p, buf.indexOf(0, p)));
    }
  }
  return names;
}

/** Copies the VC++ runtime DLLs out of the conda package: a zip holding pkg-*.tar.zst. */
async function copyVcRuntime(binDir) {
  const res = await fetch(VC_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${VC_URL}`);
  const conda = Buffer.from(await res.arrayBuffer());
  if (createHash('sha256').update(conda).digest('hex') !== VC_SHA256) throw new Error(`Checksum mismatch for ${VC_URL}`);
  const [, zst] = [...unzip(conda)].find(([name]) => /^pkg-.*\.tar\.zst$/.test(name)) ?? [];
  if (!zst) throw new Error('No package payload in ' + VC_URL);
  const dir = mkdtempSync(join(tmpdir(), 'wat-vc-'));
  try {
    writeFileSync(join(dir, 'pkg.tar'), zstdDecompressSync(zst));
    execFileSync('tar', ['-xf', join(dir, 'pkg.tar'), '-C', dir]);
    for (const dll of VC_DLLS) cpSync(join(dir, 'Library/bin', dll), join(binDir, dll));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Entries of an in-memory zip (stored or deflated, no ZIP64), by name. */
function unzip(buf) {
  const files = new Map();
  for (let o = 0; o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50;) {
    const method = buf.readUInt16LE(o + 8), size = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26), extraLen = buf.readUInt16LE(o + 28);
    if (buf.readUInt16LE(o + 6) & 0x08) throw new Error('Zip entries with data descriptors are not supported');
    const start = o + 30 + nameLen + extraLen;
    const raw = buf.subarray(start, start + size);
    files.set(buf.toString('utf8', o + 30, o + 30 + nameLen), method === 8 ? inflateRawSync(raw) : raw);
    o = start + size;
  }
  return files;
}

// Same start as the app: initdb, then postgres on 127.0.0.1 with a password, one query, pg_ctl stop.
async function smokeTest() {
  const dir = mkdtempSync(join(tmpdir(), 'wat-pg-'));
  const data = join(dir, 'data');
  const pw = join(dir, 'pw');
  writeFileSync(pw, 'smoke');
  try {
    execFileSync(join(out, 'bin/initdb.exe'), ['-D', data, '-U', 'wa_turbo', '--pwfile', pw, '-E', 'UTF8', '--locale=C', '--locale-provider=builtin',
      '--builtin-locale=C.UTF-8', '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--no-instructions'], { stdio: 'ignore' });
    const pg = spawn(join(out, 'bin/postgres.exe'), ['-D', data, '-p', '54399', '-c', 'listen_addresses=127.0.0.1', '-c', 'unix_socket_directories='],
      { stdio: 'ignore', windowsHide: true });
    let ok = '';
    for (let i = 0; i < 50 && !ok; i++) {
      await new Promise(r => setTimeout(r, 200));
      try { ok = await query(); } catch { /* still starting */ }
    }
    execFileSync(join(out, 'bin/pg_ctl.exe'), ['stop', '-D', data, '-m', 'fast', '-w'], { stdio: 'ignore' });
    await new Promise(r => (pg.exitCode === null ? pg.once('exit', r) : r()));
    if (!ok) throw new Error('Bundled Postgres did not answer a query');
    console.log('Smoke test passed:', ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function query() {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ host: '127.0.0.1', port: 54399, user: 'wa_turbo', password: 'smoke', database: 'postgres' });
  await c.connect();
  try {
    const r = await c.query("SELECT current_setting('server_version') v, to_tsvector('simple', 'Halo Dunia') t, lower('ÇA VA') l");
    return `${r.rows[0].v}, ${r.rows[0].t}, ${r.rows[0].l}`;
  } finally {
    await c.end();
  }
}
