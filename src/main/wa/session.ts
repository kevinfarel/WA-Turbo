import { EventEmitter } from 'node:events';
import makeWASocket, {
  Browsers, BufferJSON, DisconnectReason, downloadMediaMessage, jidNormalizedUser, makeCacheableSignalKeyStore,
  type AnyMessageContent, type ConnectionState, type Contact, type GroupParticipant, type WAMessage, type WAMessageKey, type WASocket,
} from 'baileys';
import pino from 'pino';
import type { AccountStatus } from '@shared/types';
import { formatPhone } from '@shared/phone';
import { fixSenders, messageRaw, sendersToFix, setChatSubtitle, updateAccount, upsertChat, upsertContacts, type ContactIn } from '../db/queries';
import { ingest, type IngestResult } from '../ingest/upsert';
import { usePgAuthState } from './auth-state-pg';
import { JidBook, isGroupJid, mapMessage, phoneOf, skipChat, type Identity } from './mappers';

// One linked device per WhatsApp number. It listens to events and runs read queries (group names).
// It sends only what the person does by hand: a message they typed and pressed Send on, or an edit or
// delete-for-everyone of their own message (send/edit/revoke below, all through out()).
// No automatic, scheduled or AI-written messages, and no read receipts or presence.

const MEMBERS_TTL = 10 * 60_000;

const logger = pino({ level: process.env.WA_TURBO_DEBUG ? 'debug' : 'warn' });

export interface SessionEvents {
  qr: [qr: string];
  linking: [];
  status: [status: AccountStatus];
  ingested: [result: IngestResult];
  error: [message: string];
}

export class WaSession extends EventEmitter<SessionEvents> {
  private sock: WASocket | null = null;
  private stopped = false;
  private retry = 0;
  private timer: NodeJS.Timeout | null = null;
  private me: Identity = { pn: null, lid: null };
  private book = new JidBook();
  private contactNames = new Map<string, string>();
  private groupNames = new Map<string, string>();
  // Each group's members as WhatsApp addresses them (the ID a tag must use), refreshed when older than MEMBERS_TTL.
  private groupMembers = new Map<string, { at: number; ids: string[] }>();
  status: AccountStatus = 'reconnecting';

  constructor(readonly accountId: string) {
    super();
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.sock?.end(undefined);
    this.sock = null;
  }

  /** Unlinks this Mac from the phone ("Linked devices" entry disappears). */
  async logout(): Promise<void> {
    this.stopped = true;
    try { await this.sock?.logout(); } catch { /* already gone */ }
    this.sock = null;
  }

  /** Sends one message the person wrote: text, or a photo with an optional caption, tagging `mentions`. Returns its WhatsApp id. */
  async send(chatJid: string, body: { text: string; image?: { buf: Buffer; mime: string }; mentions?: string[] }): Promise<string> {
    const tags = body.mentions?.length ? { mentions: body.mentions } : {};
    const content = body.image
      ? { image: body.image.buf, mimetype: body.image.mime, ...(body.text ? { caption: body.text } : {}), ...tags }
      : { text: body.text, ...tags };
    const sent = await this.out(chatJid, content);
    if (!sent?.key.id) throw new Error('WhatsApp did not accept the message. Try again.');
    await this.store([sent], true);
    return sent.key.id;
  }

  /** Replaces the text of a message you sent. The chat shows it as edited for everyone. */
  async edit(chatJid: string, key: WAMessageKey, text: string): Promise<void> {
    await this.out(key.remoteJid || chatJid, { text, edit: key });
  }

  /** Deletes a message you sent for everyone in the chat ("This message was deleted"). */
  async revoke(chatJid: string, key: WAMessageKey): Promise<void> {
    await this.out(key.remoteJid || chatJid, { delete: key });
  }

  /** The single call that reaches WhatsApp. */
  private async out(jid: string, content: AnyMessageContent): Promise<WAMessage | undefined> {
    const sock = this.sock;
    if (!sock || this.status !== 'online') throw new Error('This number is not connected right now. Wait until it is back online.');
    return sock.sendMessage(jid, content);
  }

  /**
   * The people in a group other than you: the ID to tag them with, their phone-number ID when known,
   * and the name WhatsApp gave us. A read query, asked again when the list is older than 10 minutes.
   */
  async members(groupJid: string): Promise<{ id: string; pn: string; name: string | null }[]> {
    let cached = this.groupMembers.get(groupJid);
    if (this.sock && this.status === 'online' && (!cached || Date.now() - cached.at > MEMBERS_TTL)) {
      try {
        const g = await this.sock.groupMetadata(groupJid);
        this.learnMembers(g.id, g.participants);
        cached = this.groupMembers.get(groupJid);
      } catch (e) {
        logger.warn({ err: e }, 'group members fetch failed');
      }
    }
    // Members WhatsApp lists by LID only: look up their phone number locally, as message senders are.
    await this.resolveLids(cached?.ids ?? []);
    const mine = [this.me.pn, this.me.lid];
    return (cached?.ids ?? [])
      .map(id => ({ id, pn: this.book.canonical(id) }))
      .filter(m => !mine.includes(m.id) && !mine.includes(m.pn))
      .map(m => ({ ...m, name: this.contactNames.get(m.pn) ?? null }));
  }

  private learnMembers(groupJid: string, participants: GroupParticipant[]): void {
    // Members come with both IDs, so history-sync messages (LID only) can be named after their phone number.
    for (const p of participants) {
      this.book.learn(p.lid ?? (p.id.endsWith('@lid') ? p.id : null), p.phoneNumber ?? (p.id.endsWith('@s.whatsapp.net') ? p.id : null));
      const pn = this.book.canonical(p.id, p.phoneNumber);
      const nm = p.name || p.notify || p.verifiedName;
      if (nm && !this.contactNames.has(pn)) this.contactNames.set(pn, nm);
    }
    this.groupMembers.set(groupJid, { at: Date.now(), ids: participants.map(p => jidNormalizedUser(p.id)) });
  }

  /** The other ID (LID or phone number) of someone in your chats, when WhatsApp has told us. */
  altJid(jid: string): string | null {
    return this.book.altOf(jid);
  }

  async downloadMedia(raw: unknown): Promise<Buffer> {
    const msg = JSON.parse(JSON.stringify(raw), BufferJSON.reviver) as WAMessage;
    return downloadMediaMessage(msg, 'buffer', {});
  }

  private setStatus(s: AccountStatus): void {
    if (this.status === s) return;
    this.status = s;
    void updateAccount(this.accountId, { status: s });
    this.emit('status', s);
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await usePgAuthState(this.accountId);
    const sock = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      logger,
      browser: process.platform === 'win32' ? Browsers.windows('WA Turbo') : Browsers.macOS('WA Turbo'),
      syncFullHistory: true,
      markOnlineOnConnect: false,
      shouldIgnoreJid: jid => skipChat(jid),
      getMessage: async key => {
        if (!key.remoteJid || !key.id) return undefined;
        const raw = (await messageRaw(this.accountId, jidNormalizedUser(key.remoteJid), key.id)) as WAMessage | null;
        return raw?.message ?? undefined;
      },
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', u => void this.onConnection(u, sock));

    sock.ev.on('lid-mapping.update', m => this.book.learn(m.lid, m.pn));
    sock.ev.on('contacts.upsert', c => void this.onContacts(c));
    sock.ev.on('contacts.update', c => void this.onContacts(c as Contact[]));
    sock.ev.on('groups.upsert', gs => gs.forEach(g => g.subject && this.groupNames.set(g.id, g.subject)));
    sock.ev.on('groups.update', gs => gs.forEach(g => g.id && g.subject && this.groupNames.set(g.id, g.subject)));

    sock.ev.on('messaging-history.set', h => void this.safe(async () => {
      for (const m of h.lidPnMappings ?? []) this.book.learn(m.lid, m.pn);
      await this.onContacts(h.contacts);
      for (const c of h.chats) if (c.id && c.name) (isGroupJid(c.id) ? this.groupNames : this.contactNames).set(jidNormalizedUser(c.id), c.name);
      await this.store(h.messages, false);
    }));

    // Your own messages (sent here or on the phone) arrive as 'append'; recent ones are live too.
    sock.ev.on('messages.upsert', e => void this.safe(async () => {
      const recentOwn = (m: WAMessage) => !!m.key.fromMe && Date.now() - Number(m.messageTimestamp ?? 0) * 1000 < 120_000;
      const live = e.type === 'notify' ? e.messages : e.messages.filter(recentOwn);
      const rest = e.type === 'notify' ? [] : e.messages.filter(m => !recentOwn(m));
      if (live.length) await this.store(live, true);
      if (rest.length) await this.store(rest, false);
    }));
  }

  private async onConnection(u: Partial<ConnectionState>, sock: WASocket): Promise<void> {
    if (sock !== this.sock) return;
    if (u.qr) {
      this.setStatus('pairing');
      this.emit('qr', u.qr);
    }
    if (u.isNewLogin) this.emit('linking');
    if (u.connection === 'open') {
      this.retry = 0;
      const user = sock.user;
      this.me = { pn: user?.id ? jidNormalizedUser(user.id) : null, lid: user?.lid ? jidNormalizedUser(user.lid) : null };
      this.book.learn(this.me.lid, this.me.pn);
      await updateAccount(this.accountId, { status: 'online', phone: formatPhone(phoneOf(this.me.pn)), jid: this.me.pn ?? undefined, pairedNow: this.status === 'pairing' });
      this.setStatus('online');
      void this.safe(async () => { await this.loadGroups(sock); await this.backfillSenders(); });
    }
    if (u.connection === 'close') {
      const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (this.stopped) return;
      if (code === DisconnectReason.loggedOut) {
        this.stopped = true;
        this.setStatus('logged_out');
        return;
      }
      if (code === DisconnectReason.restartRequired) {
        this.emit('linking'); // normal right after a QR scan
        void this.safe(() => this.connect());
        return;
      }
      if (this.status !== 'pairing') this.setStatus('reconnecting');
      const delay = Math.min(60_000, 2_000 * 2 ** this.retry++);
      this.timer = setTimeout(() => void this.safe(() => this.connect()), delay);
    }
  }

  private async onContacts(list: Contact[]): Promise<void> {
    const rows: ContactIn[] = [];
    for (const c of list) {
      if (!c.id) continue;
      this.book.learn(c.lid ?? (c.id.endsWith('@lid') ? c.id : null), c.phoneNumber ?? (c.id.endsWith('@s.whatsapp.net') ? c.id : null));
      const jid = this.book.canonical(c.id, c.phoneNumber);
      const name = c.name || c.verifiedName || null;
      if (name || c.notify) this.contactNames.set(jid, (name || c.notify)!);
      rows.push({ jid, lid: c.lid ?? null, phone: phoneOf(c.phoneNumber ?? jid) || null, name, notify: c.notify ?? null });
    }
    await upsertContacts(this.accountId, rows);
  }

  private async loadGroups(sock: WASocket): Promise<void> {
    const groups = await sock.groupFetchAllParticipating();
    for (const g of Object.values(groups)) {
      if (g.subject) this.groupNames.set(g.id, g.subject);
      this.learnMembers(g.id, g.participants);
      await upsertChat(null, this.accountId, g.id, 'group', g.subject || null);
      await setChatSubtitle(this.accountId, g.id, `${g.participants.length} members`);
    }
  }

  private async store(messages: WAMessage[], live: boolean): Promise<void> {
    if (!messages.length) return;
    const names = (jid: string) => this.contactNames.get(jid) ?? null;
    await this.resolveLids(messages.map(m => (m.key.participantAlt ? '' : m.key.participant || m.participant || '')));
    const mapped = messages.map(m => {
      if (m.pushName && !m.key.fromMe) {
        const who = isGroupJid(m.key.remoteJid ?? '') ? this.book.canonical(m.key.participant ?? '', m.key.participantAlt) : this.book.canonical(m.key.remoteJid ?? '', m.key.remoteJidAlt);
        if (who && !this.contactNames.has(who)) this.contactNames.set(who, m.pushName);
      }
      return mapMessage(m, this.me, this.book, names);
    });
    const result = await ingest(this.accountId, mapped, live, (jid, group) =>
      group ? this.groupNames.get(jid) ?? null : this.contactNames.get(jid) ?? (formatPhone(phoneOf(jid)) || null));
    if (result.chats.size) this.emit('ingested', result);
  }

  /** Asks Baileys' own LID store for phone numbers the book doesn't know yet (read locally, nothing is sent). */
  private async resolveLids(jids: string[]): Promise<void> {
    const repo = this.sock?.signalRepository;
    if (!repo) return;
    const todo = [...new Set(jids.filter(j => j.endsWith('@lid')).map(j => jidNormalizedUser(j)))].filter(j => this.book.canonical(j) === j);
    for (const lid of todo) {
      const pn = await repo.lidMapping.getPNForLID(lid).catch(() => null);
      if (pn) this.book.learn(lid, pn);
    }
  }

  /** Fills in the sender of group messages stored before senders were read from history sync. */
  private async backfillSenders(): Promise<void> {
    const rows = await sendersToFix(this.accountId);
    if (!rows.length) return;
    await this.resolveLids(rows.map(r => r.participant));
    const fixed = rows.map(r => {
      const jid = this.book.canonical(r.participant, r.alt);
      return { id: r.id, jid, name: this.contactNames.get(jid) || r.pushName || phoneOf(jid) || null };
    });
    await fixSenders(fixed);
    logger.info({ count: fixed.length }, 'filled in group message senders');
  }

  private async safe(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      logger.error({ err: e }, 'session task failed');
      this.emit('error', e instanceof Error ? e.message : String(e));
    }
  }
}

