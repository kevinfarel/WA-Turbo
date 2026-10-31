// Reads .vcf exports from iPhone (vCard 3.0), Android (2.1 with quoted-printable names), Google Contacts and
// iCloud.com (3.0/4.0). Only names and phone numbers are kept; photos and everything else are skipped.

/** A card as written; name may be empty and phones may be missing or unusable (the import counts those as skipped). */
export interface VCard { name: string; phones: string[] }

const decodeBytes = (bytes: Uint8Array, charset = 'utf-8'): string => {
  try {
    return new TextDecoder(charset, { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
};

/** The whole file as text: UTF-8 when it is valid UTF-8 (BOM dropped), else Windows-1252 as older exports use. */
export const vcfText = (bytes: Uint8Array): string => decodeBytes(bytes).replace(/^﻿/, '');

function quotedPrintable(value: string, charset: string): string {
  const s = value.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const hex = s[i] === '=' ? s.slice(i + 1, i + 3) : '';
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) { bytes.push(parseInt(hex, 16)); i += 2; }
    else bytes.push(...new TextEncoder().encode(s[i]));
  }
  return decodeBytes(Uint8Array.from(bytes), charset);
}

const unescape = (v: string): string => v.replace(/\\([nN])/g, ' ').replace(/\\([,;:\\])/g, '$1');
const tidy = (v: string): string => v.replace(/\s+/g, ' ').trim();
/** Splits a structured value on unescaped semicolons. */
const parts = (v: string): string[] => v.split(/(?<!\\);/).map(p => unescape(p).trim());

export function parseVcf(text: string): VCard[] {
  // Unfold: a line starting with a space or tab continues the previous one, and so does any line after a
  // quoted-printable value ending in "=" (a soft break; quotedPrintable() drops the "=\n").
  const logical: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const prev = logical[logical.length - 1];
    if (prev !== undefined && /^[ \t]/.test(line)) logical[logical.length - 1] += line.slice(1);
    else if (prev !== undefined && prev.endsWith('=') && /QUOTED-PRINTABLE/i.test(prev.slice(0, prev.indexOf(':')))) logical[logical.length - 1] += '\n' + line;
    else logical.push(line);
  }

  const cards: VCard[] = [];
  let cur: { fn: string; n: string; org: string; phones: string[] } | null = null;
  for (const raw of logical) {
    const colon = raw.indexOf(':');
    if (colon < 0) continue;
    const head = raw.slice(0, colon);
    const value = raw.slice(colon + 1);
    const [prop, ...params] = head.split(';');
    const key = prop.replace(/^[^.]+\./, '').toUpperCase(); // "item1.TEL" → TEL
    if (key === 'BEGIN' && /^VCARD$/i.test(value.trim())) { cur = { fn: '', n: '', org: '', phones: [] }; continue; }
    if (!cur) continue;
    if (key === 'END' && /^VCARD$/i.test(value.trim())) {
      const n = parts(cur.n);
      const fromN = tidy([n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(' '));
      const name = tidy(cur.fn) || fromN || tidy(parts(cur.org)[0] ?? '');
      if (name || cur.phones.length) cards.push({ name, phones: [...new Set(cur.phones)] });
      cur = null;
      continue;
    }
    if (key !== 'FN' && key !== 'N' && key !== 'ORG' && key !== 'TEL') continue;
    const qp = params.some(p => /QUOTED-PRINTABLE/i.test(p));
    const charset = params.map(p => /^CHARSET=(.+)$/i.exec(p)?.[1]).find(Boolean) ?? 'utf-8';
    const val = qp ? quotedPrintable(value, charset) : value;
    if (key === 'FN') cur.fn = unescape(val);
    else if (key === 'N') cur.n = val;
    else if (key === 'ORG') cur.org = val;
    else if (val.trim()) cur.phones.push(val.trim());
  }
  return cards;
}

// ITU country calling codes are prefix-free: 1 and 7 are one digit, these are two, all others three.
const TWO_DIGIT = new Set('20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(' '));

/** The calling code an international number starts with, e.g. "62" for +62 819…. */
export function callingCode(international: string): string | null {
  const d = international.replace(/\D/g, '');
  if (!d) return null;
  if (d[0] === '1' || d[0] === '7') return d[0];
  if (TWO_DIGIT.has(d.slice(0, 2))) return d.slice(0, 2);
  return d.length >= 3 ? d.slice(0, 3) : null;
}

/**
 * A phone-book number as international digits (6281234567890), or null when it isn't a phone number.
 * "+62 812…" and "0062 812…" are already international; "0812…" is local, so the country code replaces the 0;
 * "62812…" is kept; a bare national number ("812…") gets the country code in front.
 */
export function normalizePhone(raw: string, countryCode: string): string | null {
  const s = raw.trim().replace(/^tel:/i, '').replace(/\s*(?:ext\.?|x|;ext=|#).*$/i, '');
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (s.startsWith('+')) { /* international */ }
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = countryCode + d.slice(1);
  else if (!d.startsWith(countryCode) && d.length <= 12) d = countryCode + d;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Same name for duplicate purposes: case and spacing don't count. */
export const sameName = (a: string, b: string): boolean => tidy(a).toLocaleLowerCase() === tidy(b).toLocaleLowerCase();
