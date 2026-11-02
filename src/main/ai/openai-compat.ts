import type { ContentBlock } from './claude-code';
import { AiError } from './errors';
import { nextPacificMidnight } from './schedule';

// Services that speak the OpenAI chat format with a JSON schema: Google's Gemini API (free key from
// aistudio.google.com) and anything the person sets up under "Other (OpenAI-compatible)" (Groq,
// OpenRouter, OpenAI, a local server). One request per run; the key goes only to that service.

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

export interface CompatTarget { kind: 'gemini' | 'openai'; baseUrl: string; key: string | null; model: string }

const trimBase = (u: string): string => u.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');

const name = (t: CompatTarget): string => t.kind === 'gemini' ? 'Gemini' : (() => { try { return new URL(t.baseUrl).host; } catch { return 'The AI service'; } })();

function headers(t: CompatTarget): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(t.key ? { Authorization: 'Bearer ' + t.key } : {}) };
}

/** Error text from an OpenAI- or Google-style error body. */
function errText(body: unknown): string {
  const b = (Array.isArray(body) ? body[0] : body) as { error?: { message?: string; status?: string } | string; message?: string } | undefined;
  if (!b) return '';
  if (typeof b.error === 'string') return b.error;
  return [b.error?.status, b.error?.message ?? b.message].filter(Boolean).join(': ');
}

export function compatError(t: CompatTarget, status: number, body: unknown, retryAfter: string | null, now = Date.now()): AiError {
  const msg = errText(body);
  const who = name(t);
  if (status === 401 || status === 403 || /API[_ ]?key.*(not valid|invalid)|API_KEY_INVALID/i.test(msg)) {
    return new AiError(t.kind === 'gemini' ? 'Google rejected that key. Make a new one at aistudio.google.com → Get API key.' : `${who} rejected that key.`, 'bad_key');
  }
  if (status === 404) return new AiError(`${who} has no model called ${t.model}. Check the model name in Settings.`, 'bad_key');
  if (status === 429) {
    const daily = /per ?day|PerDay|daily/i.test(msg);
    const wait = Number(retryAfter);
    const retryAt = daily ? (t.kind === 'gemini' ? nextPacificMidnight(now) : now + 60 * 60_000) : now + (Number.isFinite(wait) && wait > 0 ? wait * 1000 : 60_000);
    return new AiError(daily ? `The free daily quota for ${t.model} is used up. It resets ${t.kind === 'gemini' ? 'at midnight Pacific time' : 'later'}.` : `${who} is rate-limiting this key. Try again in a minute.`, 'rate_limited', retryAt);
  }
  return new AiError(`${who} returned an error (${status})${msg ? ': ' + msg : ''}`, 'api');
}

/** The request body: system prompt, then the photos (each after its label) and the transcript. */
export function compatBody(t: CompatTarget, system: string, content: ContentBlock[], schema: object, effort: 'low' | 'medium' | 'high'): object {
  const parts = content.map(b => b.type === 'text'
    ? { type: 'text', text: b.text }
    : { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
  return {
    model: t.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: parts }],
    response_format: { type: 'json_schema', json_schema: { name: 'wa_turbo', schema, strict: false } },
    temperature: 0.2,
    // Gemini thinks before answering unless told otherwise; low keeps the free quota's tokens for the answer.
    ...(t.kind === 'gemini' ? { reasoning_effort: effort } : {}),
  };
}

export async function compatChat(t: CompatTarget, system: string, content: ContentBlock[], schema: object, effort: 'low' | 'medium' | 'high', signal?: AbortSignal):
  Promise<{ text: string; input: number; output: number; cacheRead: number; stop: string | null }> {
  let r: Response;
  try {
    r = await fetch(trimBase(t.baseUrl) + '/chat/completions', {
      method: 'POST', headers: headers(t), body: JSON.stringify(compatBody(t, system, content, schema, effort)), signal: signal ?? AbortSignal.timeout(10 * 60_000),
    });
  } catch {
    if (signal?.aborted) throw new AiError('Cancelled.', 'cancelled');
    throw new AiError(`Could not reach ${name(t)}. Check your internet connection.`, 'offline');
  }
  const body = (await r.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  } | null;
  if (!r.ok) throw compatError(t, r.status, body, r.headers.get('retry-after'));
  const c = body?.choices?.[0];
  if (c?.message?.refusal) throw new AiError(`${name(t)} declined this request. Try a different selection of messages.`, 'refused');
  if (c?.finish_reason === 'length') throw new AiError('The answer was cut off. Pick fewer chats or a shorter window.', 'invalid_output');
  const u = body?.usage;
  return { text: c?.message?.content ?? '', input: u?.prompt_tokens ?? 0, output: u?.completion_tokens ?? 0, cacheRead: u?.prompt_tokens_details?.cached_tokens ?? 0, stop: c?.finish_reason ?? null };
}

/** Checks the key without spending a request of the free quota: lists the service's models. */
export async function compatTest(t: CompatTarget): Promise<void> {
  let r: Response;
  try {
    r = await fetch(trimBase(t.baseUrl) + '/models', { headers: headers(t), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AiError(`Could not reach ${name(t)}. Check the address and your internet connection.`, 'offline');
  }
  if (r.status === 404 && t.kind === 'openai') {
    // Some servers have no model list; one tiny request tells us the address and key work.
    const s = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
    await compatChat(t, 'Answer with {"ok": true}.', [{ type: 'text', text: 'ok?' }], s, 'low');
    return;
  }
  const body = (await r.json().catch(() => null)) as { data?: { id: string }[] } | null;
  if (!r.ok) throw compatError(t, r.status, body, r.headers.get('retry-after'));
  const ids = (body?.data ?? []).map(m => m.id.replace(/^models\//, ''));
  // Google's "-latest" aliases point at whichever model is current and aren't in the list themselves.
  const alias = t.kind === 'gemini' && /-latest$/.test(t.model);
  if (t.model && ids.length && !alias && !ids.includes(t.model)) throw new AiError(`The key works, but ${name(t)} has no model called ${t.model}. Check the model name.`, 'bad_key');
}
