import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// The real send path with only DeepSeek's server, the settings row and the key store faked.

const settings = { provider: 'deepseek', deepseekModel: '', deepseekAgreed: true };
let savedKey: string | null = 'sk-saved';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/wat', isPackaged: false, getAppPath: () => '/tmp' }, safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock('../../src/main/db/queries', () => ({ getSettings: async () => settings, logRun: async () => {} }));
vi.mock('../../src/main/config', () => ({ getApiKey: () => null, getProviderKey: () => savedKey, TERMINAL: 'Terminal', HERE: 'this Mac', dataDir: () => '/tmp/wat' }));

const { structured } = await import('../../src/main/ai/client');
const { deepseekKey, forgetDeepseek } = await import('../../src/main/ai/deepseek');

const Out = z.object({ summary: z.string() });
const call = (model: string) => structured({
  kind: 'summary', model, system: 'Summarize.', user: 'hello', schema: Out, effort: 'medium',
  images: [{ label: 'Photo 1', mime: 'image/png', data: 'AAAA' }],
});
const answer = (content: string) => new Response(JSON.stringify({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 2 } },
}), { status: 200 });

const fetchMock = vi.fn<typeof fetch>();
const sent = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1]!.body as string) as { messages: { content: { type: string }[] }[] };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  settings.deepseekAgreed = true;
  savedKey = 'sk-saved';
  delete process.env.DEEPSEEK_API_KEY;
  forgetDeepseek();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('running a summary on DeepSeek', () => {
  it('posts to DeepSeek with the key and returns the checked answer', async () => {
    fetchMock.mockResolvedValueOnce(answer('{"summary":"ok"}'));
    await expect(call('deepseek:deepseek-flash')).resolves.toEqual({ summary: 'ok' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-saved');
  });
  it('tries again when JSON mode answers blank, as its docs warn', async () => {
    fetchMock.mockResolvedValueOnce(answer('   ')).mockResolvedValueOnce(answer('{"summary":"second"}'));
    await expect(call('deepseek:deepseek-flash')).resolves.toEqual({ summary: 'second' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('gives up after the second blank answer', async () => {
    fetchMock.mockResolvedValueOnce(answer('')).mockResolvedValueOnce(answer(''));
    await expect(call('deepseek:deepseek-flash')).rejects.toMatchObject({ code: 'invalid_output' });
  });
  it('sends nothing until the notice is accepted, even with a key', async () => {
    settings.deepseekAgreed = false;
    await expect(call('deepseek:deepseek-flash')).rejects.toMatchObject({ code: 'no_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends photos to Flash and leaves them out for Pro', async () => {
    fetchMock.mockImplementation(async () => answer('{"summary":"ok"}'));
    await call('deepseek:deepseek-flash');
    await call('deepseek:deepseek-v4-pro');
    expect(sent(0).messages[1].content.map(p => p.type)).toEqual(['text', 'image_url', 'text']);
    expect(sent(1).messages[1].content.map(p => p.type)).toEqual(['text']);
  });
});

describe('finding the DeepSeek key', () => {
  it('prefers a pasted key over the environment', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-env';
    await expect(deepseekKey()).resolves.toEqual({ key: 'sk-saved', from: 'saved' });
  });
  it('uses the environment when nothing is saved, and looks again after forgetting', async () => {
    savedKey = null;
    process.env.DEEPSEEK_API_KEY = ' sk-env\n';
    await expect(deepseekKey()).resolves.toEqual({ key: 'sk-env', from: 'env' });
    process.env.DEEPSEEK_API_KEY = 'sk-new';
    forgetDeepseek();
    await expect(deepseekKey()).resolves.toEqual({ key: 'sk-new', from: 'env' });
  });
  it.runIf(process.platform === 'darwin')('finds a key exported in .zshrc, as apps opened from Finder need', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wat-zdot-'));
    const zdotdir = process.env.ZDOTDIR;
    try {
      writeFileSync(join(dir, '.zshrc'), 'echo "Welcome back"\nexport DEEPSEEK_API_KEY=sk-from-zshrc\n');
      process.env.ZDOTDIR = dir;
      savedKey = null;
      await expect(deepseekKey()).resolves.toEqual({ key: 'sk-from-zshrc', from: 'env' });
      writeFileSync(join(dir, '.zshrc'), 'echo "Welcome back"\n');
      forgetDeepseek();
      await expect(deepseekKey()).resolves.toBeNull();
    } finally {
      if (zdotdir === undefined) delete process.env.ZDOTDIR; else process.env.ZDOTDIR = zdotdir;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
