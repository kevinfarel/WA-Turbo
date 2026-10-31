import type { ThemeMode } from '@shared/types';

// Light and dark, like an editor: you pick one light theme and one dark theme in Settings, and the
// titlebar switch (or the system, in System mode) chooses between them. Kept in this window's
// storage; the main process gets the colours so native menus and the window background match.

export interface Theme { id: string; name: string; dark: boolean; swatch: [string, string, string, string] }

/** swatch: sidebar, page, incoming bubble, accent — drawn on the Settings cards. */
export const THEMES: Theme[] = [
  { id: 'turbo-light', name: 'WA Turbo Light', dark: false, swatch: ['#e8eaee', '#f4f5f7', '#ffffff', '#0b6e55'] },
  { id: 'whatsapp-light', name: 'WhatsApp Light', dark: false, swatch: ['#f0f2f5', '#efeae2', '#ffffff', '#d9fdd3'] },
  { id: 'turbo-dark', name: 'WA Turbo Dark', dark: true, swatch: ['#17191c', '#16181b', '#23272d', '#14896a'] },
  { id: 'dark-modern', name: 'Dark Modern', dark: true, swatch: ['#181818', '#1f1f1f', '#2b2b2b', '#0078d4'] },
  { id: 'dark-plus', name: 'Dark+', dark: true, swatch: ['#333333', '#1e1e1e', '#2d2d2d', '#0e639c'] },
  { id: 'monokai', name: 'Monokai', dark: true, swatch: ['#1e1f1c', '#272822', '#3e3d32', '#a6e22e'] },
  { id: 'whatsapp-dark', name: 'WhatsApp Dark', dark: true, swatch: ['#202c33', '#0b141a', '#202c33', '#005c4b'] },
];

const KEY = 'wat.theme';
interface Saved { mode: ThemeMode; light: string; dark: string }
const DEFAULT: Saved = { mode: 'system', light: 'turbo-light', dark: 'turbo-dark' };

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (!v) return { ...DEFAULT };
    const ok = (id: unknown, dark: boolean) => THEMES.some(t => t.id === id && t.dark === dark);
    return {
      mode: v.mode === 'light' || v.mode === 'dark' || v.mode === 'system' ? v.mode : DEFAULT.mode,
      light: ok(v.light, false) ? v.light! : DEFAULT.light,
      dark: ok(v.dark, true) ? v.dark! : DEFAULT.dark,
    };
  } catch {
    return { ...DEFAULT };
  }
}

const saved = load();
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let onChange: (() => void) | null = null;

export const themeMode = (): ThemeMode => saved.mode;
export const themeFor = (dark: boolean): string => (dark ? saved.dark : saved.light);
export const isDark = (): boolean => (saved.mode === 'system' ? systemDark.matches : saved.mode === 'dark');

/** Puts the current theme on <html>. Safe to call before anything renders. */
export function applyTheme(): void {
  const dark = isDark();
  const root = document.documentElement;
  root.dataset.theme = themeFor(dark);
  root.dataset.dark = String(dark);
  onChange?.();
}

function persist(): void {
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* applies for this session only */ }
  applyTheme();
}

export function setMode(m: ThemeMode): void { saved.mode = m; persist(); }

/** Picking a theme also switches to its side (a dark theme turns dark mode on). */
export function setTheme(id: string): void {
  const t = THEMES.find(x => x.id === id);
  if (!t) return;
  if (t.dark) saved.dark = id; else saved.light = id;
  if (saved.mode !== 'system' || isDark() !== t.dark) saved.mode = t.dark ? 'dark' : 'light';
  persist();
}

/** The titlebar switch: the other side, as a fixed choice. */
export function toggleDark(): void { setMode(isDark() ? 'light' : 'dark'); }

/** Called after every theme change (and when the system flips in System mode). */
export function onThemeChange(fn: () => void): void { onChange = fn; }

systemDark.addEventListener('change', () => { if (saved.mode === 'system') applyTheme(); });

/** The colours native parts need: window background and titlebar. */
export function themeColours(): { bg: string; titlebar: string; titlebarText: string } {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string) => cs.getPropertyValue(k).trim();
  return { bg: v('--s0'), titlebar: v('--chrome'), titlebarText: v('--ink-2') };
}
