import { AiError } from './errors';

// A model the person already runs on this computer with Ollama (ollama.com), such as Qwen or Gemma.
// WA Turbo ships no engine and downloads nothing: it looks for Ollama on 127.0.0.1:11434, lists the
// models installed there, and sends summaries to the one picked in Settings. Nothing leaves the computer.

const BASE = 'http://127.0.0.1:11434';

export interface LocalFound { running: boolean; models: string[]; version: string | null }

/** A context window that fits the prompt: about 3 characters a token, 1,000 tokens a photo, room for the answer. */
export function contextFor(chars: number, images: number): number {
  const want = Math.ceil(chars / 3) + images * 1000 + 6000;
  return Math.min(32768, Math.max(8192, 2 ** Math.ceil(Math.log2(want))));
}

class LocalModels {
  private caps = new Map<string, string[]>();

  /** Is Ollama running here, and which models does it have? Never throws. */
  async detect(): Promise<LocalFound> {
    try {
      const v = await fetch(BASE + '/api/version', { signal: AbortSignal.timeout(1500) });
      if (!v.ok) return { running: false, models: [], version: null };
      const version = ((await v.json()) as { version?: string }).version ?? null;
      const t = await fetch(BASE + '/api/tags', { signal: AbortSignal.timeout(5000) });
      const models = (((await t.json()) as { models?: { name: string }[] }).models ?? []).map(m => m.name);
      return { running: true, models, version };
    } catch {
      return { running: false, models: [], version: null };
    }
  }

  /** What a model can do ("vision", "thinking", …). */
  private async capabilities(model: string): Promise<string[]> {
    const hit = this.caps.get(model);
    if (hit) return hit;
    let r: Response;
    try {
      r = await fetch(BASE + '/api/show', { method: 'POST', body: JSON.stringify({ model }), signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new AiError('Ollama is not running on this computer. Open the Ollama app, then check again in Settings → AI connection.', 'no_key');
    }
    if (r.status === 404) throw new AiError(`${model} is not installed in Ollama any more. Pick another model in Settings → AI connection.`, 'no_key');
    const caps = ((await r.json()) as { capabilities?: string[] }).capabilities ?? [];
    this.caps.set(model, caps);
    return caps;
  }

  /** One answer constrained to `schema`. Photos go only to models that can see them. */
  async chat(o: { model: string; system: string; text: string; images: string[]; schema: object; signal?: AbortSignal }): Promise<{ text: string; input: number; output: number; stop: string | null }> {
    const caps = await this.capabilities(o.model);
    const images = caps.includes('vision') ? o.images : [];
    const body = {
      model: o.model, stream: false, format: o.schema, keep_alive: '10m',
      ...(caps.includes('thinking') ? { think: false } : {}),
      options: { temperature: 0.2, num_ctx: contextFor(o.system.length + o.text.length, images.length) },
      messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.text, ...(images.length ? { images } : {}) }],
    };
    let r: Response;
    try {
      r = await fetch(BASE + '/api/chat', { method: 'POST', body: JSON.stringify(body), signal: o.signal ?? AbortSignal.timeout(15 * 60_000) });
    } catch {
      if (o.signal?.aborted) throw new AiError('Cancelled.', 'cancelled');
      throw new AiError('Ollama stopped answering. Make sure the Ollama app is open, then check again in Settings → AI connection.', 'no_key');
    }
    const j = (await r.json().catch(() => ({}))) as { error?: string; message?: { content?: string }; done_reason?: string; prompt_eval_count?: number; eval_count?: number };
    if (!r.ok || j.error) {
      if (/memory|resources/i.test(j.error ?? '')) throw new AiError(`This computer doesn't have enough free memory for ${o.model}. Close some apps or pick a smaller model in Settings.`, 'api');
      throw new AiError('Ollama returned an error: ' + (j.error ?? r.status), 'api');
    }
    return { text: j.message?.content ?? '', input: j.prompt_eval_count ?? 0, output: j.eval_count ?? 0, stop: j.done_reason ?? null };
  }
}

export const localModels = new LocalModels();
