import { describe, expect, it } from 'vitest';
import { weekStart, ymd } from '../../src/shared/week';
import { dueAt, runOrder, type ScheduleChat } from '../../src/main/ai/schedule';

// 26 Oct 2026 is a Monday.
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);

describe('this week', () => {
  it('starts Monday 00:00: Friday reads from Monday', () => {
    expect(weekStart(at(30, 17, 45))).toEqual(at(26, 0));
  });
  it('on a Monday, only Monday', () => {
    expect(weekStart(at(26, 9, 30))).toEqual(at(26, 0));
  });
  it('Sunday still belongs to the week that began Monday', () => {
    expect(weekStart(at(1 + 31, 21))).toEqual(at(26, 0)); // Sun 1 Nov
  });
  it('a new Monday is a new cache key', () => {
    expect(ymd(weekStart(at(30, 12)))).toBe('2026-10-26');
    expect(ymd(weekStart(at(33, 8)))).toBe('2026-11-02'); // Mon 2 Nov
  });
});

const S = { pinEveryMin: 5, otherEveryMin: 60 };
const chat = (o: Partial<ScheduleChat>): ScheduleChat => ({ pinned: false, checkedAt: null, kind: 'dm', iWrote: true, lastAt: 0, ...o });

describe('auto summary schedule', () => {
  it('pinned chats run 5 minutes after their last look, others after an hour', () => {
    expect(dueAt(chat({ pinned: true, checkedAt: 1_000_000 }), S)).toBe(1_000_000 + 5 * 60_000);
    expect(dueAt(chat({ checkedAt: 1_000_000 }), S)).toBe(1_000_000 + 60 * 60_000);
  });
  it('a chat never looked at is due right away', () => {
    expect(dueAt(chat({}), S)).toBe(60 * 60_000);
  });
  it('"Off" leaves unpinned chats alone', () => {
    expect(dueAt(chat({}), { ...S, otherEveryMin: 0 })).toBeNull();
  });
  it('skips groups you never write in, unless pinned', () => {
    expect(dueAt(chat({ kind: 'group', iWrote: false }), S)).toBeNull();
    expect(dueAt(chat({ kind: 'group', iWrote: false, pinned: true }), S)).not.toBeNull();
  });
  it('runs pinned chats first, then the newest', () => {
    const list = [chat({ lastAt: 3 }), chat({ pinned: true, lastAt: 1 }), chat({ lastAt: 9 })].sort(runOrder);
    expect(list.map(c => [c.pinned, c.lastAt])).toEqual([[true, 1], [false, 9], [false, 3]]);
  });
});
