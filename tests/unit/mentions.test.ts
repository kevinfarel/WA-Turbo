import { describe, expect, it } from 'vitest';
import type { WAMessage } from 'baileys';
import { encodeMentions, withMentions } from '../../src/shared/mentions';
import { fmtText } from '../../src/renderer/format';
import { JidBook, mapMessage } from '../../src/main/wa/mappers';

const me = { pn: '6281200000000@s.whatsapp.net', lid: '99999@lid' };

describe('@ tags', () => {
  it('turns "@Name" into the number WhatsApp expects, with the tagged IDs', () => {
    const r = encodeMentions('@Budi Santoso tolong cek, cc @Ani', [
      { name: 'Ani', jid: '6281311112222@s.whatsapp.net' },
      { name: 'Budi Santoso', jid: '240059261403301@lid' },
    ]);
    expect(r.text).toBe('@240059261403301 tolong cek, cc @6281311112222');
    expect(r.jids).toEqual(['240059261403301@lid', '6281311112222@s.whatsapp.net']);
  });
  it('drops a tag the person deleted, and never matches inside a longer name', () => {
    const r = encodeMentions('hi @Budiman', [{ name: 'Budi', jid: '628111@s.whatsapp.net' }]);
    expect(r).toEqual({ text: 'hi @Budiman', jids: [] });
  });
  it('shows stored tags by name, and leaves unknown numbers as they are', () => {
    expect(withMentions('@628131 and @777777', { '628131': 'Ani' })).toBe('@Ani and @777777');
    expect(fmtText('*cek* @628131', { '628131': 'Ani <x>' })).toBe('<b>cek</b> <span class="mention">@Ani &lt;x&gt;</span>');
    expect(fmtText('`@628131`', { '628131': 'Ani' })).toBe('<code>@628131</code>');
  });
  it('reads who is tagged from an incoming message, marking you as me', () => {
    const book = new JidBook();
    book.learn('240059261403301@lid', '6285117616620@s.whatsapp.net');
    const msg = {
      key: { remoteJid: '120363000000000000@g.us', id: 'M1', fromMe: false, participant: '628138361376@s.whatsapp.net' },
      message: { extendedTextMessage: { text: '@240059261403301 @99999 ok?', contextInfo: { mentionedJid: ['240059261403301@lid', '99999@lid'] } } },
      messageTimestamp: 1_790_000_000,
    } as WAMessage;
    const r = mapMessage(msg, me, book, () => null);
    expect(r.kind === 'message' && r.msg.mentions).toEqual({ '240059261403301': '6285117616620@s.whatsapp.net', '99999': 'me' });
    expect(r.kind === 'message' && r.msg.mentionsMe).toBe(true);
  });
});
