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
