// Restricted words: what each number must never mention. Pure matching, used by the check before a message
// goes out and by the Settings list. All words are escaped; nobody writes a regex here.

export const MAX_WORD = 60;
export const MAX_WORDS = 50;

/** A word with its spaces, dashes and dots gone: two spellings with the same core are one word, and match the same text. */
export const core = (word: string): string => word.toLowerCase().replace(/[\s._-]+/g, '');

/** The word in the list that already covers this one, whatever its spacing or punctuation. */
export function coveredBy(word: string, list: string[]): string | undefined {
  return list.find(w => core(w) === core(word));
}

/** How a typed word is kept: lowercase, trimmed, single spaces. */
export const tidyWord = (word: string): string => word.trim().replace(/\s+/g, ' ').toLowerCase();

/** The list as it is kept: tidy, one spelling of each word (the first), within the limits. An entry may hold several words split by commas. */
export function cleanWords(list: unknown): string[] {
  const entries = (Array.isArray(list) ? list : []).filter((e): e is string => typeof e === 'string').flatMap(e => e.split(','));
  const out: string[] = [];
  for (const w of entries.map(tidyWord)) {
    if (core(w) && w.length <= MAX_WORD && !coveredBy(w, out)) out.push(w);
  }
  return out.slice(0, MAX_WORDS);
}

const escapeRe = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

// Indonesian writes these onto the word itself, so "<word>nya" still names it.
const SUFFIX = '(?:nya|ku|mu|lah|kah|pun)?';
const SEPARATORS = '[\\s._-]*';

// Spaces, dashes and dots may fall anywhere in the word: A.B.C, a b c, two-part, twopart, two part.
function wordRe(word: string): RegExp {
  const letters = [...core(word)].map(escapeRe).join(SEPARATORS);
  return new RegExp('(?<![\\p{L}\\p{N}])' + letters + SUFFIX + '(?![\\p{L}\\p{N}])', 'iu');
}

/** The listed words the text names outright. */
export function exactHits(text: string, words: string[]): string[] {
  return words.filter(w => wordRe(w).test(text));
}

/** A file name as words: no extension, and what runs together split apart, so BillABC2026.png reads "Bill ABC 2026". */
export function fileWords(name: string): string {
  return name.replace(/\.[\p{L}\p{N}]{1,5}$/u, '')
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2');
}

const tokens = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Edits between two strings, counting a swap of neighbouring letters as one. */
function distance(a: string, b: string): number {
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, before[j - 2]! + 1);
      row.push(best);
    }
    before = prev;
    prev = row;
  }
  return prev[b.length]!;
}

const withoutDoubles = (s: string): string => s.replace(/(.)\1+/g, '$1');

/** How near "seen" must be to a listed word to be worth a second look. Short names have too many neighbours for plain edits. */
function looksLike(seen: string, word: string): boolean {
  const size = word.length;
  if (size < 3) return false;
  if (size === 3) {
    if (seen.length === 3) return distance(seen, word) === 1 && [...seen].sort().join('') === [...word].sort().join('');
    return seen.length === 4 && withoutDoubles(seen) === withoutDoubles(word);
  }
  const limit = size <= 7 ? 1 : 2;
  return Math.abs(seen.length - word.length) <= limit && distance(seen, word) <= limit;
}

/** Listed words the text does not name outright but comes close to: only these are worth asking the AI about. */
export function closeHits(text: string, words: string[]): string[] {
  const exact = new Set(exactHits(text, words));
  const seen = tokens(text);
  return words.filter(w => {
    if (exact.has(w)) return false;
    const parts = tokens(w);
    const word = parts.join('');
    // Joined up, like the exact match: "two part" can arrive as one word with a typo, and one word as two.
    for (let i = 0; i < seen.length; i++) {
      let joined = '';
      for (let n = 0; n <= parts.length && i + n < seen.length; n++) {
        joined += seen[i + n];
        // One whole part of a longer name is its own word: "amanah" alone is not a typo of "el amanah".
        if (looksLike(joined, word) && !parts.includes(joined)) return true;
      }
    }
    return false;
  });
}
