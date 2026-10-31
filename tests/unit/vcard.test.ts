import { describe, expect, it } from 'vitest';
import { callingCode, normalizePhone, parseVcf, vcfText } from '../../src/main/contacts/vcard';
import { plan } from '../../src/main/contacts/import';

const IPHONE = [
  'BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Apple Inc.//iPhone OS 18.0//EN', 'N:Santoso;Budi;;;', 'FN:Budi Santoso',
  'item1.TEL;type=pref:+62 812-3456-7890', 'item1.X-ABLabel:mobile', 'TEL;type=WORK;type=VOICE:(021) 555-0123',
  'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD', ' /2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'N:;;;;', 'FN:', 'ORG:Toko Maju\\, Cabang 2;', 'TEL;type=CELL:0811 1001 2250', 'END:VCARD',
].join('\r\n');

// Android 2.1 export: quoted-printable UTF-8 with a soft line break, no FN folding by spaces.
const ANDROID = [
  'BEGIN:VCARD', 'VERSION:2.1', 'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;=E5=BC=A0=E4=BC=9F;;;',
  'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0=E4=BC=9F =F0=9F=98=80 Caf=C3=A9 Bes=',
  'ar', 'TEL;CELL;PREF:+6281234567890', 'TEL;HOME:081234567890', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:2.1', 'FN:No Number Person', 'EMAIL;HOME:x@example.com', 'END:VCARD',
].join('\n');

const GOOGLE = [
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:Rama Putra', 'N:Putra;Rama;;;', 'TEL;TYPE=CELL:+62 819-0607-1616',
  'NOTE:Line one\\nline two', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:Rama (kantor)', 'TEL;TYPE=WORK:+62 819 0607 1616', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:4.0', 'FN:Very Long Name That Got', ' Folded', 'TEL;VALUE=uri;TYPE=cell:tel:+65-9123-4567', 'END:VCARD',
].join('\r\n');

describe('reading .vcf exports', () => {
  it('iPhone 3.0: grouped TEL, photo skipped, ORG when there is no name', () => {
    expect(parseVcf(IPHONE)).toEqual([
      { name: 'Budi Santoso', phones: ['+62 812-3456-7890', '(021) 555-0123'] },
      { name: 'Toko Maju, Cabang 2', phones: ['0811 1001 2250'] },
    ]);
  });

  it('Android 2.1: quoted-printable UTF-8 names with soft line breaks', () => {
    const cards = parseVcf(ANDROID);
    expect(cards[0]).toEqual({ name: '张伟 😀 Café Besar', phones: ['+6281234567890', '081234567890'] });
    expect(cards[1]).toEqual({ name: 'No Number Person', phones: [] });
  });

  it('Google and 4.0: folded names and tel: URIs', () => {
    expect(parseVcf(GOOGLE).map(c => c.name)).toEqual(['Rama Putra', 'Rama (kantor)', 'Very Long Name That GotFolded']);
    expect(parseVcf(GOOGLE)[2].phones).toEqual(['tel:+65-9123-4567']);
  });

  it('decodes a UTF-8 file with a BOM, and falls back to Windows-1252', () => {
    expect(vcfText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
    expect(vcfText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe('Café');
  });
});

describe('phone numbers', () => {
  it('turns phone-book numbers into international digits', () => {
    expect(normalizePhone('+62 812-3456-7890', '62')).toBe('6281234567890');
    expect(normalizePhone('0812 3456 7890', '62')).toBe('6281234567890');
    expect(normalizePhone('6281234567890', '62')).toBe('6281234567890');
    expect(normalizePhone('812 3456 7890', '62')).toBe('6281234567890');
    expect(normalizePhone('0065 9123 4567', '62')).toBe('6591234567');
    expect(normalizePhone('tel:+65-9123-4567', '62')).toBe('6591234567');
    expect(normalizePhone('(021) 555-0123', '62')).toBe('62215550123');
    expect(normalizePhone('+62 21 555 0123 ext. 12', '62')).toBe('62215550123');
    expect(normalizePhone('14045', '62')).toBeNull();
    expect(normalizePhone('call me', '62')).toBeNull();
  });

  it('finds the calling code of a linked number', () => {
    expect(callingCode('+62 819-0607-1616')).toBe('62');
    expect(callingCode('+1 415 555 0100')).toBe('1');
    expect(callingCode('+971 50 123 4567')).toBe('971');
  });
});

describe('import preview', () => {
  const cards = [...parseVcf(IPHONE), ...parseVcf(ANDROID), ...parseVcf(GOOGLE)];

  it('flags numbers with more than one name; case and spacing are not a difference', () => {
    const earlier = new Map([['6281110012250', 'toko  maju, cabang 2']]);           // same name, other case
    const synced = new Map([['6281234567890', 'Budi (WA)']]);                        // saved on the phone
    const chats = new Map([['6281234567890', 'Budi (WA)']]);
    const p = plan(cards, '62', earlier, synced, chats);

    expect(p.skipped).toBe(1);
    expect(p.names.get('6281110012250')).toBe('Toko Maju, Cabang 2');
    expect(p.unchanged).toBe(1);

    const budi = p.duplicates.find(d => d.phone === '6281234567890')!;
    expect(budi.options.map(o => [o.name, o.from])).toEqual([
      ['Budi Santoso', ['file']], ['张伟 😀 Café Besar', ['file']], ['Budi (WA)', ['phone']],
    ]);
    expect(budi.keep).toBe('Budi (WA)');          // what WA Turbo shows today
    expect(budi.chat).toBe('Budi (WA)');
    expect(p.duplicates[0].phone).toBe('6281234567890'); // numbers with a chat come first

    const rama = p.duplicates.find(d => d.phone === '6281906071616')!;
    expect(rama.options.map(o => o.name)).toEqual(['Rama Putra', 'Rama (kantor)']);
    expect(rama.keep).toBe('Rama Putra');          // twice in the file: first one preselected
    expect(rama.display).toBe('+62 819-0607-1616');
  });

  it('a different earlier import is a duplicate, the same one is not', () => {
    const p = plan(parseVcf(GOOGLE), '62', new Map([['6591234567', 'Old Name']]), new Map(), new Map());
    const d = p.duplicates.find(x => x.phone === '6591234567')!;
    expect(d.options.map(o => [o.name, o.from])).toEqual([['Very Long Name That GotFolded', ['file']], ['Old Name', ['import']]]);
    expect(d.keep).toBe('Old Name');
  });
});
