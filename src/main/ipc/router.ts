import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Api, EventKey, Events } from '@shared/ipc';
import type { AiProvider, AiStatus, Bootstrap, DbInfo, Loop, SendOutcome } from '@shared/types';
import { activeModel, DEFAULT_MODELS, pickLocal, PROVIDERS } from '@shared/ai';
import { dbPassword, dbTools, externalDatabaseUrl, getApiKey, getProviderKey, HERE, setApiKey, setDbTools, setProviderKey } from '../config';
import * as Q from '../db/queries';
import { isConnected, q1 } from '../db/client';
import { pgHome, pgServer, portFree, PG_PORT, TOOLS_HOST } from '../db/server';
import { flagMessage, loopAction, resolveLoops } from '../loops/service';
import { setLoopRules } from '../loops/rules';
import { resetClient, testKey } from '../ai/client';
import { claudeCodeStatus, forgetClaude } from '../ai/claude-code';
import { agyStatus, checkAgy, findAgy, forgetAgy } from '../ai/antigravity';
import { codexStatus, findCodex, forgetCodex } from '../ai/codex';
import { DEEPSEEK_ENV, deepseekKey, forgetDeepseek } from '../ai/deepseek';
import { diagText } from '../ai/diag';
import { localModels } from '../ai/local';
import { compatTest, DEEPSEEK_BASE, GEMINI_BASE } from '../ai/openai-compat';
import { summarizeChat } from '../ai/summarize';
import { generateReport } from '../ai/report';
import { autoSummary } from '../ai/auto';
import { langDetect } from '../ai/language';
import { applyUi } from '../ui';
import { notifier } from '../notify/center';
import type { WaManager } from '../wa/manager';
import { cacheMedia, extOf, loadMedia } from '../media';
import { applyContacts, guessCountry, previewContacts } from '../contacts/import';
import { formatPhone } from '@shared/phone';
import { cleanWords } from '@shared/restricted';
import { screenMessage } from '../ai/restricted';

export function broadcast<K extends EventKey>(key: K, payload: Events[K]): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('evt', key, payload);
  if (key === 'loops-changed') void notifier.checkOverdue(payload as Loop[]).catch(() => {});
}

const runs = new Map<string, AbortController>();

// Photos picked or pasted in the composer, by token, so the window never hands the main process a file path.
const picked = new Map<string, { path: string } | { buf: Buffer; mime: string; name?: string }>();
let lastSend = { key: '', at: 0 };
const MAX_PHOTO_BYTES = 16 * 1024 * 1024;
// WhatsApp's own limits: edits within 15 minutes, delete for everyone within about 2 days.
const EDIT_WINDOW_MS = 15 * 60_000;
const REVOKE_WINDOW_MS = 48 * 3600_000;

// What the photo picker offers: macOS also decodes HEIC, WebP and TIFF; Windows only what Chromium's own decoders read.
const PHOTO_EXT = process.platform === 'darwin' ? ['jpg', 'jpeg', 'png', 'heic', 'webp', 'tiff', 'gif'] : ['jpg', 'jpeg', 'png', 'bmp', 'gif'];
const NOT_A_PHOTO = process.platform === 'darwin' ? 'WA Turbo can only send photos (JPEG, PNG, HEIC, WebP).' : 'WA Turbo can only send photos (JPEG, PNG).';

/** A pasted photo: JPEG and PNG go as they are, anything else the system can decode is sent as JPEG. */
function pastedPhoto(data: Uint8Array, mime: string): { buf: Buffer; mime: string; img: Electron.NativeImage } {
  if (!data?.byteLength) throw new Error(NOT_A_PHOTO);
  if (data.byteLength > MAX_PHOTO_BYTES) throw new Error('That photo is larger than 16 MB, which WhatsApp does not accept.');
  const buf = Buffer.from(data);
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error(NOT_A_PHOTO);
  if (mime === 'image/jpeg' || mime === 'image/png') return { buf, mime, img };
  return { buf: img.toJPEG(90), mime: 'image/jpeg', img };
}

/** JPEG and PNG go as they are; anything else the system can open is sent as JPEG. */
async function readPhoto(path: string): Promise<{ buf: Buffer; mime: string }> {
  const ext = extname(path).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return { buf: await readFile(path), mime: 'image/jpeg' };
  if (ext === '.png') return { buf: await readFile(path), mime: 'image/png' };
  const img = nativeImage.createFromPath(path);
  if (img.isEmpty()) throw new Error(NOT_A_PHOTO);
  return { buf: img.toJPEG(90), mime: 'image/jpeg' };
}

export interface RouterDeps {
  manager: WaManager;
  boot: () => Promise<{ ok: boolean; error: string | null }>;
  dbState: () => { ok: boolean; error: string | null };
  ready: () => Promise<unknown>;
}

export async function aiStatus(provider: AiProvider): Promise<AiStatus> {
  const base = { provider, testing: false, cliFound: false, account: null };
  switch (provider) {
    case 'api': return { ...base, connected: !!getApiKey() };
    case 'claude-code': {
      const s = await claudeCodeStatus();
      return { ...base, connected: s.loggedIn, cliFound: s.installed, account: s.account };
    }
    case 'local': {
      const [found, s] = await Promise.all([localModels.detect(), Q.getSettings()]);
      // No model picked yet, or the picked one was removed from Ollama: take the best one installed.
      let model = s.localModel;
      if (found.running && !found.models.includes(model)) {
        model = pickLocal(found.models) ?? '';
        if (model !== s.localModel) await Q.saveSettings({ localModel: model });
      }
      return { ...base, connected: found.running && !!model, cliFound: found.running, models: found.models,
        account: found.version ? 'Ollama ' + found.version : null };
    }
    case 'gemini': {
      const s = await Q.getSettings();
      return { ...base, connected: !!getProviderKey('gemini') && s.geminiAgreed };
    }
    case 'deepseek': {
      const [s, found] = await Promise.all([Q.getSettings(), deepseekKey()]);
      return { ...base, connected: !!found && s.deepseekAgreed, cliFound: !!found, account: found?.from === 'env' ? DEEPSEEK_ENV : null };
    }
    case 'openai': {
      const s = await Q.getSettings();
      return { ...base, connected: !!s.openaiBaseUrl && !!s.openaiModel, account: s.openaiBaseUrl || null };
    }
    case 'antigravity': {
      const s = await agyStatus();
      return { ...base, connected: s.ok, cliFound: s.installed };
    }
    case 'codex': {
      const s = await codexStatus();
      return { ...base, connected: s.loggedIn, cliFound: s.installed, account: s.account };
    }
  }
}

export function registerIpc(d: RouterDeps): void {
  const bootstrap = async (): Promise<Bootstrap> => {
    await d.ready();
    const st = d.dbState();
    if (!st.ok || !isConnected()) {
      const settings = Q.DEFAULT_SETTINGS;
      return { dbOk: false, dbError: st.error, accounts: [], partners: [], settings, ai: await aiStatus(settings.provider) };
    }
    const settings = await Q.getSettings();
    return {
      dbOk: true, dbError: null, accounts: await Q.listAccounts(), partners: await Q.listPartners(), settings,
      ai: await aiStatus(settings.provider),
    };
  };

  const run = async <T>(runId: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    runs.get(runId)?.abort();
    const ac = new AbortController();
    runs.set(runId, ac);
    try {
      return await fn(ac.signal);
    } finally {
      if (runs.get(runId) === ac) runs.delete(runId);
    }
  };

  const chatRef = async (chatId: string) => {
    const c = await Q.chatMeta(chatId);
    if (!c) throw new Error('That chat no longer exists.');
    return c;
  };

  // Tags only go to people in this group, and only when the text still has their "@<number>".
  const checkMentions = async (c: { account_id: string; jid: string; kind: string }, body: string, mentions: string[]): Promise<string[]> => {
    const list = [...new Set((Array.isArray(mentions) ? mentions : []).filter(j => typeof j === 'string'))];
    if (!list.length) return [];
    if (c.kind !== 'group') throw new Error('People can only be tagged in groups.');
    const members = new Set(((await d.manager.session(c.account_id)?.members(c.jid)) ?? []).map(m => m.id));
    for (const j of list) {
      if (!members.has(j)) throw new Error('Someone you tagged is no longer in this group.');
      if (!body.includes('@' + j.split('@')[0])) throw new Error('A tag was removed from the message. Tag the person again.');
    }
    return list;
  };

  // Restricted words: runs here so nothing in the window can skip it, and only ever holds a message back.
  const screenText = async (accountId: string, chatId: string, body: string, allowFlagged: boolean, attachment?: string): Promise<SendOutcome> => {
    const a = await Q.accountRestricted(accountId);
    if (!a) return { sent: true, aiSkipped: false };
    const r = await screenMessage({ rule: a.rule, text: body, attachment, chatId, allowFlagged, onAsk: () => broadcast('checking', { chatId }) });
    if (r.ok) return { sent: true, aiSkipped: r.aiSkipped };
    return { sent: false, number: a.name, words: r.words, by: r.by, hard: a.rule.hard, ...(r.fileOnly ? { file: attachment } : {}) };
  };

  const ownMessage = async (messageId: string) => {
    const m = await Q.messageForChange(messageId);
    if (!m || m.deleted) throw new Error('That message is no longer there.');
    if (!m.from_me) throw new Error('You can only change messages you sent.');
    return m;
  };
  const keyOf = (m: NonNullable<Awaited<ReturnType<typeof Q.messageForChange>>>) =>
    ({ remoteJid: m.key?.remoteJid || m.jid, id: m.wa_id, fromMe: true, ...(m.key?.participant ? { participant: m.key.participant } : {}) });

  const dbInfo = async (): Promise<DbInfo> => {
    const size = isConnected() ? await q1<{ n: number }>('SELECT pg_database_size(current_database()) AS n').catch(() => null) : null;
    if (externalDatabaseUrl()) return { mode: 'external', version: null, folder: null, sizeBytes: size?.n ?? null, toolsOn: false, tools: null, toolsError: null };
    return { mode: 'bundled', version: pgServer.version(), folder: pgHome(), sizeBytes: size?.n ?? null, toolsOn: dbTools(),
      tools: pgServer.tools(dbPassword()), toolsError: pgServer.toolsError };
  };

  /** Names changed (contacts import): every chat list, SUM UP! card and open chat redraws with the new names. */
  const namesChanged = async () => {
    for (const a of await Q.listAccounts()) broadcast('chats-changed', { acct: a.id });
    broadcast('loops-changed', await Q.listLoops());
  };

  /** After the team changes: let replies from teammates settle open loops, then refresh the window. */
  const teamSettled = async () => {
    for (const chatId of await Q.chatsWithOpenLoops()) await resolveLoops(chatId).catch(() => false);
    broadcast('loops-changed', await Q.listLoops());
  };

  const handlers: Api = {
    bootstrap,
    retryDb: async () => { await d.boot(); return bootstrap(); },
    dbInfo,
    setDbTools: async on => {
      if (externalDatabaseUrl()) throw new Error('This copy uses the database from WA_TURBO_DATABASE_URL.');
      if (on && !pgServer.tools(dbPassword()) && !(await portFree(PG_PORT, TOOLS_HOST)))
        throw new Error(`Port ${PG_PORT} is already used by another program on this Mac, so database tools can't connect.`);
      setDbTools(on);
      const st = await d.boot();
      if (!st.ok) throw new Error(st.error ?? "WA Turbo's database didn't restart.");
      return dbInfo();
    },
    previewContacts: (data, fileName, countryCode) => previewContacts(new Uint8Array(data), fileName, countryCode),
    applyContacts: async (token, keep) => { const r = await applyContacts(token, keep); await namesChanged(); return r; },
    contactsInfo: async () => ({ ...(await Q.phonebookInfo()), countryCode: await guessCountry((await Q.getSettings()).contactsCountry) }),
    clearContacts: async () => { const n = await Q.clearPhonebook(); await namesChanged(); return n; },
    showDbFolder: async () => { if (!externalDatabaseUrl()) await shell.openPath(pgHome()); },

    listChats: acct => Q.listChats(acct),
    listAllChats: () => Q.listChats(null),
    searchChats: (acct, query) => Q.searchChats(acct, query),
    getMessages: (chatId, limit) => Q.getMessages(chatId, Math.min(Math.max(limit, 1), 5000)),
    openChat: async chatId => { await Q.markRead(chatId); await notifier.read(chatId); }, // local only: no read receipt is ever sent
    setActiveChat: async chatId => { notifier.setActiveChat(chatId); },
    setMuted: async (chatId, until) => {
      await Q.setMuted(chatId, until);
      const c = await chatRef(chatId);
      broadcast('chats-changed', { acct: c.account_id });
      await notifier.apply(await Q.getSettings());
    },
    testNotification: async () => {
      if (!notifier.supported()) throw new Error('Notifications are not available on ' + HERE + '.');
      notifier.test();
    },
    openNotificationSettings: async () => {
      await shell.openExternal(process.platform === 'win32' ? 'ms-settings:notifications' : 'x-apple.systempreferences:com.apple.Notifications-Settings.extension');
    },

    // The one way out to WhatsApp: a message typed in the composer and sent with the window in front.
    // Nothing in WA Turbo sends on a timer, on a rule, or from Claude's output.
    sendMessage: async (chatId, text, photoToken, mentions, allowFlagged = false) => {
      if (!BrowserWindow.getFocusedWindow()) throw new Error('Messages are sent only from the WA Turbo window while it is in front.');
      const body = text.trim();
      const photo = photoToken ? picked.get(photoToken) : undefined;
      if (photoToken && !photo) throw new Error('Pick the photo again.');
      if (!body && !photo) throw new Error('Type a message first.');
      if (body.length > 4096) throw new Error('That message is too long for WhatsApp. Split it in two.');
      const key = chatId + '\n' + body + '\n' + (photoToken ?? '');
      if (key === lastSend.key && Date.now() - lastSend.at < 3000) throw new Error('That message was just sent.');
      const c = await chatRef(chatId);
      // Before lastSend: a message held back was not sent, so Send anyway must not look like a repeat.
      // WhatsApp never receives a photo's file name, but a name from the wrong side usually means the wrong photo.
      const attachment = photo ? ('path' in photo ? basename(photo.path) : photo.name) : undefined;
      const checked = await screenText(c.account_id, c.id, body, allowFlagged, attachment);
      if (!checked.sent) return checked;
      lastSend = { key, at: Date.now() };
      const tags = await checkMentions(c, body, mentions);
      const image = photo ? ('path' in photo ? await readPhoto(photo.path) : photo) : undefined;
      const waId = await d.manager.send(c.account_id, c.jid, { text: body, image, mentions: tags });
      if (photoToken) picked.delete(photoToken);
      if (image) {
        const id = await Q.messageIdByWa(c.id, waId);
        if (id) await cacheMedia(c.account_id, id, image.mime, image.buf);
      }
      return checked;
    },
    // Edit and delete for everyone: only your own messages, only from the window, inside WhatsApp's limits.
    editMessage: async (messageId, text, allowFlagged = false) => {
      if (!BrowserWindow.getFocusedWindow()) throw new Error('Messages are edited only from the WA Turbo window while it is in front.');
      const body = text.trim();
      if (!body) throw new Error('A message cannot be empty. Delete it instead.');
      if (body.length > 4096) throw new Error('That message is too long for WhatsApp.');
      const m = await ownMessage(messageId);
      if (m.type !== 'text') throw new Error('Only text messages can be edited.');
      if (Date.now() - m.sent_at > EDIT_WINDOW_MS) throw new Error('WhatsApp only allows edits within 15 minutes of sending.');
      const checked = await screenText(m.account_id, m.chat_id, body, allowFlagged);
      if (!checked.sent) return checked;
      await d.manager.edit(m.account_id, m.jid, keyOf(m), body);
      await Q.editMessage(m.chat_id, m.wa_id, body);
      broadcast('messages-changed', { chatId: m.chat_id });
      return checked;
    },
    deleteForEveryone: async messageId => {
      if (!BrowserWindow.getFocusedWindow()) throw new Error('Messages are deleted only from the WA Turbo window while it is in front.');
      const m = await ownMessage(messageId);
      if (Date.now() - m.sent_at > REVOKE_WINDOW_MS) throw new Error('WhatsApp only allows delete for everyone within about 2 days of sending.');
      await d.manager.revoke(m.account_id, m.jid, keyOf(m));
      await Q.deleteMessage(m.chat_id, m.wa_id);
      broadcast('messages-changed', { chatId: m.chat_id });
      broadcast('chats-changed', { acct: m.account_id });
      if (await Q.dismissLoopsOn(messageId)) broadcast('loops-changed', await Q.listLoops());
    },
    pickPhoto: async () => {
      const w = BrowserWindow.getFocusedWindow();
      const opts = { title: 'Send a photo', properties: ['openFile' as const], filters: [{ name: 'Photos', extensions: PHOTO_EXT }] };
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
      const path = r.filePaths[0];
      if (r.canceled || !path) return null;
      const { size } = await stat(path);
      if (size > MAX_PHOTO_BYTES) throw new Error('That photo is larger than 16 MB, which WhatsApp does not accept.');
      const img = nativeImage.createFromPath(path);
      if (img.isEmpty()) throw new Error(NOT_A_PHOTO);
      const token = randomUUID();
      picked.set(token, { path });
      return { token, name: basename(path), size, preview: img.resize({ height: 120 }).toDataURL() };
    },
    pastePhoto: async (data, mime, name) => {
      const p = pastedPhoto(data, mime);
      const token = randomUUID();
      // A file copied in Finder keeps its name; a screenshot has none worth reading.
      picked.set(token, { buf: p.buf, mime: p.mime, ...(typeof name === 'string' && name ? { name: basename(name).slice(0, 255) } : {}) });
      return { token, name: 'Pasted photo.' + extOf(p.mime), size: p.buf.length, preview: p.img.resize({ height: 120 }).toDataURL() };
    },
    groupMembers: async chatId => {
      const c = await chatRef(chatId);
      if (c.kind !== 'group') return [];
      const list = (await d.manager.session(c.account_id)?.members(c.jid)) ?? [];
      // Names: your contacts, else what WhatsApp told this session, else the name they used on their messages.
      const jids = [...new Set(list.flatMap(m => [m.pn, m.id]))];
      const [saved, spoke] = await Promise.all([Q.contactNames(c.account_id, jids), Q.senderNames(c.account_id, jids)]);
      return list
        .map(m => {
          const phone = m.pn.endsWith('@s.whatsapp.net') ? formatPhone('+' + m.pn.split('@')[0]) : '';
          const name = saved.get(m.pn) ?? saved.get(m.id) ?? m.name ?? spoke.get(m.pn) ?? spoke.get(m.id) ?? '';
          return { jid: m.id, name: name || phone, phone, named: !!name };
        })
        .filter(m => m.name)
        // People with a name first, then the ones known only by number.
        .sort((a, b) => Number(b.named) - Number(a.named) || a.name.localeCompare(b.name))
        .map(({ named: _, ...m }) => m);
    },
    saveMedia: async messageId => {
      const f = await loadMedia(Number(messageId));
      const name = f.fileName || `WhatsApp photo ${messageId}.${extOf(f.mime)}`;
      const w = BrowserWindow.getFocusedWindow();
      const opts = { title: 'Save to ' + HERE, defaultPath: join(app.getPath('downloads'), name) };
      const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      await writeFile(r.filePath, f.buf);
      return { path: r.filePath };
    },
    setChatPartner: async (chatId, partner, type, service, stage) => {
      if (partner) {
        await Q.upsertPartner(partner, type);
        broadcast('partners', await Q.listPartners());
      }
      await Q.setChatPartner(chatId, partner, service, stage);
      const c = await chatRef(chatId);
      broadcast('chats-changed', { acct: c.account_id });
    },

    listLoops: () => Q.listLoops(),
    flagMessage: async (chatId, msgId) => {
      const l = await flagMessage(await chatRef(chatId), msgId);
      broadcast('loops-changed', await Q.listLoops());
      return l;
    },
    loopAction: async (loopId, act) => {
      const l = await loopAction(loopId, act);
      broadcast('loops-changed', await Q.listLoops());
      return l;
    },

    listTeam: () => Q.listTeam(),
    usage: since => Q.usageSince(since),
    setTeam: async (messageId, onTeam) => {
      const s = await Q.messageSender(messageId);
      if (!s) throw new Error('That message is no longer in the chat.');
      if (s.fromMe) throw new Error('That message is yours.');
      if (s.kind !== 'group') throw new Error('My team only applies to group chats. In a direct chat the other person is always the other side.');
      if (!s.jid) throw new Error('WA Turbo doesn\'t know who sent this older message. Use “Waiting on them” on its SUM UP! card instead.');
      const name = s.name || s.jid.split('@')[0];
      if (onTeam) {
        const alt = d.manager.session(s.accountId)?.altJid(s.jid) ?? null;
        await Q.addTeam(name, [s.jid, ...(alt ? [alt] : [])]);
        await Q.flipTeamLoops([s.jid, ...(alt ? [alt] : [])], true, name);
      } else {
        const member = await Q.teamMemberOf([s.jid]);
        if (member) await Q.flipTeamLoops(await Q.removeTeam(member), false, name);
      }
      await teamSettled();
      return Q.listTeam();
    },
    removeTeam: async memberId => {
      const m = (await Q.listTeam()).find(x => x.id === memberId);
      await Q.flipTeamLoops(await Q.removeTeam(memberId), false, m?.name ?? 'Unknown');
      await teamSettled();
      return Q.listTeam();
    },

    startPairing: (name, desc, accent) => d.manager.startPairing(name, desc, accent),
    refreshPairing: () => d.manager.refreshPairing(),
    cancelPairing: () => d.manager.cancelPairing(),
    reconnect: id => d.manager.reconnect(id),
    unlink: id => d.manager.unlink(id),
    setNumberLang: async (id, lang) => {
      if (lang === null) await Q.forgetAccountLang(id);
      else await Q.setAccountLang(id, lang, false);
      if (lang === null) langDetect.poke(true);
      const accounts = await Q.listAccounts();
      broadcast('accounts', accounts);
      return accounts;
    },
    setNumberRestricted: async (id, rule) => {
      await Q.setAccountRestricted(id, { on: !!rule?.on, hard: !!rule?.hard, words: cleanWords(rule?.words) });
    },
    setUiPrefs: async p => {
      applyUi(p);
      await notifier.apply(await Q.getSettings());
    },

    getSettings: () => Q.getSettings(),
    saveSettings: async patch => {
      if (patch.openAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin: patch.openAtLogin });
      const saved = await Q.saveSettings(patch);
      if (patch.loopRules) setLoopRules(saved.loopRules);
      await notifier.apply(saved);
      if (['autoOn', 'pinEveryMin', 'pinWindow', 'otherEveryMin', 'otherWindow', 'provider', 'autoDailyBudget'].some(k => k in patch)) await autoSummary.schedule();
      return saved;
    },
    autoStatus: async () => autoSummary.status(),
    checkAi: async deep => {
      forgetClaude(); forgetAgy(); forgetCodex(); forgetDeepseek();
      const s = await Q.getSettings();
      if (deep && s.provider === 'antigravity' && (await findAgy())) {
        try { await checkAgy(s.agyModel); } catch (e) {
          const st = await aiStatus(s.provider);
          return { ...st, connected: false, detail: e instanceof Error ? e.message : String(e) };
        }
      }
      const st = await aiStatus(s.provider);
      if (st.connected) { langDetect.poke(true); await autoSummary.schedule(); }
      return st;
    },
    testKey: async key => {
      try {
        const s = await Q.getSettings();
        await testKey(key.trim(), s.model);
        setApiKey(key.trim());
        resetClient();
        langDetect.poke(true);
        return { ok: true, error: null };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    disconnectKey: async () => { setApiKey(null); resetClient(); },
    testProviderKey: async (provider, key) => {
      try {
        const s = await Q.getSettings();
        const deepseek = provider === 'deepseek';
        if (deepseek) forgetDeepseek();
        const k = key?.trim() || (deepseek ? (await deepseekKey())?.key ?? null : getProviderKey(provider));
        if (provider === 'gemini' && !k) throw new Error('Paste your Gemini key first.');
        if (deepseek && !k) throw new Error('Paste your DeepSeek key first.');
        if (provider === 'openai' && !s.openaiBaseUrl) throw new Error('Enter the service address first, e.g. https://api.groq.com/openai/v1.');
        if (provider === 'openai' && !s.openaiModel) throw new Error('Enter the model name first.');
        await compatTest({
          kind: provider, key: k,
          baseUrl: provider === 'gemini' ? GEMINI_BASE : deepseek ? DEEPSEEK_BASE : s.openaiBaseUrl,
          model: provider === 'gemini' ? s.geminiModel || DEFAULT_MODELS.gemini : deepseek ? s.deepseekModel || DEFAULT_MODELS.deepseek : s.openaiModel,
        });
        if (key?.trim()) setProviderKey(provider, key.trim());
        langDetect.poke(true);
        await autoSummary.schedule();
        return { ok: true, error: null };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    disconnectProvider: async provider => { setProviderKey(provider, null); },
    detectLocal: () => localModels.detect(),
    aiDiagnostics: async provider => {
      const s = await Q.getSettings();
      const extra: Record<string, string> = { 'wa turbo': app.getVersion(), model: activeModel({ ...s, provider }) || '(default)' };
      if (provider === 'antigravity') extra.cli = (await findAgy()) ?? 'not found';
      if (provider === 'codex') extra.cli = (await findCodex()) ?? 'not found';
      if (provider === 'local') { const f = await localModels.detect(); extra.ollama = f.running ? f.version ?? 'running' : 'not running'; extra.models = f.models.join(', '); }
      extra.experimental = String(PROVIDERS[provider].experimental);
      return diagText(provider, extra);
    },

    summarize: async (chatId, opts) => {
      const s = await Q.getSettings();
      const result = await run('summary:' + chatId, signal =>
        summarizeChat(chatId, activeModel(s), { window: opts?.window ?? s.window, force: opts?.force }, 'summary:' + chatId, p => broadcast('progress', p), signal));
      broadcast('loops-changed', await Q.listLoops());
      const c = await chatRef(chatId);
      broadcast('chats-changed', { acct: c.account_id });
      return result;
    },
    cancelRun: async runId => { runs.get(runId)?.abort(); },
    lastSummary: async chatId => {
      const s = await Q.lastSummary(chatId);
      return s ? { chatId: s.chatId, model: s.model, createdAt: s.createdAt, msgCount: s.msgCount, insight: s.insight, windowKey: s.windowKey, auto: s.auto } : null;
    },
    setPinned: async (chatId, pinned) => {
      await Q.setPinned(chatId, pinned);
      const c = await chatRef(chatId);
      broadcast('chats-changed', { acct: c.account_id });
      await autoSummary.schedule();
      await notifier.checkOverdue();
    },

    listReports: () => Q.listReports(),
    generateReport: async (presetId, days, chatIds, custom) => {
      const s = await Q.getSettings();
      if (presetId === 'custom' && custom.trim()) await Q.saveSettings({ customPrompt: custom.trim() });
      const r = await run('report', signal => generateReport(presetId, days, chatIds, custom.trim(), activeModel(s), 'report', p => broadcast('progress', p), signal));
      broadcast('loops-changed', await Q.listLoops());
      return r;
    },
    deleteReport: id => Q.deleteReport(id),
    exportReport: async (_id, markdown) => {
      const name = (markdown.split('\n')[0].replace(/^#\s*/, '') || 'wa-turbo-report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.md';
      const path = join(app.getPath('downloads'), name);
      await writeFile(path, markdown, 'utf8');
      return { path };
    },
    copyText: async text => { clipboard.writeText(text); },
  };

  for (const [key, fn] of Object.entries(handlers)) {
    ipcMain.handle('api:' + key, async (_e, ...args: unknown[]) => {
      try {
        return { ok: true, value: await (fn as (...a: unknown[]) => Promise<unknown>)(...args) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
  }
}
