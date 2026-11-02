import {
  BufferJSON, getContentType, isJidBroadcast, isJidGroup, isJidStatusBroadcast, isLidUser, jidNormalizedUser, normalizeMessageContent,
  type WAMessage, type proto,
} from 'baileys';
import type { MessageType } from '@shared/types';
import type { MessageIn } from '../db/queries';

// The only module that reads raw Baileys message shapes. A protocol change gets fixed here.

export interface Identity { pn: string | null; lid: string | null } // my own JIDs, normalized

/** Keeps LID ↔ phone-number mappings so a DM has one chat whichever ID WhatsApp uses. */
export class JidBook {
  private lidToPn = new Map<string, string>();

  learn(lid: string | null | undefined, pn: string | null | undefined): void {
    if (lid && pn && isLidUser(lid)) this.lidToPn.set(jidNormalizedUser(lid), jidNormalizedUser(pn));
  }

  /** The other form of a person's ID (LID for a phone-number ID and the reverse), when known. */
  altOf(jid: string): string | null {
    const j = jidNormalizedUser(jid);
    if (isLidUser(j)) return this.lidToPn.get(j) ?? null;
    for (const [lid, pn] of this.lidToPn) if (pn === j) return lid;
    return null;
  }

  canonical(jid: string, alt?: string | null): string {
    const j = jidNormalizedUser(jid);
    if (!isLidUser(j)) return j;
    if (alt && !isLidUser(alt)) {
      this.learn(j, alt);
      return jidNormalizedUser(alt);
    }
    return this.lidToPn.get(j) ?? j;
  }
}

export function skipChat(jid: string | null | undefined): boolean {
  if (!jid) return true;
  return isJidStatusBroadcast(jid) || !!isJidBroadcast(jid) || jid.endsWith('@newsletter');
}

export const isGroupJid = (jid: string): boolean => !!isJidGroup(jid);

export const phoneOf = (jid: string | null | undefined): string => {
  if (!jid || isLidUser(jid)) return ''; // a LID's digits are not a phone number
  const user = (jid ?? '').split('@')[0].split(':')[0];
  return /^\d{6,}$/.test(user) ? '+' + user : '';
};

const tsOf = (t: WAMessage['messageTimestamp']): number => {
  if (!t) return Date.now();
  const n = typeof t === 'number' ? t : Number(t.toString());
  return n * 1000;
};

type AnyContent = { contextInfo?: proto.IContextInfo | null; caption?: string | null; text?: string | null; fileName?: string | null; mimetype?: string | null; jpegThumbnail?: Uint8Array | null };

export type Mapped =
  | { kind: 'message'; chatJid: string; isGroup: boolean; msg: MessageIn }
  | { kind: 'edit'; chatJid: string; waId: string; text: string }
  | { kind: 'delete'; chatJid: string; waId: string }
  | { kind: 'skip' };

export function mapMessage(m: WAMessage, me: Identity, book: JidBook, names: (jid: string) => string | null): Mapped {
  const key = m.key;
  if (!key?.remoteJid || !key.id || skipChat(key.remoteJid)) return { kind: 'skip' };
  const group = isGroupJid(key.remoteJid);
  const chatJid = group ? jidNormalizedUser(key.remoteJid) : book.canonical(key.remoteJid, key.remoteJidAlt);

  const content = normalizeMessageContent(m.message);
  if (!content) {
    if (m.messageStubType) return { kind: 'skip' };
    return { kind: 'skip' };
  }

  // Edits and deletes arrive as protocol messages pointing at another message.
  const pm = content.protocolMessage;
  if (pm?.key?.id) {
    if (pm.type === 0 /* REVOKE */) return { kind: 'delete', chatJid, waId: pm.key.id };
    const edited = pm.editedMessage ? textOf(normalizeMessageContent(pm.editedMessage)) : '';
    if (edited) return { kind: 'edit', chatJid, waId: pm.key.id, text: edited };
    return { kind: 'skip' };
  }

  const ctype = getContentType(content);
  if (!ctype || ctype === 'reactionMessage' || ctype === 'senderKeyDistributionMessage' || ctype === 'pollUpdateMessage') return { kind: 'skip' };

  const type = typeOf(ctype);
  const body = (content[ctype] ?? {}) as AnyContent;
  const text = textOf(content);
  if (type === 'other' && !text) return { kind: 'skip' };

  const ctx = body.contextInfo ?? content.extendedTextMessage?.contextInfo ?? null;
  const mine = (j: string | null | undefined) => !!j && [me.pn, me.lid].includes(jidNormalizedUser(j));
  const fromMe = !!key.fromMe;

  let senderJid: string | null = null;
  let senderName: string | null = null;
  if (!fromMe) {
    // Live group messages carry the sender on the key; history sync puts it on the message itself.
    const participant = key.participant || m.participant || '';
    senderJid = group ? (participant ? book.canonical(participant, key.participantAlt) : null) : chatJid;
    senderName = (senderJid && names(senderJid)) || m.pushName || phoneOf(senderJid) || null;
  }

  const media = type === 'image' || type === 'video' || type === 'document' || type === 'audio' || type === 'sticker'
    ? { mime: body.mimetype ?? '', fileName: body.fileName ?? null, thumb: body.jpegThumbnail ? Buffer.from(body.jpegThumbnail).toString('base64') : null }
    : null;

  return {
    kind: 'message', chatJid, isGroup: group,
    msg: {
      waId: key.id, senderJid, senderName, fromMe, sentAt: tsOf(m.messageTimestamp), type, text,
      quotedWaId: ctx?.stanzaId ?? null,
      quotedFromMe: !!ctx?.stanzaId && mine(ctx.participant),
      mentionsMe: (ctx?.mentionedJid ?? []).some(j => mine(j)),
      mentions: mentionsOf(ctx?.mentionedJid, mine, book),
      media,
      raw: media ? JSON.parse(JSON.stringify(m, BufferJSON.replacer)) : {
        key: m.key, ...(m.participant ? { participant: m.participant } : {}), ...(m.pushName ? { pushName: m.pushName } : {}),
        message: m.message ? { conversation: text } : null,
      },
    },
  };
}

/** "@<number>" as written in the text → the tagged person's ID (phone-number form when known), 'me' for you. */
function mentionsOf(jids: string[] | null | undefined, mine: (j: string) => boolean, book: JidBook): Record<string, string> | null {
  if (!jids?.length) return null;
  const out: Record<string, string> = {};
  for (const j of jids) {
    const tok = jidNormalizedUser(j).split('@')[0];
    if (tok) out[tok] = mine(j) ? 'me' : book.canonical(j);
  }
  return Object.keys(out).length ? out : null;
}

function typeOf(ctype: string): MessageType {
  switch (ctype) {
    case 'conversation': case 'extendedTextMessage': return 'text';
    case 'imageMessage': return 'image';
    case 'videoMessage': case 'ptvMessage': return 'video';
    case 'audioMessage': return 'audio';
    case 'documentMessage': case 'documentWithCaptionMessage': return 'document';
    case 'stickerMessage': return 'sticker';
    case 'locationMessage': case 'liveLocationMessage': return 'location';
    case 'contactMessage': case 'contactsArrayMessage': return 'contact';
    default: return 'other';
  }
}

function textOf(c: proto.IMessage | undefined): string {
  if (!c) return '';
  return (
    c.conversation ||
    c.extendedTextMessage?.text ||
    c.imageMessage?.caption ||
    c.videoMessage?.caption ||
    c.documentMessage?.caption ||
    c.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    c.buttonsResponseMessage?.selectedDisplayText ||
    c.listResponseMessage?.title ||
    ''
  ).trim();
}
