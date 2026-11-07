import type { LoopRules, RuleGroupId } from './types';

// What the local loop rules look for. Each built-in term is one alternative of the rule's pattern;
// the label is what Settings shows, and what a switched-off term is saved as. Only the person's changes
// are stored, so a built-in term added in a later version reaches them too.
// Terms people add are plain text, never patterns: a typo in Settings cannot break message intake.

export interface RuleTerm { label: string; re: string }
export interface RuleGroup { id: RuleGroupId; title: string; hint: string; terms: RuleTerm[] }

type Spec = string | [label: string, re: string];
const T = (specs: Spec[]): RuleTerm[] => specs.map(s => (typeof s === 'string' ? { label: s, re: s } : { label: s[0], re: s[1] }));

export const RULE_GROUPS: RuleGroup[] = [
  {
    id: 'ask', title: 'Asks to you', hint: 'A message to you with one of these becomes You owe them. A question mark always counts too.',
    terms: T([
      'can you', 'could you', 'would you', 'will you', 'do you', 'are you', 'is there',
      ['please confirm / check / send / advise / share / let / review / reply', 'please (confirm|check|send|advise|share|let|review|reply)'],
      'pls', 'kindly', 'mohon', 'tolong', 'apakah', 'kapan', 'bagaimana', 'gimana', ['bisa / bisakah', 'bisa(kah)?'], 'minta', 'boleh',
    ]),
  },
  {
    id: 'myAsk', title: 'Your asks', hint: 'A message from you with one of these becomes Waiting on them. A question mark always counts too.',
    terms: T([
      'please confirm', 'pls confirm', 'can you confirm', 'could you confirm', 'kindly confirm', 'confirm once',
      ['let me / us know', 'let (me|us) know'], ['eta', 'eta\\b'], 'mohon konfirmasi', 'mohon dikonfirmasi',
      ['tolong konfirmasi / dikonfirmasi', 'tolong (di)?konfirmasi'], 'bisa dikonfirmasi', 'mohon info', 'mohon dibantu',
    ]),
  },
  {
    id: 'promise', title: 'Your promises', hint: 'A message from you with one of these becomes a promise you owe.',
    terms: T(['i will', "i'll", 'we will', "we'll", 'will send', 'will check', 'will share', 'will update', 'will revert', 'akan saya', 'saya akan', 'kami akan', 'nanti saya', 'segera saya']),
  },
  {
    id: 'followUp', title: 'Chases', hint: 'From the side that is waiting, one of these counts as a chase on the open loop instead of a new one.',
    terms: T([
      'following up', ['follow up / follow-up / followup / following-up', 'follow(ing)?[\\s-]?up'], 'any update', 'any luck', 'still waiting', 'gentle reminder', 'just checking',
      ['bumping this / up', 'bumping (this|up)'], 'ada update', 'sudah ada update', ['kabar / kabarnya', 'kabar(nya)?'],
      ['gimana update / kabar', 'gimana (update|kabar)(nya)?'], ['bagaimana update / kabar', 'bagaimana (update|kabar)(nya)?'],
    ]),
  },
  {
    id: 'ignore', title: 'Short replies to skip', hint: 'A message that is only one of these never makes a card, even with “ka” or “pak” after it.',
    terms: T([
      ['ok / oke / okay / okey', 'ok(e|ay|ey)?'], ['okee…', 'oke+'], ['okk…', 'okk+'], 'noted', 'note', ['thank / thanks / thank you', 'thanks?( you)?'], 'thank you', 'thx', 'tq', 'tks', 'makasih',
      ['terima kasih / terimakasih', 'terima ?kasih'], 'siap', 'sip', 'baik', 'done', 'mantap', '👍', '🙏', '🙏🏻', '👌',
    ]),
  },
  {
    id: 'thanks', title: 'Thanks that close a loop', hint: 'Sent by the side that asked, after an answer, one of these closes the loop.',
    terms: T([
      ['terima kasih / terimakasih', 'terima ?kasih'], 'makasih', ['maakasiih…', 'ma+ka+sih'], ['thank / thanks', 'thanks?'], 'thank you', 'thx', 'tq', 'tks', 'ty', 'noted',
      'well received', 'received', 'got it', ['sudah terima / diterima', 'sudah (di ?)?terima'], 'sudah masuk', 'sudah diterima', 'diterima', 'perfect', 'sounds good', 'all good',
    ]),
  },
  {
    id: 'okay', title: 'Short OKs', hint: 'After an answer, one of these closes your own ask. It closes theirs only when your reply was about the same thing.',
    terms: T([['ok / oke / okay / okey', 'ok(e|ay|ey)?'], ['okee…', 'oke+'], 'baik', 'siap', 'sip', 'mantap', 'done', 'beres', 'aman', 'alright', 'great']),
  },
  {
    id: 'defer', title: 'Not an answer yet', hint: 'A reply with one of these only postpones the answer, so the loop stays open.',
    terms: T([
      'cek dulu', ['check first / later', 'check (first|later)'], ['nanti saya / kami / aku', 'nanti (saya|kami|aku)'], ['akan saya / kami', 'akan (saya|kami)'], 'saya akan', 'kami akan',
      ["i'll check / get back / revert / update", "i'?ll (check|get back|revert|update)"], 'let me check', ['will check / revert / get back', 'will (check|revert|get back)'],
      'tunggu', 'sebentar', 'bentar', 'on it',
    ]),
  },
];

export const MAX_TERM = 60;

/** Trimmed, single-spaced and lowercased: matching ignores case and spacing anyway. */
export const cleanTerm = (raw: string): string => raw.trim().replace(/\s+/g, ' ').toLowerCase();

/** A built-in term that already matches this exact text, e.g. "bisakah" is in "bisa / bisakah". */
export const builtInFor = (g: RuleGroup, term: string): RuleTerm | undefined =>
  g.terms.find(t => new RegExp('^(?:' + t.re + ')$', 'iu').test(term));

export type AddResult = { rules: LoopRules; status: 'added' | 'restored' | 'exists' | 'empty' };

/** Adds a word to a group. One that is built in but switched off is switched back on instead. */
export function addRuleTerm(rules: LoopRules, g: RuleGroup, raw: string): AddResult {
  const term = cleanTerm(raw).slice(0, MAX_TERM).trim();
  if (!term) return { rules, status: 'empty' };
  const { off = [], add = [] } = rules[g.id] ?? {};
  const built = builtInFor(g, term);
  if (built && off.includes(built.label)) return { rules: { ...rules, [g.id]: { off: off.filter(l => l !== built.label), add } }, status: 'restored' };
  if (built || add.includes(term)) return { rules, status: 'exists' };
  return { rules: { ...rules, [g.id]: { off, add: [...add, term] } }, status: 'added' };
}

/** Switches a built-in term off or back on. */
export function toggleRuleTerm(rules: LoopRules, id: RuleGroupId, label: string): LoopRules {
  const { off = [], add = [] } = rules[id] ?? {};
  return { ...rules, [id]: { off: off.includes(label) ? off.filter(l => l !== label) : [...off, label], add } };
}

export function removeRuleTerm(rules: LoopRules, id: RuleGroupId, term: string): LoopRules {
  const { off = [], add = [] } = rules[id] ?? {};
  return { ...rules, [id]: { off, add: add.filter(t => t !== term) } };
}

export const rulesChanged = (rules: LoopRules): boolean => RULE_GROUPS.some(g => !!rules[g.id]?.off?.length || !!rules[g.id]?.add?.length);
