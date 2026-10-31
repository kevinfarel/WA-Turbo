import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { dataDir, HERE } from '../config';
import { AiError } from './errors';

// Reaches Claude through the Claude Code CLI signed in on this computer, so runs count against the
// person's Claude plan instead of separately billed API credits. Each run is one headless turn
// with every tool switched off and no settings, hooks, plugins, MCP servers or CLAUDE.md loaded:
// the CLI can only read the prompt and answer. Nothing is saved to Claude Code's session history.

const WIN = process.platform === 'win32';

const CANDIDATES = WIN
  ? [
      join(homedir(), '.local', 'bin', 'claude.exe'), // the native installer (install.ps1)
      join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'claude.cmd'),
    ]
  : [
      join(homedir(), '.local/bin/claude'),
      join(homedir(), '.claude/local/claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ];

let found: Promise<string | null> | null = null;

/**
 * Path of the `claude` binary. Apps opened from Finder don't get the shell's PATH, so ask a login shell first;
 * on Windows ask `where`. Then the installers' default folders: on Windows a PATH change made after you
 * signed in doesn't reach apps started from the Start menu.
 */
export function findClaude(): Promise<string | null> {
  found ??= new Promise<string | null>(resolve => {
    const [cmd, args]: [string, string[]] = WIN ? ['where.exe', ['claude']] : ['/bin/zsh', ['-lc', 'command -v claude']];
    execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, out) => {
      const fromShell = err ? [] : out.trim().split(/\r?\n/);
      // `where` lists every match; the .exe beats an npm .cmd shim.
      if (WIN) fromShell.sort((a, b) => Number(/\.exe$/i.test(b)) - Number(/\.exe$/i.test(a)));
      // npm also puts an extensionless bash shim next to claude.cmd; Windows can't start that one.
      const runnable = (p: string) => isAbsolute(p) && (!WIN || /\.(exe|cmd)$/i.test(p)) && existsSync(p);
      resolve([...(WIN ? fromShell : fromShell.slice(-1)), ...CANDIDATES].find(runnable) ?? null);
    });
  });
  return found;
}

/**
 * How to start the CLI. A Windows .cmd shim can only run through cmd.exe, which would re-parse the JSON schema
 * and system prompt arguments, so the shim's own target is started instead: a .exe directly, a .js with
 * Electron running as Node.
 */
export function launcher(bin: string): { file: string; pre: string[]; asNode: boolean } {
  if (!/\.cmd$/i.test(bin)) return { file: bin, pre: [], asNode: false };
  const targets = [...readFileSync(bin, 'utf8').matchAll(/"%(?:~dp0|dp0)%\\([^"]+\.(?:js|exe))"/gi)].map(m => join(dirname(bin), m[1]));
  const target = targets.find(t => existsSync(t));
  if (!target) throw new AiError('Claude Code was installed in a way WA Turbo cannot start. Reinstall it with the installer from claude.ai, then check again in Settings.', 'no_key');
  return /\.exe$/i.test(target) ? { file: target, pre: [], asNode: false } : { file: process.execPath, pre: [target], asNode: true };
}

export const forgetClaude = (): void => { found = null; };

function cliEnv(): NodeJS.ProcessEnv {
  const e = { ...process.env };
  // An API key in the environment would make the CLI bill that key instead of the signed-in plan.
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ELECTRON_RUN_AS_NODE']) delete e[k];
  const extra = WIN ? [join(homedir(), '.local', 'bin')] : ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin')];
  e.PATH = [e.PATH ?? e.Path, ...extra].filter(Boolean).join(delimiter);
  return e;
}

export interface ClaudeCodeStatus { installed: boolean; loggedIn: boolean; account: string | null }

export async function claudeCodeStatus(): Promise<ClaudeCodeStatus> {
  const bin = await findClaude();
  if (!bin) return { installed: false, loggedIn: false, account: null };
  const out = await new Promise<string>(resolve => {
    // Exits non-zero when signed out but still prints the JSON.
    let l: ReturnType<typeof launcher>;
    try { l = launcher(bin); } catch { resolve(''); return; }
    const env = { ...cliEnv(), ...(l.asNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
    execFile(l.file, [...l.pre, 'auth', 'status'], { timeout: 15000, env, windowsHide: true }, (_err, stdout) => resolve(stdout));
  });
  try {
    const j = JSON.parse(out) as { loggedIn?: boolean; email?: string; subscriptionType?: string };
    const plan = j.subscriptionType ? j.subscriptionType[0].toUpperCase() + j.subscriptionType.slice(1) : null;
    return { installed: true, loggedIn: !!j.loggedIn, account: [j.email, plan].filter(Boolean).join(' · ') || null };
  } catch {
    return { installed: true, loggedIn: false, account: null };
  }
}

/** The CLI's final `result` event, only the fields WA Turbo reads. */
export interface ClaudeCodeResult {
  is_error: boolean;
  subtype: string;
  stop_reason: string | null;
  api_error_status: number | null;
  result?: string;
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

const TIMEOUT_MS = 15 * 60_000;

/** Message content in the Messages API shape: text blocks and base64 images. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string } };

export async function runClaudeCode(o: {
  model: string; system: string; content: ContentBlock[]; jsonSchema: object; effort: 'low' | 'medium' | 'high'; signal?: AbortSignal;
}): Promise<ClaudeCodeResult> {
  const bin = await findClaude();
  if (!bin) throw new AiError('Claude Code is not installed on ' + HERE + '. Install it, sign in, then check again in Settings.', 'no_key');
  const l = launcher(bin);
  if (o.signal?.aborted) throw new AiError('Cancelled.', 'cancelled');
  const cwd = join(dataDir(), 'claude-code');
  mkdirSync(cwd, { recursive: true });
  const args = [
    // stream-json carries image blocks; one user message in, the result event out.
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', o.model, '--effort', o.effort,
    '--tools', '', '--safe-mode', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence',
    '--system-prompt', o.system, '--json-schema', JSON.stringify(o.jsonSchema),
  ];

  return new Promise<ClaudeCodeResult>((resolve, reject) => {
    const env = { ...cliEnv(), ...(l.asNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
    const child = spawn(l.file, [...l.pre, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', ended: AiError | null = null;
    const stop = (err: AiError) => { ended = err; child.kill('SIGTERM'); };
    const onAbort = () => stop(new AiError('Cancelled.', 'cancelled'));
    const timer = setTimeout(() => stop(new AiError('Claude Code took longer than 15 minutes. Pick fewer chats or a shorter window.', 'api')), TIMEOUT_MS);
    o.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', e => { ended ??= new AiError('Could not start Claude Code: ' + e.message, 'api'); });
    child.on('close', code => {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      if (ended) return reject(ended);
      const line = stdout.trim().split(/\r?\n/).reverse().find(l => l.startsWith('{') && l.includes('"type":"result"'));
      try {
        if (line) return resolve(JSON.parse(line) as ClaudeCodeResult);
      } catch { /* fall through */ }
      const why = stderr.trim().split('\n').filter(l => !l.startsWith('[claude-code:')).pop();
      reject(new AiError('Claude Code stopped without an answer' + (why ? ': ' + why : ` (exit ${code}).`), 'api'));
    });
    child.stdin.on('error', () => {}); // the CLI can exit before reading everything; 'close' reports why
    child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content: o.content } }) + '\n');
  });
}
