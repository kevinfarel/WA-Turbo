import type { LoopDir, LoopKind } from '@shared/types';
import { DEFAULT_SLA_H } from '@shared/sla';

// Local loop rules. They run on this Mac for every new message and send nothing anywhere.
// Matching is plain pattern work in English and Bahasa Indonesia; Claude reviews the hits
// the next time the chat is summarized.

export interface RuleInput {
  fromMe: boolean;
  text: string;
  isGroup: boolean;
  chatHasPartner: boolean;
  mentionsMe: boolean;
  quotesMine: boolean;
}

export interface OpenLoopRef { id: string; dir: LoopDir; topic: string }

export type RuleResult =
  | { type: 'create'; dir: LoopDir; kind: LoopKind; topic: string; slaH: number }
  | { type: 'nudge'; loopId: string; by: 'me' | 'them' }
  | null;

// Forms of address that trail short replies ("Baik ka", "Siap pak").
const ADDRESS = '(?:\\s+(?:ka+k?|kk|pak|bu|bapak|ibu|mas|mba+k?|bro|sis|gan|min|om|bos+|sir|all|guys|team|tim))*';
const SKIP = new RegExp('^(ok(e|ay|ey)?|oke+|okk+|noted|note|thanks?( you)?|thank you|thx|tq|tks|makasih|terima ?kasih|siap|sip|baik|done|mantap|👍|🙏|🙏🏻|👌)' + ADDRESS + '[\\s.!,🙏👍🏻🏼🏽]*$', 'iu');
// Thanks or "received" settle what came before; "ok"/"baik" may only acknowledge the last message.
const STRONG_ACK = /\b(terima ?kasih|makasih|ma+ka+sih|thanks?|thank you|thx|tq|tks|ty|noted|well received|received|got it|sudah (di ?)?terima|sudah masuk|sudah diterima|diterima|perfect|sounds good|all good)\b/i;
const WEAK_ACK = /\b(ok(e|ay|ey)?|oke+|baik|siap|sip|mantap|done|beres|aman|alright|great)\b/i;
const EMOJI_ACK = /^[\s🙏👍👌✅❤️🙌🏻🏼🏽🏾🏿️]+$/u;
const DEFER = /\b(cek dulu|check (first|later)|nanti (saya|kami|aku)|akan (saya|kami)|saya akan|kami akan|i'?ll (check|get back|revert|update)|let me check|will (check|revert|get back)|tunggu|sebentar|bentar|on it)\b/i;
const FOLLOW_UP = /\b(following up|follow(ing)?[\s-]?up|any update|any luck|still waiting|gentle reminder|just checking|bumping (this|up)|ada update|sudah ada update|kabar(nya)?|gimana (update|kabar)(nya)?|bagaimana (update|kabar)(nya)?)\b/i;
const INBOUND_ASK = /\b(can you|could you|would you|will you|do you|are you|is there|please (confirm|check|send|advise|share|let|review|reply)|pls|kindly|mohon|tolong|apakah|kapan|bagaimana|gimana|bisa(kah)?|minta|boleh)\b/i;
const OUTBOUND_ASK = /\b(please confirm|pls confirm|can you confirm|could you confirm|kindly confirm|confirm once|let (me|us) know|eta\b|mohon konfirmasi|mohon dikonfirmasi|tolong (di)?konfirmasi|bisa dikonfirmasi|mohon info|mohon dibantu)\b/i;
const PROMISE = /\b(i will|i'll|we will|we'll|will send|will check|will share|will update|will revert|akan saya|saya akan|kami akan|nanti saya|segera saya)\b/i;
const CONFIRM = /confirm|konfirmasi/i;

export const MIN_TEXT = 4;

export function topicOf(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 96 ? t.slice(0, 95).trim() + '…' : t;
}

function isQuestion(text: string): boolean {
  return text.includes('?') || INBOUND_ASK.test(text);
}

/** 2: "Terima kasih banyak atas pembayarannya ka 🙏", "noted, thanks". 1: "ok", "Baik ka", 👍. 0: not an acknowledgement. */
export function ackStrength(text: string): 0 | 1 | 2 {
  const t = text.trim();
  if (!t || isQuestion(t) || t.length > 200) return 0;
  if (STRONG_ACK.test(t)) return 2;
  return EMOJI_ACK.test(t) || WEAK_ACK.test(t) ? 1 : 0;
}

export const isAck = (text: string): boolean => ackStrength(text) > 0;

/** A reply that plausibly addresses the ask: a photo or file, or one shared content word. */
export function related(topic: string, reply: { text: string; type: string }): boolean {
  if (reply.type !== 'text') return true;
  const t = words(topic);
  for (const w of words(reply.text)) if (w.length >= 4 && t.has(w)) return true;
  return false;
}

/** "Nanti saya cek dulu": a reply that postpones the answer instead of giving it. */
export const isDeferral = (text: string): boolean => DEFER.test(text);

const words = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1));

/** The same ask sent again (copy-paste, or nearly so). */
export function sameAsk(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (x.size < 3 || y.size < 3) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size) >= 0.85 && both / (x.size + y.size - both) >= 0.6;
}

export function evaluate(input: RuleInput, openLoops: OpenLoopRef[]): RuleResult {
  const text = input.text.trim();
  if (text.length < MIN_TEXT || SKIP.test(text)) return null;

  // A follow-up from the side that is waiting is a nudge on the loop, not a new loop.
  if (FOLLOW_UP.test(text)) {
    const want: LoopDir = input.fromMe ? 'waiting' : 'owed';
    const target = openLoops.find(l => l.dir === want);
    if (target) return { type: 'nudge', loopId: target.id, by: input.fromMe ? 'me' : 'them' };
  }

  // Asking the same thing again is a chase on the open loop, not a second loop.
  const again = openLoops.find(l => l.dir === (input.fromMe ? 'waiting' : 'owed') && sameAsk(l.topic, topicOf(text)));
  if (again) return { type: 'nudge', loopId: again.id, by: input.fromMe ? 'me' : 'them' };

  // Groups are scanned only when tagged with a partner, or when a message is aimed at you.
  if (input.isGroup) {
    const aimed = input.mentionsMe || input.quotesMine;
    if (input.fromMe ? !input.chatHasPartner : !(input.chatHasPartner || aimed)) return null;
  }

  if (!input.fromMe) {
    if (!isQuestion(text)) return null;
    return { type: 'create', dir: 'owed', kind: CONFIRM.test(text) ? 'confirmation' : 'question', topic: topicOf(text), slaH: DEFAULT_SLA_H.owed };
  }

  if (OUTBOUND_ASK.test(text) || text.includes('?')) {
    return { type: 'create', dir: 'waiting', kind: CONFIRM.test(text) ? 'confirmation' : 'question', topic: topicOf(text), slaH: DEFAULT_SLA_H.waiting };
  }
  if (PROMISE.test(text)) {
    return { type: 'create', dir: 'owed', kind: 'commitment', topic: topicOf(text), slaH: DEFAULT_SLA_H.owed };
  }
  return null;
}
