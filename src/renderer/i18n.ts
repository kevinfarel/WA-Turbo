import type { Lang } from '@shared/types';
import { ID } from './i18n-id';

// App language. The window is written in English; in Bahasa Indonesia every piece of interface text
// is looked up in i18n-id.ts as it appears on screen (a MutationObserver sees each render), so the
// render code stays as it is. Chat content is never translated: names, messages, Claude's output
// and anything else under translate="no" is skipped. English does nothing at all.
//
// Dictionary keys are the English text of one text node (spacing collapsed). A key with {n} (a
// number or time) or {x}/{y} (any text, translated again on its own) is a pattern. Text joined
// with " · " is translated part by part.

const LANG_KEY = 'wat.lang';

function stored(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'en' || v === 'id') return v;
  } catch { /* storage blocked: follow the system */ }
  return navigator.language.toLowerCase().startsWith('id') ? 'id' : 'en';
}

export const lang: Lang = stored();
/** Dates and numbers follow the app language. */
export const locale = lang === 'id' ? 'id-ID' : 'en-GB';

/** Saves the choice; the window reloads so every view is drawn again in the new language. */
export function setLang(l: Lang): void {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* keeps the current language */ }
  location.reload();
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const exact = new Map<string, string>();
const patterns: { re: RegExp; out: string }[] = [];
const PH = /\{(n\d?|x|y|z)\}/g;
const HAS_PH = /\{(n\d?|x|y|z)\}/;
for (const [en, id] of Object.entries(ID)) {
  if (!HAS_PH.test(en)) { exact.set(norm(en), id); continue; }
  const src = norm(en).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(n\d?|x|y|z)\\?\}/g, (_m, k: string) => (k[0] === 'n' ? `(?<${k}>[\\d.,:+−-]+)` : `(?<${k}>.+?)`));
  patterns.push({ re: new RegExp('^' + src + '$'), out: id });
}

const debug = (() => { try { return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV || localStorage.getItem('wat.i18nDebug') === '1'; } catch { return false; } })();
const missing = new Set<string>();
if (debug) (window as unknown as { __i18nMissing: Set<string> }).__i18nMissing = missing;

function lookup(s: string, depth = 0): string | null {
  const hit = exact.get(s);
  if (hit !== undefined) return hit;
  for (const p of patterns) {
    const m = p.re.exec(s);
    if (!m) continue;
    return p.out.replace(PH, (_x, k: string) => {
      const v = m.groups?.[k] ?? '';
      return k[0] === 'n' || depth > 1 ? v : (lookup(v, depth + 1) ?? v);
    });
  }
  if (s.includes(' · ')) {
    const parts = s.split(' · ');
    const out = parts.map(p => lookup(p, depth + 1) ?? p);
    if (out.some((p, i) => p !== parts[i])) return out.join(' · ');
  }
  return null;
}

/** One string in the app language; unknown text comes back as it is. */
export function tr(s: string): string {
  if (lang === 'en') return s;
  const n = norm(s);
  if (!n || !/[A-Za-z]/.test(n)) return s;
  const hit = lookup(n);
  if (hit === null) { if (debug) missing.add(n); return s; }
  const lead = /^\s*/.exec(s)![0], tail = /\s*$/.exec(s)![0];
  return lead + hit + tail;
}

const ATTRS = ['title', 'aria-label', 'placeholder'] as const;
// What this file wrote, so its own changes don't come back through the observer.
const wrote = new WeakMap<Node, string>();

const skipped = (el: Element | null): boolean => !!el?.closest('[translate="no"], script, style, code, textarea');

function textNode(t: Text): void {
  if (wrote.get(t) === t.data || skipped(t.parentElement)) return;
  const out = tr(t.data);
  if (out !== t.data) { t.data = out; wrote.set(t, out); }
}

function attrs(el: Element): void {
  if (el.closest('[translate="no"]') || el.parentElement?.closest('script, style, code, textarea')) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const key = '@' + a;
    const done = (el as unknown as Record<string, string>)[key];
    if (done === v) continue;
    const out = tr(v);
    if (out !== v) { (el as unknown as Record<string, string>)[key] = out; el.setAttribute(a, out); }
  }
}

function tree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) { textNode(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE && skipped(root as Element)) { if (root.nodeName === 'TEXTAREA') attrs(root as Element); return; }
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => {
      if (n.nodeType !== Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
      if ((n as Element).getAttribute('translate') === 'no' || /^(SCRIPT|STYLE|CODE)$/.test(n.nodeName)) return NodeFilter.FILTER_REJECT;
      // A text box keeps what was typed, but its placeholder and label are interface text.
      if (n.nodeName === 'TEXTAREA') { attrs(n as Element); return NodeFilter.FILTER_REJECT; }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  if (root.nodeType === Node.ELEMENT_NODE) attrs(root as Element);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) { const t = n as Text; if (wrote.get(t) !== t.data) { const out = tr(t.data); if (out !== t.data) { t.data = out; wrote.set(t, out); } } }
    else attrs(n as Element);
  }
}

/** Translates the page as it is now and everything drawn after. */
export function startTranslating(): void {
  document.documentElement.lang = lang;
  if (lang === 'en') return;
  tree(document.body);
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(tree);
      else if (r.type === 'characterData') textNode(r.target as Text);
      else if (r.target.nodeType === Node.ELEMENT_NODE) attrs(r.target as Element);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
}
