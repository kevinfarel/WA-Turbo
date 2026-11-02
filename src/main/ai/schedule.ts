import type { ChatKind, Settings } from '@shared/types';

// When auto summary runs a chat, kept free of I/O so it can be tested on its own.

export interface ScheduleChat { pinned: boolean; checkedAt: number | null; kind: ChatKind; iWrote: boolean; lastAt: number }

const MIN = 60_000;

/** When this chat may run next, or null when auto summary leaves it alone. */
export function dueAt(c: ScheduleChat, s: Pick<Settings, 'pinEveryMin' | 'otherEveryMin'>): number | null {
  const every = c.pinned ? s.pinEveryMin : s.otherEveryMin;
  if (!every) return null;
  // Broadcast-style groups you never write in (announcement channels) run only when pinned.
  if (!c.pinned && c.kind === 'group' && !c.iWrote) return null;
  return (c.checkedAt ?? 0) + every * MIN;
}

/** Pinned first, then the chat with the newest message. */
export const runOrder = (a: ScheduleChat, b: ScheduleChat): number => Number(b.pinned) - Number(a.pinned) || b.lastAt - a.lastAt;

/** Free providers: how long until another auto run fits, with at most `cap` runs in any `windowMs` (0 = now). */
export function capWait(recent: number[], now: number, cap: number, windowMs: number): number {
  const inWindow = recent.filter(t => now - t < windowMs).sort((a, b) => a - b);
  return inWindow.length < cap ? 0 : inWindow[inWindow.length - cap] + windowMs - now;
}

/** The next 00:00 in a time zone (Gemini's free quota resets at midnight Pacific time). */
export function nextMidnight(now: number, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const sinceMidnight = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + (now % 1000);
  return now - sinceMidnight + 24 * 3600_000;
}

export const nextPacificMidnight = (now: number): number => nextMidnight(now, 'America/Los_Angeles');
