import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { AiError } from './errors';

// Finding and starting the AI command-line tools WA Turbo can run (Claude Code, Codex, Antigravity).
// Each run is one headless turn the CLI answers and exits; WA Turbo never passes flags that let it act.

const WIN = process.platform === 'win32';

/** The installers' default folders, for apps started from Finder or the Start menu without the shell's PATH. */
export function defaultDirs(): string[] {
  return WIN
    ? [join(homedir(), '.local', 'bin'), join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm'),
        join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs')]
    : [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
}

/**
 * Looks a CLI up once and remembers it: a login shell first (macOS apps opened from Finder don't get the shell's PATH),
 * `where` on Windows, then `candidates`. On Windows the .exe beats an npm .cmd shim, and the extensionless bash shim
 * npm puts beside it is skipped because Windows can't start it.
 */
export function cliFinder(name: string, candidates: string[]): { find: () => Promise<string | null>; forget: () => void } {
  let found: Promise<string | null> | null = null;
  return {
    find: () => {
      found ??= new Promise<string | null>(resolve => {
        const [cmd, args]: [string, string[]] = WIN ? ['where.exe', [name]] : ['/bin/zsh', ['-lc', 'command -v ' + name]];
        execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, out) => {
          const fromShell = err ? [] : out.trim().split(/\r?\n/);
          if (WIN) fromShell.sort((a, b) => Number(/\.exe$/i.test(b)) - Number(/\.exe$/i.test(a)));
          const runnable = (p: string) => isAbsolute(p) && (!WIN || /\.(exe|cmd)$/i.test(p)) && existsSync(p);
          resolve([...(WIN ? fromShell : fromShell.slice(-1)), ...candidates].find(runnable) ?? null);
        });
      });
      return found;
    },
    forget: () => { found = null; },
  };
}

/**
 * How to start a CLI. A Windows .cmd shim can only run through cmd.exe, which would re-parse the JSON schema
 * and prompt arguments, so the shim's own target is started instead: a .exe directly, a .js with
 * Electron running as Node.
 */
export function launcher(bin: string, product = 'This tool'): { file: string; pre: string[]; asNode: boolean } {
  if (!/\.cmd$/i.test(bin)) return { file: bin, pre: [], asNode: false };
  const targets = [...readFileSync(bin, 'utf8').matchAll(/"%(?:~dp0|dp0)%\\([^"]+\.(?:js|exe))"/gi)].map(m => join(dirname(bin), m[1]));
  const target = targets.find(t => existsSync(t));
  if (!target) throw new AiError(product + ' was installed in a way WA Turbo cannot start. Reinstall it with its installer, then check again in Settings.', 'no_key');
  return /\.exe$/i.test(target) ? { file: target, pre: [], asNode: false } : { file: process.execPath, pre: [target], asNode: true };
}

/** The app's environment minus `drop`, with the installers' folders on PATH. */
export function cliEnv(drop: string[], asNode = false): NodeJS.ProcessEnv {
  const e = { ...process.env };
  for (const k of [...drop, 'ELECTRON_RUN_AS_NODE']) delete e[k];
  e.PATH = [e.PATH ?? e.Path, ...defaultDirs()].filter(Boolean).join(delimiter);
  if (asNode) e.ELECTRON_RUN_AS_NODE = '1';
  return e;
}

export interface CliResult { code: number | null; stdout: string; stderr: string }

/** Runs a CLI to the end, feeding `stdin`. Rejects only when it could not start, was cancelled or timed out. */
export function runCli(o: {
  bin: string; args: string[]; product: string; cwd: string; drop: string[]; stdin?: string; signal?: AbortSignal; timeoutMs: number;
}): Promise<CliResult> {
  const l = launcher(o.bin, o.product);
  if (o.signal?.aborted) return Promise.reject(new AiError('Cancelled.', 'cancelled'));
  return new Promise((resolve, reject) => {
    const child = spawn(l.file, [...l.pre, ...o.args], { cwd: o.cwd, env: cliEnv(o.drop, l.asNode), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', ended: AiError | null = null;
    const stop = (err: AiError) => { ended = err; child.kill('SIGTERM'); };
    const onAbort = () => stop(new AiError('Cancelled.', 'cancelled'));
    const timer = setTimeout(() => stop(new AiError(`${o.product} took longer than ${Math.round(o.timeoutMs / 60_000)} minutes. Pick fewer chats or a shorter window.`, 'api')), o.timeoutMs);
    o.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', e => { ended ??= new AiError(`Could not start ${o.product}: ${e.message}`, 'api'); });
    child.on('close', code => {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      if (ended) reject(ended);
      else resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {}); // the CLI can exit before reading everything; 'close' reports why
    child.stdin.end(o.stdin ?? '');
  });
}

/** The last stderr line worth showing, without the CLI's own debug prefixes. */
export const lastLine = (s: string): string | undefined =>
  s.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^\[[\w-]+:/.test(l)).pop();
