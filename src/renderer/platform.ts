// Windows wording. The window is written for macOS. On Windows app.ts swaps the static English once at
// startup (WIN_COPY), and i18n.ts adds the same sentences to the Indonesian dictionary, so the window
// reads right in both languages without a second copy of every string.

export const IS_WIN = (globalThis as { platform?: string }).platform === 'win32';

/** How the copy names the computer. */
export const HERE = IS_WIN ? 'this PC' : 'this Mac';

/** [macOS English, Windows English], applied in order to each text node; the catch-alls come last. */
export const WIN_COPY: [string, string][] = [
  ['a Dock bounce until you look', 'a flashing taskbar button until you look'],
  ['Dock badge', 'Taskbar badge'],
  ['Show WA Turbo in the menu bar, with how many pinned chats are waiting on my reply', 'Show in the tray icon how many pinned chats are waiting on my reply'],
  ['Open macOS notification settings', 'Open Windows notification settings'],
  ['The first banner asks macOS for permission. If nothing appears, allow WA Turbo in macOS notification settings. Whether banners slide away or stay until closed is set there too, for the whole app.',
    'If no banner appears, allow WA Turbo in Windows notification settings and check that Do not disturb is off. Whether banners also stay in the notification center is set there too, for the whole app.'],
  ['Closing the window keeps WA Turbo running in the Dock. Quit it with ⌘Q.', 'Closing the window keeps WA Turbo running in the notification area, next to the clock. Quit it from the tray icon’s menu.'],
  ['Only programs on this Mac can connect, and only with the password shown here. Switching this restarts the database for a moment; WhatsApp reconnects by itself.',
    'WA Turbo’s database listens only on this PC (127.0.0.1) and accepts only the password shown here, so tools like DBeaver can connect whenever WA Turbo runs.'],
  ['AirDrop the file to this Mac.', 'Send the file to this PC by email, iCloud Drive or USB.'],
  ['Same as macOS', 'Same as Windows'],
  ['macOS notifications are not available.', 'Notifications are not available on this PC.'],
  ['leaves the Mac', 'leaves the PC'],
  ['On this Mac', 'On this PC'],
  ['this Mac', 'this PC'],
];

export const toWindows = (s: string): string => WIN_COPY.reduce((t, [mac, win]) => t.split(mac).join(win), s);

/** Indonesian for the Windows sentences that are more than a Mac → PC swap. */
const WIN_ID: Record<string, string> = {
  'Show in the tray icon how many pinned chats are waiting on my reply': 'Tampilkan di ikon tray jumlah chat disematkan yang menunggu balasan saya',
  'If no banner appears, allow WA Turbo in Windows notification settings and check that Do not disturb is off. Whether banners also stay in the notification center is set there too, for the whole app.':
    'Jika banner tidak muncul, izinkan WA Turbo di pengaturan notifikasi Windows dan pastikan Jangan ganggu mati. Apakah banner juga tetap ada di pusat notifikasi diatur di sana, untuk seluruh aplikasi.',
  'Closing the window keeps WA Turbo running in the notification area, next to the clock. Quit it from the tray icon’s menu.':
    'Menutup jendela membuat WA Turbo tetap berjalan di area notifikasi, di samping jam. Keluar lewat menu ikon tray.',
  'WA Turbo’s database listens only on this PC (127.0.0.1) and accepts only the password shown here, so tools like DBeaver can connect whenever WA Turbo runs.':
    'Database WA Turbo hanya menerima koneksi di PC ini (127.0.0.1) dan hanya dengan kata sandi yang ditampilkan di sini, jadi alat seperti DBeaver bisa terhubung selama WA Turbo berjalan.',
  'Send the file to this PC by email, iCloud Drive or USB.': 'Kirim file ke PC ini lewat email, iCloud Drive atau USB.',
  'Sound: Reminder': 'Suara: Pengingat', 'Sound: Message': 'Suara: Pesan', 'Sound: Mail': 'Suara: Email', 'Sound: Text': 'Suara: SMS',
  'Sound: Windows default': 'Suara: bawaan Windows',
  // Messages from the main process on Windows
  'WA Turbo can only send photos (JPEG, PNG).': 'WA Turbo hanya bisa mengirim foto (JPEG, PNG).',
  "WA Turbo's database files are missing. Reinstall WA Turbo.": 'File database WA Turbo tidak ada. Pasang ulang WA Turbo.',
  'WA Turbo was started "as administrator", and its database refuses to run that way. Close it and open it normally.':
    'WA Turbo dijalankan "sebagai administrator", dan databasenya menolak berjalan seperti itu. Tutup, lalu buka seperti biasa.',
  'Claude Code was installed in a way WA Turbo cannot start. Reinstall it with the installer from claude.ai, then check again in Settings.':
    'Claude Code terpasang dengan cara yang tidak bisa dijalankan WA Turbo. Pasang ulang dengan installer dari claude.ai, lalu cek lagi di Pengaturan.',
};

/** Main-process messages worded with HERE, on either platform. */
const HERE_ID: Record<string, string> = {
  'Claude Code is not installed on this Mac. Install it, sign in, then check again in Settings.': 'Claude Code belum terpasang di Mac ini. Pasang, masuk, lalu cek lagi di Pengaturan.',
  'Notifications are not available on this Mac.': 'Notifikasi tidak tersedia di Mac ini.',
};

const ID_SWAPS: [RegExp, string][] = [[/ikon Dock memantul/g, 'tombol taskbar berkedip'], [/Badge Dock/g, 'Badge taskbar'], [/\bmacOS\b/g, 'Windows'], [/\bMac\b/g, 'PC']];

/** Entries to add to the Indonesian dictionary for this platform: each Mac sentence again in its Windows wording. */
export function platformDictionary(dict: Record<string, string>): Record<string, string> {
  const base = { ...dict, ...HERE_ID };
  if (!IS_WIN) return HERE_ID;
  const out: Record<string, string> = { ...WIN_ID };
  for (const [en, id] of Object.entries(base)) {
    const win = toWindows(en);
    if (win === en || win in out) continue;
    out[win] = ID_SWAPS.reduce((t, [re, to]) => t.replace(re, to), id);
  }
  return out;
}
