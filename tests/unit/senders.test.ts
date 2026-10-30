import { describe, expect, it } from 'vitest';
import type { WAMessage } from 'baileys';
import { JidBook, mapMessage, phoneOf } from '../../src/main/wa/mappers';

const me = { pn: '6281200000000@s.whatsapp.net', lid: '99999@lid' };
const names = () => null;
const groupMsg = (o: Partial<WAMessage>): WAMessage => ({
  key: { remoteJid: '120363000000000000@g.us', id: 'ABC', fromMe: false }, message: { conversation: 'Ada update?' }, messageTimestamp: 1_790_000_000, ...o,
}) as WAMessage;

describe('group message senders', () => {
  it('reads the sender from history sync (on the message, not the key)', () => {
    const book = new JidBook();
    book.learn('240059261403301@lid', '6285117616620@s.whatsapp.net');
    const r = mapMessage(groupMsg({ participant: '240059261403301@lid' }), me, book, names);
    expect(r.kind).toBe('message');
    if (r.kind !== 'message') return;
    expect(r.msg.senderJid).toBe('6285117616620@s.whatsapp.net');
    expect(r.msg.senderName).toBe('+6285117616620');
    expect((r.msg.raw as { participant?: string }).participant).toBe('240059261403301@lid');
  });
  it('live messages: key.participant with the phone number alongside', () => {
    const r = mapMessage(groupMsg({ key: { remoteJid: '120363000000000000@g.us', id: 'D', fromMe: false, participant: '212232185073818@lid', participantAlt: '628138361376@s.whatsapp.net' } }), me, new JidBook(), names);
    expect(r.kind === 'message' && r.msg.senderJid).toBe('628138361376@s.whatsapp.net');
  });
  it('no sender at all is stored as unknown, not as an empty ID', () => {
    const r = mapMessage(groupMsg({}), me, new JidBook(), names);
    expect(r.kind === 'message' && r.msg.senderJid).toBeNull();
  });
  it("a LID's digits are never shown as a phone number", () => {
    expect(phoneOf('240059261403301@lid')).toBe('');
    expect(phoneOf('6285117616620@s.whatsapp.net')).toBe('+6285117616620');
  });
});
