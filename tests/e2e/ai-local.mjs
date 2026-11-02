// End-to-end check of "Local model": with Ollama running on this computer (127.0.0.1:11434) and a chat model
// pulled, launches the built app on a scratch data folder, seeds one chat into its database, switches to
// Local model, and checks WA Turbo found Ollama, picked a model by itself and summarizes with it.
//   node tests/e2e/ai-local.mjs <scratch userData> [screenshot.png]
import { _electron as electron } from 'playwright-core';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const require = createRequire(import.meta.url);
const [ud, shot] = process.argv.slice(2);
if (!ud) { console.error('usage: node tests/e2e/ai-local.mjs <scratch userData> [shot.png]'); process.exit(2); }

const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')), WA_TURBO_USER_DATA: ud, WA_TURBO_NO_AUTO: '1', WA_TURBO_NO_LANG: '1' };
const app = await electron.launch({ executablePath: require('electron'), args: ['.'], env });
const page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const call = (fn, ...args) => page.evaluate(([f, a]) => window.api[f](...a), [fn, args]);
const ok = (cond, what) => { console.log((cond ? 'ok   ' : 'FAIL ') + what); if (!cond) process.exitCode = 1; };

try {
  let boot;
  for (let i = 0; i < 60; i++) { boot = await call('bootstrap'); if (boot.dbOk) break; await page.waitForTimeout(500); }
  ok(boot.dbOk, 'database up');

  // Same socket folder rule as src/main/db/server.ts.
  const pref = join(ud, 'postgres', 'run');
  const sock = Buffer.byteLength(join(pref, '.s.PGSQL.54320')) <= 100 ? pref : join(tmpdir(), 'wat-' + createHash('sha1').update(ud).digest('hex').slice(0, 10));
  const db = new pg.Client({ host: sock, port: 54320, user: 'wa_turbo', database: 'wa_turbo' });
  await db.connect();
  let chat = (await db.query("SELECT id FROM chats WHERE jid = '628111000001@s.whatsapp.net'")).rows[0]?.id;
  if (!chat) {
    const acct = (await db.query("INSERT INTO accounts (name, status, ai_lang) VALUES ('Test number', 'logged_out', 'id') RETURNING id")).rows[0].id;
    chat = (await db.query("INSERT INTO chats (account_id, jid, kind, name, last_message_at) VALUES ($1, '628111000001@s.whatsapp.net', 'dm', 'Budi', now()) RETURNING id", [acct])).rows[0].id;
    const lines = [
      [false, 'Mas, invoice bulan Oktober sudah dikirim belum? Finance kami tanya terus.'],
      [true, 'Belum mas, besok pagi saya kirim ya'],
      [false, 'Oke. Sekalian tolong kirim faktur pajaknya juga'],
      [false, 'Satu lagi, meeting Kamis jadi jam 2 siang?'],
      [true, 'Jadi, jam 2 di kantor kalian'],
      [false, 'Siap, terima kasih'],
    ];
    for (const [i, [me, text]] of lines.entries()) {
      await db.query(`INSERT INTO messages (account_id, chat_id, wa_id, sender_jid, sender_name, from_me, sent_at, text)
        VALUES ($1, $2, $3, $4, $5, $6, now() - make_interval(mins => $7), $8)`, [acct, chat, 'm' + i, me ? null : '628111000001@s.whatsapp.net', me ? null : 'Budi', me, (lines.length - i) * 10, text]);
    }
  }
  await db.end();

  const found = await call('detectLocal');
  ok(found.running, 'Ollama detected (' + found.version + ') with ' + found.models.join(', '));
  await call('saveSettings', { provider: 'local', localModel: '' });
  const st = await call('checkAi', false);
  const picked = (await call('getSettings')).localModel;
  ok(st.connected && !!picked, 'connected, picked ' + picked + ' by itself');

  const t0 = Date.now();
  const r = await call('summarize', chat, { window: 50, force: true });
  ok(r.model === 'local:' + picked, `summary by ${r.model} in ${((Date.now() - t0) / 1000).toFixed(1)} s, language ${r.lang}`);
  console.log('     summary: ' + r.insight.summary);
  console.log('     actions: ' + JSON.stringify(r.insight.actions));
  const loops = (await call('listLoops')).filter(l => l.chatId === chat && l.state === 'open');
  console.log('     open loops: ' + loops.map(l => `${l.dir}/${l.source}: ${l.topic}`).join(' | '));
  const use = await call('usage', 0);
  ok(use.reduce((n, b) => n + b.input + b.output, 0) > 0, 'usage logged: ' + use.reduce((n, b) => n + b.input, 0) + ' in / ' + use.reduce((n, b) => n + b.output, 0) + ' out');
  const cached = await call('summarize', chat, { window: 50 });
  ok(cached.cached === true, 'second summarize with nothing new is served from the cache');

  if (shot) {
    await page.reload(); // the window picks up the provider this script set behind its back
    await page.waitForTimeout(2500);
    await page.click('[data-view="settings"]');
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.querySelector('#localBox')?.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot });
    console.log('     screenshot ' + shot);
  }
} finally {
  if (errors.length) console.log('Page errors:\n' + errors.join('\n'));
  await app.close();
}
