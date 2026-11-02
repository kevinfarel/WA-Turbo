import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/wat', isPackaged: false, getAppPath: () => '/tmp' }, safeStorage: { isEncryptionAvailable: () => false } }));
const { activeModel, cheapModel, modelLabel, pickLocal, splitModel, PROVIDERS } = await import('../../src/shared/ai');
const { capWait, nextMidnight, nextPacificMidnight } = await import('../../src/main/ai/schedule');
const { contextFor } = await import('../../src/main/ai/local');
const { compatBody, compatError } = await import('../../src/main/ai/openai-compat');
const { parseCodex, codexError } = await import('../../src/main/ai/codex');
const { parseAgy } = await import('../../src/main/ai/antigravity');

const base = { model: 'claude-haiku-5-5' as const, localModel: 'gemma4:e4b', geminiModel: '', openaiModel: 'llama-4', agyModel: '', codexModel: '' };

describe('model ids per provider', () => {
  it('keeps Claude ids bare and prefixes the others', () => {
    expect(activeModel({ ...base, provider: 'claude-code' })).toBe('claude-haiku-5-5');
    expect(activeModel({ ...base, provider: 'api' })).toBe('claude-haiku-5-5');
    expect(activeModel({ ...base, provider: 'local' })).toBe('local:gemma4:e4b');
    expect(activeModel({ ...base, provider: 'gemini' })).toBe('gemini:gemini-flash-latest');
    expect(activeModel({ ...base, provider: 'openai' })).toBe('openai:llama-4');
    expect(activeModel({ ...base, provider: 'codex' })).toBe('codex:');
  });
  it('language detection uses Haiku on Claude and the chosen model elsewhere', () => {
    expect(cheapModel({ ...base, model: 'claude-opus-5-5', provider: 'claude-code' })).toBe('claude-haiku-5-5');
    expect(cheapModel({ ...base, provider: 'local' })).toBe('local:gemma4:e4b');
  });
  it('splits a model id back and names it for the window', () => {
    expect(splitModel('local:qwen3.5:4b')).toEqual({ provider: 'local', name: 'qwen3.5:4b' });
    expect(splitModel('claude-sonnet-5-5')).toEqual({ provider: null, name: 'claude-sonnet-5-5' });
    expect(modelLabel('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5');
    expect(modelLabel('local:qwen3.5:4b')).toBe('qwen3.5:4b (local)');
    expect(modelLabel('codex:')).toBe('Codex');
    expect(modelLabel('gemini:gemini-flash-latest')).toBe('gemini-flash-latest');
  });
  it('marks which providers are free, metered and experimental', () => {
    expect(Object.values(PROVIDERS).filter(p => p.free).map(p => p.id).sort()).toEqual(['antigravity', 'gemini', 'local']);
    expect(Object.values(PROVIDERS).filter(p => p.quota).map(p => p.id).sort()).toEqual(['antigravity', 'gemini']);
    expect(Object.values(PROVIDERS).filter(p => p.experimental).map(p => p.id).sort()).toEqual(['antigravity', 'codex']);
  });
});

describe('free-provider cap: 10 chats in any 10 minutes', () => {
  const MIN = 60_000, W = 10 * MIN;
  it('lets runs through under the cap', () => {
    expect(capWait([], 0, 10, W)).toBe(0);
    expect(capWait(Array.from({ length: 9 }, (_, i) => i * MIN), 9 * MIN, 10, W)).toBe(0);
  });
  it('waits until the oldest run in the window drops out', () => {
    const ten = Array.from({ length: 10 }, (_, i) => i * 30_000); // 0 … 4.5 min
    expect(capWait(ten, 5 * MIN, 10, W)).toBe(5 * MIN); // the run at 0 leaves at 10 min
  });
  it('ignores runs older than the window', () => {
    const old = Array.from({ length: 10 }, (_, i) => i * 1000);
    expect(capWait(old, 11 * MIN, 10, W)).toBe(0);
  });
});

describe('quota reset times', () => {
  it('finds the next midnight in a time zone', () => {
    const now = Date.UTC(2026, 10, 1, 10, 30); // 17:30 in Jakarta
    expect(new Date(nextMidnight(now, 'Asia/Jakarta')).toISOString()).toBe('2026-11-01T17:00:00.000Z');
  });
  it("uses Pacific time for Gemini's free quota", () => {
    expect(new Date(nextPacificMidnight(Date.UTC(2026, 9, 15, 10, 30))).toISOString()).toBe('2026-10-16T07:00:00.000Z'); // 03:30 PDT
    // 1 Nov 2026 is the day daylight time ends: 02:30 PST, so midnight is 08:00 UTC.
    expect(new Date(nextPacificMidnight(Date.UTC(2026, 10, 1, 10, 30))).toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });
});

describe('local models (Ollama on this computer)', () => {
  it('picks the best installed chat model, skipping embedding models', () => {
    expect(pickLocal(['nomic-embed-text:latest', 'llama3.1:8b', 'gemma4:e4b', 'qwen3.5:4b'])).toBe('qwen3.5:4b');
    expect(pickLocal(['nomic-embed-text:latest', 'gemma3:4b'])).toBe('gemma3:4b');
    expect(pickLocal(['nomic-embed-text:latest', 'phi4:14b'])).toBe('phi4:14b');
    expect(pickLocal(['bge-m3:latest'])).toBeNull();
    expect(pickLocal([])).toBeNull();
  });
  it('sizes the context window to the prompt', () => {
    expect(contextFor(1000, 0)).toBe(8192);
    expect(contextFor(30_000, 2)).toBe(32768);
    expect(contextFor(500_000, 10)).toBe(32768);
  });
});

describe('OpenAI-compatible services', () => {
  const g = { kind: 'gemini' as const, baseUrl: 'x', key: 'k', model: 'gemini-flash-latest' };
  it('sends photos as data URLs after their label and asks for the schema', () => {
    const b = compatBody(g, 'sys', [{ type: 'text', text: 'Photo [#1]' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } }, { type: 'text', text: 'chat' }], { type: 'object' }, 'low') as Record<string, any>;
    expect(b.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(b.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } });
    expect(b.response_format.json_schema.schema).toEqual({ type: 'object' });
    expect(b.reasoning_effort).toBe('low');
    expect('reasoning_effort' in (compatBody({ ...g, kind: 'openai' }, 's', [], {}, 'low') as object)).toBe(false);
  });
  it("tells a bad key, a missing model and a used-up daily quota apart", () => {
    expect(compatError(g, 400, { error: { message: 'API key not valid. Please pass a valid API key.' } }, null).code).toBe('bad_key');
    expect(compatError(g, 404, {}, null).code).toBe('bad_key');
    const now = Date.UTC(2026, 10, 1, 10, 30);
    const daily = compatError(g, 429, [{ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 250 per day' } }], null, now);
    expect(daily.code).toBe('rate_limited');
    expect(daily.retryAt).toBe(nextPacificMidnight(now));
    expect(compatError(g, 429, { error: { message: 'per minute' } }, '20', now).retryAt).toBe(now + 20_000);
  });
});

describe('experimental CLIs', () => {
  it('reads codex exec --json events', () => {
    const out = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"item.started","item":{"id":"i0","type":"command_execution","command":"ls","status":"in_progress"}}',
      '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"{\\"ok\\":true}"}}',
      '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":100,"output_tokens":7}}',
    ].join('\n');
    expect(parseCodex(out)).toEqual({ message: '{"ok":true}', usage: { input_tokens: 120, cached_input_tokens: 100, output_tokens: 7 }, error: null, commands: 1 });
    expect(parseCodex('{"type":"turn.failed","error":{"message":"You are not logged in"}}').error).toBe('You are not logged in');
    expect(codexError('You are not logged in').code).toBe('no_key');
    expect(codexError("You've hit your usage limit").code).toBe('rate_limited');
  });
  it('finds the result line in agy stream-json output', () => {
    const out = '{"event":"progress"}\n{"status":"SUCCESS","response":"{}","structured_output":{"ok":true},"usage":{"input_tokens":5,"output_tokens":2}}\n';
    expect(parseAgy(out)?.structured_output).toEqual({ ok: true });
    expect(parseAgy('{"event":"result","result":{"status":"ERROR","error":"x"}}')?.status).toBe('ERROR');
    expect(parseAgy('nothing')).toBeNull();
  });
  it('never lets a CLI act: no permission bypass, read-only sandbox, nothing saved', () => {
    const agy = readFileSync('src/main/ai/antigravity.ts', 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    const codex = readFileSync('src/main/ai/codex.ts', 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    expect(agy).not.toMatch(/dangerously|--yolo|--sandbox', 'false/);
    expect(codex).toContain("'--sandbox', 'read-only'");
    expect(codex).toContain("'--ephemeral'");
    expect(codex).not.toMatch(/danger-full-access|workspace-write|--full-auto|dangerously|--add-dir/);
  });
});
