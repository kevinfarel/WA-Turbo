import { describe, expect, it } from 'vitest';
import type { Loop } from '../../src/shared/types';
import { decide, overdueLoops, type AlertInput } from '../../src/main/notify/decide';

const NOW = 1_800_000_000_000;
const S = { notifyOn: true, notifyOthers: 'direct' as const, notifyPausedUntil: 0 };
const msg = (o: Partial<AlertInput>): AlertInput => ({ fromMe: false, kind: 'dm', pinned: false, mutedUntil: null, mentionsMe: false, quotedFromMe: false, viewing: false, ...o });

describe('which tier a message notifies in', () => {
  it('pinned chats: every message, groups too', () => {
    expect(decide(msg({ pinned: true }), S, NOW)).toBe('pinned');
    expect(decide(msg({ pinned: true, kind: 'group' }), S, NOW)).toBe('pinned');
  });
  it('other chats: direct chats, and groups only when you are mentioned or replied to', () => {
    expect(decide(msg({}), S, NOW)).toBe('other');
    expect(decide(msg({ kind: 'group' }), S, NOW)).toBe('none');
    expect(decide(msg({ kind: 'group', mentionsMe: true }), S, NOW)).toBe('other');
    expect(decide(msg({ kind: 'group', quotedFromMe: true }), S, NOW)).toBe('other');
  });
  it('"Mentions only" drops plain direct messages; "Off" drops all other chats but not pinned', () => {
    expect(decide(msg({}), { ...S, notifyOthers: 'mentions' }, NOW)).toBe('none');
    expect(decide(msg({ mentionsMe: true }), { ...S, notifyOthers: 'mentions' }, NOW)).toBe('other');
    expect(decide(msg({}), { ...S, notifyOthers: 'off' }, NOW)).toBe('none');
    expect(decide(msg({ pinned: true }), { ...S, notifyOthers: 'off' }, NOW)).toBe('pinned');
  });
  it('never for your own messages or the chat you are reading', () => {
    expect(decide(msg({ pinned: true, fromMe: true }), S, NOW)).toBe('none');
    expect(decide(msg({ pinned: true, viewing: true }), S, NOW)).toBe('none');
  });
  it('a WA Turbo mute silences even pinned chats until it ends', () => {
    expect(decide(msg({ pinned: true, mutedUntil: NOW + 60_000 }), S, NOW)).toBe('none');
    expect(decide(msg({ pinned: true, mutedUntil: Infinity }), S, NOW)).toBe('none');
    expect(decide(msg({ pinned: true, mutedUntil: NOW - 1 }), S, NOW)).toBe('pinned');
  });
  it('pause and the main switch silence everything', () => {
    expect(decide(msg({ pinned: true }), { ...S, notifyPausedUntil: NOW + 1 }, NOW)).toBe('none');
    expect(decide(msg({ pinned: true }), { ...S, notifyOn: false }, NOW)).toBe('none');
  });
});

const H = 3_600_000;
const loop = (o: Partial<Loop>): Loop => ({
  id: '1', chatId: 'pin', msgId: null, dir: 'owed', kind: 'question', state: 'open', source: 'rule', topic: 'Payment proof', askedBy: 'Shop',
  askedAt: NOW - 30 * H, slaH: 24, blocks: null, snoozeNote: null, answeredAt: null, nudges: [], chases: 0, aiHint: null, closeNote: null, ...o,
});

describe('menu bar: pinned chats waiting too long for your reply', () => {
  const pinned = new Set(['pin']);
  it('counts only open, owed, overdue loops in pinned chats', () => {
    const list = overdueLoops([
      loop({ id: 'a' }),
      loop({ id: 'b', chatId: 'other' }),
      loop({ id: 'c', dir: 'waiting' }),
      loop({ id: 'd', askedAt: NOW - 2 * H }),
      loop({ id: 'e', state: 'snoozed' }),
    ], pinned, NOW);
    expect(list.map(x => x.loop.id)).toEqual(['a']);
  });
  it('your own follow-up restarts the clock', () => {
    expect(overdueLoops([loop({ nudges: [NOW - H] })], pinned, NOW)).toEqual([]);
  });
});
