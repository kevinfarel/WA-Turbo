import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { ModelId } from '@shared/types';
import { getApiKey } from '../config';
import { getSettings, logRun } from '../db/queries';
import { runClaudeCode, type ContentBlock } from './claude-code';
import { AiError } from './errors';

export { AiError };

export const MODEL_NAMES: Record<ModelId, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

// Haiku 5.5 has no server-side fallback; Opus and Sonnet retry a refused request on another model.
const HAS_FALLBACK: Record<ModelId, boolean> = { 'claude-opus-5-5': true, 'claude-sonnet-5-5': true, 'claude-haiku-5-5': false };

let cached: { key: string; client: Anthropic } | null = null;

function client(key = getApiKey()): Anthropic {
  if (!key) throw new AiError('Claude is not connected. Add your API key in AI setup.', 'no_key');
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

const refusedMessage = (model: ModelId): string => HAS_FALLBACK[model]
  ? 'Claude declined this request. Try a different selection of messages.'
  : 'Claude Haiku 5.5 declined this request. Run it again on Sonnet 5.5 from Settings.';

/** One structured Claude call: zod-validated output, refusal check, usage logged. Goes through
 *  Claude Code (the signed-in plan) or the API key, whichever AI setup has selected. */
export async function structured<S extends z.ZodType>(c: StructuredCall<S>): Promise<z.infer<S>> {
  const { provider } = await getSettings();
  return provider === 'api' ? viaApi(c) : viaClaudeCode(c);
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
    return new AiError('Claude Code is signed out. Open Terminal, run claude, type /login, then check again in AI setup.', 'no_key');
  }
  if (status === 429 || /usage limit|limit reached|rate limit/i.test(msg)) return new AiError('Your Claude plan is at its usage limit. ' + msg, 'rate_limited');
  if (status === 404 || status === 403) return new AiError(`Your Claude plan can't use ${MODEL_NAMES[model]} in Claude Code. Pick another model in AI setup.`, 'bad_key');
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
        ...(HAS_FALLBACK[c.model] ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
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
