import type { Lang, Loop } from './types';

// SLA math, ported from the mockup's loopAge / loopPending / loopSla / fmtDur.
// Difference from the mockup (confirmed 28 Oct): only your own nudges restart the clock;
// chases from the other side are counted on the loop but never reset it.

export type SlaState = 'over' | 'soon' | 'ok' | 'closed';

export const SLA_LABEL: Record<SlaState, string> = { over: 'Overdue', soon: 'Due soon', ok: 'On time', closed: 'Closed' };
export const SLA_ORDER: Record<SlaState, number> = { over: 0, soon: 1, ok: 2, closed: 3 };

const H = 3_600_000;

export const hoursSince = (t: number, now: number): number => Math.max(0, (now - t) / H);

/** Total time since the loop opened; for answered loops, how long it took. */
export function loopAge(l: Loop, now: number): number {
  if (l.state === 'answered' && l.answeredAt) return Math.max(0, (l.answeredAt - l.askedAt) / H);
  return hoursSince(l.askedAt, now);
}

/** Hours since the last thing you did about it. Your nudge restarts this clock. */
export function loopPending(l: Loop, now: number): number {
  const last = l.nudges.length ? Math.max(...l.nudges) : l.askedAt;
  return hoursSince(Math.max(last, l.askedAt), now);
}

export function loopSla(l: Loop, now: number): SlaState {
  if (l.state !== 'open') return 'closed';
  const p = loopPending(l, now);
  if (p > l.slaH) return 'over';
  if (p > l.slaH * 0.7) return 'soon';
  return 'ok';
}

let durLang: Lang = 'en';
/** The language fmtDur writes in by default: the app language (set once at start in each process). */
export const setDurLang = (l: Lang): void => { durLang = l; };

export function fmtDur(h: number, lang: Lang = durLang): string {
  const [m, hr, d] = lang === 'id' ? [' mnt', ' jam', ' hari'] : ['m', 'h', 'd'];
  if (h < 1) return Math.max(1, Math.round(h * 60)) + m;
  if (h < 24) return Math.round(h) + hr;
  const days = Math.floor(h / 24);
  const r = Math.round(h % 24);
  if (r === 24) return days + 1 + d;
  return days + d + (r ? ' ' + r + hr : '');
}

export const DEFAULT_SLA_H = { owed: 24, waiting: 48 } as const;
