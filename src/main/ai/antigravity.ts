import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { agyOk, setAgyOk } from '../config';
import { cliEnv, cliFinder, lastLine, launcher, runCli } from './cli';
import { recordDiag, runFolder, scrubArgs } from './diag';
import { AiError } from './errors';

// Experimental: Google's Antigravity CLI (agy), signed in with the person's Google account (free Individual
// plan or Google AI Pro/Ultra). One headless turn per run: the prompt goes in on stdin as a stream-json user
// event, the answer comes back constrained by --json-schema. Tools that need approval are refused because
// --dangerously-skip-permissions is never passed, and the run starts in an empty folder.
// The headless mode takes text only, so photos are not sent on this provider.

const WIN = process.platform === 'win32';
const CANDIDATES = WIN
  ? [join(homedir(), '.local', 'bin', 'agy.exe'), join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'agy', 'agy.exe')]
  : [join(homedir(), '.local/bin/agy'), '/opt/homebrew/bin/agy', '/usr/local/bin/agy'];

const finder = cliFinder('agy', CANDIDATES);
export const findAgy = finder.find;
export const forgetAgy = finder.forget;

const DROP = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'];
const TIMEOUT_MS = 15 * 60_000;

/** The result fields WA Turbo reads from the JSON / stream-json output. */
interface AgyResult { status?: string; response?: string; structured_output?: unknown; error?: unknown; usage?: { input_tokens?: number; output_tokens?: number; thinking_tokens?: number; cache_read_tokens?: number } }

/** The last output line that carries a result (stream-json prints progress events before it). */
export function parseAgy(stdout: string): AgyResult | null {
  const lines = stdout.trim().split(/\r?\n/).reverse();
  for (const l of lines) {
    if (!l.startsWith('{')) continue;
    try {
      const j = JSON.parse(l) as AgyResult & { result?: AgyResult };
      const r = j.result && typeof j.result === 'object' ? j.result : j;
      if ('structured_output' in r || ('status' in r && ('response' in r || 'error' in r))) return r;
    } catch { /* not JSON */ }
  }
  return null;
}

export function agyError(text: string): AiError {
  if (/authentication required|not signed in|sign ?in|log ?in/i.test(text)) {
    setAgyOk(false);
    return new AiError('Antigravity is signed out. Open Terminal, run agy, sign in with Google, then press Check again in Settings.', 'no_key');
  }
  if (/quota|exhausted|rate.?limit|429|spend cap/i.test(text)) return new AiError('Your Antigravity quota is used up for now. ' + text, 'rate_limited', Date.now() + 60 * 60_000);
  if (/unknown model|model .*not (found|available)/i.test(text)) return new AiError('Antigravity has no model by that name. Clear the model in Settings to use its default.', 'bad_key');
  return new AiError('Antigravity returned an error: ' + text, 'api');
}

let versionCache: string | null = null;
function agyVersion(bin: string): Promise<string | null> {
  if (versionCache) return Promise.resolve(versionCache);
  return new Promise(resolve => {
    try {
      const l = launcher(bin, 'Antigravity');
      execFile(l.file, [...l.pre, '--version'], { timeout: 10_000, env: cliEnv(DROP, l.asNode), windowsHide: true }, (_e, out) => resolve(versionCache = out.trim() || null));
    } catch { resolve(null); }
  });
}

export async function runAgy(o: { model: string; system: string; text: string; jsonSchema: object; effort: 'low' | 'medium' | 'high'; signal?: AbortSignal }):
  Promise<{ output: unknown; input: number; outTokens: number; cacheRead: number; stop: string | null }> {
  const bin = await findAgy();
  if (!bin) throw new AiError('The Antigravity CLI (agy) is not installed. Install it from antigravity.google, sign in, then press Check again in Settings.', 'no_key');
  const run = runFolder();
  const schemaPath = join(run.dir, 'schema.json');
  writeFileSync(schemaPath, JSON.stringify(o.jsonSchema));
  // The -p text is a placeholder: in stream-json input mode agy reads the prompt from stdin and drops flag prompts.
  const args = ['-p', 'Answer the message on stdin.', '--input-format', 'stream-json', '--output-format', 'stream-json', '--json-schema', schemaPath,
    '--print-timeout', '15m', '--effort', o.effort, ...(o.model ? ['--model', o.model] : [])];
  const stdin = JSON.stringify({ event: 'user', message: { content: o.system + '\n\n' + o.text } }) + '\n';
  try {
    const res = await runCli({ bin, args, product: 'Antigravity', cwd: run.dir, drop: DROP, stdin, signal: o.signal, timeoutMs: TIMEOUT_MS });
    const r = parseAgy(res.stdout);
    const errLine = res.stderr.split(/\r?\n/).find(l => l.includes('AGY_ERROR')) ?? (res.code ? lastLine(res.stderr) : undefined);
    recordDiag('antigravity', { version: await agyVersion(bin), args: scrubArgs(args, []), exit: res.code, error: errLine ?? (r?.error ? JSON.stringify(r.error) : null), usage: r?.usage ?? null,
      notes: [`status: ${r?.status ?? 'no result line'}`, `structured_output: ${r && 'structured_output' in r ? 'present' : 'missing'}`, `stdout lines: ${res.stdout.split('\n').length}`] });
    if (!r || (r.status !== undefined && r.status !== 'SUCCESS')) {
      throw agyError(errLine ?? (r?.error ? JSON.stringify(r.error) : `no answer (exit ${res.code})`));
    }
    setAgyOk(true);
    let output = r.structured_output;
    if (output === undefined && r.response) { try { output = JSON.parse(r.response); } catch { output = undefined; } }
    const u = r.usage ?? {};
    return { output, input: u.input_tokens ?? 0, outTokens: (u.output_tokens ?? 0) + (u.thinking_tokens ?? 0), cacheRead: u.cache_read_tokens ?? 0, stop: r.status ?? null };
  } finally {
    run.done();
  }
}

export interface AgyStatus { installed: boolean; ok: boolean }

/** No status command exists, so "connected" means installed and the last run or check went through. */
export async function agyStatus(): Promise<AgyStatus> {
  const bin = await findAgy();
  return { installed: !!bin, ok: !!bin && agyOk() };
}

/** Settings → Check again: one tiny run that proves the sign-in works (uses one request of the quota). */
export async function checkAgy(model: string): Promise<void> {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  const r = await runAgy({ model, system: 'Reply with {"ok": true} and nothing else.', text: 'ok?', jsonSchema: schema, effort: 'low' });
  if ((r.output as { ok?: boolean } | undefined)?.ok !== true) throw new AiError('Antigravity answered, but not in the shape WA Turbo asked for. Copy diagnostics and share them.', 'invalid_output');
}
