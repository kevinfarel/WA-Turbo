import type { Loop, NotifyOthers } from '@shared/types';
import { loopPending, loopSla } from '@shared/sla';

// Which tier a new message notifies in. Pure, so every rule in the notifications brief has a test.

export type Tier = 'pinned' | 'other' | 'none';

export interface AlertInput {
  fromMe: boolean;
  kind: 'dm' | 'group';
  pinned: boolean;
  mutedUntil: number | null;
  mentionsMe: boolean;
  quotedFromMe: boolean;
  /** WA Turbo is in front with this chat open. */
  viewing: boolean;
}

export interface DecideSettings { notifyOn: boolean; notifyOthers: NotifyOthers; notifyPausedUntil: number }

export function decide(m: AlertInput, s: DecideSettings, now: number): Tier {
  if (!s.notifyOn || s.notifyPausedUntil > now) return 'none';
  if (m.fromMe || m.viewing) return 'none';
  if (m.mutedUntil !== null && m.mutedUntil > now) return 'none';
  if (m.pinned) return 'pinned';
  const forMe = m.mentionsMe || m.quotedFromMe;
  switch (s.notifyOthers) {
    case 'all': return 'other';
    case 'direct': return m.kind === 'dm' || forMe ? 'other' : 'none';
    case 'mentions': return forMe ? 'other' : 'none';
    default: return 'none';
  }
}

/** Banners that land within this window of the chat's last banner update it instead of popping again. */
export const BUNDLE_MS: Record<Exclude<Tier, 'none'>, number> = { pinned: 30_000, other: 120_000 };

/** Messages older than this when they arrive (the Mac was asleep) still count, but bundle into one catch-up banner. */
export const STALE_MS = 15 * 60_000;

/** Open loops where someone waits for your reply past the SLA, in pinned chats. Longest wait first. */
export function overdueLoops(loops: Loop[], pinned: Set<string>, now: number): { loop: Loop; waitedH: number }[] {
  return loops
    .filter(l => l.dir === 'owed' && l.state === 'open' && pinned.has(l.chatId) && loopSla(l, now) === 'over')
    .map(l => ({ loop: l, waitedH: loopPending(l, now) }))
    .sort((a, b) => b.waitedH - a.waitedH);
}
