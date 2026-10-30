import type { Message } from '@shared/types';
import { tx } from '../db/client';
import { chatByJid, chatMeta, deleteMessage, editMessage, messagesByIds, upsertChat, upsertMessages, type MessageIn } from '../db/queries';
import { applyRules, resolveLoops } from '../loops/service';
import type { Mapped } from '../wa/mappers';

export const RULE_BACKFILL_MS = 7 * 24 * 3_600_000;
const BATCH = 500;

/** `changed` holds chats where a stored message was edited or deleted; `alerts` the new live messages, for notifications. */
export interface IngestResult { chats: Set<string>; messages: Message[]; loopsChanged: boolean; changed: Set<string>; alerts: IngestAlert[] }
export interface IngestAlert { chatId: string; messageId: string; fromMe: boolean; mentionsMe: boolean; quotedFromMe: boolean; sentAt: number }

/**
 * Stores a batch of mapped messages for one account. `live` messages count as unread and always
 * run the loop rules; history-sync messages run them only when newer than the 7-day backfill window.
 */
export async function ingest(accountId: string, items: Mapped[], live: boolean, chatName: (jid: string, isGroup: boolean) => string | null): Promise<IngestResult> {
  const out: IngestResult = { chats: new Set(), messages: [], loopsChanged: false, changed: new Set(), alerts: [] };
  const byChat = new Map<string, { isGroup: boolean; msgs: MessageIn[] }>();
  const edits: Extract<Mapped, { kind: 'edit' | 'delete' }>[] = [];

  for (const it of items) {
    if (it.kind === 'message') {
      const g = byChat.get(it.chatJid) ?? { isGroup: it.isGroup, msgs: [] };
      g.msgs.push(it.msg);
      byChat.set(it.chatJid, g);
    } else if (it.kind === 'edit' || it.kind === 'delete') {
      edits.push(it);
    }
  }

  const fresh: { chatId: string; id: number; msg: MessageIn }[] = [];
  for (const [jid, g] of byChat) {
    g.msgs.sort((a, b) => a.sentAt - b.sentAt);
    for (let i = 0; i < g.msgs.length; i += BATCH) {
      const part = g.msgs.slice(i, i + BATCH);
      await tx(async c => {
        const chatId = await upsertChat(c, accountId, jid, g.isGroup ? 'group' : 'dm', chatName(jid, g.isGroup));
        const ids = await upsertMessages(c, accountId, chatId, part, live);
        const byWa = new Map(part.map(m => [m.waId, m]));
        for (const r of ids) fresh.push({ chatId, id: r.id, msg: byWa.get(r.waId)! });
        out.chats.add(chatId);
      });
    }
  }

  for (const e of edits) {
    const meta = await chatIdFor(accountId, e.chatJid);
    if (!meta) continue;
    if (e.kind === 'edit') await editMessage(meta, e.waId, e.text);
    else await deleteMessage(meta, e.waId);
    out.chats.add(meta);
    out.changed.add(meta);
  }

  // Rules run oldest first so a follow-up finds the loop its question opened.
  const cutoff = Date.now() - RULE_BACKFILL_MS;
  fresh.sort((a, b) => a.msg.sentAt - b.msg.sentAt);
  for (const f of fresh) {
    if (!live && f.msg.sentAt < cutoff) continue;
    if (f.msg.type !== 'text' && !f.msg.text) continue;
    const meta = await chatMeta(f.chatId);
    if (meta && (await applyRules(meta, f.id, f.msg))) out.loopsChanged = true;
  }
  // Later messages can settle earlier loops (their thanks after your reply).
  for (const chatId of new Set(fresh.filter(f => live || f.msg.sentAt >= cutoff).map(f => f.chatId))) {
    if (await resolveLoops(chatId)) out.loopsChanged = true;
  }

  if (live && fresh.length) {
    out.messages = await messagesByIds(fresh.map(f => f.id));
    out.alerts = fresh.map(f => ({ chatId: f.chatId, messageId: String(f.id), fromMe: f.msg.fromMe, mentionsMe: f.msg.mentionsMe, quotedFromMe: f.msg.quotedFromMe, sentAt: f.msg.sentAt }));
  }
  return out;
}

const chatIdCache = new Map<string, string>();
async function chatIdFor(accountId: string, jid: string): Promise<string | null> {
  const k = accountId + '|' + jid;
  const hit = chatIdCache.get(k);
  if (hit) return hit;
  const row = await chatByJid(accountId, jid);
  if (row) chatIdCache.set(k, row.id);
  return row?.id ?? null;
}
