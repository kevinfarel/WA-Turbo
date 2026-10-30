import { describe, expect, it } from 'vitest';
import { fmtDur, loopAge, loopPending, loopSla } from '../../src/shared/sla';
import type { Loop } from '../../src/shared/types';
import { AliasBook, redact, restore } from '../../src/main/ai/redact';

const NOW = Date.UTC(2026, 9, 28, 9, 40);
const h = (n: number) => NOW - n * 3_600_000;
const loop = (o: Partial<Loop>): Loop => ({
  id: 'L', chatId: 'c', msgId: 'm', dir: 'owed', kind: 'question', state: 'open', source: 'manual', topic: 't',
  askedBy: 'x', askedAt: h(10), slaH: 24, blocks: null, snoozeNote: null, answeredAt: null, nudges: [], chases: 0, aiHint: null, closeNote: null, ...o,
});

describe('SLA', () => {
  it('matches the mockup thresholds', () => {
    expect(loopSla(loop({ askedAt: h(10) }), NOW)).toBe('ok');
    expect(loopSla(loop({ askedAt: h(17) }), NOW)).toBe('soon'); // > 70% of 24h
    expect(loopSla(loop({ askedAt: h(25) }), NOW)).toBe('over');
    expect(loopSla(loop({ state: 'answered' }), NOW)).toBe('closed');
  });

  it('restarts the clock on your nudge but not on their chase', () => {
    const waiting = loop({ dir: 'waiting', slaH: 48, askedAt: h(110), nudges: [h(60)] });
    expect(loopPending(waiting, NOW)).toBeCloseTo(60);
    expect(loopSla(waiting, NOW)).toBe('over');
    const owed = loop({ askedAt: h(76), chases: 1 });
    expect(loopSla(owed, NOW)).toBe('over');
    expect(fmtDur(loopPending(owed, NOW) - owed.slaH)).toBe('2d 4h');
  });

  it('formats durations like the mockup', () => {
    expect(fmtDur(0.25)).toBe('15m');
    expect(fmtDur(9)).toBe('9h');
    expect(fmtDur(76)).toBe('3d 4h');
    expect(fmtDur(48)).toBe('2d');
    expect(loopAge(loop({ state: 'answered', askedAt: h(66), answeredAt: h(18) }), NOW)).toBeCloseTo(48);
  });
});

describe('redaction', () => {
  it('swaps phone numbers and JIDs for stable aliases and back', () => {
    const book = new AliasBook();
    const out = redact('Call +62 812-5540-118 or 0812 5540 118, SG +65 8123-4490, jid 6281255401180@s.whatsapp.net', book.aliasFor);
    // The JID is a different number (extra 0); the two spellings of +62 812-5540-118 share an alias.
    expect(out).toBe('Call Contact-02 or Contact-02, SG Contact-03, jid Contact-01');
    expect(restore('Ask Contact-03', book.displayMap())).toBe('Ask +6581234490');
  });

  it('leaves IPs, amounts and invoice numbers alone', () => {
    const book = new AliasBook();
    const t = 'IPs 103.148.22.10 and 103.148.22.11, INV-2026-00418, code 2005200, Rp 1.500.000';
    expect(redact(t, book.aliasFor)).toBe(t);
  });

  it('keeps aliases stable across runs', () => {
    const book = new AliasBook([{ real: '6281255401180', alias: 'Contact-07' }]);
    expect(redact('+62 812-5540-1180', book.aliasFor)).toBe('Contact-07');
    expect(redact('+65 8123-4490', book.aliasFor)).toBe('Contact-08');
  });
});
