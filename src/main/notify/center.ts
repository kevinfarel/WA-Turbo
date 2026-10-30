import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { Loop, Message, OverdueChat, Settings } from '@shared/types';
import { fmtDur } from '@shared/sla';
import * as Q from '../db/queries';
import type { IngestAlert, IngestResult } from '../ingest/upsert';
import { BUNDLE_MS, STALE_MS, decide, overdueLoops, type Tier } from './decide';
import { TRAY_ICON } from './tray-icon';

// macOS notifications, the Dock badge and the menu bar icon. Read-only: it shows things and opens
// chats, and never sends anything to WhatsApp (scripts/check-send.mjs keeps main/notify off the send path).

export interface NotifyHooks {
  window(): BrowserWindow | null;
  /** Bring WA Turbo forward, on this chat and message when given. */
  open(chatId: string | null, messageId: string | null): void;
  /** In-app toast for a pinned chat while WA Turbo is in front on another chat. */
  toast(p: { chatId: string; messageId: string; title: string; body: string }): void;
  saveSettings(patch: Partial<Settings>): Promise<void>;
}

/** More chats than this in one batch (the Mac woke up, a number reconnected) become one catch-up banner. */
const CATCH_UP_CHATS = 4;
const OVERDUE_EVERY_MS = 60_000;

interface Banner { n: Notification; at: number; count: number; firstMsg: string; tier: Exclude<Tier, 'none'> }

export class Notifier {
  private hooks: NotifyHooks | null = null;
  private s: Settings = { ...Q.DEFAULT_SETTINGS };
  private activeChat: string | null = null;
  private banners = new Map<string, Banner>();
  private reminders = new Map<string, NodeJS.Timeout>();
  private seen = new Set<string>();
  private seeded = false;
  private overdue: OverdueChat[] = [];
  private tray: Tray | null = null;
  private timer: NodeJS.Timeout | null = null;
  private extra = new Set<Notification>();

  async start(hooks: NotifyHooks): Promise<void> {
    this.hooks = hooks;
    this.s = await Q.getSettings();
    await this.checkOverdue();
    await this.badge();
    this.timer = setInterval(() => void this.checkOverdue().catch(() => {}), OVERDUE_EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const t of this.reminders.values()) clearTimeout(t);
    this.reminders.clear();
    this.tray?.destroy();
    this.tray = null;
  }

  async apply(s: Settings): Promise<void> {
    this.s = s;
    if (!s.notifyRemindMin) { for (const t of this.reminders.values()) clearTimeout(t); this.reminders.clear(); }
    await this.badge();
    await this.checkOverdue();
  }

  /** The chat open in the window (null on other tabs), so its messages don't notify while you read it. */
  setActiveChat(chatId: string | null): void {
    this.activeChat = chatId;
  }

  /** You opened the chat: its banners and reminder go away and the badge drops. */
  async read(chatId: string): Promise<void> {
    const t = this.reminders.get(chatId);
    if (t) clearTimeout(t);
    this.reminders.delete(chatId);
    this.banners.get(chatId)?.n.close();
    this.banners.delete(chatId);
    await this.badge();
  }

  async onIngested(r: IngestResult): Promise<void> {
    if (!r.alerts.length) { await this.badge(); return; }
    const now = Date.now();
    const chats = new Map((await Q.notifyChats([...new Set(r.alerts.map(a => a.chatId))])).map(c => [c.id, c]));
    const msgs = new Map(r.messages.map(m => [m.id, m]));
    const front = this.inFront();
    const groups = new Map<string, { tier: Exclude<Tier, 'none'>; items: IngestAlert[] }>();
    for (const a of r.alerts) {
      const c = chats.get(a.chatId);
      if (!c) continue;
      const tier = decide({ fromMe: a.fromMe, kind: c.kind, pinned: c.pinned, mutedUntil: c.mutedUntil, mentionsMe: a.mentionsMe, quotedFromMe: a.quotedFromMe,
        viewing: front && this.activeChat === a.chatId }, this.s, now);
      if (tier === 'none') continue;
      const g = groups.get(a.chatId) ?? { tier, items: [] };
      g.items.push(a);
      groups.set(a.chatId, g);
    }
    if (groups.size > CATCH_UP_CHATS && !front) {
      const pinned = [...groups.values()].filter(g => g.tier === 'pinned').length;
      this.post({ title: 'WA Turbo', body: groups.size + ' chats have new messages' + (pinned ? ' · ' + pinned + ' pinned' : ''), silent: true }, () => this.hooks?.open(null, null));
    } else {
      for (const [chatId, g] of groups) {
        const c = chats.get(chatId)!;
        const last = msgs.get(g.items[g.items.length - 1].messageId);
        const stale = g.items.every(a => now - a.sentAt > STALE_MS);
        if (front) {
          if (g.tier === 'pinned' && last) this.hooks?.toast({ chatId, messageId: last.id, title: '📌 ' + c.name, body: this.preview(last, 1) });
          continue;
        }
        this.banner(c, g.tier, g.items, last, stale, now);
      }
    }
    await this.badge();
  }

  private banner(c: Q.NotifyChat, tier: Exclude<Tier, 'none'>, items: IngestAlert[], last: Message | undefined, stale: boolean, now: number): void {
    const prev = this.banners.get(c.id);
    const bundled = !!prev && now - prev.at < BUNDLE_MS[tier];
    const count = (bundled ? prev!.count : 0) + items.length;
    const firstMsg = bundled ? prev!.firstMsg : items[0].messageId;
    const sound = tier === 'pinned' ? this.s.notifyPinnedSound : this.s.notifyOtherSound;
    const quiet = bundled || stale || sound === 'None';
    const sender = c.kind === 'group' && last && last.who !== 'me' ? last.who : null;
    prev?.n.close();
    const n = this.post({
      id: 'chat-' + c.id,
      groupId: tier === 'pinned' ? 'pin-' + c.id : 'others',
      title: (tier === 'pinned' ? '📌 ' : '') + c.name,
      subtitle: [tier === 'pinned' ? 'Pinned' : null, c.acct, sender].filter(Boolean).join(' · '),
      body: last ? this.preview(last, count) : count + ' new messages',
      silent: quiet,
      ...(quiet ? {} : { sound }),
    }, () => this.hooks?.open(c.id, firstMsg), false);
    this.banners.set(c.id, { n, at: bundled ? prev!.at : now, count, firstMsg, tier });
    if (tier !== 'pinned') return;
    if (!stale) app.dock?.bounce('critical');
    if (this.s.notifyRemindMin > 0 && !this.reminders.has(c.id)) {
      this.reminders.set(c.id, setTimeout(() => void this.remind(c.id).catch(() => {}), this.s.notifyRemindMin * 60_000));
    }
  }

  private async remind(chatId: string): Promise<void> {
    this.reminders.delete(chatId);
    const [c] = await Q.notifyChats([chatId]);
    const now = Date.now();
    if (!c || !c.pinned || c.unread <= 0 || !this.s.notifyOn || this.s.notifyPausedUntil > now || (c.mutedUntil !== null && c.mutedUntil > now)) return;
    if (this.inFront() && this.activeChat === chatId) return;
    const first = this.banners.get(chatId)?.firstMsg ?? null;
    this.banners.get(chatId)?.n.close();
    const n = this.post({
      id: 'chat-' + chatId, groupId: 'pin-' + chatId, title: '📌 ' + c.name, subtitle: 'Pinned · ' + c.acct,
      body: 'Still unread · ' + c.unread + (c.unread === 1 ? ' message' : ' messages'),
      silent: this.s.notifyPinnedSound === 'None', ...(this.s.notifyPinnedSound === 'None' ? {} : { sound: this.s.notifyPinnedSound }),
    }, () => this.hooks?.open(chatId, first), false);
    this.banners.set(chatId, { n, at: now, count: c.unread, firstMsg: first ?? '', tier: 'pinned' });
    if (!this.inFront()) app.dock?.bounce('critical');
  }

  /** Re-checks pinned chats waiting too long for your reply: menu bar count, list, and one banner per newly overdue ask. */
  async checkOverdue(loops?: Loop[]): Promise<void> {
    const now = Date.now();
    const pinned = await Q.notifyChats(null);
    const byId = new Map(pinned.map(c => [c.id, c]));
    const list = overdueLoops(loops ?? (await Q.listLoops()), new Set(byId.keys()), now);
    const quiet = !this.s.notifyOn || !this.s.notifyOverdue || this.s.notifyPausedUntil > now;
    const ids = new Set(list.map(x => x.loop.id));
    for (const { loop, waitedH } of list) {
      if (this.seen.has(loop.id)) continue;
      this.seen.add(loop.id);
      const c = byId.get(loop.chatId)!;
      if (!this.seeded || quiet || (c.mutedUntil !== null && c.mutedUntil > now)) continue;
      this.post({
        id: 'overdue-' + loop.id, groupId: 'pin-' + c.id, title: '📌 ' + c.name + ' is waiting on you',
        subtitle: 'Pinned · ' + c.acct + ' · ' + fmtDur(waitedH) + ' without your reply', body: loop.topic,
        ...(this.s.notifyPinnedSound === 'None' ? { silent: true } : { sound: this.s.notifyPinnedSound }),
      }, () => this.hooks?.open(c.id, loop.msgId));
    }
    for (const id of this.seen) if (!ids.has(id)) this.seen.delete(id);
    this.seeded = true;
    const firstPerChat = new Map<string, OverdueChat>();
    for (const { loop, waitedH } of list) {
      if (firstPerChat.has(loop.chatId)) continue;
      const c = byId.get(loop.chatId)!;
      firstPerChat.set(loop.chatId, { chatId: c.id, name: c.name, acct: c.acct, waitedH, topic: loop.topic });
    }
    this.overdue = [...firstPerChat.values()];
    this.renderTray();
  }

  /** A sample of each tier, from Settings. */
  test(): void {
    this.post({ title: '📌 Example pinned chat', subtitle: 'Pinned · test', body: 'This is how a pinned chat looks and sounds.',
      ...(this.s.notifyPinnedSound === 'None' ? { silent: true } : { sound: this.s.notifyPinnedSound }) }, () => this.hooks?.open(null, null));
    setTimeout(() => this.post({ title: 'Example chat', subtitle: 'test', body: 'And this is every other chat.', groupId: 'others',
      ...(this.s.notifyOtherSound === 'None' ? { silent: true } : { sound: this.s.notifyOtherSound }) }, () => this.hooks?.open(null, null)), 2500);
  }

  supported(): boolean {
    return Notification.isSupported();
  }

  private async badge(): Promise<void> {
    const t = await Q.unreadTotals();
    const n = this.s.notifyBadge === 'chats' ? t.chats : this.s.notifyBadge === 'messages' ? t.messages : this.s.notifyBadge === 'pinned' ? t.pinned : 0;
    app.setBadgeCount(n);
  }

  private renderTray(): void {
    if (!this.s.menuBar) { this.tray?.destroy(); this.tray = null; return; }
    const n = this.overdue.length;
    const img = nativeImage.createFromBuffer(Buffer.from(n ? TRAY_ICON.alert : TRAY_ICON.normal, 'base64'), { scaleFactor: 2 });
    img.setTemplateImage(true);
    if (!this.tray) { this.tray = new Tray(img); this.tray.setToolTip('WA Turbo'); } else this.tray.setImage(img);
    this.tray.setTitle(n ? String(n) : '', { fontType: 'monospacedDigit' });
    const now = Date.now();
    const paused = this.s.notifyPausedUntil > now;
    const items: MenuItemConstructorOptions[] = [
      { label: n ? n + (n === 1 ? ' pinned chat is' : ' pinned chats are') + ' waiting on your reply' : 'No pinned chat is waiting on you', enabled: false },
      ...this.overdue.map(o => ({ label: o.name + ' · ' + fmtDur(o.waitedH), sublabel: o.acct + ' · ' + o.topic, click: () => this.hooks?.open(o.chatId, null) })),
      { type: 'separator' },
      { label: 'Open WA Turbo', click: () => this.hooks?.open(null, null) },
      paused
        ? { label: 'Resume notifications (paused until ' + new Date(this.s.notifyPausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')',
            click: () => void this.hooks?.saveSettings({ notifyPausedUntil: 0 }) }
        : { label: 'Pause notifications', submenu: [
            { label: 'For 1 hour', click: () => void this.hooks?.saveSettings({ notifyPausedUntil: Date.now() + 3_600_000 }) },
            { label: 'Until tomorrow 08:00', click: () => void this.hooks?.saveSettings({ notifyPausedUntil: tomorrowAt8() }) },
          ] },
      { type: 'separator' },
      { label: 'Quit WA Turbo', click: () => app.quit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  private inFront(): boolean {
    const w = this.hooks?.window();
    return !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused();
  }

  private preview(m: Message, count: number): string {
    const text = !this.s.notifyPreview ? 'New message' : m.text ? m.text.replace(/\s+/g, ' ').slice(0, 180) : Q.mediaLabel(m.type);
    return count > 1 ? count + ' new messages' + (this.s.notifyPreview ? ' · ' + text : '') : text;
  }

  /** Shows one notification and keeps a reference until it is clicked or closed (click handlers need the object alive). */
  private post(o: Electron.NotificationConstructorOptions, onClick: () => void, track = true): Notification {
    const n = new Notification(o);
    n.on('click', onClick);
    if (track) {
      this.extra.add(n);
      if (this.extra.size > 50) this.extra.delete(this.extra.values().next().value!);
      n.on('close', () => this.extra.delete(n));
      n.on('click', () => this.extra.delete(n));
    }
    n.show();
    return n;
  }
}

function tomorrowAt8(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

export const notifier = new Notifier();
