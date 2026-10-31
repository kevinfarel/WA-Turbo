import { randomUUID } from 'node:crypto';
import type { ContactDuplicate, ContactImportPreview, ContactImportResult, ContactOption, ContactSource } from '@shared/types';
import * as Q from '../db/queries';
import { formatPhone } from '@shared/phone';
import { callingCode, normalizePhone, parseVcf, sameName, vcfText, type VCard } from './vcard';

// Importing a .vcf: read it, find numbers with more than one contact name (twice in the file, or different from an
// earlier import or from the name saved on the number's own phone), let the person pick, then save to `phonebook`.
// A different WhatsApp profile name is not a duplicate; your contact name beats it, as on the phone.

export interface Planned {
  /** Numbers with one name: saved as is. */
  names: Map<string, string>;
  duplicates: ContactDuplicate[];
  added: number;
  unchanged: number;
  skipped: number;
}

/** Pure part of the preview, so it can be tested without a database. */
export function plan(cards: VCard[], countryCode: string, earlier: Map<string, string>, synced: Map<string, string>, chats: Map<string, string>): Planned {
  const fromFile = new Map<string, string[]>();
  let skipped = 0;
  for (const card of cards) {
    const phones = card.name ? card.phones.map(p => normalizePhone(p, countryCode)).filter((p): p is string => !!p) : [];
    if (!phones.length) { skipped++; continue; }
    for (const p of new Set(phones)) {
      const list = fromFile.get(p) ?? [];
      if (!list.some(n => sameName(n, card.name))) list.push(card.name);
      fromFile.set(p, list);
    }
  }

  const names = new Map<string, string>();
  const duplicates: ContactDuplicate[] = [];
  let added = 0;
  let unchanged = 0;
  for (const [phone, fileNames] of fromFile) {
    const options: ContactOption[] = [];
    const add = (name: string | undefined, from: ContactSource) => {
      if (!name) return;
      const o = options.find(x => sameName(x.name, name));
      if (o) { if (!o.from.includes(from)) o.from.push(from); } else options.push({ name, from: [from] });
    };
    fileNames.forEach(n => add(n, 'file'));
    add(earlier.get(phone), 'import');
    add(synced.get(phone), 'phone');
    if (options.length === 1) {
      names.set(phone, options[0].name);
      if (earlier.has(phone) || synced.has(phone)) unchanged++; else added++;
      continue;
    }
    // Preselect what WA Turbo shows today (earlier import, else the phone's name), or the first name in the file.
    const keep = earlier.get(phone) ?? synced.get(phone) ?? fileNames[0];
    duplicates.push({ phone, display: formatPhone('+' + phone), chat: chats.get(phone) ?? null, options, keep: options.find(o => sameName(o.name, keep))!.name });
  }
  duplicates.sort((a, b) => Number(!!b.chat) - Number(!!a.chat) || a.display.localeCompare(b.display));
  return { names, duplicates, added, unchanged, skipped };
}

let pending: { token: string; planned: Planned } | null = null;

export async function guessCountry(saved: string): Promise<string> {
  if (/^\d{1,3}$/.test(saved)) return saved;
  const phone = (await Q.listAccounts()).find(a => a.phone)?.phone;
  return (phone && callingCode(phone)) || '62';
}

export async function previewContacts(data: Uint8Array, fileName: string, countryCode: string | null): Promise<ContactImportPreview> {
  if (data.byteLength > 100e6) throw new Error('That file is over 100 MB. Export contacts without photos and try again.');
  const cards = parseVcf(vcfText(data));
  if (!cards.length) throw new Error("That file has no contacts in it. Choose a .vcf file exported from your phone's Contacts.");
  const cc = countryCode && /^\d{1,3}$/.test(countryCode) ? countryCode : await guessCountry((await Q.getSettings()).contactsCountry);
  if (countryCode && cc === countryCode) await Q.saveSettings({ contactsCountry: cc });
  const phones = [...new Set(cards.flatMap(c => c.phones.map(p => normalizePhone(p, cc)).filter((p): p is string => !!p)))];
  const [earlier, synced, chats] = await Promise.all([Q.phonebookNames(phones), Q.syncedNames(phones), Q.dmChatNames(phones)]);
  const planned = plan(cards, cc, earlier, synced, chats);
  pending = { token: randomUUID(), planned };
  return {
    token: pending.token, fileName, countryCode: cc, cards: cards.length, numbers: planned.names.size + planned.duplicates.length,
    added: planned.added, unchanged: planned.unchanged, skipped: planned.skipped, duplicates: planned.duplicates,
  };
}

export async function applyContacts(token: string, keep: Record<string, string>): Promise<ContactImportResult> {
  if (!pending || pending.token !== token) throw new Error('That import expired. Choose the file again.');
  const { names, duplicates } = pending.planned;
  const save = [...names].map(([phone, name]) => ({ phone, name }));
  const remove: string[] = [];
  let kept = 0;
  for (const d of duplicates) {
    const pick = d.options.find(o => o.name === (keep[d.phone] ?? d.keep)) ?? d.options.find(o => o.name === d.keep)!;
    if (pick.from.includes('file') || pick.from.includes('import')) save.push({ phone: d.phone, name: pick.name });
    else remove.push(d.phone); // the phone's own name: no override, so it follows the phone from now on
    if (!pick.from.includes('file')) kept++;
  }
  const before = await Q.dmDisplayNames();
  await Q.savePhonebook(save, remove);
  pending = null;
  const after = await Q.dmDisplayNames();
  let renamedChats = 0;
  for (const [id, name] of after) if (before.get(id) !== name) renamedChats++;
  return { saved: save.length, kept, renamedChats };
}
