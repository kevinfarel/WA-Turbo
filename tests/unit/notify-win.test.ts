import { describe, expect, it } from 'vitest';
import { BADGE_PX, badgeBitmap, toastXml, trayBitmap, winSound } from '../../src/main/notify/win';

describe('Windows toasts', () => {
  it('keep the pinned and other-chat sounds apart, also from the macOS defaults', () => {
    expect(winSound('Glass')).toBe('Reminder');
    expect(winSound('Tink')).toBe('IM');
    expect(winSound('Mail')).toBe('Mail');
    expect(winSound('Submarine')).toBe('Default');
  });
  it('escape chat text and carry sound and subtitle', () => {
    const x = toastXml({ title: '📌 A & B <team>', subtitle: 'Pinned · Sales', body: 'say "hi"', sound: 'Glass' });
    expect(x).toContain('<text>📌 A &amp; B &lt;team&gt;</text><text>say &quot;hi&quot;</text>');
    expect(x).toContain('<text placement="attribution">Pinned · Sales</text>');
    expect(x).toContain('<audio src="ms-winsoundevent:Notification.Reminder"/>');
  });
  it('go quiet when silent or set to None', () => {
    expect(toastXml({ title: 't', silent: true })).toContain('<audio silent="true"/>');
    expect(toastXml({ title: 't', sound: 'None' })).toContain('<audio silent="true"/>');
  });
});

describe('Windows badge and tray bitmaps', () => {
  const alpha = (b: Buffer, x: number, y: number, w: number) => b[(y * w + x) * 4 + 3];
  it('draws an opaque centre and transparent corners', () => {
    for (const n of [1, 42, 250]) {
      const b = badgeBitmap(n);
      expect(b.length).toBe(BADGE_PX * BADGE_PX * 4);
      expect(alpha(b, 0, 0, BADGE_PX)).toBe(0);
      expect(alpha(b, 16, 16, BADGE_PX)).toBe(255);
    }
  });
  it('puts the glyph in white on the brand tile', () => {
    const size = 36, tpl = Buffer.alloc(size * size * 4);
    tpl[(18 * size + 18) * 4 + 3] = 255; // one glyph pixel
    const out = trayBitmap(tpl, size, false);
    expect([...out.subarray((18 * size + 18) * 4, (18 * size + 18) * 4 + 4)]).toEqual([255, 255, 255, 255]);
    expect([...out.subarray((10 * size + 10) * 4, (10 * size + 10) * 4 + 3)]).toEqual([0x55, 0x6e, 0x0b]);
    expect(alpha(out, 0, 0, size)).toBe(0);
  });
});
