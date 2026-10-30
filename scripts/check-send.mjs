// Fails the build unless everything WA Turbo sends to WhatsApp comes from the person's own hand:
// a message typed and sent from the composer, or an edit / delete-for-everyone of their own message.
// No automatic, scheduled, rule-driven or AI-written sends, and no read receipts, presence or chat changes.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const FORBIDDEN = [
  'relayMessage', 'readMessages', 'sendReceipt', 'sendReceipts', 'sendPresenceUpdate', 'presenceSubscribe',
  'chatModify', 'sendMessageAck', 'updateMediaMessage', 'groupParticipantsUpdate', 'groupUpdateSubject', 'groupUpdateDescription',
  'updateProfileStatus', 'updateProfileName', 'updateBlockStatus', 'star', 'sendPeerDataOperationMessage', 'sendStatusMentions',
];
const CALL = new RegExp('\\.(' + FORBIDDEN.join('|') + ')\\s*\\(');

// Each send hop, the one file it may appear in, and how many times.
const HOPS = [
  { re: /(?<!\bapi)\.sendMessage\s*\(/, file: 'main/wa/session.ts', max: 1, what: 'WhatsApp sendMessage' },
  { re: /\bmanager\.send\s*\(/, file: 'main/ipc/router.ts', max: 1, what: 'manager.send' },
  { re: /\bmanager\.edit\s*\(/, file: 'main/ipc/router.ts', max: 1, what: 'manager.edit' },
  { re: /\bmanager\.revoke\s*\(/, file: 'main/ipc/router.ts', max: 1, what: 'manager.revoke' },
  { re: /\bapi\.sendMessage\s*\(/, file: 'renderer/app.ts', max: 1, what: 'api.sendMessage' },
  { re: /\bapi\.editMessage\s*\(/, file: 'renderer/app.ts', max: 1, what: 'api.editMessage' },
  { re: /\bapi\.deleteForEveryone\s*\(/, file: 'renderer/app.ts', max: 1, what: 'api.deleteForEveryone' },
];
// In the window, each outgoing call lives in one function, and only a click or key press calls it.
const GESTURES = [
  { fn: 'sendFromComposer', api: 'api.sendMessage', callers: /case 'sendBtn'|e\.key === 'Enter'/, says: 'only the Send button or Enter may send' },
  { fn: 'saveEdit', api: 'api.editMessage', callers: /case 'editSave'|e\.key === 'Enter'/, says: 'only the Save button or Enter may save an edit' },
  { fn: 'removeForEveryone', api: 'api.deleteForEveryone', callers: /confirmDlg\(/, says: 'delete for everyone runs only after the confirm dialog' },
];
// Code that runs on its own (AI, rules, ingest, notifications) must not reach the send path at all.
const AUTONOMOUS = ['main/ai', 'main/loops', 'main/ingest', 'main/notify'];
const REACHES_SEND = /\.send\s*\(|\.revoke\s*\(|manager\.edit|sendMessage|WaManager|wa\/manager|wa\/session/;

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(f)) out.push(p);
  }
  return out;
}

export function findViolations(root = 'src') {
  const hits = [];
  const counts = new Map();
  for (const file of walk(root)) {
    const rel = relative(root, file).split('\\').join('/');
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const at = `${rel}:${i + 1}: ${line.trim()}`;
      if (CALL.test(line)) hits.push(at + '  ← receipts, presence and chat changes are never sent');
      for (const h of HOPS) {
        if (!h.re.test(line)) continue;
        if (rel !== h.file) hits.push(at + `  ← ${h.what} belongs only in src/${h.file}`);
        counts.set(h.what, (counts.get(h.what) ?? 0) + 1);
      }
      if (AUTONOMOUS.some(d => rel.startsWith(d + '/')) && REACHES_SEND.test(line)) hits.push(at + '  ← AI, rules, ingest and notifications may not send');
    });
  }
  for (const h of HOPS) if ((counts.get(h.what) ?? 0) > h.max) hits.push(`${h.what} appears ${counts.get(h.what)} times; only ${h.max} is allowed`);

  const app = join(root, 'renderer/app.ts');
  let src = null;
  try { src = readFileSync(app, 'utf8'); } catch { /* no renderer in this tree */ }
  if (src !== null) {
    for (const g of GESTURES) {
      const call = new RegExp('\\b' + g.fn + '\\s*\\(');
      const apiCall = new RegExp(g.api.replace('.', '\\.') + '\\s*\\(');
      src.split('\n').forEach((line, i) => {
        if (!call.test(line) || new RegExp('function ' + g.fn + '\\s*\\(').test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (!g.callers.test(line)) hits.push(`${app}:${i + 1}: ${line.trim()}  ← ${g.says}`);
      });
      const body = src.split('function ' + g.fn)[1]?.split('\n}\n')[0] ?? '';
      if (/setTimeout|setInterval|requestIdleCallback/.test(body)) hits.push(`${app}: ${g.fn} must act right away, never on a timer`);
      if (apiCall.test(src) && !apiCall.test(body)) hits.push(`${app}: ${g.api} must be called only inside ${g.fn}`);
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = findViolations();
  if (hits.length) {
    console.error('WA Turbo sends only what you do yourself. These lines break that:\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log('Send check passed: only your own Send, Edit and Delete reach WhatsApp; no automatic, scheduled or AI sends, no receipts or presence.');
}
