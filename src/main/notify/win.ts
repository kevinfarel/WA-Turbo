// Windows versions of what macOS gives the notifier for free: toast sounds, the taskbar badge and a
// colour tray icon. Pure functions over strings and BGRA pixel buffers; center.ts turns them into
// toasts and nativeImages.

import { winSound } from '@shared/sounds';

export { winSound };

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The toast Windows shows for a notification: title, body, the subtitle as attribution, and its sound. */
export function toastXml(o: { title?: string; subtitle?: string; body?: string; sound?: string; silent?: boolean }): string {
  const sound = winSound(o.sound);
  const audio = o.silent || sound === 'None' ? '<audio silent="true"/>' : `<audio src="ms-winsoundevent:Notification.${sound}"/>`;
  const text = [o.title, o.body].filter(Boolean).map(t => `<text>${xml(t!)}</text>`).join('') +
    (o.subtitle ? `<text placement="attribution">${xml(o.subtitle)}</text>` : '');
  return `<toast><visual><binding template="ToastGeneric">${text}</binding></visual>${audio}</toast>`;
}

// 3×5 pixel glyphs for the badge count.
const GLYPHS: Record<string, string> = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111', '+': '000010111010000',
};

export const BADGE_PX = 32;

/** Red dot with the count in white, BGRA, BADGE_PX square (16 px at 2×), for the taskbar overlay. */
export function badgeBitmap(n: number): Buffer {
  const label = n > 99 ? '99+' : String(Math.max(1, Math.floor(n)));
  const size = BADGE_PX, buf = Buffer.alloc(size * size * 4);
  const c = size / 2, r = size / 2 - 0.5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = Math.max(0, Math.min(1, r - Math.hypot(x + 0.5 - c, y + 0.5 - c) + 0.5));
    buf.writeUInt32LE(((a * 255) << 24 | 0x30 << 16 | 0x2f << 8 | 0xd1) >>> 0, (y * size + x) * 4); // #d12f30, premultiplied below
  }
  premultiply(buf);
  const scale = label.length === 1 ? 4 : label.length === 2 ? 3 : 2;
  const w = label.length * 3 * scale + (label.length - 1) * scale;
  let x0 = Math.round((size - w) / 2);
  const y0 = Math.round((size - 5 * scale) / 2);
  for (const ch of label) {
    const g = GLYPHS[ch];
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
      if (g[gy * 3 + gx] !== '1') continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        buf.writeUInt32LE(0xffffffff, ((y0 + gy * scale + dy) * size + x0 + gx * scale + dx) * 4);
      }
    }
    x0 += 4 * scale;
  }
  return buf;
}

/**
 * The tray icon for Windows: the menu bar template's glyph in white on a rounded tile in the brand
 * colour, readable on light and dark taskbars. `alert` adds a red dot. Input and output are BGRA.
 */
export function trayBitmap(template: Buffer, size: number, alert: boolean): Buffer {
  const out = Buffer.alloc(size * size * 4);
  const rad = size * 0.22;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // rounded-square coverage
    const dx = Math.max(rad - (x + 0.5), x + 0.5 - (size - rad), 0), dy = Math.max(rad - (y + 0.5), y + 0.5 - (size - rad), 0);
    const tile = Math.max(0, Math.min(1, rad - Math.hypot(dx, dy) + 0.5));
    const glyph = template[(y * size + x) * 4 + 3] / 255;
    let [b, g, r] = [0x55, 0x6e, 0x0b]; // #0b6e55
    if (alert && Math.hypot(x + 0.5 - size * 0.8, y + 0.5 - size * 0.2) < size * 0.19) [b, g, r] = [0x30, 0x2f, 0xd1];
    else { b += (255 - b) * glyph; g += (255 - g) * glyph; r += (255 - r) * glyph; }
    out.writeUInt32LE(((tile * 255) << 24 | Math.round(r) << 16 | Math.round(g) << 8 | Math.round(b)) >>> 0, (y * size + x) * 4);
  }
  return premultiply(out);
}

function premultiply(buf: Buffer): Buffer {
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i + 3] / 255;
    buf[i] = Math.round(buf[i] * a); buf[i + 1] = Math.round(buf[i + 1] * a); buf[i + 2] = Math.round(buf[i + 2] * a);
  }
  return buf;
}
