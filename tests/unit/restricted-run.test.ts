import { beforeEach, describe, expect, it, vi } from 'vitest';

const structured = vi.fn();
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }));
vi.mock('../../src/main/ai/client', () => ({ structured }));
vi.mock('../../src/main/db/queries', () => ({
  addAliases: vi.fn(async () => {}),
  getSettings: vi.fn(async () => ({ provider: 'claude-code', model: 'claude-haiku-5-5' })),
  listAliases: vi.fn(async () => []),
}));

const { AiError } = await import('../../src/main/ai/errors');
const { screenMessage } = await import('../../src/main/ai/restricted');

const rule = (over = {}) => ({ on: true, hard: false, words: ['acme', 'zeta'], ...over });
const check = (text: string, r = rule(), allowFlagged = false, attachment?: string) => {
  const onAsk = vi.fn();
  return screenMessage({ rule: r, text, attachment, chatId: 'c1', allowFlagged, onAsk }).then(res => ({ res, onAsk }));
};

beforeEach(() => { structured.mockReset(); });

describe('screenMessage', () => {
  it('lets everything through when off or empty, without the AI', async () => {
    expect((await check('acme', rule({ on: false }))).res).toEqual({ ok: true, aiSkipped: false });
    expect((await check('acme', rule({ words: [] }))).res).toEqual({ ok: true, aiSkipped: false });
    expect(structured).not.toHaveBeenCalled();
  });

  it('holds an exact match without calling the AI', async () => {
    expect((await check('call acme now')).res).toEqual({ ok: false, words: ['acme'], by: 'exact' });
    expect(structured).not.toHaveBeenCalled();
  });

  it('sends right away when nothing is close, without calling the AI', async () => {
    const { res, onAsk } = await check('ok siap');
    expect(res).toEqual({ ok: true, aiSkipped: false });
    expect(structured).not.toHaveBeenCalled();
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('asks only about the close word, at low effort, and holds on a yes', async () => {
    structured.mockResolvedValue({ hit: ['ACME '] });
    const { res, onAsk } = await check('call acne now');
    expect(res).toEqual({ ok: false, words: ['acme'], by: 'ai' });
    expect(onAsk).toHaveBeenCalledOnce();
    const call = structured.mock.calls[0][0];
    expect(call).toMatchObject({ kind: 'restricted', effort: 'low', chatId: 'c1' });
    expect(call.user).toContain('- acme');
    expect(call.user).not.toContain('zeta');
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends on a no', async () => {
    structured.mockResolvedValue({ hit: [] });
    expect((await check('call acne now')).res).toEqual({ ok: true, aiSkipped: false });
  });

  it('drops an answer that is not on the list', async () => {
    structured.mockResolvedValue({ hit: ['something else', 'zeta'] });
    expect((await check('call acne now')).res).toEqual({ ok: true, aiSkipped: false });
  });

  it('counts a name of several words that comes back in pieces', async () => {
    structured.mockResolvedValue({ hit: ['delta', 'omega', 'beta'] });
    expect((await check('invoice deltaomgabeta', rule({ words: ['delta omega beta'] }))).res).toEqual({ ok: false, words: ['delta omega beta'], by: 'ai' });
  });

  it('holds a message for its attachment name alone, even with no text', async () => {
    expect((await check('', rule(), false, 'BillACME2026.png')).res).toEqual({ ok: false, words: ['acme'], by: 'exact', fileOnly: true });
    expect((await check('see photo', rule(), false, 'bill_acme.png')).res).toEqual({ ok: false, words: ['acme'], by: 'exact', fileOnly: true });
    expect(structured).not.toHaveBeenCalled();
  });

  it('blames the message when the word is in both', async () => {
    expect((await check('ask acme', rule(), false, 'bill_acme.png')).res).toEqual({ ok: false, words: ['acme'], by: 'exact' });
  });

  it('reports words from the message and the attachment together', async () => {
    expect((await check('ask zeta', rule(), false, 'bill_acme.png')).res).toEqual({ ok: false, words: ['acme', 'zeta'], by: 'exact' });
  });

  it('asks the AI about a close attachment name, and shows it the name', async () => {
    structured.mockResolvedValue({ hit: ['acme'] });
    expect((await check('see photo', rule(), false, 'bill_acne.png')).res).toEqual({ ok: false, words: ['acme'], by: 'ai', fileOnly: true });
    expect(structured.mock.calls[0][0].user).toContain('Attached file: bill_acne');
  });

  it('passes a clean attachment without the AI, and Send anyway covers it', async () => {
    expect((await check('', rule(), false, 'liburan 2026.jpg')).res).toEqual({ ok: true, aiSkipped: false });
    expect((await check('', rule(), true, 'bill_acme.png')).res).toEqual({ ok: true, aiSkipped: false });
    expect((await check('', rule({ hard: true }), true, 'bill_acme.png')).res).toMatchObject({ ok: false, fileOnly: true });
    expect(structured).not.toHaveBeenCalled();
  });

  it('hides phone numbers from the AI and caps the text', async () => {
    structured.mockResolvedValue({ hit: [] });
    await check('acne +62 812-5540-118 ' + 'x'.repeat(5000));
    const { user } = structured.mock.calls[0][0];
    expect(user).not.toContain('5540');
    expect(user.length).toBeLessThan(1100);
  });

  it('says nothing when no AI is connected', async () => {
    structured.mockRejectedValue(new AiError('Not connected', 'no_key'));
    expect((await check('call acne now')).res).toEqual({ ok: true, aiSkipped: false });
    structured.mockRejectedValue(new AiError('Bad key', 'bad_key'));
    expect((await check('call acne now')).res).toEqual({ ok: true, aiSkipped: false });
  });

  it('sends with a note when the AI fails', async () => {
    for (const e of [new AiError('Limit', 'rate_limited'), new AiError('Down', 'offline'), new Error('boom')]) {
      structured.mockRejectedValueOnce(e);
      expect((await check('call acne now')).res).toEqual({ ok: true, aiSkipped: true });
    }
  });

  it('gives up on an AI that never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const real = AbortSignal.timeout;
    const ctl = new AbortController();
    AbortSignal.timeout = () => ctl.signal;
    structured.mockReturnValue(new Promise(() => {}));
    const pending = check('call acne now');
    await new Promise(r => setImmediate(r));
    ctl.abort();
    expect((await pending).res).toEqual({ ok: true, aiSkipped: true });
    AbortSignal.timeout = real;
    vi.useRealTimers();
  });

  it('Send anyway skips the check, and spends nothing', async () => {
    expect((await check('call acme now', rule(), true)).res).toEqual({ ok: true, aiSkipped: false });
    expect((await check('call acne now', rule(), true)).res).toEqual({ ok: true, aiSkipped: false });
    expect(structured).not.toHaveBeenCalled();
  });

  it('a hard block ignores Send anyway', async () => {
    expect((await check('call acme now', rule({ hard: true }), true)).res).toEqual({ ok: false, words: ['acme'], by: 'exact' });
  });
});
