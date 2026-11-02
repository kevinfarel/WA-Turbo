import { mkdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { dataDir } from '../config';

// What the experimental providers (Antigravity, Codex) did on their last run, for Settings → Copy diagnostics.
// Never any message text: only versions, flags, exit codes, error lines and token counts, so a tester can paste
// it into a bug report safely.

export interface Diag { at: number; version: string | null; args: string[]; exit: number | null; error: string | null; usage: unknown; notes: string[] }

const last = new Map<string, Diag>();

export function recordDiag(provider: string, d: Omit<Diag, 'at'>): void {
  last.set(provider, { ...d, at: Date.now() });
}

export function diagText(provider: string, extra: Record<string, string>): string {
  const d = last.get(provider);
  const lines = [`WA Turbo diagnostics · ${provider} · ${new Date().toISOString()}`, `platform: ${process.platform} ${process.arch}`];
  for (const [k, v] of Object.entries(extra)) lines.push(`${k}: ${v}`);
  if (!d) return [...lines, 'last run: none yet (press Check again or summarize a chat first)'].join('\n');
  lines.push(`last run: ${new Date(d.at).toISOString()}`, `cli version: ${d.version ?? 'unknown'}`, `args: ${d.args.join(' ')}`,
    `exit code: ${d.exit ?? 'none'}`, `error: ${d.error ?? 'none'}`, `usage: ${JSON.stringify(d.usage ?? null)}`, ...d.notes);
  return lines.join('\n');
}

/** An empty folder for one CLI run (schema file, photos), removed afterwards. The CLI starts inside it. */
export function runFolder(): { dir: string; done: () => void } {
  const dir = join(dataDir(), 'ai-runs', Date.now() + '-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Replaces the prompt in a recorded argument list, so diagnostics never carry message text. */
export const scrubArgs = (args: string[], secret: string[]): string[] => args.map(a => secret.includes(a) ? '<prompt>' : a.length > 200 ? a.slice(0, 40) + '…' : a);
