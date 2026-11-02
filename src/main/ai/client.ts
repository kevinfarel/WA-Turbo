import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { modelLabel, splitModel } from '@shared/ai';
import type { AiProvider, ModelId, Settings } from '@shared/types';
import { getApiKey, getProviderKey } from '../config';
import { getSettings, logRun } from '../db/queries';
import { runAgy } from './antigravity';
import { runClaudeCode, type ContentBlock } from './claude-code';
import { runCodex } from './codex';
import { AiError } from './errors';
import { localModels } from './local';
import { compatChat, GEMINI_BASE } from './openai-compat';

export { AiError };

// Haiku 5.5 has no server-side fallback; Opus and Sonnet retry a refused request on another model.
const hasFallback = (model: ModelId): boolean => model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5';

let cached: { key: string; client: Anthropic } | null = null;

function client(key = getApiKey()): Anthropic {
  if (!key) throw new AiError('Claude is not connected. Add your API key in Settings → AI connection.', 'no_key');
  if (cached?.key !== key) cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 2 }) };
  return cached.client;
}

export const resetClient = (): void => { cached = null; };

export async function testKey(key: string, model: ModelId): Promise<void> {
  try {
    await client(key).models.retrieve(model);
  } catch (e) {
    throw mapError(e);
  }
}

function mapError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new AiError('Cancelled.', 'cancelled');
  if (e instanceof Anthropic.AuthenticationError) return new AiError('Anthropic rejected that key. Check it in console.anthropic.com → API keys.', 'bad_key');
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError('This key has no access to that model. Pick another model or check the key.', 'bad_key');
  if (e instanceof Anthropic.RateLimitError) return new AiError('Anthropic is rate-limiting this key. Try again in a minute.', 'rate_limited');
  if (e instanceof Anthropic.APIConnectionError) return new AiError('Could not reach Anthropic. Check your internet connection.', 'offline');
  if (e instanceof Anthropic.APIError) return new AiError(`Anthropic returned an error (${e.status ?? 'unknown'}): ${e.message}`, 'api');
  return new AiError(e instanceof Error ? e.message : String(e), 'api');
}

export interface AiImage { label: string; mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }

function contentOf(c: { user: string; images?: AiImage[] }): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const i of c.images ?? []) {
    blocks.push({ type: 'text', text: i.label }, { type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } });
  }
  blocks.push({ type: 'text', text: c.user });
  return blocks;
}

export interface StructuredCall<S extends z.ZodType> {
  kind: string;
  model: ModelId;
  system: string;
  user: string;
  /** Photos from the chat, each labelled with its message id. Sent before the transcript. */
  images?: AiImage[];
  schema: S;
  effort: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  /** The chat this call reads, so usage can be counted per number. */
  chatId?: string;
}

const refusedMessage = (model: ModelId): string => hasFallback(model)
  ? 'Claude declined this request. Try a different selection of messages.'
  : 'Claude Haiku 5.5 declined this request. Run it again on Sonnet 5.5 from Settings.';

/** One structured AI call: zod-validated output, refusal check, usage logged. Goes through whichever
 *  provider Settings has selected: Claude Code, the Anthropic key, or one of the others (viaOther). */
export async function structured<S extends z.ZodType>(c: StructuredCall<S>): Promise<z.infer<S>> {
  const s = await getSettings();
  if (s.provider === 'api') return viaApi(c);
  if (s.provider === 'claude-code') return viaClaudeCode(c);
  return viaOther(c, s);
}

/** What each of the other providers hands back: the parsed answer (or undefined) and its token counts. */
interface OtherOut { output: unknown; input: number; outTokens: number; cacheRead: number; stop: string | null }

const PROVIDER_NAME: Record<Exclude<AiProvider, 'claude-code' | 'api'>, string> = {
  local: 'The local model', gemini: 'Gemini', openai: 'The AI service', antigravity: 'Antigravity', codex: 'Codex',
};

/** Photo labels written into the text, for providers that take the photos as a separate list. */
function photoNote(images: AiImage[]): string {
  return images.length ? 'Photos attached, in this order: ' + images.map(i => i.label.replace(/^Photo /, '')).join(', ') + '\n\n' : '';
}

async function runOther(c: StructuredCall<z.ZodType>, s: Settings, jsonSchema: object): Promise<OtherOut> {
  const model = splitModel(c.model).name;
  switch (s.provider) {
    case 'local': {
      const r = await localModels.chat({ model, system: c.system, text: photoNote(c.images ?? []) + c.user, images: (c.images ?? []).map(i => i.data), schema: jsonSchema, signal: c.signal });
      let output: unknown;
      try { output = JSON.parse(r.text); } catch { output = undefined; }
      if (r.stop === 'length') throw new AiError('The answer was cut off. Pick fewer chats or a shorter window.', 'invalid_output');
      return { output, input: r.input, outTokens: r.output, cacheRead: 0, stop: r.stop };
    }
    case 'gemini': case 'openai': {
      const gemini = s.provider === 'gemini';
      const key = getProviderKey(s.provider);
      if (gemini && !key) throw new AiError('Gemini is not connected. Add your free key in Settings → AI connection.', 'no_key');
      const r = await compatChat({ kind: s.provider, baseUrl: gemini ? GEMINI_BASE : s.openaiBaseUrl, key, model }, c.system, contentOf(c), jsonSchema, c.effort, c.signal);
      let output: unknown;
      try { output = JSON.parse(r.text); } catch { output = undefined; }
      return { output, input: r.input, outTokens: r.output, cacheRead: r.cacheRead, stop: r.stop };
    }
    case 'antigravity':
      return runAgy({ model, system: c.system, text: c.user, jsonSchema, effort: c.effort, signal: c.signal });
    case 'codex':
      return runCodex({ model, system: c.system, text: photoNote(c.images ?? []) + c.user, images: (c.images ?? []).map(i => ({ mime: i.mime, data: i.data })), jsonSchema, effort: c.effort, signal: c.signal });
    default:
      throw new AiError('Pick an AI connection in Settings.', 'no_key');
  }
}

async function viaOther<S extends z.ZodType>(c: StructuredCall<S>, s: Settings): Promise<z.infer<S>> {
  const who = PROVIDER_NAME[s.provider as keyof typeof PROVIDER_NAME] ?? 'The AI';
  const jsonSchema = cliSchema(c.schema);
  // Small local models now and then miss a field; one more try usually fixes it.
  const tries = s.provider === 'local' ? 2 : 1;
  for (let i = 1; ; i++) {
    const started = Date.now();
    try {
      const r = await runOther(c, s, jsonSchema);
      const out = c.schema.safeParse(r.output);
      void logRun({ kind: c.kind, model: c.model, chatId: c.chatId, input: r.input, output: r.outTokens, cacheRead: r.cacheRead, stop: r.stop, ms: Date.now() - started,
        error: out.success ? undefined : 'invalid output' }).catch(() => {});
      if (out.success) return out.data as z.infer<S>;
      if (i >= tries) throw new AiError(who + ' returned something WA Turbo could not read. Run it again' + (s.provider === 'local' ? ', or pick a bigger model in Settings.' : '.'), 'invalid_output');
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError(e instanceof Error ? e.message : String(e), 'api');
      if (err.code !== 'invalid_output' || !/could not read/.test(err.message)) void logRun({ kind: c.kind, model: c.model, chatId: c.chatId, ms: Date.now() - started, error: err.message }).catch(() => {});
      throw err;
    }
  }
}

async function viaClaudeCode<S extends z.ZodType>(c: StructuredCall<S>): Promise<z.infer<S>> {
  const started = Date.now();
  let logged = false;
  try {
    const res = await runClaudeCode({ model: c.model, system: c.system, content: contentOf(c), jsonSchema: cliSchema(c.schema), effort: c.effort, signal: c.signal });
    const u = res.usage;
    logged = true;
    void logRun({
      kind: c.kind, model: c.model, chatId: c.chatId, input: u?.input_tokens, output: u?.output_tokens, cacheRead: u?.cache_read_input_tokens,
      cacheWrite: u?.cache_creation_input_tokens, stop: res.stop_reason, ms: Date.now() - started, error: res.is_error ? res.result : undefined,
    }).catch(() => {});
    if (res.is_error) throw cliError(res.api_error_status, res.result ?? '', c.model);
    if (res.stop_reason === 'refusal') throw new AiError(refusedMessage(c.model), 'refused');
    if (res.subtype !== 'success') throw new AiError('Claude returned something WA Turbo could not read. Run it again.', 'invalid_output');
    const out = c.schema.safeParse(res.structured_output);
    if (!out.success) throw new AiError('Claude returned something WA Turbo could not read. Run it again.', 'invalid_output');
    return out.data as z.infer<S>;
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError(e instanceof Error ? e.message : String(e), 'api');
    if (!logged) void logRun({ kind: c.kind, model: c.model, chatId: c.chatId, ms: Date.now() - started, error: err.message }).catch(() => {});
    throw err;
  }
}

/** The CLI's validator doesn't know zod's draft 2020-12 `$schema` URI; the keywords themselves are plain. */
function cliSchema(schema: z.ZodType): object {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

function cliError(status: number | null, msg: string, model: ModelId): AiError {
  if (status === 401 || /\/login|not logged in|log ?in again|invalid api key|oauth/i.test(msg)) {
    return new AiError('Claude Code is signed out. Open Terminal, run claude, type /login, then check again in Settings.', 'no_key');
  }
  if (status === 429 || /usage limit|limit reached|rate limit/i.test(msg)) return new AiError('Your Claude plan is at its usage limit. ' + msg, 'rate_limited');
  if (status === 404 || status === 403) return new AiError(`Your Claude plan can't use ${modelLabel(model)} in Claude Code. Pick another model in Settings.`, 'bad_key');
  if (status === null && /connect|network|ENOTFOUND|ECONNREFUSED|offline/i.test(msg)) return new AiError('Could not reach Anthropic. Check your internet connection.', 'offline');
  return new AiError('Claude Code returned an error' + (status ? ` (${status})` : '') + ': ' + msg, 'api');
}

async function viaApi<S extends z.ZodType>(c: StructuredCall<S>): Promise<z.infer<S>> {
  const started = Date.now();
  try {
    const res = await client().beta.messages.parse(
      {
        model: c.model,
        max_tokens: 16000,
        system: [{ type: 'text', text: c.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: contentOf(c) }],
        output_config: { format: betaZodOutputFormat(c.schema), effort: c.effort },
        ...(hasFallback(c.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal: c.signal },
    );
    const u = res.usage;
    void logRun({
      kind: c.kind, model: c.model, chatId: c.chatId, input: u?.input_tokens, output: u?.output_tokens, cacheRead: u?.cache_read_input_tokens ?? undefined,
      cacheWrite: u?.cache_creation_input_tokens ?? undefined, stop: res.stop_reason, ms: Date.now() - started,
    }).catch(() => {});
    if (res.stop_reason === 'refusal') {
      throw new AiError(refusedMessage(c.model), 'refused');
    }
    if (res.stop_reason === 'max_tokens') throw new AiError('The answer was cut off. Pick fewer chats or a shorter window.', 'invalid_output');
    const out = res.parsed_output as z.infer<S> | null;
    if (!out) throw new AiError('Claude returned something WA Turbo could not read. Run it again.', 'invalid_output');
    return out;
  } catch (e) {
    const err = mapError(e);
    if (err.code !== 'refused' && err.code !== 'invalid_output') {
      void logRun({ kind: c.kind, model: c.model, chatId: c.chatId, ms: Date.now() - started, error: err.message }).catch(() => {});
    }
    throw err;
  }
}
