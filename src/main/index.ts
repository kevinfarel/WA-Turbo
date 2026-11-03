import { app, BrowserWindow, net, protocol, shell } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dbPassword, dbTools, externalDatabaseUrl, migrationsDir } from './config';
import { connect, disconnect, migrate } from './db/client';
import { pgServer, PgServerError } from './db/server';
import { chatMeta, chatsWithOpenLoops, getSettings, lastSummary, listAccounts, listLoops, listPartners, messageMedia, saveSettings } from './db/queries';
import { resolveLoops } from './loops/service';
import { setLoopRules } from './loops/rules';
import { initMedia, loadMedia, MediaError } from './media';
import { aiStatus, broadcast, registerIpc } from './ipc/router';
import { autoSummary } from './ai/auto';
import { langDetect } from './ai/language';
import { notifier } from './notify/center';
import { WaManager } from './wa/manager';
import { restoreTheme, titleBarOverlay, windowBackground } from './ui';

const here = dirname(fileURLToPath(import.meta.url));

app.setName('WA Turbo');
// Windows matches notifications and the taskbar button to the installer's shortcut by this id.
if (process.platform === 'win32') app.setAppUserModelId('local.waturbo.app');
// WA_TURBO_USER_DATA runs a second copy (dev, screenshots) beside the installed app without sharing its lock or config.
if (process.env.WA_TURBO_USER_DATA) app.setPath('userData', process.env.WA_TURBO_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([{ scheme: 'wat-media', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const manager = new WaManager();
initMedia(id => manager.session(id));
let dbState: { ok: boolean; error: string | null } = { ok: false, error: 'Not connected yet' };
let win: BrowserWindow | null = null;

async function boot(): Promise<{ ok: boolean; error: string | null }> {
  manager.stopAll();
  try {
    const external = externalDatabaseUrl();
    await connect(external ?? await pgServer.start({ tcp: dbTools(), password: dbPassword() }));
    await migrate(migrationsDir());
    dbState = { ok: true, error: null };
    setLoopRules((await getSettings()).loopRules);
    // Re-check loops stored before the current rules (a thanks after your reply closes them).
    for (const chatId of await chatsWithOpenLoops()) await resolveLoops(chatId).catch(() => false);
    // WA_TURBO_OFFLINE=1 opens the stored data without connecting to WhatsApp (demo data, screenshots).
    if (!process.env.WA_TURBO_OFFLINE) await manager.startAll();
    broadcast('partners', await listPartners());
  } catch (e) {
    await disconnect();
    dbState = { ok: false, error: describeDbError(e) };
  }
  return dbState;
}

function describeDbError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof PgServerError) return msg;
  const code = (e as { code?: string }).code;
  if (code === 'ECONNREFUSED' || /ECONNREFUSED|ENOENT/.test(msg)) return "WA Turbo's database isn't answering.";
  if (code === '28P01' || /password authentication failed/i.test(msg)) return 'Postgres rejected the user or password in the connection string.';
  if (/no password supplied|SASL/i.test(msg)) return 'Postgres wants a password. Add it to the connection string.';
  if (code === '3D000') return 'The wa_turbo database does not exist yet.';
  return msg;
}

manager.on('accounts', a => broadcast('accounts', a));
manager.on('pair', p => broadcast('pair', p));
manager.on('ingested', (accountId, r) => {
  broadcast('chats-changed', { acct: accountId });
  const byChat = new Map<string, typeof r.messages>();
  for (const m of r.messages) byChat.set(m.chatId, [...(byChat.get(m.chatId) ?? []), m]);
  for (const [chatId, messages] of byChat) broadcast('messages', { chatId, messages });
  for (const chatId of r.changed) broadcast('messages-changed', { chatId });
  if (r.loopsChanged) void listLoops().then(l => broadcast('loops-changed', l)).catch(() => {});
  autoSummary.markChanged(r.chats);
  langDetect.poke();
  void notifier.onIngested(r).catch(() => {});
});

/** wat-media://thumb/<messageId> serves the stored thumbnail; wat-media://full/<messageId> the full file. */
function registerMediaProtocol(): void {
  protocol.handle('wat-media', async req => {
    const url = new URL(req.url);
    const id = Number(url.pathname.replace(/^\//, ''));
    const row = Number.isFinite(id) ? await messageMedia(id) : null;
    if (!row?.media) return new Response('Not found', { status: 404 });
    if (url.host === 'thumb') {
      if (!row.media.thumb) return new Response('No thumbnail', { status: 404 });
      return new Response(new Uint8Array(Buffer.from(row.media.thumb, "base64")), { headers: { 'content-type': 'image/jpeg' } });
    }
    if (row.media.path && existsSync(row.media.path)) return net.fetch(pathToFileURL(row.media.path).toString());
    try {
      const f = await loadMedia(id);
      return new Response(new Uint8Array(f.buf), { headers: { 'content-type': f.mime || 'application/octet-stream' } });
    } catch (e) {
      return new Response(e instanceof Error ? e.message : 'Not available', { status: e instanceof MediaError ? e.status : 500 });
    }
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 760, minHeight: 560,
    title: 'WA Turbo',
    // macOS: real traffic lights inset in the app's own title bar. Windows: its caption buttons drawn over the bar's right end.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay(), autoHideMenuBar: true }),
    backgroundColor: windowBackground(),
    show: false,
    webPreferences: { preload: join(here, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => { win?.show(); void notifier.windowReady().catch(() => {}); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(here, '../renderer/index.html'));
  win.on('closed', () => { win = null; });
}

// Opening WA Turbo again (Start menu, taskbar) brings the window back, also after it was closed to the tray.
app.on('second-instance', () => {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(async () => {
  restoreTheme();
  let firstBoot: Promise<unknown> = Promise.resolve();
  registerIpc({ manager, boot, dbState: () => dbState, ready: () => firstBoot });
  registerMediaProtocol();
  firstBoot = boot();
  createWindow();
  await firstBoot;
  broadcast('accounts', dbState.ok ? await listAccounts() : []);
  // WA_TURBO_NO_AUTO=1 keeps auto summary off for screenshots and tests.
  if (dbState.ok && !process.env.WA_TURBO_NO_AUTO) {
    await autoSummary.start({
      isConnected: async () => (await aiStatus((await getSettings()).provider)).connected,
      onRan: (chatId, pinned) => void (async () => {
        broadcast('loops-changed', await listLoops());
        const c = await chatMeta(chatId);
        if (c) broadcast('chats-changed', { acct: c.account_id });
        if (pinned) { const s = await lastSummary(chatId); if (s) broadcast('summary', s); }
      })().catch(() => {}),
      onStatus: s => broadcast('auto', s),
    }).catch(() => {});
  }
  // WA_TURBO_NO_LANG=1 keeps the one-time language detection off as well.
  if (dbState.ok && !process.env.WA_TURBO_NO_LANG) {
    langDetect.start({
      isConnected: async () => (await aiStatus((await getSettings()).provider)).connected,
      onDetected: () => void listAccounts().then(a => broadcast('accounts', a)).catch(() => {}),
    });
  }
  if (dbState.ok) {
    await notifier.start({
      window: () => win,
      open: (chatId, messageId) => {
        const fresh = !win;
        if (!win) createWindow();
        if (win!.isMinimized()) win!.restore();
        win!.show();
        app.focus({ steal: true });
        if (!chatId) return;
        const send = () => broadcast('open-chat', { chatId, messageId });
        if (fresh) win!.webContents.once('did-finish-load', () => setTimeout(send, 1500));
        else send();
      },
      toast: p => broadcast('notify', p),
      saveSettings: async patch => {
        const s = await saveSettings(patch);
        await notifier.apply(s);
        broadcast('settings', s);
      },
    }).catch(e => console.error('Notifications did not start:', e));
  }
});

// Closing the window keeps WA Turbo running so every number keeps receiving: in the Dock on a Mac,
// in the notification area on Windows. Without a tray icon (the database didn't start) Windows quits.
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !notifier.hasTray()) app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });
// Quitting waits for the built-in Postgres to shut down cleanly; a force quit leaves it running for the next launch to adopt.
let quitting = false;
app.on('before-quit', e => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  autoSummary.stop(); langDetect.stop(); notifier.stop(); manager.stopAll();
  void disconnect()
    .then(() => (externalDatabaseUrl() ? undefined : pgServer.stop()))
    .catch(err => console.error('Database shutdown:', err))
    .finally(() => app.quit());
});
