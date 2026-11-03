import type { LoopDir, LoopKind, LoopRules, RuleGroupId } from '@shared/types';
import { DEFAULT_SLA_H } from '@shared/sla';
import { RULE_GROUPS } from '@shared/rule-terms';

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
const SKIP_TAIL = ADDRESS + '[\\s.!,🙏👍🏻🏼🏽]*$';
const EMOJI_ACK = /^[\s🙏👍👌✅❤️🙌🏻🏼🏽🏾🏿️]+$/u;
const CONFIRM = /confirm|konfirmasi/i;

type Matchers = Record<RuleGroupId, (text: string) => boolean>;

/** The built-in pattern of each group, without the terms switched off; null when none are left. */
export function builtInRegexes(cfg: LoopRules = {}): Record<RuleGroupId, RegExp | null> {
  const out = {} as Record<RuleGroupId, RegExp | null>;
  for (const g of RULE_GROUPS) {
    const off = cfg[g.id]?.off ?? [];
    const alt = g.terms.filter(t => !off.includes(t.label)).map(t => t.re).join('|');
    // A short reply is the whole message; everything else may appear anywhere in it.
    out[g.id] = !alt ? null : g.id === 'ignore' ? new RegExp('^(' + alt + ')' + SKIP_TAIL, 'iu') : new RegExp('\\b(' + alt + ')\\b', 'i');
  }
  return out;
}

// Added terms are plain text, so they are escaped and any spacing between words matches. Whole words
// here too, with a boundary that works for emoji and accented letters, where \b does not.
const literal = (term: string): string => term.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');

function addedRegex(id: RuleGroupId, add: string[]): RegExp | null {
  if (!add.length) return null;
  const alt = add.map(literal).join('|');
  return new RegExp(id === 'ignore' ? '^(?:' + alt + ')' + SKIP_TAIL : '(?<![\\p{L}\\p{N}_])(?:' + alt + ')(?![\\p{L}\\p{N}_])', 'iu');
}

function compile(cfg: LoopRules): Matchers {
  const built = builtInRegexes(cfg);
  const out = {} as Matchers;
  for (const g of RULE_GROUPS) {
    const res = [built[g.id], addedRegex(g.id, cfg[g.id]?.add ?? [])].filter((r): r is RegExp => r !== null);
    out[g.id] = text => res.some(r => r.test(text));
  }
  return out;
}

let m = compile({});

/** Settings → SUM UP! rules: applies from the next message, and from startup after a restart. */
export const setLoopRules = (cfg: LoopRules): void => { m = compile(cfg); };

export const MIN_TEXT = 4;

export function topicOf(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 96 ? t.slice(0, 95).trim() + '…' : t;
}

function isQuestion(text: string): boolean {
  return text.includes('?') || m.ask(text);
}

/** 2: "Terima kasih banyak atas pembayarannya ka 🙏", "noted, thanks". 1: "ok", "Baik ka", 👍. 0: not an acknowledgement. */
export function ackStrength(text: string): 0 | 1 | 2 {
  const t = text.trim();
  if (!t || isQuestion(t) || t.length > 200) return 0;
  if (m.thanks(t)) return 2;
  return EMOJI_ACK.test(t) || m.okay(t) ? 1 : 0;
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
export const isDeferral = (text: string): boolean => m.defer(text);

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
  if (text.length < MIN_TEXT || m.ignore(text)) return null;

  // A follow-up from the side that is waiting is a nudge on the loop, not a new loop.
  if (m.followUp(text)) {
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

  if (m.myAsk(text) || text.includes('?')) {
    return { type: 'create', dir: 'waiting', kind: CONFIRM.test(text) ? 'confirmation' : 'question', topic: topicOf(text), slaH: DEFAULT_SLA_H.waiting };
  }
  if (m.promise(text)) {
    return { type: 'create', dir: 'owed', kind: 'commitment', topic: topicOf(text), slaH: DEFAULT_SLA_H.owed };
  }
  return null;
}
