import type { ChatKind, Loop } from '@shared/types';
import { DEFAULT_SLA_H } from '@shared/sla';
import { q1 } from '../db/client';
import {
  addNudge, autoClose, chatMeta, createLoop, flipLoop, foldRepeat, getLoop, messagesByIds, openLoopRefs, openLoopsFull, setLoopState, teamJids, threadSince,
  type MessageIn, type OpenLoopFull, type ThreadLine,
} from '../db/queries';
import { ackStrength, evaluate, isDeferral, related, sameAsk, topicOf } from './rules';

interface ChatRef { id: string; kind: ChatKind; partner_id: string | null }

const askedByLabel = (who: string, partner: string | null): string => (partner ? `${who} (${partner})` : who);

/** Runs the local rules on one stored message. Returns true when a loop was created or nudged. */
export async function applyRules(chat: ChatRef, messageId: number, msg: MessageIn): Promise<boolean> {
  const open = await openLoopRefs(chat.id);
  // In groups, your team is on your side: their asks wait on the other party, their answers count as yours.
  const team = !msg.fromMe && chat.kind === 'group' && !!msg.senderJid && (await teamJids()).has(msg.senderJid);
  const r = evaluate({
    fromMe: msg.fromMe || team, text: msg.text, isGroup: chat.kind === 'group', chatHasPartner: !!chat.partner_id,
    mentionsMe: msg.mentionsMe, quotesMine: msg.quotedFromMe,
  }, open);
  if (!r) return false;
  if (r.type === 'nudge') {
    await addNudge(r.loopId, r.by === 'me', messageId, msg.sentAt);
    return true;
  }
  const id = await createLoop({
    chatId: chat.id, messageId: String(messageId), dir: r.dir, kind: r.kind, source: 'rule', topic: r.topic,
    askedBy: msg.fromMe ? 'You' : team ? (msg.senderName ?? 'Teammate') + ' (Team)' : askedByLabel(msg.senderName ?? 'Unknown', chat.partner_id), askedAt: msg.sentAt, slaH: r.slaH,
  });
  return id !== null;
}

const quoteOf = (t: string): string => '“' + (t.length > 48 ? t.slice(0, 47).trim() + '…' : t) + '”';

/**
 * Settles a chat's open loops from what happened after them. The same ask sent twice becomes one
 * loop chased once. A loop closes when the answering side replied (with anything but "I'll check")
 * and the asking side then acknowledged it: "Terima kasih atas pembayarannya", "ok noted", 👍.
 */
export async function resolveLoops(chatId: string): Promise<boolean> {
  const open = await openLoopsFull(chatId);
  if (!open.length) return false;
  const chat = await chatMeta(chatId);
  const isGroup = chat?.kind === 'group';
  let changed = false;

  const kept: OpenLoopFull[] = [];
  for (const l of open) {
    const first = kept.find(k => k.dir === l.dir && sameAsk(k.topic, l.topic));
    if (first) {
      await foldRepeat(first.id, l.id, l.dir === 'waiting', l.messageId, l.askedAt);
      changed = true;
    } else kept.push(l);
  }

  const thread = await threadSince(chatId, kept[0].askedAt);
  for (const l of kept) {
    const askerIsMe = l.dir === 'waiting';
    const after = thread.filter(m => m.at > l.askedAt || (m.at === l.askedAt && l.messageId !== null && m.id > l.messageId));
    const isAnswer = (m: ThreadLine) => m.ours !== askerIsMe && !(m.text && isDeferral(m.text));
    const r = after.findIndex(isAnswer);
    if (r < 0) continue;
    const ack = after.slice(r + 1).find((m, i) => {
      if (m.ours !== askerIsMe) return false;
      // In a group, only the person who asked can settle it.
      if (isGroup && !askerIsMe && l.senderJid && m.senderJid !== l.senderJid) return false;
      // A loop you flagged by hand closes only on an acknowledgement that came after you flagged it.
      if (l.source === 'manual' && m.at <= l.createdAt) return false;
      const s = ackStrength(m.text);
      if (s === 2) return true;
      // "ok" settles your own ask, or theirs when your reply was about it (a photo, or the same words).
      return s === 1 && (askerIsMe || after.slice(r, r + 1 + i).some(a => isAnswer(a) && related(l.topic, a)));
    });
    if (!ack) continue;
    await autoClose(l.id, ack.at, askerIsMe
      ? (ack.fromMe ? 'You' : 'Your team') + ' replied ' + quoteOf(ack.text) + ' after their answer'
      : 'They replied ' + quoteOf(ack.text) + ' after your reply');
    changed = true;
  }
  return changed;
}

/** "Needs my reply" / "Awaiting reply" on a message. */
export async function flagMessage(chat: ChatRef, msgId: string): Promise<Loop> {
  const [m] = await messagesByIds([Number(msgId)]);
  if (!m) throw new Error('That message is no longer in the chat.');
  const mine = m.who === 'me';
  const dir = mine ? 'waiting' : 'owed';
  const created = await createLoop({
    chatId: chat.id, messageId: msgId, dir, kind: mine ? 'confirmation' : 'question', source: 'manual',
    topic: topicOf(m.text || 'Attachment'), askedBy: mine ? 'You' : askedByLabel(m.who, chat.partner_id), askedAt: m.at,
    slaH: DEFAULT_SLA_H[dir],
  });
  if (created) return (await getLoop(created))!;
  // Already tracked: reopen the existing loop for this message instead of duplicating it.
  const row = await q1<{ id: number }>('SELECT id FROM loops WHERE message_id = $1 AND dir = $2', [Number(msgId), dir]);
  if (!row) throw new Error('Could not track that message.');
  await setLoopState(String(row.id), 'open');
  return (await getLoop(String(row.id)))!;
}

export type LoopAct = 'answered' | 'nudge' | 'snooze' | 'reopen' | 'dismiss' | 'flip';

export async function loopAction(id: string, act: LoopAct): Promise<Loop> {
  const l = await getLoop(id);
  if (!l) throw new Error('That loop no longer exists.');
  switch (act) {
    case 'answered': await setLoopState(id, 'answered'); break;
    case 'nudge': await addNudge(id, true, null); break; // logs your follow-up only; nothing is sent
    case 'snooze': await setLoopState(id, 'snoozed', 'Snoozed from the tracker'); break;
    case 'reopen': await setLoopState(id, 'open'); break;
    case 'flip': await flipLoop(id); break; // you owe them <-> waiting on them
    case 'dismiss':
      if (l.source !== 'rule' && l.source !== 'ai') throw new Error('Only auto-detected loops can be dismissed. Snooze it instead.');
      await setLoopState(id, 'dismissed');
      break;
  }
  return (await getLoop(id))!;
}
