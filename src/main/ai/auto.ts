import type { AutoStatus } from '@shared/types';
import { autoCandidates, getSettings, markAutoChecked } from '../db/queries';
import { dueAt, runOrder } from './schedule';
import { AiError } from './errors';
import { summarizeChat } from './summarize';

// Auto summary. A new, edited or deleted message puts its chat on the changed list; one timer wakes
// for the next chat that is due. With nothing changed there is no timer and nothing runs. Runs go
// one at a time, pinned chats first. Pinned chats get a saved summary the AI panel shows; other
// chats only refresh their SUM UP! loops. Nothing here can send a WhatsApp message.

export interface AutoHooks {
  isConnected: () => Promise<boolean>;
  onRan: (chatId: string, pinned: boolean) => void;
  onStatus: (s: AutoStatus) => void;
}

const PAUSE_MS = 30 * 60_000;
class AutoSummary {
  private changed = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private nextAt: number | null = null;
  private running: string | null = null;
  private pausedUntil: number | null = null;
  private pausedWhy: string | null = null;
  private busy = false;
  private waiting = 0; // changed chats that will actually run under the current settings
  private on = false;
  private hooks: AutoHooks | null = null;

  /** Rebuilds the changed list from the database (chats newer than their last auto look) and schedules. */
  async start(hooks: AutoHooks): Promise<void> {
    this.hooks = hooks;
    for (const c of await autoCandidates(null)) this.changed.add(c.id);
    await this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.hooks = null;
  }

  markChanged(chatIds: Iterable<string>): void {
    let added = false;
    for (const id of chatIds) if (!this.changed.has(id)) { this.changed.add(id); added = true; }
    if (added || !this.timer) void this.schedule();
  }

  status(): AutoStatus {
    return { on: this.on, pending: this.waiting, nextAt: this.nextAt, runningChat: this.running, pausedUntil: this.pausedUntil, pausedWhy: this.pausedWhy };
  }

  private emit(): void { this.hooks?.onStatus(this.status()); }

  /** Sets the one timer for the next due chat, or none. Safe to call any time. */
  async schedule(): Promise<void> {
    if (!this.hooks) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextAt = null;
    if (this.busy) return; // the running batch reschedules when it ends
    const s = await getSettings();
    this.on = s.autoOn;
    if (!s.autoOn || !this.changed.size) { this.waiting = 0; this.emit(); return; }
    const cands = await autoCandidates([...this.changed]);
    this.changed = new Set(cands.map(c => c.id)); // drops chats already covered
    const times = cands.map(c => dueAt(c, s)).filter((t): t is number => t !== null);
    this.waiting = times.length;
    if (!times.length) { this.emit(); return; }
    let at = Math.max(Date.now(), Math.min(...times));
    if (this.pausedUntil && at < this.pausedUntil) at = this.pausedUntil;
    this.nextAt = at;
    this.timer = setTimeout(() => void this.runDue(), at - Date.now());
    this.emit();
  }

  private async runDue(): Promise<void> {
    this.timer = null;
    this.nextAt = null;
    this.busy = true;
    try {
      let s = await getSettings();
      if (!s.autoOn || !this.hooks) return;
      if (this.pausedUntil && Date.now() < this.pausedUntil) return;
      this.pausedUntil = null;
      this.pausedWhy = null;
      // Not connected: run nothing and keep nothing for later, so signing back in is not a burst.
      if (!(await this.hooks.isConnected())) { this.changed.clear(); return; }
      const now = Date.now();
      const due = (await autoCandidates([...this.changed]))
        .filter(c => { const t = dueAt(c, s); return t !== null && t <= now; })
        .sort(runOrder);
      for (const c of due) {
        s = await getSettings();
        if (!s.autoOn) break;
        this.running = c.id;
        this.emit();
        try {
          await summarizeChat(c.id, s.model, { window: { auto: c.pinned ? s.pinWindow : s.otherWindow }, auto: true, save: c.pinned }, 'auto:' + c.id, () => {});
          await markAutoChecked(c.id, c.rev);
          this.hooks?.onRan(c.id, c.pinned);
        } catch (e) {
          if (e instanceof AiError && e.code === 'rate_limited') {
            this.pausedUntil = Date.now() + PAUSE_MS;
            this.pausedWhy = 'Your Claude plan is at its usage limit.';
            break;
          }
          if (e instanceof AiError && (e.code === 'no_key' || e.code === 'bad_key')) { this.changed.clear(); break; }
          // Anything else: try this chat again after its interval.
          await markAutoChecked(c.id, null);
        }
      }
    } finally {
      this.running = null;
      this.busy = false;
      await this.schedule();
    }
  }
}

export const autoSummary = new AutoSummary();
