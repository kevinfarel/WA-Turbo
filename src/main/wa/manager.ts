import { EventEmitter } from 'node:events';
import QRCode from 'qrcode';
import type { WAMessageKey } from 'baileys';
import type { Account, Accent, PairState } from '@shared/types';
import { authClear, createAccount, deleteAccount, listAccounts, updateAccount } from '../db/queries';
import type { IngestResult } from '../ingest/upsert';
import { HERE } from '../config';
import { WaSession } from './session';

export interface ManagerEvents {
  accounts: [accounts: Account[]];
  pair: [state: PairState];
  ingested: [accountId: string, result: IngestResult];
}

export class WaManager extends EventEmitter<ManagerEvents> {
  private sessions = new Map<string, WaSession>();
  private pair: PairState = { accountId: null, phase: 'name', qrSvg: null, error: null };

  /** Starts a session for every linked account; drops accounts whose pairing never finished. */
  async startAll(): Promise<void> {
    for (const a of await listAccounts()) {
      if (a.status === 'pairing' && !a.pairedAt) { await deleteAccount(a.id); continue; }
      if (a.status === 'logged_out') continue;
      await this.spawn(a.id);
    }
    await this.pushAccounts();
  }

  stopAll(): void {
    for (const s of this.sessions.values()) s.stop();
    this.sessions.clear();
  }

  session(accountId: string): WaSession | undefined {
    return this.sessions.get(accountId);
  }

  /** A message the person typed and sent from the chat window. */
  async send(accountId: string, chatJid: string, body: { text: string; image?: { buf: Buffer; mime: string } }): Promise<string> {
    const s = this.sessions.get(accountId);
    if (!s) throw new Error('This number is not linked on ' + HERE + '.');
    return s.send(chatJid, body);
  }

  /** An edit of your own message, made from the chat window. */
  async edit(accountId: string, chatJid: string, key: WAMessageKey, text: string): Promise<void> {
    const s = this.sessions.get(accountId);
    if (!s) throw new Error('This number is not linked on ' + HERE + '.');
    await s.edit(chatJid, key, text);
  }

  /** Delete for everyone of your own message, confirmed in the chat window. */
  async revoke(accountId: string, chatJid: string, key: WAMessageKey): Promise<void> {
    const s = this.sessions.get(accountId);
    if (!s) throw new Error('This number is not linked on ' + HERE + '.');
    await s.revoke(chatJid, key);
  }

  async startPairing(name: string, desc: string, accent: Accent): Promise<PairState> {
    await this.cancelPairing();
    const id = await createAccount(name.trim(), desc.trim(), accent);
    this.pair = { accountId: id, phase: 'wait', qrSvg: null, error: null };
    await this.spawn(id);
    this.emit('pair', this.pair);
    return this.pair;
  }

  async refreshPairing(): Promise<PairState> {
    const id = this.pair.accountId;
    if (!id) return this.pair;
    this.sessions.get(id)?.stop();
    this.sessions.delete(id);
    await authClear(id);
    this.pair = { ...this.pair, phase: 'wait', qrSvg: null, error: null };
    await this.spawn(id);
    this.emit('pair', this.pair);
    return this.pair;
  }

  async cancelPairing(): Promise<void> {
    const id = this.pair.accountId;
    this.pair = { accountId: null, phase: 'name', qrSvg: null, error: null };
    if (!id) return;
    const s = this.sessions.get(id);
    if (s && s.status !== 'online') {
      s.stop();
      this.sessions.delete(id);
      await deleteAccount(id);
      await this.pushAccounts();
    }
  }

  async reconnect(accountId: string): Promise<void> {
    this.sessions.get(accountId)?.stop();
    this.sessions.delete(accountId);
    await updateAccount(accountId, { status: 'reconnecting' });
    await this.spawn(accountId);
    await this.pushAccounts();
  }

  /** Unlinks the number and deletes everything stored for it. */
  async unlink(accountId: string): Promise<void> {
    const s = this.sessions.get(accountId);
    this.sessions.delete(accountId);
    if (s) await s.logout();
    await deleteAccount(accountId);
    await this.pushAccounts();
  }

  private async spawn(accountId: string): Promise<void> {
    const s = new WaSession(accountId);
    this.sessions.set(accountId, s);
    s.on('qr', qr => void this.onQr(accountId, qr));
    s.on('linking', () => this.setPair(accountId, { phase: 'linking' }));
    s.on('status', st => {
      if (st === 'online') this.setPair(accountId, { phase: 'linked', qrSvg: null });
      void this.pushAccounts();
    });
    s.on('ingested', r => this.emit('ingested', accountId, r));
    s.on('error', msg => this.setPair(accountId, { error: msg }));
    await s.start();
  }

  private async onQr(accountId: string, qr: string): Promise<void> {
    if (this.pair.accountId !== accountId) return;
    const svg = await QRCode.toString(qr, { type: 'svg', margin: 0, errorCorrectionLevel: 'L', color: { dark: '#14171c', light: '#ffffff' } });
    this.setPair(accountId, { phase: 'wait', qrSvg: svg });
  }

  private setPair(accountId: string, patch: Partial<PairState>): void {
    if (this.pair.accountId !== accountId) return;
    if (this.pair.phase === 'linked' && patch.phase && patch.phase !== 'linked') return;
    this.pair = { ...this.pair, ...patch };
    this.emit('pair', this.pair);
  }

  private async pushAccounts(): Promise<void> {
    this.emit('accounts', await listAccounts());
  }
}
