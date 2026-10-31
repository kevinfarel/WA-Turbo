import { BrowserWindow, nativeTheme } from 'electron';
import type { Lang, UiPrefs } from '@shared/types';
import { setDurLang } from '@shared/sla';
import { setUiPrefs, uiPrefs } from './config';

// The window owns the app language and theme (Settings and the titlebar switch). It reports them
// here so the native parts match: light or dark menus and dialogs, the window background shown
// before the page paints, and the language of notifications and the menu bar.

let lang: Lang = uiPrefs()?.lang ?? 'en';
setDurLang(lang);

export const uiLang = (): Lang => lang;

/** Background for a new window, from the theme in use last time. */
export const windowBackground = (): string => uiPrefs()?.bg ?? (nativeTheme.shouldUseDarkColors ? '#1b1d21' : '#eceef1');

/** Applies the last saved light/dark choice before the first window opens. */
export function restoreTheme(): void {
  const p = uiPrefs();
  if (p) nativeTheme.themeSource = p.mode;
}

export function applyUi(p: UiPrefs): void {
  lang = p.lang;
  setDurLang(lang);
  nativeTheme.themeSource = p.mode;
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.setBackgroundColor(p.bg);
  setUiPrefs(p);
}
