import { describe, expect, it } from 'vitest';
import { fmtText } from '../../src/renderer/format';

describe('message formatting', () => {
  it('keeps line breaks and numbered lines as typed', () => {
    expect(fmtText('1. first\n2. second')).toBe('1. first\n2. second');
  });
  it('renders WhatsApp bold, italic, strike and code', () => {
    expect(fmtText('*hi* _there_ ~old~ `merchantID`')).toBe('<b>hi</b> <i>there</i> <s>old</s> <code>merchantID</code>');
  });
  it('leaves snake_case, stray stars and bullets alone', () => {
    expect(fmtText('user_name_x 2 * 3 * 4')).toBe('user_name_x 2 * 3 * 4');
    expect(fmtText('* item\n- other')).toBe('• item\n• other');
  });
  it('does not format inside code or links', () => {
    expect(fmtText('`*a*`')).toBe('<code>*a*</code>');
    expect(fmtText('see https://x.co/a_b_c.')).toBe('see <a href="https://x.co/a_b_c" target="_blank" rel="noopener">https://x.co/a_b_c</a>.');
  });
  it('escapes HTML', () => {
    expect(fmtText('<img src=x onerror=alert(1)> *&*')).toBe('&lt;img src=x onerror=alert(1)&gt; <b>&amp;</b>');
  });
  it('code blocks and quotes', () => {
    expect(fmtText('```\nline1\nline2\n```')).toBe('<code class="blk">line1\nline2</code>');
    expect(fmtText('> quoted\nreply')).toBe('<span class="q">quoted</span>\nreply');
  });
});
