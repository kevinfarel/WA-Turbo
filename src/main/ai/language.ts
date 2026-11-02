import { z } from 'zod';
import { cheapModel } from '@shared/ai';
import type { Lang } from '@shared/types';
import { addAliases, getSettings, langSamples, listAliases, setAccountLang } from '../db/queries';
import { structured } from './client';
import { DETECT_SYSTEM } from './prompts';
import { AliasBook, redact } from './redact';

// A number that has no language yet gets one picked from its first conversations: the newest
// messages of its 10 most recent chats go to the AI once (Claude Haiku on the Claude providers), and the answer (English or
// Bahasa Indonesia) becomes what the AI writes in for that number. You can change it any time in
// Settings; a language you picked is never replaced. Nothing here sends a WhatsApp message.

const DetectOut = z.object({ lang: z.enum(['en', 'id']) });

const WANT_CHATS = 10;
/** A number with fewer chats than that is detected once it has been linked this long. */
const SETTLE_MS = 10 * 60_000;
const MIN_LINES = 3;
const RETRY_MS = 10 * 60_000;

export interface LangHooks {
  isConnected: () => Promise<boolean>;
  onDetected: () => void;
}

class LangDetect {
  private hooks: LangHooks | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private failedAt = 0;

  start(hooks: LangHooks): void {
    this.hooks = hooks;
    this.soon(5_000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.hooks = null;
  }

  /** New messages arrived, or the AI was just connected (force: retry now even after a failure). */
  poke(force = false): void {
    if (force) this.failedAt = 0;
    this.soon(force ? 1_000 : 30_000);
  }

  private soon(ms: number): void {
    if (!this.hooks || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, ms);
  }

  private async run(): Promise<void> {
    if (!this.hooks || this.busy || Date.now() - this.failedAt < RETRY_MS) return;
    this.busy = true;
    let waiting = false;
    try {
      const todo = await langSamples();
      if (!todo.length) return;
      if (!(await this.hooks.isConnected())) return; // Settings pokes again once the AI is connected
      for (const a of todo) {
        const settled = a.chats >= WANT_CHATS || !a.pairedAt || Date.now() - a.pairedAt > SETTLE_MS;
        if (!settled || a.lines.length < MIN_LINES) { waiting = true; continue; }
        await setAccountLang(a.id, await detectLang(a.lines), true);
        this.hooks?.onDetected();
      }
    } catch {
      this.failedAt = Date.now();
    } finally {
      this.busy = false;
      // History sync is still filling a new number: look again in a few minutes.
      if (waiting) this.soon(3 * 60_000);
    }
  }
}

/** One cheap call: phone numbers swapped for aliases, at most 80 short lines, low effort. */
export async function detectLang(lines: string[]): Promise<Lang> {
  const book = new AliasBook(await listAliases());
  const text = lines.slice(0, 80).map(l => '- ' + redact(l.replace(/\s+/g, ' '), book.aliasFor)).join('\n');
  await addAliases(book.added);
  const out = await structured({ kind: 'language', model: cheapModel(await getSettings()), system: DETECT_SYSTEM, user: text, schema: DetectOut, effort: 'low' });
  return out.lang;
}

export const langDetect = new LangDetect();
