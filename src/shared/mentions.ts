// WhatsApp writes a tag as "@<number>" in the text plus the person's ID in the message's mention list;
// every app then shows that person's name in place of the number. These helpers do both directions.

/** A person tagged in the composer: the name shown while typing and the ID WhatsApp mentions. */
export interface PickedMention { name: string; jid: string }

const tokenOf = (jid: string): string => jid.split('@')[0].split(':')[0];

/** "@<number>" in a stored message → "@Name" for each tag we have a name for. */
export function withMentions(text: string, mentions: Record<string, string> | undefined): string {
  if (!mentions || !text.includes('@')) return text;
  return text.replace(/@(\d{5,})/g, (all, tok: string) => (mentions[tok] ? '@' + mentions[tok] : all));
}

/**
 * Composer text with "@Name" tags → what WhatsApp expects: "@<number>" and the tagged IDs.
 * A tag the person deleted or edited away is dropped; longer names are matched first.
 */
export function encodeMentions(text: string, picked: PickedMention[]): { text: string; jids: string[] } {
  const jids: string[] = [];
  let out = text;
  for (const p of [...picked].sort((a, b) => b.name.length - a.name.length)) {
    // "@Budi" must not match the start of "@Budiman".
    const tag = new RegExp('@' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])', 'gu');
    if (!tag.test(out)) continue;
    out = out.replace(tag, '@' + tokenOf(p.jid));
    if (!jids.includes(p.jid)) jids.push(p.jid);
  }
  return { text: out, jids };
}
