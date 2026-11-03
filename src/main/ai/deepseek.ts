import { execFile } from 'node:child_process';
import { getProviderKey } from '../config';

// Finds the DeepSeek key. DeepSeek has no plan login a CLI could hold (its API is a prepaid balance
// with API keys), so the nearest thing to "already signed in" is its documented DEEPSEEK_API_KEY
// variable. A key pasted in Settings wins over it. The variable's value stays in memory; it is never
// written to WA Turbo's config, and WA Turbo doesn't read other apps' saved credentials.

export const DEEPSEEK_ENV = 'DEEPSEEK_API_KEY';

const WIN = process.platform === 'win32';
const MARK = '<<wa-turbo-key>>';

/** Picks the value out of the shell's output, which can also hold whatever the person's zshrc prints. */
export function parseShellKey(out: string): string | null {
  const parts = out.split(MARK);
  return parts.length >= 3 ? parts[1].trim() || null : null;
}

/** macOS apps opened from Finder don't get the shell's variables, and people export keys in .zshrc, hence -i. */
const fromShell = (): Promise<string | null> => new Promise(resolve => {
  const child = execFile('/bin/zsh', ['-ilc', `printf '%s%s%s' '${MARK}' "$${DEEPSEEK_ENV}" '${MARK}'`], { timeout: 8000 }, (err, out) =>
    resolve(err ? null : parseShellKey(out)));
  child.stdin?.end();
});

let found: Promise<string | null> | null = null;

export async function deepseekKey(): Promise<{ key: string; from: 'saved' | 'env' } | null> {
  const saved = getProviderKey('deepseek');
  if (saved) return { key: saved, from: 'saved' };
  // Windows apps inherit the user's variables, so the shell is only needed on macOS.
  found ??= Promise.resolve(process.env[DEEPSEEK_ENV]?.trim() || null).then(k => k ?? (WIN ? null : fromShell()));
  const key = await found;
  return key ? { key, from: 'env' } : null;
}

export const forgetDeepseek = (): void => { found = null; };
