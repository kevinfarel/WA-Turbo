import { afterEach, describe, expect, it } from 'vitest';
import type { RuleGroupId } from '../../src/shared/types';
import { addRuleTerm, removeRuleTerm, RULE_GROUPS, rulesChanged, toggleRuleTerm } from '../../src/shared/rule-terms';
import { ackStrength, builtInRegexes, evaluate, isDeferral, setLoopRules, type RuleInput } from '../../src/main/loops/rules';

// The rules exactly as they were before they became settings. Only change these on purpose:
// they are the promise that an untouched install behaves the same.
const ADDRESS = '(?:\\s+(?:ka+k?|kk|pak|bu|bapak|ibu|mas|mba+k?|bro|sis|gan|min|om|bos+|sir|all|guys|team|tim))*';
const ORIGINAL: Record<RuleGroupId, RegExp> = {
  ignore: new RegExp('^(ok(e|ay|ey)?|oke+|okk+|noted|note|thanks?( you)?|thank you|thx|tq|tks|makasih|terima ?kasih|siap|sip|baik|done|mantap|👍|🙏|🙏🏻|👌)' + ADDRESS + '[\\s.!,🙏👍🏻🏼🏽]*$', 'iu'),
  thanks: /\b(terima ?kasih|makasih|ma+ka+sih|thanks?|thank you|thx|tq|tks|ty|noted|well received|received|got it|sudah (di ?)?terima|sudah masuk|sudah diterima|diterima|perfect|sounds good|all good)\b/i,
  okay: /\b(ok(e|ay|ey)?|oke+|baik|siap|sip|mantap|done|beres|aman|alright|great)\b/i,
  defer: /\b(cek dulu|check (first|later)|nanti (saya|kami|aku)|akan (saya|kami)|saya akan|kami akan|i'?ll (check|get back|revert|update)|let me check|will (check|revert|get back)|tunggu|sebentar|bentar|on it)\b/i,
  followUp: /\b(following up|follow(ing)?[\s-]?up|any update|any luck|still waiting|gentle reminder|just checking|bumping (this|up)|ada update|sudah ada update|kabar(nya)?|gimana (update|kabar)(nya)?|bagaimana (update|kabar)(nya)?)\b/i,
  ask: /\b(can you|could you|would you|will you|do you|are you|is there|please (confirm|check|send|advise|share|let|review|reply)|pls|kindly|mohon|tolong|apakah|kapan|bagaimana|gimana|bisa(kah)?|minta|boleh)\b/i,
  myAsk: /\b(please confirm|pls confirm|can you confirm|could you confirm|kindly confirm|confirm once|let (me|us) know|eta\b|mohon konfirmasi|mohon dikonfirmasi|tolong (di)?konfirmasi|bisa dikonfirmasi|mohon info|mohon dibantu)\b/i,
  promise: /\b(i will|i'll|we will|we'll|will send|will check|will share|will update|will revert|akan saya|saya akan|kami akan|nanti saya|segera saya)\b/i,
};

const dm = (text: string, fromMe = false): RuleInput => ({ fromMe, text, isGroup: false, chatHasPartner: false, mentionsMe: false, quotesMine: false });
const group = (id: RuleGroupId) => RULE_GROUPS.find(g => g.id === id)!;

afterEach(() => setLoopRules({}));

describe('default rules', () => {
  it('are the original patterns, character for character', () => {
    const now = builtInRegexes();
    for (const g of RULE_GROUPS) {
      expect(now[g.id]?.source, g.id).toBe(ORIGINAL[g.id].source);
      expect(now[g.id]?.flags, g.id).toBe(ORIGINAL[g.id].flags);
    }
  });

  it('have a unique label for every term, and each term compiles on its own', () => {
    for (const g of RULE_GROUPS) {
      expect(new Set(g.terms.map(t => t.label)).size, g.id).toBe(g.terms.length);
      for (const t of g.terms) expect(() => new RegExp('^(?:' + t.re + ')$', 'iu')).not.toThrow();
    }
  });
});

describe('switching a word off', () => {
  const noBisa = toggleRuleTerm({}, 'ask', 'bisa / bisakah');

  it('stops only that word', () => {
    expect(evaluate(dm('Hari ini bisa ketemu jam berapa'), [])).toMatchObject({ type: 'create', dir: 'owed' });
    setLoopRules(noBisa);
    expect(evaluate(dm('Hari ini bisa ketemu jam berapa'), [])).toBeNull();
    expect(evaluate(dm('Kapan bisa ketemu'), [])).toMatchObject({ type: 'create', dir: 'owed' });
  });

  it('leaves the question mark working', () => {
    setLoopRules(noBisa);
    expect(evaluate(dm('Hari ini bisa ketemu?'), [])).toMatchObject({ type: 'create', dir: 'owed' });
  });

  it('with every word in a list off, that list matches nothing', () => {
    setLoopRules({ promise: { off: group('promise').terms.map(t => t.label) } });
    expect(evaluate(dm('I will send it today', true), [])).toBeNull();
  });

  it('switches back on with the same toggle', () => {
    expect(rulesChanged(toggleRuleTerm(noBisa, 'ask', 'bisa / bisakah'))).toBe(false);
  });
});

describe('adding a word', () => {
  it('works in the list it was added to, as a whole word', () => {
    setLoopRules({ ask: { add: ['ketemuan'] } });
    expect(evaluate(dm('Besok ketemuan yuk'), [])).toMatchObject({ type: 'create', dir: 'owed' });
    expect(evaluate(dm('Sudah ketemuannya kemarin'), [])).toBeNull();
  });

  it('matches any case and spacing', () => {
    setLoopRules({ promise: { add: ['saya kabari'] } });
    expect(evaluate(dm('Nanti SAYA   Kabari ya', true), [])).toMatchObject({ kind: 'commitment' });
  });

  it('is plain text, never a pattern', () => {
    setLoopRules({ ask: { add: ['a.b', '(', '[x', 'c++'] } });
    expect(evaluate(dm('send axb now'), [])).toBeNull();
    expect(evaluate(dm('need a.b now'), [])).toMatchObject({ type: 'create' });
    expect(evaluate(dm('learning c++ now'), [])).toMatchObject({ type: 'create' });
  });

  it('can be an emoji', () => {
    setLoopRules({ okay: { add: ['🔥'] } });
    expect(ackStrength('🔥')).toBe(1);
  });

  it('feeds every list: skip, thanks and not-an-answer', () => {
    setLoopRules({ ignore: { add: ['bisa dong'] }, thanks: { add: ['matur nuwun'] }, defer: { add: ['nanti dicek'] } });
    expect(evaluate(dm('Bisa dong kak'), [])).toBeNull();
    expect(ackStrength('matur nuwun ya')).toBe(2);
    expect(isDeferral('ok nanti dicek')).toBe(true);
  });
});

describe('editing the lists', () => {
  it('adds a clean word once', () => {
    const r = addRuleTerm({}, group('ask'), '  Ketemu   Yuk ');
    expect(r).toMatchObject({ status: 'added', rules: { ask: { add: ['ketemu yuk'] } } });
    expect(addRuleTerm(r.rules, group('ask'), 'KETEMU YUK').status).toBe('exists');
  });

  it('finds a word inside a built-in term rather than adding a copy', () => {
    expect(addRuleTerm({}, group('ask'), 'bisakah').status).toBe('exists');
  });

  it('switches a built-in word back on instead of adding it again', () => {
    const r = addRuleTerm(toggleRuleTerm({}, 'ask', 'bisa / bisakah'), group('ask'), 'Bisa');
    expect(r.status).toBe('restored');
    expect(rulesChanged(r.rules)).toBe(false);
  });

  it('ignores an empty box, and removes an added word', () => {
    expect(addRuleTerm({}, group('ask'), '   ').status).toBe('empty');
    const { rules } = addRuleTerm({}, group('ask'), 'yuk');
    expect(rulesChanged(removeRuleTerm(rules, 'ask', 'yuk'))).toBe(false);
  });
});
