import type { AiProvider, ClaudeModel, ModelId, Settings } from './types';

// The AI providers WA Turbo can use, shared by the window and the main process. A model id is the
// Claude model name for the two Claude providers, and "<provider>:<model>" for the others, so the
// summary cache and the usage log tell runs on different providers apart without another column.

export interface ProviderInfo {
  id: AiProvider;
  name: string;
  /** Free routes: auto summary is capped at FREE_CAP chats per FREE_WINDOW_MS on these. */
  free: boolean;
  /** Free routes with a daily quota: auto summary also stops at Settings.autoDailyBudget runs a day. */
  quota: boolean;
  /** Shipped untested by us, for others to try (no test login here). */
  experimental: boolean;
}

export const PROVIDERS: Record<AiProvider, ProviderInfo> = {
  'claude-code': { id: 'claude-code', name: 'Claude Code', free: false, quota: false, experimental: false },
  api: { id: 'api', name: 'Anthropic API key', free: false, quota: false, experimental: false },
  local: { id: 'local', name: 'Local model', free: true, quota: false, experimental: false },
  gemini: { id: 'gemini', name: 'Gemini free key', free: true, quota: true, experimental: false },
  openai: { id: 'openai', name: 'OpenAI-compatible', free: false, quota: false, experimental: false },
  antigravity: { id: 'antigravity', name: 'Google (Antigravity)', free: true, quota: true, experimental: true },
  codex: { id: 'codex', name: 'ChatGPT (Codex)', free: false, quota: false, experimental: true },
};

export const isClaude = (p: AiProvider): boolean => p === 'claude-code' || p === 'api';

/** Auto summary on free providers: at most this many chats in any 10 minutes. */
export const FREE_CAP = 10;
export const FREE_WINDOW_MS = 10 * 60_000;

export const CLAUDE_MODELS: Record<ClaudeModel, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

/** Families that read chats well and can see photos, best first: the one WA Turbo picks when several are installed. */
const LOCAL_PREFERRED = [/^qwen3\.5/, /^gemma4/, /^qwen3-vl/, /^gemma3n?/, /^qwen3/, /^llama4/, /^mistral-small/, /^qwen2\.5vl/, /^llama3\.2-vision/];

/** Embedding and other non-chat models Ollama may list, which can't summarize. */
const NOT_CHAT = /embed|minilm|bge-|nomic|rerank|whisper/i;

/** The local model to use when the person hasn't picked one: a preferred family, else any chat model. */
export function pickLocal(models: string[]): string | null {
  const chat = models.filter(m => !NOT_CHAT.test(m));
  for (const re of LOCAL_PREFERRED) { const hit = chat.find(m => re.test(m)); if (hit) return hit; }
  return chat[0] ?? null;
}

export const DEFAULT_MODELS = { gemini: 'gemini-flash-latest', openai: '', antigravity: '', codex: '' } as const;

/** The model this provider runs, as the id stored with summaries, reports and usage. */
export function activeModel(s: Pick<Settings, 'provider' | 'model' | 'localModel' | 'geminiModel' | 'openaiModel' | 'agyModel' | 'codexModel'>): ModelId {
  switch (s.provider) {
    case 'claude-code': case 'api': return s.model;
    case 'local': return 'local:' + s.localModel;
    case 'gemini': return 'gemini:' + (s.geminiModel || DEFAULT_MODELS.gemini);
    case 'openai': return 'openai:' + s.openaiModel;
    case 'antigravity': return 'antigravity:' + s.agyModel;
    case 'codex': return 'codex:' + s.codexModel;
  }
}

/** The cheapest model of the selected provider, for one-off calls such as language detection. */
export const cheapModel = (s: Parameters<typeof activeModel>[0]): ModelId => isClaude(s.provider) ? 'claude-haiku-5-5' : activeModel(s);

/** Splits "gemini:gemini-flash-latest" into provider and model name; Claude ids have no prefix. */
export function splitModel(id: ModelId): { provider: AiProvider | null; name: string } {
  if (id in CLAUDE_MODELS) return { provider: null, name: id };
  const i = id.indexOf(':');
  const p = id.slice(0, i) as AiProvider;
  return i > 0 && p in PROVIDERS ? { provider: p, name: id.slice(i + 1) } : { provider: null, name: id };
}

/** How a model shows in the window: "Claude Haiku 5.5", "qwen3.5:4b (local)", "Codex". */
export function modelLabel(id: ModelId): string {
  if (id in CLAUDE_MODELS) return CLAUDE_MODELS[id as ClaudeModel];
  const { provider, name } = splitModel(id);
  if (provider === 'local') return (name || 'Local model') + (name ? ' (local)' : '');
  if (provider === 'antigravity') return name || 'Antigravity';
  if (provider === 'codex') return name || 'Codex';
  return name || 'AI';
}
