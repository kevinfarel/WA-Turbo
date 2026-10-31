import { describe, expect, it } from 'vitest';
import { fmtDur } from '../../src/shared/sla';
import { reportLang } from '../../src/main/ai/report';
import { chatSystem, customSystem, synthSystem } from '../../src/main/ai/prompts';
import { ID } from '../../src/renderer/i18n-id';

describe('summary language', () => {
  it('each prompt names the language, and keeps the owner "You" in English', () => {
    expect(chatSystem('en')).toContain('always write your output in English');
    expect(chatSystem('id')).toContain('always write your output in Bahasa Indonesia');
    expect(chatSystem('id')).toContain('keep the owner value "You" in English');
    expect(synthSystem('id')).toContain('Write in Bahasa Indonesia');
    expect(customSystem('en')).toContain('Write in English');
  });

  it('a report is written in the language most of its chats use; a tie is English', () => {
    expect(reportLang(['id', 'id', 'en'])).toBe('id');
    expect(reportLang(['id', 'en'])).toBe('en');
    expect(reportLang([])).toBe('en');
  });

  it('durations follow the language', () => {
    expect(fmtDur(0.25, 'id')).toBe('15 mnt');
    expect(fmtDur(3, 'id')).toBe('3 jam');
    expect(fmtDur(52, 'id')).toBe('2 hari 4 jam');
    expect(fmtDur(52, 'en')).toBe('2d 4h');
  });
});

describe('Indonesian dictionary', () => {
  it('every placeholder in a key appears in its translation', () => {
    for (const [en, id] of Object.entries(ID)) {
      const want = (en.match(/\{(n\d?|x|y|z)\}/g) ?? []).sort();
      const got = (id.match(/\{(n\d?|x|y|z)\}/g) ?? []).sort();
      expect(got, en).toEqual(want);
    }
  });
});
