import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cliEnv, cliFinder, lastLine, launcher, runCli } from './cli';
import { recordDiag, runFolder, scrubArgs } from './diag';
import { AiError } from './errors';

// Experimental: OpenAI's Codex CLI, signed in with the person's ChatGPT plan (Plus or higher). One
// `codex exec` turn per run, read-only sandbox, started in an empty folder, nothing saved to Codex's history
// (--ephemeral). The answer is constrained by --output-schema. Codex is a coding agent with a shell; the
// read-only sandbox stops it changing anything, and diagnostics count any command it tried to run.

const WIN = process.platform === 'win32';
const CANDIDATES = WIN
  ? [join(homedir(), '.local', 'bin', 'codex.exe'), join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'codex.cmd')]
  : [join(homedir(), '.local/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex'];

const finder = cliFinder('codex', CANDIDATES);
export const findCodex = finder.find;
export const forgetCodex = finder.forget;

// A key in the environment would make Codex bill that key instead of the ChatGPT plan.
const DROP = ['OPENAI_API_KEY', 'CODEX_API_KEY'];
const TIMEOUT_MS = 15 * 60_000;

export interface CodexEvents { message: string | null; usage: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number } | null; error: string | null; commands: number }

/** Reads `codex exec --json` events: the last agent message, token usage, any failure, and shell commands tried. */
export function parseCodex(stdout: string): CodexEvents {
  const ev: CodexEvents = { message: null, usage: null, error: null, commands: 0 };
  for (const l of stdout.split(/\r?\n/)) {
    if (!l.startsWith('{')) continue;
    let j: { type?: string; item?: { type?: string; item_type?: string; text?: string }; usage?: CodexEvents['usage']; error?: { message?: string } | string; message?: string };
    try { j = JSON.parse(l); } catch { continue; }
    const itemType = j.item?.type ?? j.item?.item_type;
    if (j.type === 'item.completed' && (itemType === 'agent_message' || itemType === 'assistant_message')) ev.message = j.item?.text ?? ev.message;
    if (j.type === 'item.started' && itemType === 'command_execution') ev.commands++;
    if (j.type === 'turn.completed') ev.usage = j.usage ?? null;
    if (j.type === 'turn.failed') ev.error = typeof j.error === 'string' ? j.error : j.error?.message ?? 'turn failed';
    if (j.type === 'error') ev.error = j.message ?? 'error';
  }
  return ev;
}

export function codexError(text: string): AiError {
  if (/not logged in|log ?in|unauthori[sz]ed|401|sign ?in/i.test(text)) return new AiError('Codex is signed out. Open Terminal, run codex login, then press Check again in Settings.', 'no_key');
  if (/usage limit|rate.?limit|429|limit reached/i.test(text)) return new AiError('Your ChatGPT plan is at its Codex usage limit. ' + text, 'rate_limited', Date.now() + 30 * 60_000);
  if (/model .*(not (found|supported|available))|unknown model/i.test(text)) return new AiError('Your ChatGPT plan cannot use that model in Codex. Clear the model in Settings to use its default.', 'bad_key');
  return new AiError('Codex returned an error: ' + text, 'api');
}

const run = (bin: string, args: string[], ms: number): Promise<{ code: number; out: string }> => new Promise(resolve => {
  try {
    const l = launcher(bin, 'Codex');
    execFile(l.file, [...l.pre, ...args], { timeout: ms, env: cliEnv(DROP, l.asNode), windowsHide: true }, (e, out, err) =>
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: (out || err).trim() }));
  } catch { resolve({ code: 1, out: '' }); }
});

let versionCache: string | null = null;

export async function runCodex(o: { model: string; system: string; text: string; images: { mime: string; data: string }[]; jsonSchema: object; effort: 'low' | 'medium' | 'high'; signal?: AbortSignal }):
  Promise<{ output: unknown; input: number; outTokens: number; cacheRead: number; stop: string | null }> {
  const bin = await findCodex();
  if (!bin) throw new AiError('The Codex CLI is not installed. Install it (npm install -g @openai/codex), run codex login, then press Check again in Settings.', 'no_key');
  const f = runFolder();
  const schemaPath = join(f.dir, 'schema.json');
  const lastPath = join(f.dir, 'answer.json');
  writeFileSync(schemaPath, JSON.stringify(o.jsonSchema));
  const photos = o.images.map((im, i) => {
    const p = join(f.dir, `photo-${i + 1}.${im.mime === 'image/png' ? 'png' : im.mime === 'image/webp' ? 'webp' : im.mime === 'image/gif' ? 'gif' : 'jpg'}`);
    writeFileSync(p, Buffer.from(im.data, 'base64'));
    return p;
  });
  // -i takes several comma-separated files; "-" at the very end reads the prompt from stdin.
  const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never',
    ...(photos.length ? ['-i', photos.join(',')] : []), '--output-schema', schemaPath, '-c', `model_reasoning_effort="${o.effort}"`,
    ...(o.model ? ['-m', o.model] : []), '-o', lastPath, '-'];
  const stdin = o.system + '\n\nAnswer only from the messages below. Do not run commands or use tools.\n\n' + o.text;
  try {
    versionCache ??= (await run(bin, ['--version'], 10_000)).out || null;
    const res = await runCli({ bin, args, product: 'Codex', cwd: f.dir, drop: DROP, stdin, signal: o.signal, timeoutMs: TIMEOUT_MS });
    const ev = parseCodex(res.stdout);
    const err = ev.error ?? (res.code ? lastLine(res.stderr) ?? `exit ${res.code}` : null);
    recordDiag('codex', { version: versionCache, args: scrubArgs(args, []), exit: res.code, error: err, usage: ev.usage,
      notes: [`shell commands tried: ${ev.commands}`, `agent message: ${ev.message ? 'present' : 'missing'}`, `photos attached: ${photos.length}`] });
    if (err) throw codexError(err);
    let text = ev.message ?? '';
    try { text = readFileSync(lastPath, 'utf8') || text; } catch { /* -o not written; use the event */ }
    let output: unknown;
    try { output = JSON.parse(text); } catch { output = undefined; }
    const u = ev.usage ?? {};
    return { output, input: u.input_tokens ?? 0, outTokens: u.output_tokens ?? 0, cacheRead: u.cached_input_tokens ?? 0, stop: 'turn.completed' };
  } finally {
    f.done();
  }
}

export interface CodexStatus { installed: boolean; loggedIn: boolean; account: string | null }

/** `codex login status` exits 0 when signed in and says how ("Logged in using ChatGPT"). */
export async function codexStatus(): Promise<CodexStatus> {
  const bin = await findCodex();
  if (!bin) return { installed: false, loggedIn: false, account: null };
  const r = await run(bin, ['login', 'status'], 15_000);
  return { installed: true, loggedIn: r.code === 0, account: r.code === 0 ? r.out.split('\n')[0] || null : null };
}
