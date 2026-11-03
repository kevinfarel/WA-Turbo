import type pg from 'pg';
import type {
  Account, Accent, AccountStatus, ChatInsight, Lang, ChatKind, ChatSummaryRow, Loop, LoopDir, LoopKind, LoopSource, LoopState,
  Message, MessageType, ModelId, Partner, PresetId, Report, Settings, SummaryResult, TeamMember, UsageBucket,
} from '@shared/types';
import { withMentions } from '@shared/mentions';
import { formatPhone } from '@shared/phone';
import { DEFAULT_SLA_H } from '@shared/sla';
import { q, q1, tx } from './client';

/* ---------------- accounts ---------------- */

interface AccountRow { id: string; name: string; description: string; phone: string; accent: Accent; status: AccountStatus; paired_at: number | null; jid: string | null; ai_lang: Lang | null; ai_lang_detected: boolean }
const toAccount = (r: AccountRow): Account => ({
  id: r.id, name: r.name, desc: r.description, phone: r.phone, accent: r.accent, status: r.status, pairedAt: r.paired_at, lang: r.ai_lang, langDetected: r.ai_lang_detected,
});

export async function listAccounts(): Promise<Account[]> {
  return (await q<AccountRow>('SELECT * FROM accounts ORDER BY created_at')).map(toAccount);
}

export async function accountJids(): Promise<{ id: string; jid: string | null; status: AccountStatus }[]> {
  return q('SELECT id, jid, status FROM accounts ORDER BY created_at');
}

export async function createAccount(name: string, desc: string, accent: Accent): Promise<string> {
  const r = await q1<{ id: string }>('INSERT INTO accounts (name, description, accent) VALUES ($1, $2, $3) RETURNING id', [name, desc, accent]);
  return r!.id;
}

export async function updateAccount(id: string, p: { status?: AccountStatus; phone?: string; jid?: string; pairedNow?: boolean }): Promise<void> {
  await q(
    `UPDATE accounts SET status = coalesce($2, status), phone = coalesce($3, phone), jid = coalesce($4, jid),
       paired_at = CASE WHEN $5 THEN now() ELSE paired_at END WHERE id = $1`,
    [id, p.status ?? null, p.phone ?? null, p.jid ?? null, p.pairedNow ?? false],
  );
}

/** Sets the language Claude writes in for a number. detected = chosen by WA Turbo from the chats, not by you. */
export async function setAccountLang(id: string, lang: Lang, detected: boolean): Promise<void> {
  await q('UPDATE accounts SET ai_lang = $2, ai_lang_detected = $3 WHERE id = $1', [id, lang, detected]);
}

export async function forgetAccountLang(id: string): Promise<void> {
  await q('UPDATE accounts SET ai_lang = NULL, ai_lang_detected = false WHERE id = $1', [id]);
}

/** The language for the number a chat belongs to; English until one is set. */
export async function langOfChat(chatId: string): Promise<Lang> {
  const r = await q1<{ ai_lang: Lang | null }>('SELECT a.ai_lang FROM chats c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1', [chatId]);
  return r?.ai_lang ?? 'en';
}

/** Numbers with no language yet, and a sample to detect one from: the newest text of their 10 most recent chats. */
export async function langSamples(): Promise<{ id: string; chats: number; pairedAt: number | null; lines: string[] }[]> {
  const accts = await q<{ id: string; paired_at: number | null }>("SELECT id, paired_at FROM accounts WHERE ai_lang IS NULL AND status <> 'pairing'");
  const out = [];
  for (const a of accts) {
    const rows = await q<{ chat_id: string; text: string }>(
      `SELECT x.chat_id, x.text FROM (SELECT id FROM chats WHERE account_id = $1 AND last_message_at IS NOT NULL ORDER BY last_message_at DESC LIMIT 10) c
         CROSS JOIN LATERAL (SELECT m.chat_id, m.text FROM messages m WHERE m.chat_id = c.id AND m.type = 'text' AND NOT m.deleted AND length(m.text) > 1
                             ORDER BY m.sent_at DESC LIMIT 8) x`, [a.id]);
    out.push({ id: a.id, chats: new Set(rows.map(r => r.chat_id)).size, pairedAt: a.paired_at, lines: rows.map(r => r.text.slice(0, 200)) });
  }
  return out;
}

export async function deleteAccount(id: string): Promise<void> {
  await q('DELETE FROM accounts WHERE id = $1', [id]);
}

/* ---------------- Baileys auth state ---------------- */

export async function authGet(accountId: string, kind: string, ids: string[]): Promise<Map<string, unknown>> {
  const rows = await q<{ key_id: string; value: unknown }>(
    'SELECT key_id, value FROM wa_auth_state WHERE account_id = $1 AND kind = $2 AND key_id = ANY($3)', [accountId, kind, ids]);
  return new Map(rows.map(r => [r.key_id, r.value]));
}

export async function authSet(accountId: string, rows: { kind: string; keyId: string; value: unknown | null }[]): Promise<void> {
  if (!rows.length) return;
  await tx(async c => {
    for (const r of rows) {
      if (r.value === null) await c.query('DELETE FROM wa_auth_state WHERE account_id = $1 AND kind = $2 AND key_id = $3', [accountId, r.kind, r.keyId]);
      else await c.query(
        `INSERT INTO wa_auth_state (account_id, kind, key_id, value) VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_id, kind, key_id) DO UPDATE SET value = excluded.value`, [accountId, r.kind, r.keyId, JSON.stringify(r.value)]);
    }
  });
}

export async function authClear(accountId: string): Promise<void> {
  await q('DELETE FROM wa_auth_state WHERE account_id = $1', [accountId]);
}

/* ---------------- contacts ---------------- */

export interface ContactIn { jid: string; lid?: string | null; phone?: string | null; name?: string | null; notify?: string | null }

/** Saved names (imported or from the phone) for several people at once, keyed by the ID asked for. */
export async function contactNames(accountId: string, jids: string[]): Promise<Map<string, string>> {
  const rows = await q<{ jid: string; name: string | null }>('SELECT j AS jid, contact_name($1, j) AS name FROM unnest($2::text[]) j', [accountId, jids]);
  return new Map(rows.filter(r => r.name).map(r => [r.jid, r.name!]));
}

/** The name each person last showed on a message they sent (their WhatsApp profile name), skipping bare numbers. */
export async function senderNames(accountId: string, jids: string[]): Promise<Map<string, string>> {
  const rows = await q<{ jid: string; name: string }>(
    `SELECT DISTINCT ON (sender_jid) sender_jid AS jid, sender_name AS name FROM messages
      WHERE account_id = $1 AND sender_jid = ANY($2) AND NOT from_me AND coalesce(sender_name, '') !~ '^[+0-9 ()-]*$'
      ORDER BY sender_jid, sent_at DESC`, [accountId, jids]);
  return new Map(rows.map(r => [r.jid, r.name]));
}

export async function upsertContacts(accountId: string, list: ContactIn[]): Promise<void> {
  if (!list.length) return;
  await tx(async c => {
    for (const k of list) {
      await c.query(
        `INSERT INTO contacts (account_id, jid, lid, phone, name, notify) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (account_id, jid) DO UPDATE SET lid = coalesce(excluded.lid, contacts.lid), phone = coalesce(excluded.phone, contacts.phone),
           name = coalesce(excluded.name, contacts.name), notify = coalesce(excluded.notify, contacts.notify)`,
        [accountId, k.jid, k.lid ?? null, k.phone ?? null, k.name ?? null, k.notify ?? null]);
    }
  });
}

export async function listContacts(accountId: string): Promise<ContactIn[]> {
  return q('SELECT jid, lid, phone, name, notify FROM contacts WHERE account_id = $1', [accountId]);
}

/* ---------------- chats ---------------- */

export async function upsertChat(c: pg.PoolClient | null, accountId: string, jid: string, kind: ChatKind, name: string | null): Promise<string> {
  const sql = `INSERT INTO chats (account_id, jid, kind, name) VALUES ($1, $2, $3, coalesce($4, ''))
               ON CONFLICT (account_id, jid) DO UPDATE SET name = CASE WHEN coalesce($4, '') <> '' THEN $4 ELSE chats.name END
               RETURNING id`;
  const params = [accountId, jid, kind, name];
  const r = c ? (await c.query<{ id: string }>(sql, params)).rows[0] : await q1<{ id: string }>(sql, params);
  return r!.id;
}

export async function chatByJid(accountId: string, jid: string): Promise<{ id: string; kind: ChatKind; partner_id: string | null } | null> {
  return q1('SELECT id, kind, partner_id FROM chats WHERE account_id = $1 AND jid = $2', [accountId, jid]);
}

export async function chatMeta(chatId: string): Promise<{ id: string; account_id: string; jid: string; kind: ChatKind; name: string; partner_id: string | null } | null> {
  return q1('SELECT id, account_id, jid, kind, name, partner_id FROM chats WHERE id = $1', [chatId]);
}

/** Display names: your contact name (imported .vcf, else the name saved on the number's phone), else what WhatsApp sent. */
const DM_NAME = `CASE WHEN c.kind = 'dm' THEN coalesce(contact_name(c.account_id, c.jid), nullif(c.name, '')) ELSE c.name END`;
const SENDER_NAME = `CASE WHEN from_me THEN sender_name ELSE coalesce(contact_name(account_id, sender_jid), sender_name) END AS sender_name`;
// Each tag in the text with the person's ID and saved name: {"<number>": [jid, name]}.
const mentionsOf = (t: string) => `(SELECT jsonb_object_agg(e.key, jsonb_build_array(e.value, contact_name(${t}.account_id, e.value))) FROM jsonb_each_text(${t}.mentions) e) AS mentions`;
const MENTIONS = mentionsOf('messages');

const CHAT_ROW_SQL = `
  SELECT c.id, c.account_id, ${DM_NAME} AS name, c.subtitle, c.kind, c.unread, c.partner_id, c.service, c.stage, c.summarized_at, c.jid,
         coalesce(c.last_message_at, c.created_at) AS last_at, c.pinned_at, c.auto_checked_at, c.notify_muted_until,
         lm.from_me, lm.sender_name, lm.text, lm.type, lm.mentions,
         (SELECT count(*) FROM messages m WHERE m.chat_id = c.id AND NOT m.deleted) AS msg_count,
         ls.created_at AS sum_at, coalesce(ls.auto, false) AS sum_auto,
         CASE WHEN ls.created_at IS NULL THEN 0 ELSE (SELECT count(*) FROM messages m WHERE m.chat_id = c.id AND NOT m.deleted AND m.type <> 'system'
           AND m.id > coalesce(ls.last_message_id, 0)) END AS new_since
  FROM chats c
  LEFT JOIN LATERAL (SELECT from_me, CASE WHEN from_me THEN sender_name ELSE coalesce(contact_name(account_id, sender_jid), sender_name) END AS sender_name, text, type, ${mentionsOf('m')} FROM messages m WHERE m.chat_id = c.id AND NOT m.deleted
                     ORDER BY sent_at DESC LIMIT 1) lm ON true
  LEFT JOIN LATERAL (SELECT created_at, auto, last_message_id FROM summaries s WHERE s.chat_id = c.id
                     ORDER BY created_at DESC LIMIT 1) ls ON true`;

interface ChatRow {
  id: string; account_id: string; name: string; subtitle: string; kind: ChatKind; unread: number; partner_id: string | null;
  service: string | null; stage: string | null; summarized_at: number | null; jid: string; last_at: number;
  from_me: boolean | null; sender_name: string | null; text: string | null; type: MessageType | null; msg_count: number;
  pinned_at: number | null; auto_checked_at: number | null; sum_at: number | null; sum_auto: boolean; new_since: number;
  notify_muted_until: number | null; mentions: MessageRow['mentions'];
}

const toChat = (r: ChatRow): ChatSummaryRow => ({
  id: r.id, acct: r.account_id, name: r.name || r.jid.split('@')[0], org: r.subtitle, kind: r.kind, unread: r.unread,
  partner: r.partner_id, service: r.service, stage: r.stage, lastAt: r.last_at,
  lastWho: r.from_me ? 'me' : r.sender_name || '', lastText: withMentions(r.text ?? '', mentionNames(r.mentions)) || (r.type && r.type !== 'text' ? mediaLabel(r.type) : ''),
  msgCount: Number(r.msg_count), summarizedAt: r.summarized_at,
  pinned: r.pinned_at !== null, lastSumAt: r.sum_at, lastSumAuto: r.sum_auto, newSince: Number(r.new_since), autoCheckedAt: r.auto_checked_at,
  mutedUntil: r.notify_muted_until,
});

export async function getChatRow(chatId: string): Promise<ChatSummaryRow | null> {
  const r = await q1<ChatRow>(CHAT_ROW_SQL + ' WHERE c.id = $1', [chatId]);
  return r ? toChat(r) : null;
}

export async function setPinned(chatId: string, pinned: boolean): Promise<void> {
  await q('UPDATE chats SET pinned_at = CASE WHEN $2 THEN coalesce(pinned_at, now()) ELSE NULL END WHERE id = $1', [chatId, pinned]);
}

/* ---------------- my team ---------------- */

let teamCache: Set<string> | null = null;

/** IDs of everyone marked as your team (phone-number and LID forms). */
export async function teamJids(): Promise<Set<string>> {
  if (!teamCache) teamCache = new Set((await q<{ jid: string }>('SELECT jid FROM team_jids')).map(r => r.jid));
  return teamCache;
}

export async function listTeam(): Promise<TeamMember[]> {
  const rows = await q<{ id: number; name: string; jids: string[]; created_at: number }>(
    `SELECT tm.id, coalesce((SELECT n FROM (SELECT contact_name(NULL, x.jid) AS n FROM team_jids x WHERE x.member_id = tm.id) k WHERE n IS NOT NULL LIMIT 1), tm.name) AS name,
            array_agg(tj.jid ORDER BY tj.jid) AS jids, tm.created_at
       FROM team_members tm JOIN team_jids tj ON tj.member_id = tm.id GROUP BY tm.id ORDER BY lower(tm.name), tm.id`);
  return rows.map(r => ({ id: String(r.id), name: r.name, phones: r.jids.filter(j => j.endsWith('@s.whatsapp.net')).map(j => '+' + j.split('@')[0]), addedAt: r.created_at }));
}

/** Adds a person (all their known IDs) to your team; joins an existing member when one ID is already there. */
export async function addTeam(name: string, jids: string[]): Promise<string> {
  const ids = [...new Set(jids.filter(Boolean))];
  const found = await q1<{ member_id: number }>('SELECT member_id FROM team_jids WHERE jid = ANY($1) LIMIT 1', [ids]);
  const memberId = found?.member_id ?? (await q1<{ id: number }>('INSERT INTO team_members (name) VALUES ($1) RETURNING id', [name]))!.id;
  for (const j of ids) await q('INSERT INTO team_jids (jid, member_id) VALUES ($1, $2) ON CONFLICT (jid) DO NOTHING', [j, memberId]);
  teamCache = null;
  return String(memberId);
}

/** Removes a member; returns the IDs they had so their loops can be flipped back. */
export async function removeTeam(memberId: string): Promise<string[]> {
  const jids = (await q<{ jid: string }>('SELECT jid FROM team_jids WHERE member_id = $1', [Number(memberId)])).map(r => r.jid);
  await q('DELETE FROM team_members WHERE id = $1', [Number(memberId)]);
  teamCache = null;
  return jids;
}

export async function teamMemberOf(jids: string[]): Promise<string | null> {
  const r = await q1<{ member_id: number }>('SELECT member_id FROM team_jids WHERE jid = ANY($1) LIMIT 1', [jids]);
  return r ? String(r.member_id) : null;
}

/**
 * Re-labels open loops opened by these people in group chats. Joining the team: their asks become
 * "waiting on them" (an existing duplicate is dismissed). Leaving: back to "you owe them".
 * Returns the chats touched.
 */
export async function flipTeamLoops(jids: string[], toTeam: boolean, label: string): Promise<string[]> {
  const from = toTeam ? 'owed' : 'waiting';
  const to = toTeam ? 'waiting' : 'owed';
  const rows = await q<{ id: number; chat_id: string; message_id: number; sla_hours: number; partner_id: string | null }>(
    `SELECT l.id, l.chat_id, l.message_id, l.sla_hours, c.partner_id FROM loops l
       JOIN messages m ON m.id = l.message_id JOIN chats c ON c.id = l.chat_id
      WHERE l.state IN ('open', 'snoozed') AND l.dir = $1 AND c.kind = 'group' AND NOT m.from_me AND m.sender_jid = ANY($2)`, [from, jids]);
  for (const r of rows) {
    const twin = await q1<{ id: number }>('SELECT id FROM loops WHERE message_id = $1 AND dir = $2', [r.message_id, to]);
    if (twin) { await q(`UPDATE loops SET state = 'dismissed', close_note = 'Same ask, tracked the other way' WHERE id = $1`, [r.id]); continue; }
    const asked = toTeam ? label + ' (Team)' : r.partner_id ? `${label} (${r.partner_id})` : label;
    const sla = r.sla_hours === DEFAULT_SLA_H[from] ? DEFAULT_SLA_H[to] : r.sla_hours;
    await q('UPDATE loops SET dir = $2, sla_hours = $3, asked_by = $4, ai_hint = NULL WHERE id = $1', [r.id, to, sla, asked]);
  }
  return [...new Set(rows.map(r => r.chat_id))];
}

/** Switches one loop between "you owe them" and "waiting on them" by hand. */
export async function flipLoop(id: string): Promise<void> {
  const l = await q1<{ dir: LoopDir; message_id: number | null; sla_hours: number }>('SELECT dir, message_id, sla_hours FROM loops WHERE id = $1', [Number(id)]);
  if (!l) throw new Error('That loop no longer exists.');
  const to: LoopDir = l.dir === 'owed' ? 'waiting' : 'owed';
  if (l.message_id !== null && await q1('SELECT 1 FROM loops WHERE message_id = $1 AND dir = $2 AND id <> $3', [l.message_id, to, Number(id)])) {
    throw new Error('This message is already tracked the other way.');
  }
  const sla = l.sla_hours === DEFAULT_SLA_H[l.dir] ? DEFAULT_SLA_H[to] : l.sla_hours;
  await q('UPDATE loops SET dir = $2, sla_hours = $3, ai_hint = NULL WHERE id = $1', [Number(id), to, sla]);
}

/* ---------------- group senders ---------------- */

/** Group messages with no sender yet whose stored copy still says who sent them. */
export async function sendersToFix(accountId: string): Promise<{ id: number; participant: string; alt: string | null; pushName: string | null }[]> {
  return q(
    `SELECT m.id, coalesce(m.raw -> 'key' ->> 'participant', m.raw ->> 'participant') AS participant,
            m.raw -> 'key' ->> 'participantAlt' AS alt, m.raw ->> 'pushName' AS "pushName"
       FROM messages m JOIN chats c ON c.id = m.chat_id
      WHERE c.account_id = $1 AND c.kind = 'group' AND NOT m.from_me AND m.sender_jid IS NULL
        AND coalesce(m.raw -> 'key' ->> 'participant', m.raw ->> 'participant') IS NOT NULL`, [accountId]);
}

export async function fixSenders(list: { id: number; jid: string; name: string | null }[]): Promise<void> {
  for (const f of list) {
    await q('UPDATE messages SET sender_jid = $2, sender_name = coalesce(sender_name, $3) WHERE id = $1', [f.id, f.jid, f.name]);
    if (f.name) {
      await q(`UPDATE loops l SET asked_by = CASE WHEN c.partner_id IS NULL THEN $2 ELSE $2 || ' (' || c.partner_id || ')' END
                 FROM chats c WHERE c.id = l.chat_id AND l.message_id = $1 AND l.asked_by LIKE 'Unknown%'`, [f.id, f.name]);
    }
  }
}

/** Sender of one stored message, for "Mark as my team". */
export async function messageSender(id: string): Promise<{ jid: string | null; name: string | null; fromMe: boolean; kind: ChatKind; accountId: string } | null> {
  const r = await q1<{ sender_jid: string | null; sender_name: string | null; from_me: boolean; kind: ChatKind; account_id: string }>(
    'SELECT m.sender_jid, coalesce(contact_name(m.account_id, m.sender_jid), m.sender_name) AS sender_name, m.from_me, c.kind, c.account_id FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.id = $1', [Number(id)]);
  return r ? { jid: r.sender_jid, name: r.sender_name, fromMe: r.from_me, kind: r.kind, accountId: r.account_id } : null;
}

/* ---------------- notifications ---------------- */

/** Mutes notifications for a chat in WA Turbo only. `until` null unmutes; Infinity mutes until unmuted. */
export async function setMuted(chatId: string, until: number | null): Promise<void> {
  await q(`UPDATE chats SET notify_muted_until = CASE WHEN $2::float8 IS NULL THEN NULL WHEN $2::float8 = 'infinity' THEN 'infinity'::timestamptz
             ELSE to_timestamp($2::float8 / 1000.0) END WHERE id = $1`, [chatId, until === null ? null : until === Infinity ? 'infinity' : until]);
}

export interface NotifyChat { id: string; name: string; kind: ChatKind; pinned: boolean; mutedUntil: number | null; acct: string; acctId: string; unread: number }

/** Chat details for notifications: the given chats, or every pinned chat when `ids` is null. */
export async function notifyChats(ids: string[] | null): Promise<NotifyChat[]> {
  if (ids && !ids.length) return [];
  const rows = await q<{ id: string; name: string; jid: string; kind: ChatKind; pinned: boolean; notify_muted_until: number | null; acct: string; account_id: string; unread: number }>(
    `SELECT c.id, ${DM_NAME} AS name, c.jid, c.kind, c.pinned_at IS NOT NULL AS pinned, c.notify_muted_until, a.name AS acct, c.account_id, c.unread
     FROM chats c JOIN accounts a ON a.id = c.account_id WHERE ${ids ? 'c.id = ANY($1)' : 'c.pinned_at IS NOT NULL'}`, ids ? [ids] : []);
  return rows.map(r => ({ id: r.id, name: r.name || r.jid.split('@')[0], kind: r.kind, pinned: r.pinned, mutedUntil: r.notify_muted_until, acct: r.acct, acctId: r.account_id, unread: r.unread }));
}

/** Unread totals for the Dock badge. Chats muted in WA Turbo are left out. */
export async function unreadTotals(): Promise<{ chats: number; messages: number; pinned: number }> {
  const r = await q1<{ chats: number; messages: number; pinned: number }>(
    `SELECT count(*) FILTER (WHERE unread > 0) AS chats, coalesce(sum(unread), 0) AS messages,
            count(*) FILTER (WHERE unread > 0 AND pinned_at IS NOT NULL) AS pinned
     FROM chats WHERE notify_muted_until IS NULL OR notify_muted_until < now()`);
  return { chats: Number(r?.chats ?? 0), messages: Number(r?.messages ?? 0), pinned: Number(r?.pinned ?? 0) };
}

export async function chatRev(chatId: string): Promise<number> {
  return (await q1<{ rev: number }>('SELECT rev FROM chats WHERE id = $1', [chatId]))?.rev ?? 0;
}

/* ---------------- auto summary ---------------- */

export interface AutoCandidate { id: string; pinned: boolean; checkedAt: number | null; lastAt: number; rev: number; kind: ChatKind; iWrote: boolean }

/** Chats with something newer than their last auto look. Never-checked chats count only if active in the last 24 h. */
export async function autoCandidates(ids: string[] | null): Promise<AutoCandidate[]> {
  const rows = await q<{ id: string; pinned: boolean; auto_checked_at: number | null; last_message_at: number; rev: number; kind: ChatKind; i_wrote: boolean }>(
    `SELECT c.id, c.pinned_at IS NOT NULL AS pinned, c.auto_checked_at, c.last_message_at, c.rev, c.kind,
            EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.from_me) AS i_wrote
       FROM chats c
      WHERE c.last_message_at IS NOT NULL AND c.rev > coalesce(c.auto_rev, -1)
        AND (c.auto_rev IS NOT NULL OR c.last_message_at > now() - interval '24 hours')
        AND ($1::text[] IS NULL OR c.id = ANY($1))`, [ids]);
  return rows.map(r => ({ id: r.id, pinned: r.pinned, checkedAt: r.auto_checked_at, lastAt: r.last_message_at, rev: r.rev, kind: r.kind, iWrote: r.i_wrote }));
}

export async function markAutoChecked(chatId: string, rev: number | null): Promise<void> {
  await q('UPDATE chats SET auto_checked_at = now(), auto_rev = coalesce($2, auto_rev) WHERE id = $1', [chatId, rev]);
}

export function mediaLabel(t: MessageType): string {
  return ({ image: 'Photo', video: 'Video', audio: 'Voice note', document: 'Document', sticker: 'Sticker', location: 'Location', contact: 'Contact', system: '', other: 'Message', text: '' } as Record<MessageType, string>)[t];
}

export async function listChats(acct: string | null): Promise<ChatSummaryRow[]> {
  const rows = acct
    ? await q<ChatRow>(CHAT_ROW_SQL + ' WHERE c.account_id = $1 AND c.last_message_at IS NOT NULL ORDER BY last_at DESC', [acct])
    : await q<ChatRow>(CHAT_ROW_SQL + ' WHERE c.last_message_at IS NOT NULL ORDER BY last_at DESC');
  return rows.map(toChat);
}

export async function searchChats(acct: string, query: string): Promise<string[]> {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return [];
  const tsq = words.map(w => w + ':*').join(' & ');
  const like = '%' + query.trim().replace(/[%_\\]/g, m => '\\' + m) + '%';
  const rows = await q<{ id: string }>(
    `SELECT c.id FROM chats c WHERE c.account_id = $1 AND (c.name ILIKE $3 OR c.subtitle ILIKE $3 OR (c.kind = 'dm' AND contact_name(c.account_id, c.jid) ILIKE $3)
       OR EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.tsv @@ to_tsquery('simple', $2)))`, [acct, tsq, like]);
  return rows.map(r => r.id);
}

export async function markRead(chatId: string): Promise<void> {
  await q('UPDATE chats SET unread = 0 WHERE id = $1', [chatId]);
}

/** Creates the partner on first use and keeps the type you gave it. */
export async function upsertPartner(id: string, type: string | null): Promise<void> {
  await q(`INSERT INTO partners (id, type, service, steps) VALUES ($1, coalesce($2, ''), '', '{}')
           ON CONFLICT (id) DO UPDATE SET type = CASE WHEN coalesce($2, '') <> '' THEN $2 ELSE partners.type END`, [id, type]);
}

export async function setChatPartner(chatId: string, partner: string | null, service: string | null, stage: string | null): Promise<void> {
  await q('UPDATE chats SET partner_id = $2, service = $3, stage = $4 WHERE id = $1', [chatId, partner, service, stage]);
}

export async function setSummarized(chatIds: string[]): Promise<void> {
  await q('UPDATE chats SET summarized_at = now() WHERE id = ANY($1)', [chatIds]);
}

export async function setChatSubtitle(accountId: string, jid: string, subtitle: string): Promise<void> {
  await q('UPDATE chats SET subtitle = $3 WHERE account_id = $1 AND jid = $2', [accountId, jid, subtitle]);
}

/* ---------------- messages ---------------- */

export interface MessageIn {
  waId: string; senderJid: string | null; senderName: string | null; fromMe: boolean; sentAt: number; type: MessageType;
  text: string; quotedWaId: string | null; quotedFromMe: boolean; mentionsMe: boolean; mentions: Record<string, string> | null;
  media: { mime: string; fileName: string | null; thumb: string | null } | null; raw: unknown;
}

/** Inserts or refreshes messages for one chat. Returns ids of rows that are new. */
export async function upsertMessages(c: pg.PoolClient, accountId: string, chatId: string, list: MessageIn[], countUnread: boolean): Promise<{ id: number; waId: string }[]> {
  const fresh: { id: number; waId: string }[] = [];
  let latest = 0;
  let unread = 0;
  for (const m of list) {
    const r = await c.query<{ id: number; inserted: boolean }>(
      `INSERT INTO messages (account_id, chat_id, wa_id, sender_jid, sender_name, from_me, sent_at, type, text, quoted_wa_id, quoted_from_me, mentions_me, media, raw, mentions)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (chat_id, wa_id) DO UPDATE SET text = CASE WHEN excluded.text <> '' THEN excluded.text ELSE messages.text END,
         sender_name = coalesce(excluded.sender_name, messages.sender_name), media = coalesce(excluded.media, messages.media),
         mentions = coalesce(excluded.mentions, messages.mentions)
       RETURNING id, (xmax = 0) AS inserted`,
      [accountId, chatId, m.waId, m.senderJid, m.senderName, m.fromMe, m.sentAt, m.type, m.text, m.quotedWaId, m.quotedFromMe, m.mentionsMe,
        m.media ? JSON.stringify(m.media) : null, m.raw ? JSON.stringify(m.raw) : null, m.mentions ? JSON.stringify(m.mentions) : null]);
    const row = r.rows[0];
    if (row.inserted) {
      fresh.push({ id: Number(row.id), waId: m.waId });
      if (countUnread && !m.fromMe && m.type !== 'system') unread++;
    }
    latest = Math.max(latest, m.sentAt);
  }
  if (latest) {
    await c.query(
      `UPDATE chats SET last_message_at = greatest(coalesce(last_message_at, to_timestamp(0)), to_timestamp($2 / 1000.0)),
         unread = unread + $3, rev = rev + $4 WHERE id = $1`, [chatId, latest, unread, fresh.length]);
  }
  return fresh;
}

export async function editMessage(chatId: string, waId: string, text: string): Promise<void> {
  await q('UPDATE messages SET text = $3, edited = true WHERE chat_id = $1 AND wa_id = $2', [chatId, waId, text]);
  await q('UPDATE chats SET rev = rev + 1 WHERE id = $1', [chatId]);
}

export async function deleteMessage(chatId: string, waId: string): Promise<void> {
  await q(`UPDATE messages SET deleted = true, text = '' WHERE chat_id = $1 AND wa_id = $2`, [chatId, waId]);
  await q('UPDATE chats SET rev = rev + 1 WHERE id = $1', [chatId]);
}

interface MessageRow { id: number; chat_id: string; from_me: boolean; sender_name: string | null; sender_jid: string | null; sent_at: number; type: MessageType; text: string; media: { mime: string; fileName: string | null; thumb: string | null } | null; edited: boolean; team?: boolean; mentions?: Record<string, [string, string | null]> | null }

/** "@<number>" → the name to show; you are 'You', someone without a saved name is their phone number. */
function mentionNames(m: MessageRow['mentions']): Record<string, string> | undefined {
  if (!m) return undefined;
  const out: Record<string, string> = {};
  for (const [tok, [jid, name]] of Object.entries(m)) {
    const shown = jid === 'me' ? 'You' : name || (jid.endsWith('@s.whatsapp.net') ? formatPhone('+' + jid.split('@')[0]) : '');
    if (shown) out[tok] = shown;
  }
  return Object.keys(out).length ? out : undefined;
}

const toMessage = (r: MessageRow): Message => ({
  id: String(r.id), chatId: r.chat_id, who: r.from_me ? 'me' : r.sender_name || (r.sender_jid ?? '').split('@')[0] || 'Unknown',
  at: r.sent_at, type: r.type, text: r.text,
  media: r.media ? { mime: r.media.mime, fileName: r.media.fileName, hasThumb: !!r.media.thumb } : null,
  edited: !!r.edited,
  team: !!r.team,
  mentions: mentionNames(r.mentions),
});

/** What edit and delete-for-everyone need to point WhatsApp at one stored message. */
export async function messageForChange(id: string): Promise<{
  chat_id: string; account_id: string; jid: string; wa_id: string; from_me: boolean; sent_at: number; type: MessageType; deleted: boolean;
  key: { remoteJid?: string; id?: string; fromMe?: boolean; participant?: string } | null;
} | null> {
  return q1(
    `SELECT m.chat_id, c.account_id, c.jid, m.wa_id, m.from_me, m.sent_at, m.type, m.deleted,
       m.raw -> 'key' AS key
     FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.id = $1`, [id]);
}

/** Loops anchored on a message you deleted for everyone have nothing left to answer. */
export async function dismissLoopsOn(messageId: string): Promise<number> {
  const r = await q<{ id: string }>(`UPDATE loops SET state = 'dismissed', close_note = 'Message deleted' WHERE message_id = $1 AND state IN ('open', 'snoozed') RETURNING id`, [Number(messageId)]);
  return r.length;
}

export async function getMessages(chatId: string, limit: number): Promise<Message[]> {
  const rows = await q<MessageRow>(
    `SELECT * FROM (SELECT id, chat_id, from_me, ${SENDER_NAME}, sender_jid, sent_at, type, text, media, edited, ${MENTIONS}, EXISTS (SELECT 1 FROM team_jids t JOIN chats tc ON tc.id = messages.chat_id AND tc.kind = 'group' WHERE t.jid = messages.sender_jid) AS team FROM messages
       WHERE chat_id = $1 AND NOT deleted ORDER BY sent_at DESC, id DESC LIMIT $2) t ORDER BY sent_at, id`, [chatId, limit]);
  return rows.map(toMessage);
}

export async function messagesSince(chatId: string, since: number): Promise<Message[]> {
  const rows = await q<MessageRow>(
    `SELECT id, chat_id, from_me, ${SENDER_NAME}, sender_jid, sent_at, type, text, media, edited, ${MENTIONS}, EXISTS (SELECT 1 FROM team_jids t JOIN chats tc ON tc.id = messages.chat_id AND tc.kind = 'group' WHERE t.jid = messages.sender_jid) AS team FROM messages
     WHERE chat_id = $1 AND NOT deleted AND sent_at >= to_timestamp($2 / 1000.0) ORDER BY sent_at, id`, [chatId, since]);
  return rows.map(toMessage);
}

/** Messages since `since`, at most the newest `cap`; `skipped` counts the older ones left out. */
export async function messagesSinceCapped(chatId: string, since: number, cap: number): Promise<{ messages: Message[]; skipped: number }> {
  const rows = await q<MessageRow & { total: number }>(
    `SELECT * FROM (SELECT id, chat_id, from_me, ${SENDER_NAME}, sender_jid, sent_at, type, text, media, edited, ${MENTIONS}, EXISTS (SELECT 1 FROM team_jids t JOIN chats tc ON tc.id = messages.chat_id AND tc.kind = 'group' WHERE t.jid = messages.sender_jid) AS team, count(*) OVER () AS total FROM messages
       WHERE chat_id = $1 AND NOT deleted AND sent_at >= to_timestamp($2 / 1000.0) ORDER BY sent_at DESC, id DESC LIMIT $3) t ORDER BY sent_at, id`,
    [chatId, since, cap]);
  return { messages: rows.map(toMessage), skipped: rows.length ? Number(rows[0].total) - rows.length : 0 };
}

export async function messagesByIds(ids: number[]): Promise<Message[]> {
  if (!ids.length) return [];
  const rows = await q<MessageRow>(`SELECT id, chat_id, from_me, ${SENDER_NAME}, sender_jid, sent_at, type, text, media, edited, ${MENTIONS}, EXISTS (SELECT 1 FROM team_jids t JOIN chats tc ON tc.id = messages.chat_id AND tc.kind = 'group' WHERE t.jid = messages.sender_jid) AS team FROM messages WHERE id = ANY($1) ORDER BY sent_at, id`, [ids]);
  return rows.map(toMessage);
}

export async function messageRaw(accountId: string, remoteJid: string, waId: string): Promise<unknown | null> {
  const r = await q1<{ raw: unknown }>(
    'SELECT m.raw FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.account_id = $1 AND c.jid = $2 AND m.wa_id = $3', [accountId, remoteJid, waId]);
  return r?.raw ?? null;
}

export async function messageMedia(messageId: number): Promise<{ account_id: string; raw: unknown; media: { mime: string; fileName: string | null; thumb: string | null; path?: string } | null } | null> {
  return q1('SELECT account_id, raw, media FROM messages WHERE id = $1', [messageId]);
}

export async function messageIdByWa(chatId: string, waId: string): Promise<number | null> {
  const r = await q1<{ id: number }>('SELECT id FROM messages WHERE chat_id = $1 AND wa_id = $2', [chatId, waId]);
  return r ? Number(r.id) : null;
}

export async function setMediaPath(messageId: number, path: string): Promise<void> {
  await q(`UPDATE messages SET media = jsonb_set(media, '{path}', to_jsonb($2::text)) WHERE id = $1`, [messageId, path]);
}

export async function lastMessageId(chatId: string): Promise<number | null> {
  const r = await q1<{ id: number }>('SELECT id FROM messages WHERE chat_id = $1 ORDER BY sent_at DESC, id DESC LIMIT 1', [chatId]);
  return r ? Number(r.id) : null;
}

/* ---------------- partners ---------------- */

export async function listPartners(): Promise<Partner[]> {
  const rows = await q<{ id: string; type: Partner['type']; service: string; steps: string[]; current_step: number }>('SELECT * FROM partners ORDER BY id');
  return rows.map(r => ({ id: r.id, type: r.type, service: r.service, steps: r.steps, at: r.current_step }));
}

/* ---------------- loops ---------------- */

interface LoopRow {
  id: number; chat_id: string; message_id: number | null; dir: LoopDir; kind: LoopKind; state: LoopState; source: LoopSource; topic: string;
  asked_by: string; asked_name: string | null; asked_at: number; sla_hours: number; blocks: string | null; snooze_note: string | null; answered_at: number | null;
  ai_hint: string | null; close_note: string | null; nudges: number[] | null; chases: number;
}

const toLoop = (r: LoopRow): Loop => ({
  id: String(r.id), chatId: r.chat_id, msgId: r.message_id === null ? null : String(r.message_id), dir: r.dir, kind: r.kind, state: r.state,
  source: r.source, topic: r.topic, askedBy: r.asked_name ? r.asked_name + (/ \([^()]*\)$/.exec(r.asked_by)?.[0] ?? '') : r.asked_by, askedAt: r.asked_at, slaH: r.sla_hours, blocks: r.blocks, snoozeNote: r.snooze_note,
  answeredAt: r.answered_at, nudges: (r.nudges ?? []).map(n => Number(n)).sort((a, b) => b - a),
  chases: Number(r.chases), aiHint: r.ai_hint, closeNote: r.close_note,
});

// asked_name: the asker's contact name now, so imported names reach SUM UP! cards (asked_by keeps its "(Team)" or partner suffix).
const LOOP_SQL = `
  SELECT l.*, (SELECT CASE WHEN m.from_me THEN NULL ELSE contact_name(c.account_id, coalesce(m.sender_jid, CASE WHEN c.kind = 'dm' THEN c.jid END)) END
                 FROM messages m JOIN chats c ON c.id = m.chat_id WHERE m.id = l.message_id) AS asked_name, (SELECT array_agg((extract(epoch FROM n.at) * 1000)::bigint) FROM loop_nudges n WHERE n.loop_id = l.id AND n.by_me) AS nudges,
         (SELECT count(*) FROM loop_nudges n WHERE n.loop_id = l.id AND NOT n.by_me) AS chases
  FROM loops l`;

export async function listLoops(): Promise<Loop[]> {
  return (await q<LoopRow>(LOOP_SQL + ` WHERE l.state <> 'dismissed' ORDER BY l.asked_at`)).map(toLoop);
}

export async function getLoop(id: string): Promise<Loop | null> {
  const r = await q1<LoopRow>(LOOP_SQL + ' WHERE l.id = $1', [id]);
  return r ? toLoop(r) : null;
}

export async function loopsForChat(chatId: string): Promise<Loop[]> {
  return (await q<LoopRow>(LOOP_SQL + ` WHERE l.chat_id = $1 AND l.state <> 'dismissed' ORDER BY l.asked_at`, [chatId])).map(toLoop);
}

export async function openLoopRefs(chatId: string): Promise<{ id: string; dir: LoopDir; topic: string }[]> {
  const rows = await q<{ id: number; dir: LoopDir; topic: string }>(`SELECT id, dir, topic FROM loops WHERE chat_id = $1 AND state = 'open' ORDER BY asked_at`, [chatId]);
  return rows.map(r => ({ id: String(r.id), dir: r.dir, topic: r.topic }));
}

export interface OpenLoopFull {
  id: string; dir: LoopDir; source: LoopSource; topic: string; askedAt: number; createdAt: number;
  messageId: number | null; senderJid: string | null;
}

export async function openLoopsFull(chatId: string): Promise<OpenLoopFull[]> {
  const rows = await q<{ id: number; dir: LoopDir; source: LoopSource; topic: string; asked_at: number; created_at: number; message_id: number | null; sender_jid: string | null }>(
    `SELECT l.id, l.dir, l.source, l.topic, l.asked_at, l.created_at, l.message_id, m.sender_jid
       FROM loops l LEFT JOIN messages m ON m.id = l.message_id
      WHERE l.chat_id = $1 AND l.state = 'open' ORDER BY l.asked_at, l.id`, [chatId]);
  return rows.map(r => ({ id: String(r.id), dir: r.dir, source: r.source, topic: r.topic, askedAt: r.asked_at, createdAt: r.created_at, messageId: r.message_id, senderJid: r.sender_jid }));
}

/** `ours`: sent by you, or by someone on your team (groups only). */
export interface ThreadLine { id: number; fromMe: boolean; ours: boolean; senderJid: string | null; text: string; type: string; at: number }

export async function threadSince(chatId: string, since: number): Promise<ThreadLine[]> {
  const rows = await q<{ id: number; from_me: boolean; ours: boolean; sender_jid: string | null; text: string; type: string; sent_at: number }>(
    `SELECT m.id, m.from_me, m.from_me OR (c.kind = 'group' AND EXISTS (SELECT 1 FROM team_jids t WHERE t.jid = m.sender_jid)) AS ours,
            m.sender_jid, m.text, m.type, m.sent_at
       FROM messages m JOIN chats c ON c.id = m.chat_id
      WHERE m.chat_id = $1 AND m.sent_at >= to_timestamp($2 / 1000.0) AND NOT m.deleted AND m.type <> 'system' ORDER BY m.sent_at, m.id`, [chatId, since]);
  return rows.map(r => ({ id: r.id, fromMe: r.from_me, ours: r.ours, senderJid: r.sender_jid, text: r.text, type: r.type, at: r.sent_at }));
}

/** Closes a loop on the rules' say-so, keeping the moment it was settled and why. */
export async function autoClose(id: string, at: number, note: string): Promise<void> {
  await q(`UPDATE loops SET state = 'answered', answered_at = to_timestamp($2 / 1000.0), close_note = $3, ai_hint = NULL WHERE id = $1 AND state = 'open'`,
    [Number(id), at, note]);
}

/** A repeat of an earlier ask: counted as a chase on the first loop, the copy is dismissed. */
export async function foldRepeat(keepId: string, dupId: string, byMe: boolean, messageId: number | null, at: number): Promise<void> {
  await addNudge(keepId, byMe, messageId, at);
  await q(`UPDATE loops SET state = 'dismissed', close_note = 'Same ask as an earlier message' WHERE id = $1`, [Number(dupId)]);
}

export async function chatsWithOpenLoops(): Promise<string[]> {
  return (await q<{ chat_id: string }>(`SELECT DISTINCT chat_id FROM loops WHERE state = 'open'`)).map(r => r.chat_id);
}

export interface LoopIn {
  chatId: string; messageId: string | null; dir: LoopDir; kind: LoopKind; source: LoopSource; topic: string; askedBy: string;
  askedAt: number; slaH: number; blocks?: string | null;
}

export async function createLoop(l: LoopIn): Promise<string | null> {
  const r = await q1<{ id: number }>(
    `INSERT INTO loops (chat_id, message_id, dir, kind, source, topic, asked_by, asked_at, sla_hours, blocks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), $9, $10)
     ON CONFLICT (message_id, dir) DO NOTHING RETURNING id`,
    [l.chatId, l.messageId === null ? null : Number(l.messageId), l.dir, l.kind, l.source, l.topic, l.askedBy, l.askedAt, l.slaH, l.blocks ?? null]);
  return r ? String(r.id) : null;
}

export async function addNudge(loopId: string, byMe: boolean, messageId: number | null, at?: number): Promise<void> {
  await q('INSERT INTO loop_nudges (loop_id, by_me, message_id, at) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))',
    [Number(loopId), byMe, messageId, at ?? Date.now()]);
}

export async function setLoopState(id: string, state: LoopState, note: string | null = null): Promise<void> {
  await q(
    `UPDATE loops SET state = $2, answered_at = CASE WHEN $2 = 'answered' THEN now() WHEN $2 = 'open' THEN NULL ELSE answered_at END,
       snooze_note = CASE WHEN $2 = 'snoozed' THEN $3 WHEN $2 = 'open' THEN NULL ELSE snooze_note END,
       ai_hint = CASE WHEN $2 = 'open' THEN ai_hint ELSE NULL END,
       close_note = CASE WHEN $2 = 'open' THEN NULL ELSE close_note END WHERE id = $1`, [Number(id), state, note]);
}

export async function reviewLoop(id: string, p: { topic?: string | null; blocks?: string | null; aiHint?: string | null }): Promise<void> {
  await q('UPDATE loops SET topic = coalesce($2, topic), blocks = coalesce($3, blocks), ai_hint = $4 WHERE id = $1',
    [Number(id), p.topic ?? null, p.blocks ?? null, p.aiHint ?? null]);
}

/* ---------------- settings ---------------- */

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude-code', model: 'claude-haiku-5-5', window: 'week', customPrompt: '', openAtLogin: false, aiImages: true,
  localModel: '', geminiModel: '', openaiModel: '', openaiBaseUrl: '', agyModel: '', codexModel: '', geminiAgreed: false, autoDailyBudget: 100,
  autoOn: true, pinEveryMin: 5, pinWindow: 10, otherEveryMin: 60, otherWindow: 2,
  notifyOn: true, notifyPinnedSound: 'Glass', notifyRemindMin: 10, notifyOthers: 'direct', notifyOtherSound: 'Tink', notifyPreview: true,
  notifyBadge: 'chats', notifyOverdue: true, menuBar: true, notifyPausedUntil: 0, contactsCountry: '', loopRules: {},
};

export async function getSettings(): Promise<Settings> {
  const rows = await q<{ key: keyof Settings; value: unknown }>('SELECT key, value FROM settings');
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) (s as unknown as Record<string, unknown>)[r.key] = r.value;
  return s;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]);
  }
  return getSettings();
}

/* ---------------- summaries, reports, aliases, usage ---------------- */

export async function saveSummary(s: SummaryResult, windowSize: number, lastMsgId: number | null, rev: number | null = null): Promise<void> {
  await q('INSERT INTO summaries (chat_id, model, window_size, last_message_id, msg_count, result, chat_rev, window_key, auto, lang) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [s.chatId, s.model, windowSize, lastMsgId, s.msgCount, JSON.stringify(s.insight), rev, s.windowKey, s.auto, s.lang ?? 'en']);
}

type SummaryRow = { chat_id: string; model: ModelId; created_at: number; msg_count: number; result: ChatInsight; last_message_id: number | null; window_size: number; window_key: string | null; auto: boolean; lang: Lang };
const toSummary = (r: SummaryRow) => ({
  chatId: r.chat_id, model: r.model, createdAt: r.created_at, msgCount: r.msg_count, insight: r.result, lastMessageId: r.last_message_id,
  windowSize: r.window_size, windowKey: r.window_key, auto: r.auto, lang: r.lang,
});

/** The cache: a summary of exactly this chat revision, read with this model and window, in this language. */
export async function cachedSummary(chatId: string, model: ModelId, windowKey: string, rev: number, lang: Lang): Promise<SummaryResult | null> {
  const r = await q1<SummaryRow>('SELECT * FROM summaries WHERE chat_id = $1 AND model = $2 AND window_key = $3 AND chat_rev = $4 AND lang = $5 ORDER BY created_at DESC LIMIT 1',
    [chatId, model, windowKey, rev, lang]);
  return r ? toSummary(r) : null;
}

export async function lastSummary(chatId: string): Promise<(SummaryResult & { lastMessageId: number | null; windowSize: number }) | null> {
  const r = await q1<SummaryRow>('SELECT * FROM summaries WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 1', [chatId]);
  return r ? toSummary(r) : null;
}

interface ReportRow { id: number; title: string; preset: PresetId; custom_prompt: string; days: Report['days']; chat_ids: string[]; loop_ids: string[]; model: ModelId; overview: string; insights: Record<string, ChatInsight>; stats: Report['stats']; created_at: number }
const toReport = (r: ReportRow): Report => ({
  id: String(r.id), presetId: r.preset, title: r.title, days: r.days, custom: r.custom_prompt, model: r.model, createdAt: r.created_at,
  chatIds: r.chat_ids, overview: r.overview, loopIds: r.loop_ids, insights: r.insights, stats: r.stats,
});

export async function listReports(): Promise<Report[]> {
  return (await q<ReportRow>('SELECT * FROM reports ORDER BY created_at DESC')).map(toReport);
}

export async function saveReport(r: Omit<Report, 'id' | 'createdAt'>): Promise<Report> {
  const row = await q1<ReportRow>(
    `INSERT INTO reports (title, preset, custom_prompt, days, chat_ids, loop_ids, model, overview, insights, stats)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [r.title, r.presetId, r.custom, r.days, r.chatIds, r.loopIds, r.model, r.overview, JSON.stringify(r.insights), JSON.stringify(r.stats)]);
  return toReport(row!);
}

export async function deleteReport(id: string): Promise<void> {
  await q('DELETE FROM reports WHERE id = $1', [Number(id)]);
}

export async function listAliases(): Promise<{ real: string; alias: string }[]> {
  return q('SELECT real, alias FROM aliases');
}

export async function addAliases(rows: { real: string; alias: string }[]): Promise<void> {
  for (const r of rows) await q('INSERT INTO aliases (real, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING', [r.real, r.alias]);
}

export async function logRun(r: { kind: string; model: string; chatId?: string; input?: number; output?: number; cacheRead?: number; cacheWrite?: number; stop?: string | null; ms: number; error?: string | null }): Promise<void> {
  await q(
    `INSERT INTO ai_runs (kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, stop_reason, duration_ms, error, chat_id, account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT account_id FROM chats WHERE id = $10))`,
    [r.kind, r.model, r.input ?? null, r.output ?? null, r.cacheRead ?? null, r.cacheWrite ?? null, r.stop ?? null, r.ms, r.error ?? null, r.chatId ?? null]);
}

/** Auto runs on one provider (its "<provider>:" model prefix) since a time, for the free providers' daily budget. */
export async function autoRunsSince(prefix: string, since: number): Promise<number> {
  const r = await q1<{ n: string }>(`SELECT count(*) AS n FROM ai_runs WHERE kind = 'auto' AND starts_with(model, $1) AND created_at >= to_timestamp($2 / 1000.0)`, [prefix, since]);
  return Number(r?.n ?? 0);
}

/** AI usage per hour and number since a time (hours line up with local days in whole-hour time zones). */
export async function usageSince(since: number): Promise<UsageBucket[]> {
  const rows = await q<{ hour: number; acct: string | null; input: number; output: number; cache_read: number; cache_write: number; runs: number }>(
    `SELECT date_trunc('hour', created_at) AS hour, account_id AS acct,
            sum(coalesce(input_tokens, 0)) AS input, sum(coalesce(output_tokens, 0)) AS output,
            sum(coalesce(cache_read_tokens, 0)) AS cache_read, sum(coalesce(cache_write_tokens, 0)) AS cache_write, count(*) AS runs
       FROM ai_runs WHERE created_at >= to_timestamp($1 / 1000.0) GROUP BY 1, 2 ORDER BY 1`, [since]);
  return rows.map(r => ({ hour: r.hour, acct: r.acct, input: Number(r.input), output: Number(r.output), cacheRead: Number(r.cache_read), cacheWrite: Number(r.cache_write), runs: Number(r.runs) }));
}

/* ---------------- phone contacts (.vcf import) ---------------- */

const toMap = (rows: { phone: string; name: string }[]): Map<string, string> => new Map(rows.map(r => [r.phone, r.name]));

/** Names from earlier imports for these numbers. */
export async function phonebookNames(phones: string[]): Promise<Map<string, string>> {
  return toMap(await q('SELECT phone, name FROM phonebook WHERE phone = ANY($1)', [phones]));
}

/** Names saved on the phone that owns each linked number, as WhatsApp synced them. */
export async function syncedNames(phones: string[]): Promise<Map<string, string>> {
  return toMap(await q(
    `SELECT DISTINCT ON (phone) phone, name FROM (
       SELECT coalesce(CASE WHEN jid LIKE '%@s.whatsapp.net' THEN split_part(jid, '@', 1) END, regexp_replace(phone, '\\D', '', 'g')) AS phone, name
         FROM contacts WHERE coalesce(name, '') <> '') x
     WHERE phone = ANY($1) ORDER BY phone, name`, [phones]));
}

/** What each direct chat with these numbers is called right now. */
export async function dmChatNames(phones: string[]): Promise<Map<string, string>> {
  return toMap(await q(
    `SELECT split_part(c.jid, '@', 1) AS phone, coalesce(${DM_NAME}, split_part(c.jid, '@', 1)) AS name
       FROM chats c WHERE c.kind = 'dm' AND c.jid LIKE '%@s.whatsapp.net' AND split_part(c.jid, '@', 1) = ANY($1)`, [phones]));
}

/** Every direct chat's shown name, to count how many an import renamed. */
export async function dmDisplayNames(): Promise<Map<string, string>> {
  const rows = await q<{ id: string; name: string }>(`SELECT c.id, coalesce(${DM_NAME}, c.jid) AS name FROM chats c WHERE c.kind = 'dm'`);
  return new Map(rows.map(r => [r.id, r.name]));
}

export async function savePhonebook(rows: { phone: string; name: string }[], remove: string[]): Promise<void> {
  await tx(async c => {
    for (let i = 0; i < rows.length; i += 2000) {
      const part = rows.slice(i, i + 2000);
      await c.query(
        `INSERT INTO phonebook (phone, name) SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT (phone) DO UPDATE SET name = excluded.name, updated_at = now()`, [part.map(r => r.phone), part.map(r => r.name)]);
    }
    if (remove.length) await c.query('DELETE FROM phonebook WHERE phone = ANY($1)', [remove]);
  });
}

export async function phonebookInfo(): Promise<{ count: number; updatedAt: number | null }> {
  const r = await q1<{ count: number; updated_at: number | null }>('SELECT count(*)::int AS count, max(updated_at) AS updated_at FROM phonebook');
  return { count: r?.count ?? 0, updatedAt: r?.updated_at ?? null };
}

export async function clearPhonebook(): Promise<number> {
  return (await q<{ phone: string }>('DELETE FROM phonebook RETURNING phone')).length;
}
