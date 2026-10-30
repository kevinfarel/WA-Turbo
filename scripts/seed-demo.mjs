// Loads the OpenDesign mockup's demo data (accounts, chats, messages, loops) into a *_test database,
// so the real app can be compared with the mockup screen by screen.
//   WA_TURBO_DATABASE_URL=postgres://wa_turbo:…@localhost:5432/wa_turbo_test node scripts/seed-demo.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import pg from 'pg';

const url = process.env.WA_TURBO_DATABASE_URL;
if (!url || !/_test(\?|$)/.test(new URL(url).pathname + (new URL(url).search || ''))) {
  console.error('Refusing to run: WA_TURBO_DATABASE_URL must point at a database whose name ends in _test.');
  process.exit(1);
}

// Pull the data block out of the mockup and evaluate it with the mockup's clock helpers.
const html = readFileSync('WA-Turbo-Mac-App/index.html', 'utf8');
const start = html.indexOf('const ACCENT');
const end = html.indexOf('let loopSeq');
const code = html.slice(start, end).replace(/\blet (chats|loops)\b/g, 'var $1').replace(/\bconst (accounts|PARTNERS)\b/g, 'var $1');
const ctx = { NOW: new Date(), at: h => new Date(Date.now() - h * 3600_000) };
vm.runInNewContext(code + '\nthis.data = { accounts, chats, loops, PARTNERS };', ctx);
const { accounts, chats, loops, PARTNERS } = ctx.data;

const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query('DROP OWNED BY CURRENT_USER CASCADE');
for (const f of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) {
  await c.query(readFileSync(join('migrations', f), 'utf8'));
}
await c.query('CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
for (const f of readdirSync('migrations').filter(f => f.endsWith('.sql'))) await c.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);

// The app ships with no partners; the demo brings the mockup's own.
for (const p of PARTNERS) {
  await c.query('INSERT INTO partners (id, type, service, steps, current_step) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING',
    [p.id, p.type, p.service, p.steps, p.at ?? 0]);
}

const H = h => new Date(Date.now() - h * 3600_000);
const pairedH = { '3 days ago': 72, '11 days ago': 264, '6 days ago': 144 };
const acctId = {};
let order = 0;
for (const a of accounts) {
  const r = await c.query(
    `INSERT INTO accounts (name, description, phone, accent, status, paired_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [a.name, a.desc, a.phone, a.accent, a.status, H(pairedH[a.paired] ?? 48), new Date(Date.now() - 1e9 + order++ * 1000)]);
  acctId[a.id] = r.rows[0].id;
}

const chatId = {};
const msgId = {};
for (const ch of chats) {
  const last = Math.min(...ch.msgs.map(m => m.h));
  const r = await c.query(
    `INSERT INTO chats (account_id, jid, kind, name, subtitle, unread, last_message_at, partner_id, service, stage)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [acctId[ch.acct], ch.id + (ch.kind === 'group' ? '@g.us' : '@s.whatsapp.net'), ch.kind, ch.name, ch.org || '', ch.unread, H(last),
      ch.partner || null, ch.service || null, ch.stage || null]);
  chatId[ch.id] = r.rows[0].id;
  for (const m of ch.msgs) {
    const shot = !!m.shot;
    const mr = await c.query(
      `INSERT INTO messages (account_id, chat_id, wa_id, sender_name, from_me, sent_at, type, text, media)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [acctId[ch.acct], chatId[ch.id], ch.id + '-' + m.id, m.who === 'me' ? null : m.who, m.who === 'me', H(m.h), shot ? 'image' : 'text', m.tx,
        shot ? JSON.stringify({ mime: 'image/png', fileName: m.shot, thumb: null }) : null]);
    msgId[ch.id + ':' + m.id] = mr.rows[0].id;
  }
}

// The mockup's own loops. Two are marked as found by local rules so the "auto" tag shows.
const ruleMade = new Set(['L5', 'L17']);
const anchored = new Set();
for (const l of loops) {
  const key = l.chatId + ':' + l.msgId + ':' + l.dir;
  const anchor = anchored.has(key) ? null : msgId[l.chatId + ':' + l.msgId] ?? null;
  anchored.add(key);
  const r = await c.query(
    `INSERT INTO loops (chat_id, message_id, dir, kind, state, source, topic, asked_by, asked_at, sla_hours, blocks, snooze_note, answered_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [chatId[l.chatId], anchor, l.dir, l.kind, l.state, ruleMade.has(l.id) ? 'rule' : 'manual', l.topic, l.askedBy,
      H(l.askedH), l.slaH, l.blocks || null, l.snoozeNote || null, l.state === 'answered' ? H(l.answeredH) : null]);
  // In the mockup, follow-ups on a loop you owe come from them (counted); on a loop you wait on, they are your nudges.
  for (const n of l.nudges || []) {
    await c.query('INSERT INTO loop_nudges (loop_id, at, by_me) VALUES ($1,$2,$3)', [r.rows[0].id, H(n), l.dir === 'waiting']);
  }
}

await c.end();
console.log(`Seeded ${accounts.length} accounts, ${chats.length} chats, ${Object.keys(msgId).length} messages, ${loops.length} loops into ${new URL(url).pathname.slice(1)}.`);
