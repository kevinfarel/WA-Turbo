import { describe, expect, it } from 'vitest';
import { cleanWords, closeHits, coveredBy, exactHits, fileWords, MAX_WORD, MAX_WORDS } from '../../src/shared/restricted';

describe('cleanWords', () => {
  it('lowercases, trims, folds spaces and drops duplicates', () => {
    expect(cleanWords(['  Acme ', 'ACME', 'Blue  Bank', ''])).toEqual(['acme', 'blue bank']);
  });
  it('splits on commas, ignoring empty parts', () => {
    expect(cleanWords(['Acme, ZETA ,, blue bank,'])).toEqual(['acme', 'zeta', 'blue bank']);
    expect(cleanWords(['acme', 'zeta, ACME, new'])).toEqual(['acme', 'zeta', 'new']);
  });
  it('keeps one spelling of a word, the first', () => {
    expect(cleanWords(['two part', 'two-part', 'TWO.PART', 'twopart', 'two_part'])).toEqual(['two part']);
    expect(cleanWords(['twopart', 'two part'])).toEqual(['twopart']);
  });
  it('drops an entry that is only punctuation', () => {
    expect(cleanWords(['-', ' . ', '_', 'ok'])).toEqual(['ok']);
  });
  it('keeps to the limits and ignores what is not text', () => {
    expect(cleanWords(['x'.repeat(MAX_WORD + 1), 3, null, 'ok'])).toEqual(['ok']);
    expect(cleanWords(Array.from({ length: MAX_WORDS + 5 }, (_, i) => 'w' + i))).toHaveLength(MAX_WORDS);
    expect(cleanWords('nope')).toEqual([]);
  });
});

describe('fileWords', () => {
  it('drops the extension and splits what runs together', () => {
    expect(fileWords('BillACME2026.png')).toBe('Bill ACME 2026');
    expect(fileWords('2026acme.jpeg')).toBe('2026 acme');
    expect(fileWords('my.photo.of.acme.heic')).toBe('my.photo.of.acme');
  });
  it('lets a listed word match inside a file name, but not inside another word', () => {
    for (const n of ['BillACME2026.png', 'bukti_transfer_acme.jpg', 'IMG-20261105-acme-final.png', 'acme.png', 'Bill Acme (1).png']) expect(exactHits(fileWords(n), ['acme'])).toEqual(['acme']);
    expect(exactHits(fileWords('pacmen_photo.png'), ['acme'])).toEqual([]);
    expect(exactHits(fileWords('Screenshot 2026-11-05 at 12.46.03.png'), ['acme'])).toEqual([]);
  });
});

describe('coveredBy', () => {
  it('finds the listed spelling of a word', () => {
    expect(coveredBy('two-part', ['other', 'two part'])).toBe('two part');
    expect(coveredBy('TWOPART', ['two part'])).toBe('two part');
    expect(coveredBy('two parts', ['two part'])).toBeUndefined();
  });
});

describe('exactHits', () => {
  it('matches every spelling of a word with one entry, so a second entry would add nothing', () => {
    const forms = ['el amanah', 'el-amanah', 'elamanah', 'EL.AMANAH', 'el_amanah', 'el  amanah', 'el amanahnya'];
    for (const entry of ['el amanah', 'el-amanah', 'elamanah']) for (const t of forms) expect(exactHits('ke ' + t + ' ya', [entry])).toEqual([entry]);
  });
  it('still needs the whole word', () => {
    expect(exactHits('amanah saja', ['el amanah'])).toEqual([]);
    expect(exactHits('mel amanah', ['el amanah'])).toEqual([]);
    expect(exactHits('el amanahan', ['el amanah'])).toEqual([]);
  });
  it('finds a word whatever its case', () => {
    expect(exactHits('tolong kabari acme ya', ['ACME'])).toEqual(['ACME']);
    expect(exactHits('Please ping ACME.', ['acme'])).toEqual(['acme']);
  });
  it('does not match inside a longer word', () => {
    expect(exactHits('notifikasi roti', ['oti'])).toEqual([]);
    expect(exactHits('pacmen', ['acme'])).toEqual([]);
    expect(exactHits('kartu123', ['tu1'])).toEqual([]);
  });
  it('catches Indonesian suffixes on the word', () => {
    for (const t of ['acmenya sudah', 'ACMEku', 'acmemu', 'acmelah', 'acmekah', 'acmepun', 'acme-nya']) expect(exactHits(t, ['acme'])).toEqual(['acme']);
    expect(exactHits('acmesaurus', ['acme'])).toEqual([]);
  });
  it('catches a short name spaced or dotted out', () => {
    for (const t of ['A.B.C', 'a b c', 'a-b-c', 'a_b_c', 'A. B. C.']) expect(exactHits(t, ['ABC'])).toEqual(['ABC']);
    expect(exactHits('kaba cod', ['ABC'])).toEqual([]);
  });
  it('allows any spacing in a multi-word entry, and not a partial one', () => {
    expect(exactHits('via Blue   Bank\ntoday', ['blue bank'])).toEqual(['blue bank']);
    expect(exactHits('the blue sky', ['blue bank'])).toEqual([]);
  });
  it('treats regex characters as plain text', () => {
    expect(exactHits('see c++ docs', ['c++'])).toEqual(['c++']);
    expect(exactHits('ccc', ['c++'])).toEqual([]);
    expect(exactHits('a.*b', ['(a|b'])).toEqual([]);
    expect(() => exactHits('x', ['[', '(', '\\', 'a-b'])).not.toThrow();
  });
  it('reads non-Latin letters as letters', () => {
    expect(exactHits('kafé pagi', ['pagi'])).toEqual(['pagi']);
    expect(exactHits('pagié', ['pagi'])).toEqual([]);
  });
  it('returns every word named', () => {
    expect(exactHits('acme and zeta', ['zeta', 'acme', 'other'])).toEqual(['zeta', 'acme']);
  });
});

describe('closeHits', () => {
  it('leaves 1 and 2 letter words to the exact match', () => {
    expect(closeHits('ab ba aab', ['ab'])).toEqual([]);
  });
  it('three letters: a swap or one doubled letter, nothing wider', () => {
    expect(closeHits('ke ARJ', ['AJR'])).toEqual(['AJR']);
    expect(closeHits('ke AJRR', ['AJR'])).toEqual(['AJR']);
    expect(closeHits('ke AJS', ['AJR'])).toEqual([]);
    expect(closeHits('ke AJ', ['AJR'])).toEqual([]);
    expect(closeHits('ke RJA', ['AJR'])).toEqual([]);
  });
  it('four to seven letters: one edit', () => {
    expect(closeHits('acne', ['acme'])).toEqual(['acme']);
    expect(closeHits('acmee', ['acme'])).toEqual(['acme']);
    expect(closeHits('axne', ['acme'])).toEqual([]);
  });
  it('eight letters or more: two edits', () => {
    expect(closeHits('mountian kingdon', ['kingdom'])).toEqual(['kingdom']);
    expect(closeHits('sentosaah', ['sentosaja'])).toEqual(['sentosaja']);
    expect(closeHits('sentoxxxx', ['sentosaja'])).toEqual([]);
  });
  it('compares a multi-word entry across neighbouring words', () => {
    expect(closeHits('lewat blue benk ya', ['blue bank'])).toEqual(['blue bank']);
  });
  it('sees a typo whether the words are joined or split', () => {
    for (const t of ['elamanh', 'elaminah', 'el amanh', 'ela manh']) expect(closeHits('ke ' + t + ' ya', ['el amanah'])).toEqual(['el amanah']);
    expect(closeHits('deltaomgabeta', ['delta omega beta'])).toEqual(['delta omega beta']);
    expect(closeHits('el amanh', ['elamanah'])).toEqual(['elamanah']);
    expect(closeHits('vi cii', ['vici'])).toEqual(['vici']);
  });
  it('does not take one whole part of a longer name for a typo of it', () => {
    expect(closeHits('amanah sekali orangnya', ['el amanah'])).toEqual([]);
  });
  it('leaves out what the exact match already caught', () => {
    expect(closeHits('acme and acne', ['acme'])).toEqual([]);
  });
  it('finds nothing in an ordinary message', () => {
    expect(closeHits('ok siap, nanti saya kabari', ['acme', 'blue bank', 'AJR'])).toEqual([]);
  });
});
