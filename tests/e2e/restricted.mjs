// End-to-end check of restricted words: launches the built app on a scratch data folder, seeds one number and chat,
// and runs the check through the real router and the real window. Nothing reaches WhatsApp: the number has no socket,
// so a message that passes the check stops at "not online", which is how this tells passed from held back.
// The close-word case calls the connected AI once.
//   node tests/e2e/restricted.mjs <scratch userData> [screenshot folder]
import { _electron as electron } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const require = createRequire(import.meta.url);
const [ud, shots] = process.argv.slice(2);
if (!ud) { console.error('usage: node tests/e2e/restricted.mjs <scratch userData> [screenshot folder]'); process.exit(2); }
if (shots) mkdirSync(shots, { recursive: true });

const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')), WA_TURBO_USER_DATA: ud, WA_TURBO_NO_AUTO: '1', WA_TURBO_NO_LANG: '1' };
const app = await electron.launch({ executablePath: require('electron'), args: ['.'], env });
const page = await app.firstWindow();
await page.setViewportSize({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const call = (fn, ...args) => page.evaluate(([f, a]) => window.api[f](...a), [fn, args]);
const ok = (cond, what) => { console.log((cond ? 'ok   ' : 'FAIL ') + what); if (!cond) process.exitCode = 1; };
// macOS refuses focus to a test window while someone is using another app, and sends need the window in front.
// That rule isn't what this checks, so this run alone answers for it. The app itself is unchanged.
const front = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; BrowserWindow.getFocusedWindow = () => w; });
const shot = async name => { if (shots) await page.screenshot({ path: join(shots, name + '.png') }); };
/** A send that passed the check goes on to the WhatsApp step, which fails here because the number has no socket. */
const send = async (chat, text, allow) => {
  await front();
  try { return await call('sendMessage', chat, text, null, [], allow); } catch (e) { return { threw: String(e.message ?? e) }; }
};
const passed = r => !!r.threw && !/in front|just sent/.test(r.threw);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
/** Pastes a one-pixel image file into the composer, the way a file copied in Finder arrives. */
const paste = name => page.evaluate(([b64, n]) => {
  const dt = new DataTransfer();
  dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], n, { type: 'image/png' }));
  document.getElementById('composer').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, [PNG, name]);
const dlgOpen = () => page.evaluate(() => document.getElementById('dlgFlagged').open);
const dlgText = () => page.evaluate(() => document.getElementById('flBody').textContent);

try {
  let boot;
  for (let i = 0; i < 60; i++) { boot = await call('bootstrap'); if (boot.dbOk) break; await page.waitForTimeout(500); }
  ok(boot.dbOk, 'database up, migration 010 applied');

  const pref = join(ud, 'postgres', 'run');
  const sock = Buffer.byteLength(join(pref, '.s.PGSQL.54320')) <= 100 ? pref : join(tmpdir(), 'wat-' + createHash('sha1').update(ud).digest('hex').slice(0, 10));
  const db = new pg.Client({ host: sock, port: 54320, user: 'wa_turbo', database: 'wa_turbo' });
  db.on('error', () => {}); // the app stops its database when it closes
  await db.connect();
  await db.query('DELETE FROM accounts');
  const acct = (await db.query("INSERT INTO accounts (name, status, ai_lang, phone) VALUES ('Number one', 'online', 'en', '+62 811 1000') RETURNING id")).rows[0].id;
  const chat = (await db.query("INSERT INTO chats (account_id, jid, kind, name, last_message_at) VALUES ($1, '628111000001@s.whatsapp.net', 'dm', 'Test chat', now()) RETURNING id", [acct])).rows[0].id;
  await page.reload();
  await page.waitForSelector('.titlebar');
  await page.waitForTimeout(800);

  const rule = (over = {}) => ({ on: true, hard: false, words: ['Zentrix', 'AB1'], ...over });
  const accounts = async () => (await call('bootstrap')).accounts;

  // Off by default: a listed word passes.
  ok((await accounts())[0].restricted.on === false, 'off by default');
  await call('setNumberRestricted', acct, rule({ on: false }));
  ok(passed(await send(chat, 'ask Zentrix')), 'switched off: passes');

  await call('setNumberRestricted', acct, rule({ words: ['  Zentrix', 'zentrix ', 'AB1'] }));
  ok((await accounts())[0].restricted.words.join() === 'zentrix,ab1', 'list saved clean and read back');

  let r = await send(chat, 'tolong tanya ZENTRIXnya');
  ok(r.sent === false && r.words[0] === 'zentrix' && r.by === 'exact' && r.number === 'Number one', 'exact match is held back, naming word and number');
  ok(passed(await send(chat, 'ok siap nanti saya kabari')), 'ordinary message passes');
  ok(passed(await send(chat, 'tolong tanya ZENTRIXnya', true)), 'Send anyway passes, and is not refused as a repeat');

  const t0 = Date.now();
  r = await send(chat, 'tolong tanya tim Zentrik soal invoice');
  const ms = Date.now() - t0;
  ok(r.sent === false && r.by === 'ai' && r.words[0] === 'zentrix', `close word held back by the AI (${ms} ms)`);
  r = await send(chat, 'tolong tanya tim Zentrik soal invoice', true);
  ok(passed(r), 'Send anyway on an AI match passes' + (passed(r) ? '' : ': ' + JSON.stringify(r)));

  await call('setNumberRestricted', acct, rule({ hard: true }));
  r = await send(chat, 'ask Zentrix', true);
  ok(r.sent === false && r.hard === true, 'hard block ignores Send anyway in the main process' + (r.sent === false ? '' : ': ' + JSON.stringify(r)));
  await call('setNumberRestricted', acct, rule());

  // The window: real typing, real Enter.
  await page.reload();
  await page.waitForSelector('.titlebar');
  await page.waitForTimeout(800);
  await page.click(`[data-chat="${chat}"], [data-id="${chat}"]`).catch(() => {});
  await page.waitForSelector('#composer', { timeout: 5000 });
  await front();
  await page.fill('#composer', 'please ask zentrix about it');
  await page.press('#composer', 'Enter');
  await page.waitForFunction(() => document.getElementById('dlgFlagged').open);
  await page.waitForTimeout(150);
  ok((await dlgText()).includes('Number one') && (await dlgText()).includes('zentrix'), 'dialog names the number and the word');
  ok((await page.evaluate(() => document.activeElement.textContent)) === 'Go back', 'Go back holds the focus, not Send anyway');
  await shot('warn-en');
  await page.keyboard.press('Enter');
  ok(!(await dlgOpen()), 'Enter closes the dialog');
  ok((await page.inputValue('#composer')) === 'please ask zentrix about it', 'the text stays in the composer');
  await page.waitForTimeout(100);
  ok((await page.evaluate(() => document.activeElement.id)) === 'composer', 'focus returns to the composer');

  await front();
  await page.press('#composer', 'Enter');
  await page.waitForFunction(() => document.getElementById('dlgFlagged').open);
  await front();
  await page.click('#flaggedGo');
  await page.waitForFunction(() => !document.getElementById('dlgFlagged').open);
  await page.waitForTimeout(400);
  ok(!(await dlgOpen()) && (await page.inputValue('#composer')).includes('zentrix'), 'Send anyway goes past the check; text kept because the send itself failed here');

  // Close word: the composer is locked while the AI answers, and the dialog says "looks like".
  await page.fill('#composer', 'tanya tim Zentrik ya');
  await front();
  await page.press('#composer', 'Enter');
  await page.waitForSelector('#sendBtn.checking', { timeout: 3000 });
  ok(await page.evaluate(() => document.getElementById('composer').readOnly), 'composer is read-only during the AI check');
  await shot('checking');
  await page.waitForFunction(() => document.getElementById('dlgFlagged').open, null, { timeout: 15000 });
  ok((await dlgText()).includes('looks like'), 'AI match reads "looks like"');
  await shot('ai-en');
  await page.keyboard.press('Escape');

  // Attachment names: a real paste into the composer, with no text at all.
  await page.keyboard.press('Escape').catch(() => {});
  await page.fill('#composer', '');
  await paste('BuktiTransferZENTRIX2026.png');
  await page.waitForSelector('.attach-chip');
  await front();
  await page.press('#composer', 'Enter');
  await page.waitForFunction(() => document.getElementById('dlgFlagged').open);
  await page.waitForTimeout(150);
  const fileBody = await dlgText();
  ok(fileBody.includes('attachment') && fileBody.includes('BuktiTransferZENTRIX2026.png') && fileBody.includes('zentrix'), 'attachment name is held back: ' + fileBody);
  await shot('attachment-en');
  await page.keyboard.press('Enter');
  ok(await page.isVisible('.attach-chip'), 'the photo stays attached after Go back');
  await front();
  await page.press('#composer', 'Enter');
  await page.waitForFunction(() => document.getElementById('dlgFlagged').open);
  await front();
  await page.click('#flaggedGo');
  await page.waitForFunction(() => !document.getElementById('dlgFlagged').open);
  await page.waitForTimeout(400);
  ok(!(await dlgOpen()), 'Send anyway goes past the attachment check');
  await page.click('#attachClear');
  await paste('liburan keluarga.png');
  await page.waitForSelector('.attach-chip');
  await front();
  await page.press('#composer', 'Enter');
  await page.waitForTimeout(500);
  ok(!(await dlgOpen()), 'a clean attachment name is not held back');
  await page.click('#attachClear');

  // Hard block: Go back only.
  await call('setNumberRestricted', acct, rule({ hard: true }));
  await page.fill('#composer', 'please ask zentrix');
  await front();
  await page.press('#composer', 'Enter');
  await page.waitForFunction(() => document.getElementById('dlgFlagged').open);
  ok((await page.evaluate(() => document.getElementById('flTitle').textContent)) === 'Message blocked' && !(await page.isVisible('#flaggedGo')), 'hard block shows Go back only');
  await shot('hard-en');
  await page.keyboard.press('Escape');
  await page.fill('#composer', '');

  // Settings, for real: on, add, remove, hard, Enter to add. Reloaded so it shows the rule set above through the API.
  await page.reload();
  await page.waitForSelector('.titlebar');
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('[data-view="settings"], #navSettings, [aria-label="Settings"]')?.click());
  await page.waitForSelector('#restrictedList details', { timeout: 5000 });
  await page.click('#restrictedList summary');
  await page.fill('[data-restricted-input]', 'New Word');
  await page.press('[data-restricted-input]', 'Enter');
  await page.waitForTimeout(250);
  ok((await accounts())[0].restricted.words.includes('new word'), 'adding a word in Settings saves it in lowercase');
  ok(await page.evaluate(() => document.querySelector('#restrictedList details').open), 'the row stays open after adding');
  await page.click('[data-restricted-word="new word"]');
  await page.waitForTimeout(250);
  ok(!(await accounts())[0].restricted.words.includes('new word'), 'removing a word saves');
  await page.fill('[data-restricted-input]', 'Alpha, BETA ,, Gamma Co, zentrix');
  await page.press('[data-restricted-input]', 'Enter');
  await page.waitForTimeout(250);
  ok((await accounts())[0].restricted.words.join() === 'zentrix,ab1,alpha,beta,gamma co', 'commas add several at once, skipping one already listed');
  ok((await page.inputValue('[data-restricted-input]')) === '', 'the box empties after adding');
  await page.fill('[data-restricted-input]', 'gamma-co');
  await page.press('[data-restricted-input]', 'Enter');
  await page.waitForTimeout(150);
  ok((await accounts())[0].restricted.words.join() === 'zentrix,ab1,alpha,beta,gamma co', 'a second spelling of a word is rejected');
  ok((await page.locator('#toasts').allTextContents()).join(' ').includes('“gamma co” is enough'), 'and the note says which word is enough');
  ok((await page.inputValue('[data-restricted-input]')) === 'gamma-co', 'the rejected word stays in the box to fix');
  await page.fill('[data-restricted-input]', '');
  await db.query("UPDATE accounts SET restricted_words = '{OLD WORD,old-word,Other}' WHERE id = $1", [acct]);
  ok((await accounts())[0].restricted.words.join() === 'old word,other', 'saved words read back lowercase, with second spellings gone');
  await call('setNumberRestricted', acct, rule({ hard: true }));
  await page.reload();
  await page.waitForSelector('.titlebar');
  await page.waitForTimeout(800);
  await page.click('#tab-settings');
  await page.waitForSelector('#restrictedList details', { timeout: 5000 });
  await page.click('#restrictedList summary');
  await page.click('#restrictedBlock details summary');
  await page.locator('#restrictedBlock').scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await shot('tips-en');
  await page.click('#restrictedBlock details summary');
  await page.click('[data-restricted-hard]');
  await page.waitForTimeout(250);
  ok((await accounts())[0].restricted.hard === false, 'Hard block toggle saves');
  await page.click('[data-restricted-on]');
  await page.waitForTimeout(250);
  ok((await accounts())[0].restricted.on === false, 'On/Off toggle saves');
  await page.click('[data-restricted-on]');
  await page.locator('#restrictedBlock').scrollIntoViewIfNeeded();
  await shot('settings-en');

  // Indonesian and dark: every new string translated, in Settings and in the dialog.
  await page.evaluate(() => { localStorage.setItem('wat.lang', 'id'); localStorage.setItem('wat.i18nDebug', '1'); });
  await page.reload();
  await page.waitForSelector('.titlebar');
  await page.waitForTimeout(800);
  await page.click('#themeToggle').catch(() => {});
  await page.click('#tab-settings');
  await page.waitForSelector('#restrictedList details', { timeout: 5000 });
  await page.click('#restrictedList summary');
  await page.click('#restrictedBlock details summary');
  await page.locator('#restrictedBlock').scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await shot('settings-id-dark');
  await page.click('[data-view="inbox"]');
  await page.click(`[data-chat="${chat}"]`);
  await page.waitForSelector('#composer');
  await page.fill('#composer', 'please ask zentrix');
  await front();
  await page.press('#composer', 'Enter');
  await page.waitForFunction(() => document.getElementById('dlgFlagged').open);
  await page.waitForTimeout(250);
  const idBody = await dlgText();
  ok(idBody.includes('Number one') && idBody.includes('zentrix') && /keluar dari/.test(idBody), 'dialog translated, names kept: ' + idBody);
  await shot('warn-id-dark');
  await page.keyboard.press('Escape');
  const seen = await page.evaluate(() => Array.isArray(window.__i18nMissing) ? window.__i18nMissing : window.__i18nMissing ? [...window.__i18nMissing] : null);
  ok(seen !== null, 'Indonesian gap list is being recorded');
  const gaps = (seen ?? []).filter(x => /restrict|word|block|anyway|go back|check this|goes out|looks like|hard|attachment|comma|added|skip|name|capital|variant|typo|number\.?$/i.test(x));
  ok(gaps.length === 0, 'no missing Indonesian strings' + (gaps.length ? ': ' + JSON.stringify(gaps) : ''));
  await db.end();
} catch (e) {
  ok(false, String(e));
  await shot('failure').catch(() => {});
}
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await app.close();
