import { describe, expect, it } from 'vitest';
import { ID } from '../../src/renderer/i18n-id';

// The window is written for macOS. On Windows every Mac sentence gets Windows wording, in English and in
// Bahasa Indonesia, and none of them may still mention the Mac, the Dock, the menu bar or ⌘.
describe('Windows wording', async () => {
  (globalThis as { platform?: string }).platform = 'win32';
  const { WIN_COPY, platformDictionary, toWindows } = await import('../../src/renderer/platform');
  const win = platformDictionary(ID);

  it('rewords every Mac sentence in the dictionary', () => {
    for (const en of Object.keys(ID)) expect(toWindows(en)).not.toMatch(/\bthis Mac\b|\bmacOS\b|\bDock\b|menu bar|⌘|\bTerminal\b|\bbrew\b/);
  });
  it('has Indonesian for every Windows sentence, with no Mac words left', () => {
    for (const en of Object.keys(ID)) {
      const w = toWindows(en);
      if (w === en) continue;
      expect(win[w], w).toBeTruthy();
      expect(win[w]).not.toMatch(/\bMac\b|\bmacOS\b|\bDock\b|bar menu|⌘|AirDrop|\bTerminal\b/);
    }
  });
  it('translates the reworded sentences themselves', () => {
    for (const [mac, w] of WIN_COPY) if (mac in ID) expect(win[w], w).toBeTruthy();
    expect(win['Same as Windows']).toBe('Ikuti Windows');
    expect(win['Save {x} to this PC']).toBe('Simpan {x} ke PC ini');
  });
  it('gives the AI setup steps for Windows', () => {
    expect(toWindows('In Terminal (Command Prompt on Windows), run')).toBe('In Command Prompt, run');
    expect(toWindows('brew install --cask claude-code')).toBe('irm https://claude.ai/install.ps1 | iex');
    // The main process words its sign-in messages with TERMINAL; they need Indonesian too.
    for (const m of [
      'Codex is signed out. Open Command Prompt, run codex login, then press Check again in Settings.',
      'Antigravity is signed out. Open Command Prompt, run agy, sign in with Google, then press Check again in Settings.',
      'Claude Code is signed out. Open Command Prompt, run claude, type /login, then check again in Settings.',
      'Run codex login in Command Prompt, then press Check again.',
    ]) expect(win[m], m).toMatch(/Buka Command Prompt|di Command Prompt/);
  });
});
