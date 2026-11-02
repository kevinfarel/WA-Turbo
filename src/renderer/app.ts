// WA Turbo window. Ported from the OpenDesign mockup's own render code (same markup, classes and copy),
// with its demo data replaced by live data from the main process over window.api.
// The only send in this file is sendFromComposer(): what you typed, when you press Send or Enter.

import type { Bridge, PickedPhoto } from '@shared/ipc';
import type { ContactImportPreview, ContactSource, ContactsInfo, DbInfo, GroupMember,
  Account, Accent, AiProvider, AiStatus, AutoStatus, ChatInsight, ChatSummaryRow, ClaudeModel, LocalFound, Loop, Message, PairState, Partner, PresetId, Report, RunProgress, Settings, SummaryResult, TeamMember, UsageBucket,
} from '@shared/types';
import { fmtDur, loopAge, loopPending, loopSla, setDurLang, SLA_LABEL, SLA_ORDER } from '@shared/sla';
import { EMPTY_WEEK, PRESETS } from '@shared/presets';
import { encodeMentions, type PickedMention } from '@shared/mentions';
import { activeModel, FREE_CAP, isClaude, modelLabel, PROVIDERS } from '@shared/ai';
import { esc, fmtText } from './format';
import { weekStart } from '@shared/week';
import { WIN_SOUND_LABEL, WIN_SOUNDS, winSound } from '@shared/sounds';
import { HERE, IS_WIN, toWindows } from './platform';
import { lang, locale, setLang, startTranslating, tr } from './i18n';
import { applyTheme, isDark, onThemeChange, setMode, setTheme, THEMES, themeColours, themeFor, themeMode, toggleDark } from './theme';

// Theme and language go on before anything is drawn; the window stays blank until then (themes.css).
applyTheme();
setDurLang(lang);

declare global { interface Window { api: Bridge; platform: string } }
const api = window.api;

/* ============ helpers ============ */
const $ = <T extends HTMLElement = HTMLElement>(s: string, r?: ParentNode): T => (r || document).querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string, r?: ParentNode): T[] => Array.from((r || document).querySelectorAll(s)) as T[];
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const wide = window.matchMedia('(min-width: 1280px)');

const PATHS: Record<string, string> = {
  send: 'M4.5 12 20 4.5 13.5 20 11 13.5z',
  pin: 'M15 3.5 20.5 9l-3 1.2-3.7 3.7.8 4.6-1.8 1.8-3.6-3.6L4.5 21 3 19.5l4.7-4.7-3.6-3.6 1.8-1.8 4.6.8 3.7-3.7z',
  clip: 'M20.5 11.5 12 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.7a1.7 1.7 0 0 1-2.4-2.4L15 7.6',
  save: 'M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19.5h14',
  spark: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
  check: 'm5 13 4 4L19 7', chev: 'm9 6 6 6-6 6', back: 'm15 6-6 6 6 6',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  copy: 'M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  down: 'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19.5h16',
  trash: 'M4 7h16M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7m-9 0 .9 12.3A1.8 1.8 0 0 0 8.7 21h6.6a1.8 1.8 0 0 0 1.8-1.7L18 7',
  refresh: 'M20 11a8 8 0 1 0-2.6 6M20 5v6h-6', jump: 'M7 17 17 7M9 7h8v8', bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
  warn: 'M12 9v5M12 17.5v.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  key: 'M14.5 3a6.5 6.5 0 1 0-6.2 8.5L3 17v4h4l1-1v-2h2v-2h2l1.2-1.2A6.5 6.5 0 0 0 14.5 3M16 8h.01',
  inbox: 'M21 12a9 9 0 1 1-4.2-7.6L21 3l-1.4 4.2A8.9 8.9 0 0 1 21 12zM8 11h8M8 15h5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5.5 12.5 4 4', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4.5V12l3.5 2',
  reply: 'M9 14 4 9l5-5M4 9h9a7 7 0 0 1 7 7v4',
  hour: 'M8 3h8M8 21h8M8 3v4a4 4 0 0 0 1.5 3.1L12 12l2.5-1.9A4 4 0 0 0 16 7V3M8 21v-4a4 4 0 0 1 1.5-3.1L12 12l2.5 1.9A4 4 0 0 1 16 17v4',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7', pause: 'M10 4.5H7.5v15H10zM16.5 4.5H14v15h2.5z',
  phone: 'M7 2.5h10a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V4A1.5 1.5 0 0 1 7 2.5M11 18.5h2',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5h.01', x: 'M6 6l12 12M18 6 6 18',
  belloff: 'M18 8a6 6 0 0 0-9.4-4.9M6 8c0 7-3 8-3 8h13M13.7 21a2 2 0 0 1-3.4 0M3 3l18 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01', team: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-1a6 6 0 0 1 12 0v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4.5-5.8', swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7', edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  rocket: 'M12 2.6c2.7 2.1 4.3 5.3 4.3 8.8 0 2-.5 3.7-1.3 5H9c-.8-1.3-1.3-3-1.3-5 0-3.5 1.6-6.7 4.3-8.8M12 9.7h.01M7.7 12.9 5.4 15.2v3.2l2.6-1.7M16.3 12.9l2.3 2.3v3.2L16 17M10.3 19.6c.4 1.2 1 2.1 1.7 2.8.7-.7 1.3-1.6 1.7-2.8',
};
function icon(name: string, size?: number): string {
  return '<svg class="od-icon"' + (size ? ' style="--od-icon-size:' + size + 'px"' : '') +
    ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (PATHS[name] || '') + '"/></svg>';
}

const now = () => Date.now();
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (t: number) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dayKey = (t: number) => { const d = new Date(t); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
const startOfDay = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
function dayLabel(t: number): string {
  const diff = Math.round((startOfDay(now()) - startOfDay(t)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(t).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}
function relTime(t: number): string {
  const h = (now() - t) / 3600000;
  if (h < 24 && dayKey(t) === dayKey(now())) return clock(t);
  const diff = Math.round((startOfDay(now()) - startOfDay(t)) / 86400000);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return new Date(t).toLocaleDateString(locale, { weekday: 'short' });
  return new Date(t).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}
function initials(name: string): string {
  const clean = name.replace(/\s*[—(].*$/, '').replace(/^\+/, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts[0] && /^\d/.test(parts[0])) return parts[0].slice(-2); // unnamed contact: last two digits
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase(); // same as the mockup
}
const ACCENT: Record<Accent, string> = { green: 'var(--a-green)', blue: 'var(--a-blue)', amber: 'var(--a-amber)', violet: 'var(--a-violet)', cyan: 'var(--a-cyan)' };
const FILTER_LABEL: Record<string, string> = { all: 'All', pinned: 'Pinned', needsreply: 'Needs reply', waiting: 'Waiting on them' };
const LOOP_KIND: Record<string, string> = { question: 'Question', confirmation: 'Confirmation', commitment: 'Commitment' };
const RANGE_LABEL: Record<string, string> = { '1': 'last 24 hours', '7': 'last 7 days', '30': 'last 30 days' };
const PAGE = 300;

/* ============ state ============ */
type Summary = { chatId: string | null; running: boolean; progress: RunProgress | null; result: SummaryResult | null; error: string | null };

const state = {
  view: 'inbox' as 'inbox' | 'loops' | 'reports' | 'settings',
  acct: null as string | null,
  chat: null as string | null,
  filter: 'all',
  q: '',
  hits: null as Set<string> | null,
  panelOpen: wide.matches,
  accounts: [] as Account[],
  partners: [] as Partner[],
  chats: [] as ChatSummaryRow[],
  messages: new Map<string, Message[]>(),
  loops: [] as Loop[],
  settings: { provider: 'claude-code', model: 'claude-haiku-5-5', window: 'week', customPrompt: '', openAtLogin: false, aiImages: true, autoOn: true, pinEveryMin: 5, pinWindow: 10, otherEveryMin: 60, otherWindow: 2 } as Settings,
  drafts: new Map<string, string>(),
  photo: null as (PickedPhoto & { chatId: string }) | null,
  // @ tags: each group's members (fetched on the first "@"), the people tagged in each chat's draft, and the open list.
  members: new Map<string, { at: number; list: GroupMember[] }>(),
  tags: new Map<string, PickedMention[]>(),
  mention: null as null | { chatId: string; start: number; query: string; idx: number },
  sending: false,
  editing: null as null | { msgId: string; text: string },
  team: [] as TeamMember[],
  usage: null as UsageBucket[] | null,
  usageUnit: 'day' as 'day' | 'week',
  db: null as DbInfo | null,
  contacts: null as ContactsInfo | null,
  ct: null as null | { data: Uint8Array; preview: ContactImportPreview; keep: Record<string, string> },
  dbPwShown: false,
  dbBusy: false,
  auto: null as AutoStatus | null,
  localFound: null as LocalFound | null,
  ai: { provider: 'claude-code', connected: false, testing: false, cliFound: false, account: null } as AiStatus,
  summary: { chatId: null, running: false, progress: null, result: null, error: null } as Summary,
  reports: [] as Report[],
  report: null as string | null,
  gen: null as RunProgress | null,
  genArgs: null as null | { presetId: PresetId; days: Report['days']; chatIds: string[]; custom: string },
  pick: new Set<string>(),
  pair: { accountId: null, phase: 'name', qrSvg: null, error: null } as PairState,
  pairForm: { name: '', desc: '', accent: 'cyan' as Accent },
  loopGroup: 'direction', loopType: 'all', loopAcct: 'all', loopClosed: false, loopChat: null as string | null,
};

/* ============ derived ============ */
const acctById = (id: string | null) => state.accounts.find(a => a.id === id);
const chatById = (id: string | null) => state.chats.find(c => c.id === id);
const partnerById = (id: string | null) => state.partners.find(p => p.id === id);
const partnerOf = (c?: ChatSummaryRow) => (c && c.partner ? partnerById(c.partner) : undefined);
const ptypeOf = (c?: ChatSummaryRow) => partnerOf(c)?.type || null;
const unreadFor = (id: string) => state.chats.filter(c => id === 'all' || c.acct === id).reduce((n, c) => n + c.unread, 0);
const accentOf = (c: ChatSummaryRow) => ACCENT[acctById(c.acct)?.accent ?? 'green'];
const openLoops = () => state.loops.filter(l => l.state === 'open');
const loopById = (id: string) => state.loops.find(l => l.id === id);
const acctOfLoop = (l: Loop) => chatById(l.chatId)?.acct ?? null;
const scopedOpen = () => openLoops().filter(l => state.loopAcct === 'all' || acctOfLoop(l) === state.loopAcct);
const loopsOf = (chatId: string, dir?: string) => state.loops.filter(l => l.state === 'open' && l.chatId === chatId && (!dir || l.dir === dir));
const sla = (l: Loop) => loopSla(l, now());
const age = (l: Loop) => loopAge(l, now());
const pending = (l: Loop) => loopPending(l, now());
const model = () => activeModel(state.settings);

function visibleChats(): ChatSummaryRow[] {
  const q = state.q.trim().toLowerCase();
  return state.chats
    .filter(c => c.acct === state.acct)
    .filter(c => state.filter !== 'pinned' || c.pinned)
    .filter(c => state.filter !== 'needsreply' || loopsOf(c.id, 'owed').length > 0)
    .filter(c => state.filter !== 'waiting' || loopsOf(c.id, 'waiting').length > 0)
    .filter(c => !q || c.name.toLowerCase().includes(q) || (c.org || '').toLowerCase().includes(q) || c.lastText.toLowerCase().includes(q) || !!state.hits?.has(c.id))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastAt - a.lastAt);
}

/* ============ summary labels ============ */
const SHORT_DAY = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
const whenShort = (t: number): string => (dayKey(t) === dayKey(now()) ? '' : SHORT_DAY.format(new Date(t)).replace(',', '') + ' ') + clock(t);

function windowLabel(key: string | null): string {
  if (!key) return '';
  if (key.startsWith('week:')) return 'This week';
  if (key.startsWith('n:')) return 'Last ' + key.slice(2) + ' messages';
  if (key.startsWith('auto:')) return 'Auto · last ' + key.slice(5) + ' messages';
  if (key.startsWith('days:')) return 'Report · last ' + key.slice(5) + ' days';
  return '';
}

/** "Summed up 14:02 · auto · up to date" for the chat header. */
function sumUpLabel(c: ChatSummaryRow): { text: string; s: 'fresh' | 'stale' | 'none'; title: string } {
  if (!c.lastSumAt) return { text: 'Not summed up yet', s: 'none', title: 'Summarize reads ' + windowText() + '.' };
  const text = 'Summed up ' + whenShort(c.lastSumAt) + ' · ' + (c.lastSumAuto ? 'auto' : 'you') + ' · ' + (c.newSince ? c.newSince + ' new since' : 'up to date');
  const checked = !c.pinned && c.autoCheckedAt && c.autoCheckedAt > c.lastSumAt ? ' Loops checked by auto summary ' + relTime(c.autoCheckedAt) + '.' : '';
  return { text, s: c.newSince ? 'stale' : 'fresh', title: new Date(c.lastSumAt).toLocaleString(locale) + '.' + checked };
}

const clockOrDay = (t: number): string => (dayKey(t) === dayKey(now()) ? clock(t) : SHORT_DAY.format(new Date(t)).split(' ').slice(0, 1).join(''));
const windowText = (): string => (state.settings.window === 'week' ? "this week's messages, since Monday" : 'the last ' + state.settings.window + ' messages');

/* ============ toasts ============ */
function toast(text: string, kind?: 'ok' | 'bad', action?: { label: string; run: () => void }): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = (kind === 'ok' ? icon('check', 15) : kind === 'bad' ? icon('warn', 15) : '') + '<span>' + esc(text) + '</span>' +
    (action ? '<button type="button" class="btn btn-sm toast-act">' + esc(action.label) + '</button>' : '');
  if (action) el.querySelector('button')!.addEventListener('click', () => { el.remove(); action.run(); });
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 200); }, action ? 6000 : 2800);
}
const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'bad');

/* ============ rail ============ */
function renderRail(): void {
  const rail = $('#rail');
  const total = unreadFor('all');
  const over = openLoops().filter(l => sla(l) === 'over').length;
  let h = '<button type="button" class="acct sumup" data-go="loops" aria-current="' + (state.view === 'loops') + '" style="--acc:var(--brand)" title="Open loops across all numbers">' +
    '<span class="av" aria-hidden="true">' + icon('rocket', 21) + '<span class="beta beta-av">Beta</span></span>' +
    '<span class="nm od-truncate">SUM UP!</span>' +
    (over ? '<span class="badge">' + over + '</span>' : '') +
    '<span class="vh">Open SUM UP!' + (over ? ', ' + over + ' past SLA' : '') + '</span></button>';
  h += '<div class="rail-div"></div>';
  h += '<p class="rail-label">Numbers</p>';
  state.accounts.forEach(a => {
    const u = unreadFor(a.id);
    const pres = a.status === 'online' ? 'online' : a.status === 'logged_out' ? 'offline' : 'reconnecting';
    h += '<button type="button" class="acct" data-acct="' + a.id + '" aria-current="' + (state.acct === a.id && state.view === 'inbox') + '" style="--acc:' + ACCENT[a.accent] + '" title="' + esc(a.name + ' · ' + (a.desc || '') + ' · ' + a.phone) + '">' +
      '<span class="av" aria-hidden="true">' + esc(initials(a.name)) + '<span class="pres" data-s="' + pres + '"></span></span>' +
      '<span class="nm od-truncate" translate="no">' + esc(a.name) + '</span>' +
      (u ? '<span class="badge">' + u + '</span>' : '') +
      '<span class="vh">' + esc((a.desc || '') + ', ' + a.phone + ', ' + statusWord(a) + (u ? ', ' + u + ' unread' : '')) + '</span></button>';
  });
  rail.innerHTML = h;
  const n = state.accounts.length;
  $('#titleAcct').textContent = n ? n + (n === 1 ? ' number linked' : ' numbers linked') : 'No numbers linked yet';
  const seg = $('#segUnread');
  seg.textContent = String(total);
  seg.hidden = total === 0;
}
const statusWord = (a: Account) => ({ online: 'connected', reconnecting: 'reconnecting', pairing: 'linking', logged_out: 'logged out' }[a.status]);

/* ============ chat list ============ */
function renderList(): void {
  const rows = $('#rows');
  const a = acctById(state.acct);
  const la = $('#listAcct');
  if (a) {
    la.innerHTML = '<span class="adot" aria-hidden="true"></span><span class="od-truncate" translate="no">' + esc(a.name) +
      (a.desc ? ' · ' + esc(a.desc) : '') + '</span><span class="ph od-nowrap od-fill">' + esc(a.phone) + '</span>';
    la.style.setProperty('--acc', ACCENT[a.accent]);
  } else la.innerHTML = '';
  if (!state.accounts.length) {
    rows.innerHTML = '<div class="empty"><span class="glyph">' + icon('phone', 20) + '</span><h3>Link your first number</h3><p>Open WhatsApp on your phone → Settings → Linked devices → Link a device, then scan the code WA Turbo shows.</p>' +
      '<button type="button" class="btn btn-primary btn-sm" data-pair style="margin-top:6px">Link a number</button></div>';
    return;
  }
  const list = visibleChats();
  if (!list.length) {
    const why = state.q.trim()
      ? { h: 'No matches', p: 'Nothing in “' + state.q.trim() + '” across the chats in view. Try a shorter term or clear the filter.' }
      : state.filter !== 'all'
        ? { h: 'Nothing in this filter', p: 'No chats match the “' + (FILTER_LABEL[state.filter] || state.filter) + '” filter on ' + (a ? a.name : 'this login') + '.' }
        : { h: 'No chats yet', p: (a ? a.name : 'This login') + ' is linked but has no conversations synced yet. Messages appear here as they arrive.' };
    rows.innerHTML = '<div class="empty"><span class="glyph">' + icon('search', 20) + '</span><h3>' + esc(why.h) + '</h3><p>' + esc(why.p) + '</p></div>';
    return;
  }
  const pinChip = document.querySelector('.chip[data-filter="pinned"]');
  const pinCount = state.chats.filter(c => c.acct === state.acct && c.pinned).length;
  if (pinChip) pinChip.textContent = pinCount ? 'Pinned · ' + pinCount : 'Pinned';
  const grouped = state.filter !== 'pinned' && list.some(c => c.pinned) && list.some(c => !c.pinned);
  rows.innerHTML = list.map((c, i) => {
    const head = grouped && (i === 0 || list[i - 1].pinned !== c.pinned) ? '<p class="row-group">' + (c.pinned ? 'Pinned' : 'All chats') + '</p>' : '';
    const who = c.lastWho === 'me' ? 'You: ' : (c.kind === 'group' && c.lastWho ? c.lastWho + ': ' : '');
    const owed = loopsOf(c.id, 'owed').length;
    const waiting = loopsOf(c.id, 'waiting').length;
    return head + '<button type="button" class="row" data-chat="' + c.id + '" aria-current="' + (state.chat === c.id) + '" style="--acc:' + accentOf(c) + '">' +
      '<span class="av' + (c.kind === 'group' ? ' grp' : '') + '" aria-hidden="true">' + esc(initials(c.name)) + '</span>' +
      '<span class="row-main">' +
        '<span class="row-top">' + (c.pinned ? '<span class="row-pin" title="Pinned">' + icon('pin', 11) + '</span>' : '') + (isMuted(c) ? '<span class="row-pin muted" title="' + esc(mutedLabel(c)) + '">' + icon('belloff', 11) + '</span>' : '') + '<span class="row-nm od-fill od-truncate" translate="no">' + esc(c.name) + '</span><span class="row-t od-nowrap">' + esc(relTime(c.lastAt)) + '</span></span>' +
        '<span class="row-bot">' +
          '<span class="row-msg od-fill od-truncate">' + esc(who) + '<span translate="no">' + esc(c.lastText) + '</span></span>' +
          (owed ? '<span class="tag owe">' + icon('reply', 10) + owed + '</span>' : '') +
          (waiting ? '<span class="tag wait">' + icon('hour', 10) + waiting + '</span>' : '') +
          (c.lastSumAt ? '<span class="tag sum" title="' + esc(sumUpLabel(c).text) + '">AI ' + esc(clockOrDay(c.lastSumAt)) + '</span>' : '') +
          (c.unread ? '<span class="cnt">' + c.unread + '</span>' : '') +
        '</span>' +
      '</span>' +
      '<span class="vh">' + esc((acctById(c.acct)?.name ?? '') + ' account' +
        (owed ? ', ' + owed + ' waiting on your reply' : '') + (waiting ? ', ' + waiting + ' waiting on them' : '') + (c.unread ? ', ' + c.unread + ' unread' : '')) + '</span>' +
    '</button>';
  }).join('');
}

/* ============ conversation ============ */
const MEDIA_WORD: Record<string, string> = { image: 'Photo', video: 'Video', audio: 'Voice note', document: 'Document', sticker: 'Sticker', location: 'Location', contact: 'Contact card' };

function mediaFigure(m: Message): string {
  if (!m.media && !MEDIA_WORD[m.type]) return '';
  const name = m.media?.fileName || MEDIA_WORD[m.type] || 'Attachment';
  const isImg = (m.type === 'image' || m.type === 'sticker') && !!m.media;
  // The full photo, downloaded once and cached; the small WhatsApp thumbnail stands in if that fails.
  const thumb = isImg
    ? '<button type="button" class="sh-open" data-view-media="' + m.id + '" aria-label="Open photo"><span class="sh-thumb"><img src="wat-media://full/' + m.id + '"' +
        (m.media!.hasThumb ? ' data-fallback="wat-media://thumb/' + m.id + '"' : '') + ' alt="' + esc(name) + '" loading="lazy"></span></button>'
    : '<span class="sh-thumb ph">' + icon('doc', 18) + '<span>' + esc(MEDIA_WORD[m.type] || 'File') + '</span></span>';
  const read = m.type === 'image' && state.settings.aiImages;
  return '<figure class="shot' + (isImg ? '' : ' file') + '">' + thumb +
    '<figcaption class="sh-meta"><b class="od-truncate" translate="no">' + esc(name) + '</b>' +
    '<span class="sh-ai"' + (read ? ' data-on="true"' : '') + '>' + icon(read ? 'spark' : 'doc', 10) + (read ? 'Read by AI' : 'Not read by AI') + '</span>' +
    (m.media ? '<button type="button" class="sh-save" data-save-media="' + m.id + '" title="Save to ' + HERE + '" aria-label="Save ' + esc(name) + ' to ' + HERE + '">' + icon('save', 12) + '</button>' : '') +
    '</figcaption></figure>';
}

const EDIT_WINDOW_MS = 15 * 60_000;
const REVOKE_WINDOW_MS = 48 * 3600_000;

function msgById(id: string): Message | undefined {
  return state.chat ? state.messages.get(state.chat)?.find(m => m.id === id) : undefined;
}

/** Re-renders the open chat without jumping to the bottom. */
function renderConvoKeepScroll(): void {
  const top = document.getElementById('thread')?.scrollTop;
  renderConvo();
  const th = document.getElementById('thread');
  if (th && top !== undefined) th.scrollTop = top;
}

function openMessageMenu(m: Message, x: number, y: number): void {
  closeAcctMenu();
  const mine = m.who === 'me';
  const online = acctById(chatById(state.chat)?.acct ?? null)?.status === 'online';
  const age = Date.now() - m.at;
  const item = (act: string, label: string, ic: string, ok: boolean, why: string, cls = '') =>
    '<button type="button" data-msgact="' + act + '" data-id="' + m.id + '"' + (cls ? ' class="' + cls + '"' : '') + (ok ? '' : ' disabled title="' + esc(why) + '"') + '>' +
      icon(ic, 13) + '<span>' + label + (ok ? '' : '<small>' + esc(why) + '</small>') + '</span></button>';
  let html = m.text ? item('copy', 'Copy text', 'copy', true, '') : '';
  if (mine && m.type === 'text') html += item('edit', 'Edit', 'edit', online && age < EDIT_WINDOW_MS, online ? 'Only within 15 minutes of sending' : 'This number is offline');
  if (mine) html += item('delete', 'Delete for everyone', 'trash', online && age < REVOKE_WINDOW_MS, online ? 'Only within 2 days of sending' : 'This number is offline', 'danger');
  if (!mine && chatById(state.chat)?.kind === 'group') html += m.team ? item('unteam', 'Remove ' + esc(m.who) + ' from my team', 'x', true, '') : item('team', 'Mark ' + esc(m.who) + ' as my team', 'team', true, '');
  if (!html) return;
  const el = document.createElement('div');
  el.className = 'acct-menu msg-menu';
  el.id = 'acctMenu';
  el.innerHTML = html;
  document.body.appendChild(el);
  el.style.left = Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8)) + 'px';
}

function messageAction(act: string, id: string): void {
  const m = msgById(id); if (!m) return;
  if (act === 'copy') { void copyText(m.text, 'Message'); return; }
  if (act === 'team' || act === 'unteam') { void setTeam(id, act === 'team', m.who); return; }
  if (act === 'edit') {
    state.editing = { msgId: id, text: m.text };
    renderConvoKeepScroll();
    const box = document.getElementById('editBox') as HTMLTextAreaElement | null;
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); fitComposer(box, 240); }
    return;
  }
  if (act === 'delete') confirmDlg('Delete for everyone', 'This removes the message from the chat for everyone. They may already have read it. This cannot be undone.', 'Delete for everyone', () => void removeForEveryone(id));
}

async function setTeam(messageId: string, on: boolean, who: string): Promise<void> {
  try {
    state.team = await api.setTeam(messageId, on);
    if (state.chat) await loadMessages(state.chat, Math.max(PAGE, state.messages.get(state.chat)?.length ?? 0));
    renderConvoKeepScroll();
    if (state.view === 'settings') renderTeam();
    toast(on ? who + ' is on your team. Their asks now wait on the other side.' : who + ' removed from your team', 'ok');
  } catch (e) { fail(e); }
}

/** Saves the edit open in the chat, once, right now. Called only by the Save button and Enter. */
async function saveEdit(): Promise<void> {
  const ed = state.editing;
  if (!ed || state.sending) return;
  const box = document.getElementById('editBox') as HTMLTextAreaElement | null;
  const text = (box?.value ?? ed.text).trim();
  const m = msgById(ed.msgId);
  if (m && text === m.text.trim()) { state.editing = null; renderConvoKeepScroll(); return; }
  state.sending = true;
  try {
    await api.editMessage(ed.msgId, text);
    state.editing = null;
    if (m) { m.text = text; m.edited = true; }
    toast('Message edited', 'ok');
  } catch (e) {
    fail(e);
  }
  state.sending = false;
  renderConvoKeepScroll();
}

/** Deletes one of your messages for everyone. Called only from the confirm dialog. */
async function removeForEveryone(id: string): Promise<void> {
  try {
    await api.deleteForEveryone(id);
    const list = state.chat ? state.messages.get(state.chat) : undefined;
    if (list) { const i = list.findIndex(m => m.id === id); if (i >= 0) list.splice(i, 1); }
    if (state.editing?.msgId === id) state.editing = null;
    toast('Deleted for everyone', 'ok');
  } catch (e) {
    fail(e);
  }
  renderConvoKeepScroll();
}

function lastReplyAfter(chatId: string, t: number): Message | undefined {
  const ms = state.messages.get(chatId) ?? [];
  for (let i = ms.length - 1; i >= 0; i--) { if (ms[i].at <= t) break; if (ms[i].who === 'me') return ms[i]; }
  return undefined;
}

function renderConvo(): void {
  const host = $('#convo');
  const c = chatById(state.chat);
  if (!c) {
    host.innerHTML = '<div></div><div class="empty"><span class="glyph">' + icon('inbox', 20) + '</span><h3>No conversation open</h3><p>Pick a chat on the left to read it and summarize it with AI.</p></div>';
    return;
  }
  const a = acctById(c.acct);
  const msgs = state.messages.get(c.id);
  let body = '';
  let lastDay = '';
  (msgs ?? []).forEach(m => {
    const k = dayKey(m.at);
    if (k !== lastDay) { lastDay = k; body += '<p class="day">' + esc(dayLabel(m.at)) + '</p>'; }
    const mine = m.who === 'me';
    const al = state.loops.find(x => x.state === 'open' && x.chatId === c.id && x.msgId === m.id);
    const tools = al
      ? '<span class="dirtag od-fill" data-d="' + al.dir + '">' + icon(al.dir === 'owed' ? 'reply' : 'hour', 11) +
          (al.dir === 'owed' ? 'Unanswered ' : 'No confirmation ') + fmtDur(age(al)) + '</span>' +
        '<button type="button" class="mflag" data-on="' + al.dir + '" data-lact="answered" data-loop="' + al.id + '">' +
          icon('check', 10) + (al.dir === 'owed' ? 'Mark answered' : 'Mark confirmed') + '</button>'
      : '<span class="od-fill"></span><button type="button" class="mflag" data-mflag="' + c.id + ':' + m.id + '">' +
          icon('flag', 10) + (mine ? 'Awaiting reply' : 'Needs my reply') + '</button>';
    const editing = state.editing?.msgId === m.id;
    body += '<div class="msg' + (mine ? ' me' : '') + (al ? ' anchored' : '') + '"' + (al ? ' data-d="' + al.dir + '"' : '') +
      ' id="msg-' + c.id + '-' + m.id + '" data-mid="' + m.id + '" style="--acc:' + accentOf(c) + '">' +
      (!mine && c.kind === 'group' ? '<span class="who"><span translate="no">' + esc(m.who) + '</span>' + (m.team ? '<span class="team-tag">Team</span>' : '') + '</span>' : '') +
      (editing
        ? '<div class="edit-box"><label><span class="vh">Edit message</span><textarea id="editBox" rows="1">' + esc(state.editing!.text) + '</textarea></label>' +
            '<div class="edit-acts"><span class="od-fill hint">Enter to save · Shift+Enter for a new line · Esc to cancel</span>' +
            '<button type="button" class="btn btn-sm" id="editCancel">Cancel</button>' +
            '<button type="button" class="btn btn-sm btn-primary" id="editSave">Save</button></div></div>'
        : m.text ? '<span class="tx" translate="no">' + fmtText(m.text, shownMentions(m)) + '</span>' : '') +
      mediaFigure(m) +
      '<div class="mt-row">' + tools +
        '<button type="button" class="icon-btn mmore" data-msgmenu="' + m.id + '" title="More" aria-label="Message options">' + icon('more', 15) + '</button>' +
        '<span class="mt od-nowrap">' + (m.edited ? 'Edited · ' : '') + esc(clock(m.at)) + '</span></div></div>';
  });
  if (!msgs) body = '<div class="empty" style="height:auto;padding:40px 0"><span class="glyph">' + icon('clock', 20) + '</span><h3>Loading messages…</h3></div>';

  const myDebt = loopsOf(c.id, 'owed');
  const theirDebt = loopsOf(c.id, 'waiting');
  const top = myDebt.concat(theirDebt).sort((x, y) => pending(y) - pending(x))[0];
  const replied = top && top.dir === 'owed' ? lastReplyAfter(c.id, top.askedAt) : undefined;
  const p = partnerOf(c);

  const online = a?.status === 'online';
  const draft = state.drafts.get(c.id) ?? '';
  const photo = state.photo?.chatId === c.id ? state.photo : null;
  const typing = document.activeElement?.id === 'composer';
  const editFocus = document.activeElement?.id === 'editBox';

  host.innerHTML =
    '<div class="convo-head">' +
      '<button type="button" class="icon-btn mob-back" id="convoBack" aria-label="Back to chat list">' + icon('back', 18) + '</button>' +
      '<span class="av" aria-hidden="true" style="background:' + accentOf(c) + '">' + esc(initials(c.name)) + '</span>' +
      '<span class="od-field od-fill"><span class="ch-nm od-truncate" translate="no">' + esc(c.name) + '</span>' +
        '<span class="ch-sub od-truncate">' + esc(((p ? [p.id, c.service || p.service].filter(Boolean).join(' · ') : c.org) || '') + ' · via ' + (a?.name ?? '') + ' ' + (a?.phone ?? '')) + '</span></span>' +
      '<span class="sumup-at od-truncate" data-s="' + sumUpLabel(c).s + '" title="' + esc(sumUpLabel(c).title) + '">' + esc(sumUpLabel(c).text) + '</span>' +
      '<button type="button" class="icon-btn" id="pinBtn" aria-pressed="' + c.pinned + '" title="' + (c.pinned ? 'Unpin chat' : 'Pin chat: auto summary every ' + state.settings.pinEveryMin + ' min') + '" aria-label="' + (c.pinned ? 'Unpin chat' : 'Pin chat') + '">' + icon('pin', 16) + '</button>' +
      (p
        ? '<button type="button" class="btn btn-sm ptag" id="chatPartner" title="Partner, service and stage">' + icon('tag', 13) + '<span>' + esc(p.id) + '</span></button>'
        : '<button type="button" class="icon-btn" id="chatPartner" title="Tag a partner, service and stage" aria-label="Tag a partner">' + icon('tag', 16) + '</button>') +
      (myDebt.length + theirDebt.length
        ? '<button type="button" class="btn btn-sm" id="chatLoops" title="Open this chat in the tracker">' + icon('clock', 13) + (myDebt.length + theirDebt.length) + ' open</button>'
        : '') +
      '<button type="button" class="btn btn-sm" id="summarizeBtn">' + icon('bolt', 14) + 'Summarize</button>' +
    '</div>' +
    '<div class="session-strip" data-s="' + (a?.status === 'online' ? 'online' : 'reconnecting') + '">' +
      '<span class="dot" aria-hidden="true"></span>' +
      '<span class="od-fill od-truncate">' + (a?.status === 'online'
        ? 'Live WhatsApp session · ' + esc(a.name) + (a.pairedAt ? ' · paired ' + esc(relTime(a.pairedAt)) : '')
        : a?.status === 'logged_out' ? 'Unlinked on the phone · ' + esc(a?.name ?? '') + ' · link it again to keep syncing'
        : 'Session dropped on ' + esc(a?.name ?? '') + ' · messages may be stale') + '</span>' +
      (a?.status === 'online' ? '' : a?.status === 'logged_out'
        ? '<button type="button" class="btn btn-sm" data-pair>Link again</button>'
        : '<button type="button" class="btn btn-sm" id="reconnectBtn">Reconnect</button>') +
    '</div>' +
    (top
      ? '<div class="loop-strip" data-d="' + top.dir + '">' + icon(top.dir === 'owed' ? 'reply' : 'hour', 13) +
          '<span class="od-fill od-truncate">' + (replied
            ? esc('You replied at ' + clock(replied.at) + '. Does that answer “' + top.topic + '”?')
            : top.dir === 'owed'
              ? esc(top.askedBy + ' has waited ' + fmtDur(age(top)) + ' for an answer: ' + top.topic)
              : esc('No confirmation for ' + fmtDur(age(top)) + ': ' + top.topic)) + '</span>' +
          '<button type="button" class="btn btn-sm" data-lact="' + (top.dir === 'owed' ? 'answered' : 'nudge') + '" data-loop="' + top.id + '">' +
            (top.dir === 'owed' ? 'Mark answered' : 'Log nudge') + '</button>' +
        '</div>'
      : '') +
    '<div class="thread" id="thread">' + body + '</div>' +
    '<div class="composer-wrap">' +
      '<div class="mention-pop" id="mentionPop" role="listbox" aria-label="People to tag" hidden></div>' +
      (photo
        ? '<div class="attach-chip"><img src="' + photo.preview + '" alt=""><span class="od-fill od-truncate">' + esc(photo.name) + ' · ' + fmtBytes(photo.size) + '</span>' +
            '<button type="button" class="icon-btn" id="attachClear" aria-label="Remove photo">' + icon('trash', 14) + '</button></div>'
        : '') +
      '<div class="composer">' +
        '<button type="button" class="icon-btn" id="attachBtn" title="Send a photo (or paste one)" aria-label="Send a photo"' + (online ? '' : ' disabled') + '>' + icon('clip', 17) + '</button>' +
        '<label class="od-fill"><span class="vh">Message ' + esc(c.name) + '</span>' +
          '<textarea id="composer" rows="1" placeholder="' + (online ? (photo ? 'Add a caption…' : c.kind === 'group' ? 'Write a message… (@ to tag, Shift+Enter for a new line)' : 'Write a message… (Shift+Enter for a new line)') : 'This number is offline. You can send once it reconnects.') + '"' +
            (online ? '' : ' disabled') + '>' + esc(draft) + '</textarea></label>' +
        '<button type="button" class="send" id="sendBtn" aria-label="Send message"' + (online && (draft.trim() || photo) && !state.sending ? '' : ' disabled') + '>' + icon('send', 16) + '</button>' +
      '</div>' +
    '</div>';

  const th = $('#thread');
  if (th) th.scrollTop = th.scrollHeight;
  const ta = document.getElementById('composer') as HTMLTextAreaElement | null;
  if (ta) {
    fitComposer(ta);
    if (typing) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  renderMentionPop();
  const eb = document.getElementById('editBox') as HTMLTextAreaElement | null;
  if (eb) {
    fitComposer(eb, 240);
    if (editFocus) { eb.focus(); eb.setSelectionRange(eb.value.length, eb.value.length); }
  }
}

function fitComposer(ta: HTMLTextAreaElement, max = 200): void {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
}

const fmtBytes = (n: number): string => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB');

/** Sends exactly what is in the composer, once, right now. Called only by the Send button and Enter. */
async function sendFromComposer(): Promise<void> {
  const c = chatById(state.chat);
  if (!c || state.sending) return;
  const ta = document.getElementById('composer') as HTMLTextAreaElement | null;
  const text = (ta?.value ?? '').trim();
  const photo = state.photo?.chatId === c.id ? state.photo : null;
  if (!text && !photo) return;
  state.sending = true;
  const btn = document.getElementById('sendBtn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  try {
    const tagged = encodeMentions(text, state.tags.get(c.id) ?? []);
    await api.sendMessage(c.id, tagged.text, photo?.token ?? null, tagged.jids);
    state.drafts.delete(c.id);
    state.tags.delete(c.id);
    if (photo) state.photo = null;
    if (ta) ta.value = '';
  } catch (e) {
    fail(e);
  }
  state.sending = false;
  renderConvo();
  document.getElementById('composer')?.focus();
}

async function attachPhoto(): Promise<void> {
  const c = chatById(state.chat); if (!c) return;
  try {
    const p = await api.pickPhoto();
    if (p) { state.photo = { ...p, chatId: c.id }; renderConvo(); document.getElementById('composer')?.focus(); }
  } catch (e) { fail(e); }
}

async function pastePhoto(file: File): Promise<void> {
  const c = chatById(state.chat); if (!c) return;
  try {
    const p = await api.pastePhoto(new Uint8Array(await file.arrayBuffer()), file.type);
    state.photo = { ...p, chatId: c.id }; renderConvo(); document.getElementById('composer')?.focus();
  } catch (e) { fail(e); }
}

/* ============ @ tags ============ */
// Typing "@" in a group lists its members; picking one writes "@Name", which goes out as a WhatsApp tag.
const MEMBERS_TTL = 10 * 60_000;

/** A message's tags with "You" in the app language. */
function shownMentions(m: Message): Record<string, string> | undefined {
  if (!m.mentions) return undefined;
  return Object.fromEntries(Object.entries(m.mentions).map(([tok, name]) => [tok, name === 'You' ? tr('You') : name]));
}

function mentionMatches(): GroupMember[] {
  const m = state.mention;
  if (!m) return [];
  const q = m.query.toLowerCase();
  const digits = q.replace(/\D/g, '').replace(/^0/, ''); // 0812… finds +62 812…
  return (state.members.get(m.chatId)?.list ?? [])
    .filter(p => p.name.toLowerCase().includes(q) || (digits.length >= 3 && p.phone.replace(/\D/g, '').includes(digits)))
    .slice(0, 50);
}

function renderMentionPop(): void {
  const pop = document.getElementById('mentionPop');
  if (!pop) return;
  const m = state.mention;
  const list = m?.chatId === state.chat ? mentionMatches() : [];
  if (!m || !list.length) { pop.hidden = true; pop.innerHTML = ''; return; }
  m.idx = Math.min(m.idx, list.length - 1);
  pop.hidden = false;
  pop.innerHTML = list.map((p, i) =>
    '<button type="button" class="mention-opt" role="option" data-mention-pick="' + i + '" aria-selected="' + (i === m.idx) + '">' +
      '<span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
      '<span class="od-fill od-truncate" translate="no">' + esc(p.name) + '</span>' +
      (p.phone && p.phone !== p.name ? '<span class="kv od-nowrap" translate="no">' + esc(p.phone) + '</span>' : '') +
    '</button>').join('');
  pop.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

/** Opens, narrows or closes the list from the text just before the cursor. */
function syncMention(ta: HTMLTextAreaElement): void {
  const c = chatById(state.chat);
  const before = ta.value.slice(0, ta.selectionStart);
  const hit = c?.kind === 'group' && ta.selectionStart === ta.selectionEnd ? /(?:^|\s)@([^@\n]{0,30})$/.exec(before) : null;
  if (!c || !hit) {
    if (state.mention) { state.mention = null; renderMentionPop(); }
    return;
  }
  const start = before.length - hit[1].length - 1;
  const idx = state.mention?.chatId === c.id && state.mention.start === start ? state.mention.idx : 0;
  state.mention = { chatId: c.id, start, query: hit[1], idx };
  const cached = state.members.get(c.id);
  if (!cached || Date.now() - cached.at > MEMBERS_TTL) {
    state.members.set(c.id, { at: Date.now(), list: cached?.list ?? [] });
    void api.groupMembers(c.id)
      .then(list => { state.members.set(c.id, { at: Date.now(), list }); renderMentionPop(); })
      .catch(e => { state.members.delete(c.id); fail(e); });
  }
  renderMentionPop();
}

function pickMention(i: number): void {
  const ta = document.getElementById('composer') as HTMLTextAreaElement | null;
  const m = state.mention;
  const p = mentionMatches()[i];
  if (!ta || !m || !p) return;
  const tag = '@' + p.name + ' ';
  ta.value = ta.value.slice(0, m.start) + tag + ta.value.slice(ta.selectionStart);
  const at = m.start + tag.length;
  ta.focus();
  ta.setSelectionRange(at, at);
  const tags = state.tags.get(m.chatId) ?? [];
  if (!tags.some(t => t.jid === p.jid)) tags.push({ name: p.name, jid: p.jid });
  state.tags.set(m.chatId, tags);
  state.drafts.set(m.chatId, ta.value);
  state.mention = null;
  renderMentionPop();
  fitComposer(ta);
  const sb = document.getElementById('sendBtn') as HTMLButtonElement | null;
  if (sb) sb.disabled = state.sending || !(ta.value.trim() || state.photo?.chatId === m.chatId);
}

/** Arrow keys move through the open list, Enter or Tab picks, Escape closes. True when the key was used. */
function mentionKey(e: KeyboardEvent): boolean {
  const m = state.mention;
  const n = m ? mentionMatches().length : 0;
  if (!m || !n || e.isComposing) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { m.idx = (m.idx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; renderMentionPop(); }
  else if (e.key === 'Enter' || e.key === 'Tab') pickMention(m.idx);
  else if (e.key === 'Escape') { state.mention = null; renderMentionPop(); }
  else return false;
  e.preventDefault();
  return true;
}

async function saveMedia(id: string): Promise<void> {
  try {
    const r = await api.saveMedia(id);
    if (r) toast('Saved to ' + r.path.replace(/^\/Users\/[^/]+/, '~'), 'ok');
  } catch (e) { fail(e); }
}

/* ============ AI panel ============ */
function stepsHtml(p: RunProgress | null): string {
  const steps = p?.steps ?? [];
  const done = steps.filter(s => s.state === 'done').length;
  return '<div class="bar" style="margin-bottom:11px"><i style="width:' + Math.round(((done + 1) / Math.max(1, steps.length)) * 100) + '%"></i></div>' +
    '<div class="steps">' + steps.map(s =>
      '<p class="step" data-s="' + s.state + '"><span class="mk">' + (s.state === 'done' ? icon('check', 10) : '') + '</span><span class="od-fill">' + esc(s.label) + '</span></p>').join('') + '</div>';
}

function renderPanel(): void {
  const body = $('#panelBody');
  const chip = $('#aiChip');
  chip.dataset.on = String(state.ai.connected);
  $('#aiChipLabel').textContent = state.ai.connected ? modelLabel(model()) + ' connected' : 'AI not connected';
  $('#panelModel').textContent = state.ai.connected ? modelLabel(model()) : 'Offline';

  if (!state.ai.connected) {
    body.innerHTML =
      '<div class="card"><div class="od-row" style="--od-gap:9px;margin-bottom:8px">' +
        '<span class="av" style="width:30px;height:30px;border-radius:8px;background:var(--brand)" aria-hidden="true">' + icon('key', 15) + '</span>' +
        '<h3 class="od-fill">Connect an AI</h3></div>' +
        '<p class="card-note">Summaries and reports need an AI. Pick one in Settings: your Claude, ChatGPT or Google plan, a free AI that runs on ' + HERE + ', or a key. Nothing is sent anywhere until you connect.</p>' +
        '<div class="od-row" style="--od-gap:8px;margin-top:11px"><button type="button" class="btn btn-primary btn-sm" data-go="settings">Open Settings</button></div>' +
      '</div>' +
      '<div class="card"><h3>What you get</h3><ul class="bullets" style="margin-top:8px">' +
        '<li>Per-chat summaries with the source message one click away.</li>' +
        '<li>Cross-account reports: action items, decisions, client status.</li>' +
        '<li>Markdown export for anything you generate.</li>' +
      '</ul></div>';
    return;
  }

  const c = chatById(state.chat);
  if (!c) {
    body.innerHTML = '<div class="card"><h3>No chat open</h3><p class="card-note">Open a conversation to summarize it, or build a multi-chat report from the Reports tab.</p></div>';
    return;
  }

  const sm = state.summary;
  if (sm.chatId === c.id && sm.running) {
    body.innerHTML = '<div class="card"><h3 style="margin-bottom:10px">Summarizing ' + esc(c.name) + '</h3>' + stepsHtml(sm.progress) + '</div>' +
      '<div class="card"><div class="od-stack" style="--od-gap:7px"><span class="sk" style="width:70%"></span><span class="sk"></span><span class="sk" style="width:86%"></span><span class="sk" style="width:48%"></span></div></div>' +
      '<button type="button" class="btn" id="cancelSummary">Cancel</button>';
    return;
  }

  if (sm.chatId === c.id && sm.error) {
    body.innerHTML = '<div class="card"><div class="banner bad">' + icon('warn', 15) + '<span>' + esc(sm.error) + '</span></div>' +
      '<div class="od-row" style="--od-gap:8px;margin-top:11px">' + (sm.error === EMPTY_WEEK
        ? '<button type="button" class="btn btn-sm btn-primary" id="summarize50">' + icon('bolt', 13) + 'Summarize last 50 instead</button>'
        : '<button type="button" class="btn btn-sm" id="resummarize">' + icon('refresh', 13) + 'Try again</button>') +
      (model() === 'claude-haiku-5-5' && /declined/.test(sm.error) ? '<button type="button" class="btn btn-sm btn-primary" id="rerunSonnet">Run again on Sonnet 5.5</button>' : '') + '</div></div>';
    return;
  }

  if (sm.chatId === c.id && sm.result) {
    const r = sm.result.insight;
    const debt = loopsOf(c.id).sort((x, y) => pending(y) - pending(x));
    body.innerHTML =
      '<div class="card"><div class="od-row" style="--od-gap:7px;margin-bottom:7px">' +
        '<h3 class="od-fill od-truncate" translate="no">' + esc(c.name) + '</h3>' +
        '<span class="kv od-nowrap">' + esc(sm.result.msgCount + ' msgs') + '</span></div>' +
        '<p style="font-size:13px;color:var(--ink-2);line-height:1.6" translate="no">' + esc(r.summary) + '</p>' +
        '<p class="kv" style="margin-top:9px">' + esc([modelLabel(sm.result.model), windowLabel(sm.result.windowKey), whenShort(sm.result.createdAt),
          sm.result.skipped ? sm.result.skipped + ' earlier this week left out' : ''].filter(Boolean).join(' · ')) + '</p>' +
        (sm.result.cached ? '<p class="kv" style="margin-top:4px">No new messages since then, so the AI was not called. Run again to read it fresh.</p>' : '') +
      '</div>' +
      (debt.length ? '<div class="card sum-block"><h4>Reply debt detected · ' + debt.length + '</h4>' +
        debt.map(l =>
          '<div class="act"><span class="t" translate="no">' + esc(l.topic) + '</span>' +
          (l.aiHint ? '<span class="ai-hint">' + icon('bolt', 12) + '<span translate="no">' + esc(l.aiHint) + '</span></span>' : '') +
          '<span class="m">' +
            '<span class="dirtag" data-d="' + l.dir + '">' + icon(l.dir === 'owed' ? 'reply' : 'hour', 10) + (l.dir === 'owed' ? 'You owe' : 'Waiting') + '</span>' +
            '<span class="od-nowrap">' + esc(fmtDur(age(l))) + '</span>' +
            '<span class="slatag" data-s="' + sla(l) + '">' + esc(SLA_LABEL[sla(l)]) + '</span>' +
            '<span class="od-fill"></span>' +
            (l.aiHint
              ? '<button type="button" class="cite" data-lact="answered" data-loop="' + l.id + '">Mark answered</button>'
              : '<button type="button" class="cite" data-lact="' + (l.dir === 'owed' ? 'open' : 'nudge') + '" data-loop="' + l.id + '">' + (l.dir === 'owed' ? 'Go to message' : 'Log nudge') + '</button>') +
          '</span></div>').join('') +
        '<div class="od-row" style="--od-gap:8px;margin-top:9px"><button type="button" class="btn btn-sm od-fill" id="openTracker">' + icon('clock', 13) + 'Open in tracker</button></div></div>' : '') +
      (r.highlights.length ? '<div class="card sum-block"><h4>Highlights</h4><ul class="bullets">' + r.highlights.map(x => '<li><span translate="no">' + esc(x) + '</span></li>').join('') + '</ul></div>' : '') +
      (r.actions.length ? '<div class="card sum-block"><h4>Action items · ' + r.actions.length + '</h4>' +
        r.actions.map(x => '<div class="act"><span class="t" translate="no">' + esc(x.t) + '</span><span class="m">' +
          '<span class="owner">' + esc(x.owner) + '</span><span class="od-nowrap">' + esc(x.due) + '</span>' +
          '<span class="od-fill"></span>' + citeBtn(c.id, x.cite) + '</span></div>').join('') + '</div>' : '') +
      (r.questions.length ? '<div class="card sum-block"><h4>Open questions</h4><ul class="bullets">' + r.questions.map(x => '<li><span translate="no">' + esc(x) + '</span></li>').join('') + '</ul></div>' : '') +
      '<div class="od-row" style="--od-gap:8px">' +
        '<button type="button" class="btn btn-sm" id="copySummary">' + icon('copy', 13) + 'Copy</button>' +
        '<button type="button" class="btn btn-sm" id="resummarize">' + icon('refresh', 13) + 'Run again</button>' +
        '<span class="od-fill"></span>' +
        '<button type="button" class="btn btn-sm btn-primary" id="toReport">Add to report</button>' +
      '</div>';
    return;
  }

  body.innerHTML =
    '<div class="card"><h3>Summarize this chat</h3>' +
      '<p class="card-note">' + esc(c.msgCount + ' messages in “' + c.name + '”. The AI reads ' + windowText() + ', and returns a summary with action items.') + '</p>' +
      '<div class="od-row" style="--od-gap:8px;margin-top:11px"><button type="button" class="btn btn-primary btn-sm" id="runSummary">' + icon('bolt', 14) + 'Summarize now</button></div>' +
      '<p class="kv" style="margin-top:10px">' + (state.settings.aiImages ? 'Reads text and the 10 most recent photos; voice notes and files are never read.' : 'Text only — photos, voice notes and files stay in the chat but are never read.') + ' <button type="button" class="linkbtn" data-faq>What is sent?</button></p>' +
    '</div>' +
    '<div class="card sum-block"><h4>Or build a report</h4><div class="preset-grid">' +
      PRESETS.map(p => '<button type="button" class="preset" data-preset="' + p.id + '"><b>' + esc(p.name) + '</b><span>' + esc(p.blurb) + '</span></button>').join('') +
    '</div></div>' +
    (c.summarizedAt ? '<p class="kv">Last summarized ' + esc(relTime(c.summarizedAt)) + '.</p>' : '') +
    (!c.pinned && c.autoCheckedAt ? '<p class="kv">Loops checked by auto summary ' + esc(relTime(c.autoCheckedAt)) + '.</p>' : '');
}

function citeBtn(chatId: string, msgId: string | null, fallback?: string): string {
  if (!msgId) return '';
  const m = (state.messages.get(chatId) ?? []).find(x => x.id === msgId);
  const label = m ? (m.who === 'me' ? 'You' : m.who) + ' · ' + clock(m.at) : fallback ?? 'Source';
  return '<button type="button" class="cite" data-cite="' + chatId + ':' + msgId + '">' + icon('jump', 10) + esc(label) + '</button>';
}

/* ============ open loops ============ */
function visibleLoops(): Loop[] {
  return state.loops
    .filter(l => state.loopClosed || l.state === 'open')
    .filter(l => !state.loopChat || l.chatId === state.loopChat)
    .filter(l => state.loopAcct === 'all' || acctOfLoop(l) === state.loopAcct)
    .filter(l => state.loopType === 'all' || (ptypeOf(chatById(l.chatId)) || 'Internal') === state.loopType)
    .sort((a, b) => (SLA_ORDER[sla(a)] - SLA_ORDER[sla(b)]) || (pending(b) - pending(a)));
}

const loopCiteLabel = (l: Loop) => (l.askedBy === 'You' ? 'You' : l.askedBy.replace(/\s*\(.*$/, '')) + ' · ' + clock(l.askedAt);

function loopGroupKey(l: Loop): string {
  const c = chatById(l.chatId);
  if (state.loopGroup === 'direction') return l.dir === 'owed' ? 'You owe them' : 'Waiting on them';
  if (state.loopGroup === 'partner') return c?.partner || 'Internal — no partner';
  if (state.loopGroup === 'ptype') return ptypeOf(c) || 'Internal';
  if (state.loopGroup === 'account') return acctById(c?.acct ?? null)?.name ?? 'Unknown number';
  if (state.loopGroup === 'service') return c?.service || partnerOf(c)?.service || 'No service';
  if (state.loopGroup === 'chat') return c ? c.name : 'Unknown chat';
  const s = sla(l);
  return s === 'over' ? 'Past SLA' : s === 'soon' ? 'Due soon' : s === 'ok' ? 'Inside SLA' : 'Closed and snoozed';
}

function loopRow(l: Loop): string {
  const c = chatById(l.chatId);
  const s = sla(l);
  const pend = pending(l);
  const pct = Math.min(100, Math.round((pend / l.slaH) * 100));
  const nudged = l.nudges.length;
  const owed = l.dir === 'owed';
  const auto = l.source === 'rule' || l.source === 'ai';
  const slaTxt = l.state === 'answered' ? 'Answered'
    : l.state === 'snoozed' ? 'Snoozed'
    : s === 'over' ? 'Overdue by ' + fmtDur(pend - l.slaH)
    : s === 'soon' ? 'Due in ' + fmtDur(l.slaH - pend)
    : 'Inside ' + fmtDur(l.slaH) + ' SLA';

  const acts = l.state !== 'open'
    ? '<button type="button" class="btn btn-sm" data-lact="reopen" data-loop="' + l.id + '">' + icon('refresh', 13) + 'Reopen</button>'
    : (owed
        ? '<button type="button" class="btn btn-sm btn-primary" data-lact="open" data-loop="' + l.id + '">' + icon('jump', 13) + 'Go to message</button>' +
          '<button type="button" class="btn btn-sm" data-lact="answered" data-loop="' + l.id + '">' + icon('check', 13) + 'Mark answered</button>'
        : '<button type="button" class="btn btn-sm btn-primary" data-lact="nudge" data-loop="' + l.id + '">' + icon('bell', 13) + 'Log nudge' + (nudged ? ' again' : '') + '</button>' +
          '<button type="button" class="btn btn-sm" data-lact="answered" data-loop="' + l.id + '">' + icon('check', 13) + 'Mark confirmed</button>' +
          '<button type="button" class="btn btn-sm" data-lact="open" data-loop="' + l.id + '">' + icon('jump', 13) + 'Open chat</button>') +
      '<span class="od-fill"></span>' +
      (owed && c?.kind === 'group' && l.msgId && l.askedBy !== 'You'
        ? '<button type="button" class="btn btn-sm" data-lact="team" data-loop="' + l.id + '" title="Mark the person who asked as your team">' + icon('team', 13) + 'Asker is my team</button>' : '') +
      '<button type="button" class="btn btn-sm" data-lact="flip" data-loop="' + l.id + '" title="' + (owed ? 'Move to Waiting on them' : 'Move to You owe them') + '">' + icon('swap', 13) + (owed ? 'Waiting on them' : 'I owe them') + '</button>' +
      (auto ? '<button type="button" class="btn btn-sm" data-lact="dismiss" data-loop="' + l.id + '">' + icon('x', 13) + 'Not a loop</button>' : '') +
      '<button type="button" class="btn btn-sm" data-lact="snooze" data-loop="' + l.id + '">' + icon('pause', 13) + 'Snooze</button>';

  return '<article class="loop" data-sla="' + s + '" data-state="' + l.state + '">' +
    '<div class="loop-body">' +
      '<div class="od-cluster" style="--od-gap:6px">' +
        '<span class="dirtag" data-d="' + l.dir + '">' + icon(owed ? 'reply' : 'hour', 11) + (owed ? 'You owe them' : 'Waiting on them') + '</span>' +
        '<span class="kindtag">' + esc(LOOP_KIND[l.kind] || l.kind) + '</span>' +
        (l.source === 'rule' ? '<span class="kindtag auto">auto · local rule</span>' : l.source === 'ai' ? '<span class="kindtag auto">found by AI</span>' : '') +
      '</div>' +
      '<p class="loop-q" translate="no">' + esc(l.topic) + '</p>' +
      '<p class="loop-meta">' +
        '<span>' + esc(owed || l.askedBy !== 'You' ? 'Asked by ' + l.askedBy : 'You asked ' + (c ? c.name : '')) + '</span>' +
        '<span>·</span><span translate="no">' + esc(c ? c.name : '') + '</span>' +
        (l.msgId ? '<span>·</span>' + citeBtn(l.chatId, l.msgId, loopCiteLabel(l)) : '') +
      '</p>' +
      '<div class="loop-chips">' +
        (c ? '<span class="bchip" data-k="plat" style="--acc:' + accentOf(c) + '"><span class="adot" aria-hidden="true"></span><span translate="no">' + esc(acctById(c.acct)?.name ?? '') + '</span></span>' : '') +
        (c && c.partner ? '<span class="bchip" data-k="partner">' + icon('tag', 10) + esc(c.partner) + '</span>' : '') +
        (ptypeOf(c) ? '<span class="bchip" data-k="ptype">' + esc(ptypeOf(c)) + '</span>' : '') +
        (c && (c.service || partnerOf(c)?.service) ? '<span class="bchip">' + esc((c.service || partnerOf(c)!.service)!) + '</span>' : '') +
        (c && c.stage ? '<span class="bchip" data-k="stage">' + esc(c.stage) + '</span>' : '') +
      '</div>' +
      (l.aiHint && l.state === 'open' ? '<p class="ai-hint">' + icon('bolt', 12) + '<span translate="no">' + esc(l.aiHint) + '</span></p>' : '') +
      (l.blocks ? '<p class="loop-note">' + icon('warn', 12) + '<span>Blocking: ' + esc(l.blocks) + '</span></p>' : '') +
      (nudged && l.state === 'open' ? '<p class="loop-note">' + icon('bell', 12) + '<span>Nudged ' + nudged + '×, last ' + fmtDur((now() - l.nudges[0]) / 3600000) + ' ago</span></p>' : '') +
      (l.chases && l.state === 'open' && owed ? '<p class="loop-note">' + icon('bell', 12) + '<span>They chased ' + l.chases + '×</span></p>' : '') +
      (!nudged && !owed && l.state === 'open' ? '<p class="loop-note">' + icon('bell', 12) + '<span>Never chased since you asked</span></p>' : '') +
      (l.state === 'snoozed' && l.snoozeNote ? '<p class="loop-note">' + icon('pause', 12) + '<span>' + esc(l.snoozeNote) + '</span></p>' : '') +
      (l.state === 'answered' ? '<p class="loop-note">' + icon('check', 12) + '<span>Closed after ' + fmtDur(age(l)) + (l.closeNote ? ' · ' + esc(l.closeNote) : '') + '</span></p>' : '') +
    '</div>' +
    '<div class="loop-clock">' +
      '<span class="dur od-nowrap">' + esc(fmtDur(age(l))) + '</span>' +
      '<span class="sub od-nowrap">' + (l.state === 'open' ? (owed ? 'unanswered' : 'without confirmation') : 'total') + '</span>' +
      '<span class="slatag" data-s="' + s + '">' + icon(s === 'over' ? 'warn' : s === 'ok' ? 'check' : 'clock', 10) + esc(slaTxt) + '</span>' +
      (l.state === 'open' ? '<span class="agebar" data-s="' + s + '" role="img" aria-label="' + esc(pct + '% of the ' + fmtDur(l.slaH) + ' response window used') + '"><i style="width:' + pct + '%"></i></span>' : '') +
    '</div>' +
    '<div class="loop-acts">' + acts + '</div>' +
  '</article>';
}

function renderLoops(): void {
  const sel = $<HTMLSelectElement>('#loopAcct');
  const items = [{ id: 'all', name: 'All numbers' } as { id: string; name: string }].concat(state.accounts);
  sel.innerHTML = items.map(a => {
    const ls = openLoops().filter(l => a.id === 'all' || acctOfLoop(l) === a.id);
    return '<option value="' + a.id + '">' + esc(a.name + ' · ' + ls.filter(l => l.dir === 'owed').length + ' to answer, ' + ls.filter(l => l.dir === 'waiting').length + ' to chase') + '</option>';
  }).join('');
  sel.value = state.loopAcct;
  const all = scopedOpen();
  $<HTMLSelectElement>('#loopGroup').value = state.loopGroup;
  const typeSel = $<HTMLSelectElement>('#loopType');
  const ptypes = Array.from(new Set(state.partners.map(p => p.type).filter(Boolean)));
  typeSel.innerHTML = ['all', ...ptypes, 'Internal'].map(t => {
    const n = t === 'all' ? all.length : all.filter(l => (ptypeOf(chatById(l.chatId)) || 'Internal') === t).length;
    return '<option value="' + esc(t) + '">' + esc(t === 'all' ? 'All types' : t) + ' (' + n + ')</option>';
  }).join('');
  typeSel.value = state.loopType;
  $('#showClosed').setAttribute('aria-pressed', String(state.loopClosed));

  const scope = $('#loopScope');
  if (state.loopChat) {
    const c = chatById(state.loopChat);
    scope.hidden = false;
    scope.innerHTML = icon('search', 12) + '<span>Showing only “' + esc(c ? c.name : '') + '”. <button type="button" class="cite" id="loopScopeClear">Show every chat</button></span>';
  } else { scope.hidden = true; scope.innerHTML = ''; }

  const list = visibleLoops();
  const host = $('#loopRows');
  if (!list.length) {
    const scopeName = state.loopAcct === 'all' ? null : acctById(state.loopAcct)?.name;
    const why = state.loopType !== 'all' ? 'No open loops for ' + (state.loopType === 'Internal' ? 'internal threads' : state.loopType + ' partners') + ' under this filter.'
      : state.loopChat ? 'This chat has no open loops. Nothing is waiting on either side.'
      : scopeName ? 'Nothing open on ' + scopeName + ' — every question and confirmation there is closed.'
      : 'No open loops at all — every question and confirmation is closed.';
    host.innerHTML = '<div class="empty" style="height:auto;background:var(--s0);border:1px solid var(--line-soft);border-radius:var(--r-lg)"><span class="glyph">' + icon('check', 20) + '</span><h3>All clear</h3><p>' + esc(why) + '</p></div>';
    return;
  }
  let out = '', lastG: string | null = null;
  list.forEach(l => {
    const g = loopGroupKey(l);
    if (g !== lastG) { lastG = g; out += '<p class="gh">' + esc(g) + '<span class="gn">' + list.filter(x => loopGroupKey(x) === g).length + '</span></p>'; }
    out += loopRow(l);
  });
  host.innerHTML = out;
}

async function loopAction(act: string, id: string): Promise<void> {
  const l = loopById(id); if (!l) return;
  if (act === 'reply' || act === 'open') { if (l.msgId) void jumpToCitation(l.chatId, l.msgId); else { setView('inbox'); void openChat(l.chatId); } return; }
  if (act === 'team') { if (l.msgId) void setTeam(l.msgId, true, l.askedBy.replace(/\s*\(.*$/, '')); return; }
  try {
    await api.loopAction(id, act as 'answered' | 'nudge' | 'snooze' | 'reopen' | 'dismiss' | 'flip');
    const c = chatById(l.chatId);
    toast(act === 'answered' ? (l.dir === 'owed' ? 'Marked answered — loop closed' : 'Confirmation received — loop closed')
      : act === 'nudge' ? 'Nudge logged — clock restarted on ' + (c ? c.name : 'this chat') + '. Nothing was sent.'
      : act === 'snooze' ? 'Snoozed — hidden until you show closed items'
      : act === 'dismiss' ? 'Removed — not a loop'
      : act === 'flip' ? (l.dir === 'owed' ? 'Moved to Waiting on them' : 'Moved to You owe them') : 'Reopened', act === 'snooze' || act === 'reopen' ? undefined : 'ok');
  } catch (e) { fail(e); }
}

async function flagMessage(chatId: string, msgId: string): Promise<void> {
  try {
    const l = await api.flagMessage(chatId, msgId);
    toast(l.dir === 'waiting' ? 'Tracked — waiting on their confirmation' : 'Tracked — you owe a reply', 'ok');
  } catch (e) { fail(e); }
}

/* ============ reports ============ */
function renderReportsList(): void {
  const rows = $('#repRows');
  const n = state.reports.length;
  $('#repCount').textContent = n === 0 ? 'No reports yet' : n + (n === 1 ? ' report' : ' reports') + ' saved locally';
  if (!n) {
    rows.innerHTML = '<div class="empty"><span class="glyph">' + icon('doc', 20) + '</span><h3>No reports yet</h3><p>Pick a few chats, choose a report type, and the AI turns them into a brief you can export.</p></div>';
    return;
  }
  rows.innerHTML = state.reports.map(r =>
    '<button type="button" class="rep-row" data-report="' + r.id + '" aria-current="' + (state.report === r.id) + '">' +
      '<span class="tt od-truncate">' + esc(r.title) + '</span>' +
      '<span class="mm"><span>' + esc(relTime(r.createdAt)) + '</span><span>·</span><span>' + r.stats.chats + ' chats</span><span>·</span><span>' + r.stats.actions + ' actions</span></span>' +
    '</button>').join('');
}

const chatName = (id: string) => chatById(id)?.name ?? 'Deleted chat';
const insightOf = (r: Report, id: string): ChatInsight => r.insights[id] ?? { summary: '', highlights: [], actions: [], decisions: [], questions: [], status: { stage: '', risk: 'low', next: '' } };

function renderReportDoc(): void {
  const host = $('#repDoc');
  if (state.gen) {
    host.innerHTML = '<div class="doc"><div class="sec"><h2>Generating</h2>' + stepsHtml(state.gen) +
      '<div class="od-row" style="--od-gap:8px;padding-top:4px"><button type="button" class="btn btn-sm" id="cancelGen">Cancel</button></div></div>' +
      '<div class="sec"><div class="od-stack" style="--od-gap:8px"><span class="sk" style="width:46%"></span><span class="sk"></span><span class="sk" style="width:88%"></span><span class="sk" style="width:62%"></span></div></div></div>';
    return;
  }
  const r = state.reports.find(x => x.id === state.report);
  if (!r) {
    host.innerHTML = '<div class="empty"><span class="glyph">' + icon('doc', 20) + '</span><h3>' + (state.reports.length ? 'Pick a report' : 'Nothing generated yet') + '</h3><p>' +
      (state.reports.length ? 'Choose one on the left to read, copy or export it.' : 'Use “New report” to turn selected chats into a brief.') + '</p></div>';
    return;
  }
  const byChat = r.chatIds.map(id => ({ id, name: chatName(id), c: chatById(id), i: insightOf(r, id) }));
  const rLoops = r.loopIds.map(loopById).filter(Boolean) as Loop[];

  const grp = (name: string, extra = '') => '<span class="lbl">' + icon('chev', 12) + '<span translate="no">' + esc(name) + '</span>' + extra + '</span>';
  const actionsSec = () => {
    const groups = byChat.filter(x => x.i.actions.length);
    if (!groups.length) return '<div class="sec"><h2>Action items</h2><p style="font-size:13px;color:var(--ink-3)">Nothing was committed to in these chats during the window.</p></div>';
    return '<div class="sec"><h2>Action items · ' + r.stats.actions + '</h2>' + groups.map(x =>
      '<div class="grp">' + grp(x.name, x.c ? '<span class="kv">' + esc(acctById(x.c.acct)?.name ?? '') + '</span>' : '') +
      x.i.actions.map(a => '<div class="act"><span class="t" translate="no">' + esc(a.t) + '</span><span class="m">' +
        '<span class="owner">' + esc(a.owner) + '</span><span class="od-nowrap">' + icon('clock', 11) + ' ' + esc(a.due) + '</span>' +
        '<span class="od-fill"></span>' + citeBtn(x.id, a.cite) + '</span></div>').join('') + '</div>').join('') + '</div>';
  };
  const listSec = (title: string, pick: (i: ChatInsight) => string[], emptyText?: string) => {
    const groups = byChat.filter(x => pick(x.i).length);
    if (!groups.length) return emptyText ? '<div class="sec"><h2>' + title + '</h2><p style="font-size:13px;color:var(--ink-3)">' + emptyText + '</p></div>' : '';
    return '<div class="sec"><h2>' + title + '</h2>' + groups.map(x => '<div class="grp">' + grp(x.name) + '<ul class="bullets">' +
      pick(x.i).map(h => '<li><span translate="no">' + esc(h) + '</span></li>').join('') + '</ul></div>').join('') + '</div>';
  };
  const statusSec = () => '<div class="sec"><h2>Status by conversation</h2><div class="ctable">' + byChat.map(x =>
    '<div class="crow"><span class="od-field"><span class="nm od-truncate" translate="no">' + esc(x.name) + (x.c?.org ? ' · ' + esc(x.c.org) : '') + '</span>' +
    '<span class="st od-truncate" translate="no">' + esc(x.i.status.stage + ' — next: ' + x.i.status.next) + '</span></span>' +
    '<span class="risk od-nowrap" data-r="' + x.i.status.risk + '">' + esc(x.i.status.risk) + '</span></div>').join('') + '</div></div>';
  const debtSec = () => {
    if (!rLoops.length) return '<div class="sec"><h2>Reply debt</h2><p style="font-size:13px;color:var(--ink-3)">No open loops in these chats — nothing is waiting on either side.</p></div>';
    const block = (dir: string, title: string) => {
      const set = rLoops.filter(l => l.dir === dir);
      if (!set.length) return '';
      return '<div class="sec"><h2>' + title + ' · ' + set.length + '</h2>' + set.map(l => {
        const c = chatById(l.chatId);
        return '<div class="act"><span class="t" translate="no">' + esc(l.topic) + '</span><span class="m">' +
          '<span class="owner" translate="no">' + esc(c ? c.name : '') + '</span>' +
          (c && c.partner ? '<span class="bchip" data-k="partner">' + esc(c.partner) + '</span>' : '') +
          '<span class="od-nowrap">' + icon('clock', 11) + ' ' + esc(fmtDur(age(l))) + '</span>' +
          '<span class="slatag" data-s="' + sla(l) + '">' + esc(SLA_LABEL[sla(l)]) + '</span>' +
          '<span class="od-fill"></span>' + citeBtn(l.chatId, l.msgId, loopCiteLabel(l)) + '</span></div>';
      }).join('') + '</div>';
    };
    return block('owed', 'Waiting on your reply') + block('waiting', 'Waiting on the other side');
  };
  const partnerSec = () => {
    const rows = state.partners.filter(b => rLoops.some(l => chatById(l.chatId)?.partner === b.id));
    if (!rows.length) return '';
    return '<div class="sec"><h2>Where each integration is stuck</h2><div class="ctable">' + rows.map(b => {
      const mine = rLoops.filter(l => chatById(l.chatId)?.partner === b.id);
      const owed = mine.filter(l => l.dir === 'owed').length;
      const wait = mine.length - owed;
      const who = owed && wait ? 'both sides' : owed ? 'us' : 'them';
      const stage = mine.map(l => chatById(l.chatId)?.stage).find(Boolean) || b.steps[b.at];
      return '<div class="crow"><span class="od-field"><span class="nm od-truncate">' + esc(b.id + ' · ' + b.type + ' · ' + b.service) + '</span>' +
        '<span class="st od-truncate">' + esc(stage + ' — stuck on ' + who + ' (' + owed + ' on us, ' + wait + ' on them)') + '</span></span>' +
        '<span class="risk od-nowrap" data-r="' + (owed ? 'high' : 'watch') + '">' + esc(fmtDur(Math.max(...mine.map(age)))) + '</span></div>';
    }).join('') + '</div></div>';
  };
  const overviewSec = () => '<div class="sec"><h2>Overview</h2><p translate="no">' + esc(r.overview) + '</p>' +
    '<p class="src">' + icon('bolt', 12) + esc(modelLabel(r.model) + ' · ' + r.stats.msgs + ' messages read · ' + RANGE_LABEL[r.days]) + '</p></div>';

  let secs: string;
  if (!byChat.length) secs = '<div class="sec"><h2>Overview</h2><p style="color:var(--ink-3)">None of the selected chats had messages in the ' + esc(RANGE_LABEL[r.days]) + '. Widen the window and run it again.</p></div>';
  else if (r.presetId === 'digest') secs = overviewSec() + listSec('Highlights', i => i.highlights) + actionsSec() + listSec('Open questions · ' + r.stats.questions, i => i.questions);
  else if (r.presetId === 'actions') secs = actionsSec() + listSec('Open questions · ' + r.stats.questions, i => i.questions);
  else if (r.presetId === 'decisions') secs = listSec('Decisions and commitments', i => i.decisions, 'No decisions were recorded in these chats during the window.') + listSec('Open questions · ' + r.stats.questions, i => i.questions);
  else if (r.presetId === 'client') secs = statusSec() + actionsSec();
  else if (r.presetId === 'debt') secs = overviewSec() + debtSec() + partnerSec();
  else secs = '<div class="sec"><h2>Your prompt</h2><p style="font-style:italic;color:var(--ink-3)" translate="no">“' + esc(r.custom) + '”</p></div>' + overviewSec() + listSec('Highlights', i => i.highlights) + actionsSec();

  const d = new Date(r.createdAt);
  host.innerHTML = '<div class="doc"><div class="doc-head">' +
    '<button type="button" class="icon-btn mob-back" id="repBack" aria-label="Back to report list">' + icon('back', 18) + '</button>' +
    '<h1>' + esc(r.title) + '</h1>' +
    '<div class="doc-meta"><span>' + esc(d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + clock(r.createdAt)) + '</span>' +
      '<span>' + esc(RANGE_LABEL[r.days]) + '</span><span>' + esc(modelLabel(r.model)) + '</span></div>' +
    '<div class="stats">' + (r.presetId === 'debt'
      ? stat(r.stats.owed, 'on your reply') + stat(r.stats.waiting, 'on the other side') + stat(r.stats.overdue, 'past SLA') + stat(r.stats.longestH ? fmtDur(r.stats.longestH) : '—', 'longest open')
      : stat(r.stats.chats, 'chats read') + stat(r.stats.msgs, 'messages') + stat(r.stats.actions, 'action items') + stat(r.stats.questions, 'open questions')) + '</div>' +
    '<div class="doc-actions">' +
      '<button type="button" class="btn btn-sm" id="docCopy">' + icon('copy', 13) + 'Copy</button>' +
      '<button type="button" class="btn btn-sm" id="docExport">' + icon('down', 13) + 'Export .md</button>' +
      '<button type="button" class="btn btn-sm" id="docRerun">' + icon('refresh', 13) + 'Run again</button>' +
      '<span class="od-fill"></span>' +
      '<button type="button" class="btn btn-sm btn-danger" id="docDelete">' + icon('trash', 13) + 'Delete</button>' +
    '</div></div>' + secs + '</div>';
}
const stat = (n: number | string, c: string) => '<div class="stat od-stat"><span class="n od-nowrap">' + esc(n) + '</span><span class="c">' + esc(c) + '</span></div>';

function reportMarkdown(r: Report): string {
  const L: string[] = [];
  const mname = modelLabel(r.model);
  L.push('# ' + r.title, '');
  L.push('*' + new Date(r.createdAt).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ', ' + clock(r.createdAt) + ' · ' + RANGE_LABEL[r.days] + ' · ' + mname + '*', '');
  if (r.presetId === 'debt') L.push('- Waiting on your reply: ' + r.stats.owed, '- Waiting on the other side: ' + r.stats.waiting, '- Past SLA: ' + r.stats.overdue, '- Longest open loop: ' + (r.stats.longestH ? fmtDur(r.stats.longestH) : 'none'), '');
  else L.push('- Chats read: ' + r.stats.chats, '- Messages: ' + r.stats.msgs, '- Action items: ' + r.stats.actions, '- Open questions: ' + r.stats.questions, '');
  if (r.custom) L.push('## Prompt', '', '> ' + r.custom, '');
  if (r.overview) L.push('## Overview', '', r.overview, '');
  const footer = () => L.push('---', 'Generated by WA Turbo. Messages stayed on ' + HERE + '; only the selected text was sent to ' + mname + '.');
  const ids = r.chatIds;
  if (r.presetId === 'debt') {
    const rl = r.loopIds.map(loopById).filter(Boolean) as Loop[];
    ([['owed', 'Waiting on your reply'], ['waiting', 'Waiting on the other side']] as const).forEach(([dir, title]) => {
      const set = rl.filter(l => l.dir === dir);
      if (!set.length) return;
      L.push('## ' + title + ' (' + set.length + ')', '');
      set.forEach(l => {
        const c = chatById(l.chatId);
        const nud = l.nudges.length ? ', nudged ' + l.nudges.length + '× (last ' + fmtDur((now() - l.nudges[0]) / 3600000) + ' ago)' : ', never chased';
        L.push('- [ ] **' + l.topic + '** — ' + (c ? c.name : '') + (c && c.partner ? ' · ' + c.partner : '') + ' · open ' + fmtDur(age(l)) + ' · ' + SLA_LABEL[sla(l)] + nud + (l.blocks ? ' · blocking: ' + l.blocks : ''));
      });
      L.push('');
    });
    footer();
    return L.join('\n');
  }
  const sec = (title: string, fn: (id: string, i: ChatInsight) => void) => { L.push('## ' + title, ''); ids.forEach(id => fn(id, insightOf(r, id))); L.push(''); };
  if (r.presetId === 'client') sec('Status by conversation', (id, i) => L.push('- **' + chatName(id) + '** — ' + i.status.stage + ', risk ' + i.status.risk + '. Next: ' + i.status.next));
  if (r.presetId === 'digest' || r.presetId === 'custom') sec('Highlights', (id, i) => { if (i.highlights.length) { L.push('### ' + chatName(id)); i.highlights.forEach(h => L.push('- ' + h)); L.push(''); } });
  if (r.presetId === 'decisions') sec('Decisions and commitments', (id, i) => { if (i.decisions.length) { L.push('### ' + chatName(id)); i.decisions.forEach(h => L.push('- ' + h)); L.push(''); } });
  if (r.presetId !== 'decisions') sec('Action items', (id, i) => { if (i.actions.length) { L.push('### ' + chatName(id)); i.actions.forEach(a => L.push('- [ ] ' + a.t + ' — **' + a.owner + '**' + (a.due ? ', ' + a.due : ''))); L.push(''); } });
  const qs = ids.filter(id => insightOf(r, id).questions.length);
  if (qs.length) { L.push('## Open questions', ''); qs.forEach(id => insightOf(r, id).questions.forEach(q => L.push('- ' + q + ' *(' + chatName(id) + ')*'))); L.push(''); }
  footer();
  return L.join('\n');
}

/* ============ settings ============ */
function renderSettings(): void {
  $<HTMLSelectElement>('#model').value = state.settings.model;
  $<HTMLSelectElement>('#window').value = String(state.settings.window);
  const cp = $<HTMLTextAreaElement>('#customPrompt');
  if (document.activeElement !== cp) cp.value = state.settings.customPrompt;
  $<HTMLInputElement>('#openAtLogin').checked = state.settings.openAtLogin;
  $<HTMLInputElement>('#aiImages').checked = state.settings.aiImages;
  $<HTMLInputElement>('#autoOn').checked = state.settings.autoOn;
  (['pinEveryMin', 'pinWindow', 'otherEveryMin', 'otherWindow'] as const).forEach(k => { $<HTMLSelectElement>('#' + k).value = String(state.settings[k]); });
  renderNotifySettings();
  renderAppearance();
  renderLangList();
  renderTeam();
  void loadUsage();
  void loadDb();
  void loadContacts();
  const pins = state.chats.filter(c => c.pinned).length;
  $('#autoPinned').textContent = pins ? pins + ' pinned' : 'No pinned chats yet';
  renderAutoState();
  const prov = state.settings.provider;
  const cc = prov === 'claude-code';
  $$<HTMLInputElement>('input[name="provider"]').forEach(r => { r.checked = r.value === prov; });
  (Object.entries(BOXES) as [AiProvider, string][]).forEach(([k, sel]) => { $(sel).hidden = k !== prov; });
  $('#claudeModelRow').hidden = !isClaude(prov);
  $('#otherModelNote').hidden = isClaude(prov);
  renderProviderBox();
  renderLocalFound();
  const ccOn = cc && state.ai.provider === 'claude-code' && state.ai.connected;
  $('#ccState').textContent = state.ai.testing ? 'Checking…' : ccOn ? 'Connected' : 'Not connected';
  $('#ccAccount').textContent = state.ai.account ?? 'your Claude account';
  $('#ccOk').hidden = !ccOn;
  $('#ccSignedOut').hidden = !cc || state.ai.testing || ccOn || !state.ai.cliFound;
  // (the API key box below only applies when prov === 'api')
  $('#ccMissing').hidden = !cc || state.ai.testing || ccOn || state.ai.cliFound;
  const ck = $<HTMLButtonElement>('#checkCc');
  ck.textContent = state.ai.testing ? 'Checking…' : 'Check again';
  ck.disabled = state.ai.testing;
  $('#keyState').textContent = state.ai.connected ? 'Connected' : state.ai.testing ? 'Testing…' : 'Not connected';
  $('#keyOk').hidden = !state.ai.connected;
  $('#disconnectKey').hidden = !state.ai.connected;
  const tk = $<HTMLButtonElement>('#testKey');
  tk.textContent = state.ai.testing ? 'Testing…' : state.ai.connected ? 'Re-test connection' : 'Test connection';
  tk.disabled = state.ai.testing;
  $('#presetEditor').innerHTML = PRESETS.map(p =>
    '<div class="pz"><div class="top"><b class="od-fill">' + esc(p.name) + '</b><button type="button" class="btn btn-sm" data-usepreset="' + p.id + '">Use</button></div>' +
    '<p class="kv">' + esc(p.blurb) + '</p></div>').join('');
}

/* --- Appearance, app language and summary language (Settings) --- */
function renderAppearance(): void {
  $<HTMLSelectElement>('#appLang').value = lang;
  $$('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === themeMode())));
  const card = (t: (typeof THEMES)[number]) => {
    const [side, page, bubble, accent] = t.swatch;
    return '<button type="button" class="theme-card" data-theme-id="' + t.id + '" aria-pressed="' + (themeFor(t.dark) === t.id) + '">' +
      '<span class="sw" aria-hidden="true"><i style="background:' + side + '"></i><span class="main" style="background:' + page + '"><b style="background:' + bubble + '"></b><b style="background:' + accent + '"></b></span></span>' +
      '<span translate="no">' + esc(t.name) + '</span></button>';
  };
  $('#lightThemes').innerHTML = THEMES.filter(t => !t.dark).map(card).join('');
  $('#darkThemes').innerHTML = THEMES.filter(t => t.dark).map(card).join('');
}

function renderLangList(): void {
  const host = $('#langList');
  if (!state.accounts.length) { host.innerHTML = '<li><span class="kv">Link a number first. Its language is picked from its first conversations.</span></li>'; return; }
  host.innerHTML = state.accounts.map(a => {
    const note = !a.lang ? (state.ai.connected ? 'Not picked yet · detecting from its first 10 conversations' : 'Not picked yet · detected once an AI is connected; English until then')
      : a.langDetected ? 'Detected from its first conversations' : 'Picked by you';
    return '<li><span class="av" aria-hidden="true" style="background:' + ACCENT[a.accent] + '">' + esc(initials(a.name)) + '</span>' +
      '<span class="nm"><b translate="no">' + esc(a.name) + '</b><span>' + esc(note) + '</span></span>' +
      '<label><span class="vh">Summary language for ' + esc(a.name) + '</span><select data-numlang="' + a.id + '">' +
        '<option value="en"' + (a.lang === 'en' ? ' selected' : '') + '>English</option>' +
        '<option value="id"' + (a.lang === 'id' ? ' selected' : '') + '>Bahasa Indonesia</option>' +
        (a.lang ? '' : '<option value="" selected>English (until detected)</option>') +
      '</select></label>' +
      (a.lang && state.ai.connected ? '<button type="button" class="btn btn-sm" data-redetect="' + a.id + '" title="Read its 10 most recent conversations again">Detect again</button>' : '') +
    '</li>';
  }).join('');
}

/** Tells the main process the language and theme colours (native menus, window background, notifications). */
function reportUi(): void {
  void api.setUiPrefs({ lang, mode: themeMode(), dark: isDark(), ...themeColours() }).catch(() => {});
}

/* --- AI usage (Settings) --- */
const USAGE_DAYS = 14;
const USAGE_WEEKS = 8;
// Each number keeps its sidebar colour in the chart (teal stepped up so the set passes the colourblind checks).
const ACCENT_CHART: Record<Accent, string> = { green: '#1f8a5f', blue: '#2a5fa8', amber: '#9a6412', violet: '#6b46a8', cyan: '#00809a' };
const FALLBACK_CHART = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const ACROSS = '#8a8f98';

const tokensOf = (b: UsageBucket): number => b.input + b.output + b.cacheRead + b.cacheWrite;
const fmtTok = (n: number): string => n < 1000 ? String(n) : n < 1e6 ? (n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'k' : (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
const fmtFull = (n: number): string => n.toLocaleString(locale);

interface UsageSeries { key: string; name: string; color: string }

function usageSeries(): UsageSeries[] {
  const accts = state.accounts;
  const dup = new Set(accts.map(a => a.accent)).size < accts.length;
  const list = accts.map((a, i) => ({ key: a.id, name: a.name, color: dup ? FALLBACK_CHART[i % FALLBACK_CHART.length] : ACCENT_CHART[a.accent] }));
  if ((state.usage ?? []).some(b => b.acct === null || !accts.some(a => a.id === b.acct))) list.push({ key: '', name: 'Across numbers', color: ACROSS });
  return list;
}

function usageBuckets(): { label: string; long: string; start: number; end: number }[] {
  const now = new Date();
  const out: { label: string; long: string; start: number; end: number }[] = [];
  if (state.usageUnit === 'day') {
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (let i = USAGE_DAYS - 1; i >= 0; i--) {
      const s = new Date(d0); s.setDate(d0.getDate() - i);
      const e = new Date(s); e.setDate(s.getDate() + 1);
      out.push({ label: s.toLocaleDateString(locale, { day: 'numeric' }), long: i === 0 ? 'Today' : s.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }), start: s.getTime(), end: e.getTime() });
    }
  } else {
    const w0 = weekStart(now);
    for (let i = USAGE_WEEKS - 1; i >= 0; i--) {
      const s = new Date(w0); s.setDate(w0.getDate() - 7 * i);
      const e = new Date(s); e.setDate(s.getDate() + 7);
      out.push({ label: s.toLocaleDateString(locale, { day: 'numeric', month: 'short' }), long: i === 0 ? 'This week' : 'Week of ' + s.toLocaleDateString(locale, { day: 'numeric', month: 'short' }), start: s.getTime(), end: e.getTime() });
    }
  }
  return out;
}

async function loadUsage(): Promise<void> {
  const w0 = weekStart(new Date());
  const since = new Date(w0); since.setDate(w0.getDate() - 7 * (USAGE_WEEKS - 1));
  try { state.usage = await api.usage(since.getTime()); } catch { state.usage = []; }
  if (state.view === 'settings') renderUsage();
}

function renderUsage(): void {
  const chart = document.getElementById('usageChart'); if (!chart) return;
  $$<HTMLElement>('[data-usage]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.usage === state.usageUnit)));
  const data = state.usage ?? [];
  const series = usageSeries();
  const keyOf = (b: UsageBucket) => (b.acct && state.accounts.some(a => a.id === b.acct) ? b.acct : '');
  const sum = (from: number, to: number, key?: string) => data.filter(b => b.hour >= from && b.hour < to && (key === undefined || keyOf(b) === key));
  const now = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const week = weekStart(new Date()).getTime();
  const t = (list: UsageBucket[]) => list.reduce((n, b) => n + tokensOf(b), 0);

  $('#usageTiles').innerHTML =
    '<div class="tile"><span class="lbl">Today · all numbers</span><b>' + fmtTok(t(sum(today.getTime(), now + 1))) + '</b><span class="kv">tokens</span></div>' +
    '<div class="tile"><span class="lbl">This week · all numbers</span><b>' + fmtTok(t(sum(week, now + 1))) + '</b><span class="kv">tokens since Monday</span></div>';

  $('#usageLegend').innerHTML = series.length > 1
    ? series.map(s => '<span class="lg"><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>').join('')
    : '';

  const buckets = usageBuckets();
  const cols = buckets.map(bk => series.map(s => t(sum(bk.start, bk.end, s.key))));
  const max = Math.max(0, ...cols.map(c => c.reduce((a, b) => a + b, 0)));
  if (!max) {
    chart.innerHTML = '<p class="usage-empty">No AI runs in the last ' + (state.usageUnit === 'day' ? USAGE_DAYS + ' days' : USAGE_WEEKS + ' weeks') + '.</p>';
  } else {
    const W = Math.max(320, chart.clientWidth || 620), H = 190, L = 44, B = 24, T = 10, R = 6;
    const iw = W - L - R, ih = H - T - B;
    const step = niceStep(max / 4);
    const top = Math.ceil(max / step) * step;
    const y = (v: number) => T + ih - (v / top) * ih;
    const band = iw / buckets.length;
    const bw = Math.min(30, band * 0.62);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" aria-label="AI tokens per ' + state.usageUnit + ' by number">';
    for (let v = 0; v <= top + 1e-9; v += step) {
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid' + (v === 0 ? ' base' : '') + '"/>' +
        '<text x="' + (L - 6) + '" y="' + (y(v) + 3.5) + '" text-anchor="end" class="ax">' + fmtTok(v) + '</text>';
    }
    const every = band < 30 ? 2 : 1;
    buckets.forEach((bk, i) => {
      const x = L + band * i + (band - bw) / 2;
      let acc = 0;
      const parts = cols[i].map((v, si) => ({ v, si })).filter(p => p.v > 0);
      parts.forEach((p, k) => {
        const y1 = y(acc + p.v), y0 = y(acc);
        acc += p.v;
        const gap = k > 0 ? 2 : 0;
        const h = Math.max(0, y0 - y1 - gap);
        if (h <= 0) return;
        const last = k === parts.length - 1, r = Math.min(4, h, bw / 2);
        svg += last
          ? '<path fill="' + series[p.si].color + '" d="M' + x + ',' + (y1 + h) + 'V' + (y1 + r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y1 + ' ' + (x + bw) + ',' + (y1 + r) + 'V' + (y1 + h) + 'Z"/>'
          : '<rect fill="' + series[p.si].color + '" x="' + x + '" y="' + y1 + '" width="' + bw + '" height="' + h + '"/>';
      });
      if (i % every === 0 || i === buckets.length - 1) svg += '<text x="' + (L + band * i + band / 2) + '" y="' + (H - 7) + '" text-anchor="middle" class="ax' + (i === buckets.length - 1 ? ' now' : '') + '">' + esc(bk.label) + '</text>';
      svg += '<rect class="hit" data-ui="' + i + '" x="' + (L + band * i) + '" y="' + T + '" width="' + band + '" height="' + ih + '" tabindex="0" aria-label="' + esc(bk.long + ': ' + fmtFull(cols[i].reduce((a, b) => a + b, 0)) + ' tokens') + '"/>';
    });
    chart.innerHTML = svg + '</svg><div class="usage-tip" id="usageTip" hidden></div>';
    chart.dataset.band = String(band); chart.dataset.left = String(L);
    (chart as HTMLElement & { _cols?: number[][]; _buckets?: typeof buckets })._cols = cols;
    (chart as HTMLElement & { _cols?: number[][]; _buckets?: typeof buckets })._buckets = buckets;
  }

  const row = (name: string, color: string | null, key: string | undefined, strong = false) => {
    const d = t(sum(today.getTime(), now + 1, key)), w = sum(week, now + 1, key);
    return '<tr' + (strong ? ' class="total"' : '') + '><th scope="row">' + (color ? '<i style="background:' + color + '"></i>' : '') + esc(name) + '</th>' +
      '<td>' + fmtFull(d) + '</td><td>' + fmtFull(t(w)) + '</td><td>' + fmtFull(w.reduce((n, b) => n + b.runs, 0)) + '</td></tr>';
  };
  $('#usageTable').innerHTML = '<thead><tr><th scope="col">Number</th><th scope="col">Today</th><th scope="col">This week</th><th scope="col">Runs this week</th></tr></thead><tbody>' +
    series.map(s => row(s.name, s.color, s.key)).join('') + row('All numbers', null, undefined, true) + '</tbody>';
  $('#usageNote').textContent = series.some(s => s.key === '')
    ? 'Across numbers: report overviews that read several numbers at once, and older runs WA Turbo could not match to a number.'
    : '';
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

function showUsageTip(hit: Element): void {
  const chart = document.getElementById('usageChart') as (HTMLElement & { _cols?: number[][]; _buckets?: { long: string }[] }) | null;
  const tip = document.getElementById('usageTip');
  if (!chart || !tip || !chart._cols || !chart._buckets) return;
  const i = Number((hit as HTMLElement).dataset.ui);
  const series = usageSeries();
  const col = chart._cols[i];
  const total = col.reduce((a, b) => a + b, 0);
  tip.innerHTML = '<b>' + esc(chart._buckets[i].long) + '</b>' +
    series.map((s, si) => col[si] ? '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '<em>' + fmtFull(col[si]) + '</em></span>' : '').join('') +
    '<span class="tt"><i></i>Total<em>' + fmtFull(total) + '</em></span>';
  tip.hidden = false;
  const band = Number(chart.dataset.band), left = Number(chart.dataset.left);
  const cx = (left + band * i + band / 2) * (chart.clientWidth / Number(chart.querySelector('svg')!.viewBox.baseVal.width));
  const tw = tip.offsetWidth;
  tip.style.left = Math.max(0, Math.min(chart.clientWidth - tw, cx - tw / 2)) + 'px';
  $$('#usageChart .hit').forEach(h => h.classList.toggle('on', h === hit));
}

/* ============ contacts (.vcf import) ============ */
async function loadContacts(): Promise<void> {
  state.contacts = await api.contactsInfo().catch(() => null);
  const c = state.contacts;
  const el = document.getElementById('contactsFacts'); if (!el) return;
  el.textContent = c?.count
    ? c.count.toLocaleString() + ' names from your contacts · last import ' + new Date(c.updatedAt!).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'No contacts imported yet.';
  $('#contactsClear').hidden = !c?.count;
}

const CT_FROM: Record<ContactSource, string> = { file: 'in this file', import: 'your last import', phone: 'saved on the phone (WhatsApp)' };

async function readVcf(file: File | undefined): Promise<void> {
  if (!file) return;
  if (!/\.vcf$/i.test(file.name) && !/vcard/i.test(file.type)) { toast('Choose a .vcf file exported from your phone’s Contacts.', 'bad'); return; }
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const preview = await api.previewContacts(data, file.name, null);
    state.ct = { data, preview, keep: Object.fromEntries(preview.duplicates.map(d => [d.phone, d.keep])) };
    renderContactsDlg();
    openDlg('#dlgContacts');
  } catch (e) { fail(e); }
}

function renderContactsDlg(): void {
  const ct = state.ct; if (!ct) return;
  const p = ct.preview;
  const n = (v: number, one: string, many = one + 's') => v.toLocaleString() + ' ' + (v === 1 ? one : many);
  $('#ctSub').textContent = p.fileName;
  $('#ctSummary').textContent = n(p.cards, 'contact') + ' read · ' + n(p.numbers, 'number') + ' · ' + p.added.toLocaleString() + ' new · ' +
    p.unchanged.toLocaleString() + ' already named the same' + (p.skipped ? ' · ' + n(p.skipped, 'contact') + ' skipped (no name or phone number)' : '');
  const cc = $<HTMLInputElement>('#ctCountry');
  if (document.activeElement !== cc) cc.value = p.countryCode;
  $('#ctDupWrap').hidden = !p.duplicates.length;
  $('#ctDupTitle').textContent = n(p.duplicates.length, 'number has', 'numbers have') + ' more than one name';
  $('#ctDups').innerHTML = p.duplicates.map(d => '<li><div class="ct-num"><b>' + esc(d.display) + '</b>' + (d.chat ? '<span class="kv">Chat now shows “' + esc(d.chat) + '”</span>' : '<span class="kv">No chat yet</span>') + '</div>' +
    '<div class="ct-opts">' + d.options.map(o => '<label class="ct-opt"><input type="radio" name="ct-' + d.phone + '" data-ctphone="' + d.phone + '" value="' + esc(o.name) + '"' +
      (ct.keep[d.phone] === o.name ? ' checked' : '') + '><span class="od-fill"><b>' + esc(o.name) + '</b><span class="kv">' + o.from.map(f => CT_FROM[f]).join(' · ') + '</span></span></label>').join('') +
    '</div></li>').join('');
  $('#ctGo').textContent = 'Import ' + n(p.numbers, 'number');
}

function bulkKeep(which: 'file' | 'current'): void {
  const ct = state.ct; if (!ct) return;
  for (const d of ct.preview.duplicates) {
    const o = which === 'file' ? d.options.find(x => x.from.includes('file')) : d.options.find(x => x.from.includes('import')) ?? d.options.find(x => x.from.includes('phone'));
    if (o) ct.keep[d.phone] = o.name;
  }
  renderContactsDlg();
}

async function recountry(code: string): Promise<void> {
  const ct = state.ct; if (!ct || !/^\d{1,3}$/.test(code) || code === ct.preview.countryCode) return;
  try {
    const preview = await api.previewContacts(ct.data, ct.preview.fileName, code);
    const keep = Object.fromEntries(preview.duplicates.map(d => [d.phone, d.options.some(o => o.name === ct.keep[d.phone]) ? ct.keep[d.phone] : d.keep]));
    state.ct = { data: ct.data, preview, keep };
    renderContactsDlg();
  } catch (e) { fail(e); }
}

async function importContacts(): Promise<void> {
  const ct = state.ct; if (!ct) return;
  const go = $<HTMLButtonElement>('#ctGo');
  go.disabled = true;
  try {
    const r = await api.applyContacts(ct.preview.token, ct.keep);
    closeDlg($<HTMLDialogElement>('#dlgContacts'));
    state.ct = null;
    toast('Imported ' + r.saved.toLocaleString() + ' names · ' + r.renamedChats.toLocaleString() + (r.renamedChats === 1 ? ' chat' : ' chats') + ' renamed', 'ok');
    void loadContacts();
    state.team = await api.listTeam().catch(() => state.team); renderTeam();
  } catch (e) { fail(e); } finally { go.disabled = false; }
}

async function loadDb(): Promise<void> {
  state.db = await api.dbInfo().catch(() => null);
  renderDb();
}

function renderDb(): void {
  const facts = document.getElementById('dbFacts'); if (!facts) return;
  const d = state.db;
  const size = d?.sizeBytes == null ? '' : ' · ' + (d.sizeBytes / 1e6).toFixed(1) + ' MB used';
  facts.textContent = !d ? 'Not available' : d.mode === 'external'
    ? 'Using the Postgres named by WA_TURBO_DATABASE_URL (developer copy)' + size
    : 'Built in · PostgreSQL ' + (d.version ?? '') + size;
  const box = $<HTMLInputElement>('#dbTools');
  box.checked = !!d?.toolsOn;
  box.disabled = state.dbBusy || d?.mode !== 'bundled';
  $('#dbFolder').hidden = d?.mode !== 'bundled';
  const acc = $('#dbAccess');
  const t = d?.tools;
  acc.hidden = !t && !d?.toolsError;
  if (d?.toolsError && !t) { acc.innerHTML = '<div class="db-err">' + esc(d.toolsError) + '</div>'; return; }
  if (!t) { acc.innerHTML = ''; return; }
  const row = (k: string, v: string, shown = v) => '<dt>' + k + '</dt><dd><span class="mono">' + esc(shown) + '</span>' +
    '<button type="button" class="btn btn-sm" data-dbcopy="' + esc(v) + '" data-dblabel="' + k + '">Copy</button></dd>';
  acc.innerHTML = row('Host', t.host) + row('Port', String(t.port)) + row('Database', t.database) + row('User', t.user) +
    row('Password', t.password, state.dbPwShown ? t.password : '•'.repeat(12)).replace('</dd>', '<button type="button" class="btn btn-sm" id="dbPw">' + (state.dbPwShown ? 'Hide' : 'Show') + '</button></dd>');
}

async function setDbTools(on: boolean): Promise<void> {
  state.dbBusy = true; renderDb();
  $('#dbFacts').textContent = on ? 'Opening the database to tools on ' + HERE + '…' : 'Closing the database to tools…';
  try {
    state.db = await api.setDbTools(on);
    toast(on ? 'Database tools can connect' : 'Database tools switched off', 'ok');
  } catch (e) {
    fail(e);
    state.db = await api.dbInfo().catch(() => state.db);
  } finally {
    state.dbBusy = false; renderDb();
  }
}

function renderTeam(): void {
  const el = document.getElementById('teamList'); if (!el) return;
  el.innerHTML = state.team.length
    ? state.team.map(t => '<li><span class="od-fill"><b>' + esc(t.name) + '</b><span class="kv">' + esc(t.phones.join(', ') || 'Phone number not known yet') + '</span></span>' +
        '<button type="button" class="btn btn-sm" data-unteam="' + t.id + '">Remove</button></li>').join('')
    : '<li class="empty-line">Nobody yet. In a group chat, right-click a teammate\'s message and choose “Mark as my team”.</li>';
}

function renderNotifySettings(): void {
  const s = state.settings;
  (['notifyOn', 'notifyPreview', 'notifyOverdue', 'menuBar'] as const).forEach(k => { $<HTMLInputElement>('#' + k).checked = s[k]; });
  (['notifyPinnedSound', 'notifyOtherSound', 'notifyOthers', 'notifyBadge', 'notifyRemindMin'] as const).forEach(k => { $<HTMLSelectElement>('#' + k).value = String(s[k]); });
  if (IS_WIN) (['notifyPinnedSound', 'notifyOtherSound'] as const).forEach(k => { $<HTMLSelectElement>('#' + k).value = winSound(s[k]); });
  const paused = s.notifyPausedUntil > Date.now();
  $('#notifyPause').innerHTML = (paused
    ? '<option value="keep" selected>Paused until ' + esc(new Date(s.notifyPausedUntil).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })) + '</option><option value="0">Resume now</option>'
    : '<option value="0" selected>Not paused</option>') +
    '<option value="60">Pause for 1 hour</option><option value="tomorrow">Pause until tomorrow 08:00</option>';
  $$<HTMLElement>('#notifyBlock .auto-grid select, #notifyBlock .ck-row:not(:first-of-type) input').forEach(el => { (el as HTMLInputElement).disabled = !s.notifyOn && el.id !== 'notifyBadge' && el.id !== 'menuBar'; });
}

function renderAutoState(): void {
  const el = document.getElementById('autoState'); if (!el) return;
  const a = state.auto;
  const chat = a?.runningChat ? chatById(a.runningChat) : null;
  el.textContent = !state.settings.autoOn ? 'Off. Only your own Summarize clicks call the AI.'
    : !state.ai.connected ? 'Waiting for an AI to be connected above.'
    : !a ? 'Checking…'
    : a.pausedUntil ? 'Paused until ' + clock(a.pausedUntil) + '. ' + (a.pausedWhy ?? '')
    : a.runningChat ? 'Summarizing ' + (chat?.name ?? 'a chat') + (a.pending > 1 ? ' · ' + (a.pending - 1) + ' more waiting' : '') + '.'
    : a.nextAt ? a.pending + ' chat' + (a.pending === 1 ? '' : 's') + ' with new messages · next run ' + clock(a.nextAt) + '.'
    : 'Nothing new. No runs scheduled until a message arrives.';
  const p = state.settings.provider;
  $('#budgetRow').hidden = !PROVIDERS[p].quota;
  $<HTMLSelectElement>('#autoDailyBudget').value = String(state.settings.autoDailyBudget);
  const skip = ' Groups you never write in are skipped unless pinned.';
  $('#autoNote').textContent = (isClaude(p)
    ? 'Runs on your Claude plan, one chat at a time, pinned first. Pauses for 30 minutes if the plan reaches its usage limit.'
    : p === 'local' ? `Runs on this computer, one chat at a time, pinned first, at most ${FREE_CAP} chats every 10 minutes so it doesn't hold up your other work.`
    : PROVIDERS[p].quota ? `Runs on the free plan, one chat at a time, pinned first: at most ${FREE_CAP} chats every 10 minutes and no more than the daily budget above. Pauses until the quota resets if Google says it's used up.`
    : p === 'codex' ? 'Runs on your ChatGPT plan, one chat at a time, pinned first. Pauses for 30 minutes if the plan reaches its Codex limit.'
    : 'Runs on the service you entered, one chat at a time, pinned first. Pauses if it reports a usage limit.') + skip;
}

/* ============ render ============ */
function render(): void {
  renderRail();
  $$('.seg button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  (['inbox', 'loops', 'reports', 'settings'] as const).forEach(v => { $('#view-' + v).hidden = state.view !== v; });
  if (state.view === 'inbox') { renderList(); renderConvo(); renderPanel(); }
  if (state.view === 'loops') renderLoops();
  if (state.view === 'reports') { renderReportsList(); renderReportDoc(); }
  if (state.view === 'settings') renderSettings();
  const over = openLoops().filter(l => sla(l) === 'over').length;
  const segL = $('#segLoops');
  segL.textContent = String(over);
  segL.hidden = over === 0;
  const chip = $('#aiChip');
  chip.dataset.on = String(state.ai.connected);
  $('#aiChipLabel').textContent = state.ai.connected ? modelLabel(model()) + ' connected' : 'AI not connected';
  syncPanel();
}
function syncPanel(): void {
  $('#panel').hidden = !state.panelOpen;
  $('#panelScrim').hidden = !(state.panelOpen && !wide.matches);
  document.body.classList.toggle('no-panel', !state.panelOpen);
  $('#panelToggle').setAttribute('aria-pressed', String(state.panelOpen));
}
function setView(v: typeof state.view): void {
  state.view = v;
  document.body.classList.remove('mob-convo');
  if (v === 'reports') void loadReports();
  render();
  syncActiveChat();
}

/* ============ data loading ============ */
async function loadChats(): Promise<void> {
  state.chats = await api.listAllChats();
  if (!state.acct || !acctById(state.acct)) state.acct = state.accounts[0]?.id ?? null;
}
async function loadReports(): Promise<void> {
  state.reports = await api.listReports();
  if (state.view === 'reports') { renderReportsList(); renderReportDoc(); }
}
async function loadMessages(chatId: string, limit = PAGE): Promise<void> {
  const msgs = await api.getMessages(chatId, limit);
  state.messages.set(chatId, msgs);
}

async function openChat(id: string): Promise<void> {
  const c = chatById(id); if (!c) return;
  state.acct = c.acct;
  c.unread = 0;
  state.chat = id;
  if (state.summary.chatId !== id) state.summary = { chatId: null, running: false, progress: null, result: null, error: null };
  document.body.classList.add('mob-convo');
  render();
  syncActiveChat();
  void api.openChat(id);
  try {
    await loadMessages(id);
    const prev = await api.lastSummary(id);
    if (prev && state.summary.chatId === null && state.chat === id) state.summary = { chatId: id, running: false, progress: null, result: prev, error: null };
  } catch (e) { fail(e); }
  if (state.chat === id && state.view === 'inbox') { renderConvo(); renderPanel(); }
}

/** Scrolls only `box`. scrollIntoView would also scroll the app's fixed panes and shift the whole window. */
function scrollWithin(box: HTMLElement, el: HTMLElement, where: 'center' | 'start', instant = false): void {
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  const offset = r.top - b.top + box.scrollTop;
  const top = where === 'center' ? offset - (box.clientHeight - r.height) / 2 : offset - 12;
  box.scrollTo({ top: Math.max(0, top), behavior: instant || reduced.matches ? 'auto' : 'smooth' });
}

async function jumpToCitation(chatId: string, msgId: string): Promise<void> {
  setView('inbox');
  if (state.chat !== chatId) await openChat(chatId);
  let el = document.getElementById('msg-' + chatId + '-' + msgId);
  if (!el) {
    await loadMessages(chatId, 5000);
    renderConvo();
    el = document.getElementById('msg-' + chatId + '-' + msgId);
  }
  if (!el) { toast('That message is no longer in the chat.', 'bad'); return; }
  const th = document.getElementById('thread');
  if (th) {
    scrollWithin(th, el, 'center');
    // Photos above it finish loading and push it down; settle once more.
    const target = el;
    window.setTimeout(() => { if (target.isConnected) scrollWithin(th, target, 'center', true); }, 450);
  }
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

/* ============ AI runs ============ */
async function runSummary(opts?: { window?: Settings['window']; force?: boolean }): Promise<void> {
  const c = chatById(state.chat); if (!c || !state.ai.connected) return;
  const id = c.id;
  state.summary = { chatId: id, running: true, progress: null, result: null, error: null };
  renderPanel();
  try {
    const result = await api.summarize(id, opts);
    if (state.summary.chatId !== id) return;
    state.summary = { chatId: id, running: false, progress: null, result, error: null };
    if (result.cached) {
      toast('No new messages since ' + whenShort(result.createdAt) + ' · showing that summary');
    } else {
      await loadMessages(id);
      const d = loopsOf(id).length;
      toast(d ? 'Summary ready · ' + d + ' open loop' + (d === 1 ? '' : 's') + ' detected' : 'Summary ready for ' + c.name, 'ok');
    }
  } catch (e) {
    if (state.summary.chatId !== id) return;
    const msg = e instanceof Error ? e.message : String(e);
    state.summary = msg === 'Cancelled.' ? { chatId: null, running: false, progress: null, result: null, error: null } : { chatId: id, running: false, progress: null, result: null, error: msg };
  }
  if (state.view === 'inbox') { renderConvo(); renderPanel(); renderList(); }
}

async function startGeneration(presetId: PresetId, days: Report['days'], chatIds: string[], custom: string): Promise<void> {
  state.genArgs = { presetId, days, chatIds, custom };
  state.gen = { runId: 'report', kind: 'report', chatId: null, steps: [{ label: 'Starting', state: 'run' }] };
  state.report = null;
  setView('reports');
  try {
    const r = await api.generateReport(presetId, days, chatIds, custom);
    state.gen = null;
    state.reports.unshift(r);
    state.report = r.id;
    document.body.classList.add('mob-convo');
    render();
    toast('Report ready · ' + r.stats.actions + ' action items', 'ok');
  } catch (e) {
    state.gen = null;
    render();
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== 'Cancelled.') toast(msg, 'bad');
  }
}

function summaryText(c: ChatSummaryRow, i: ChatInsight): string {
  const L = [c.name + ' — summary', '', i.summary, ''];
  if (i.highlights.length) { L.push('Highlights:'); i.highlights.forEach(h => L.push('- ' + h)); L.push(''); }
  if (i.actions.length) { L.push('Action items:'); i.actions.forEach(a => L.push('- ' + a.t + ' (' + a.owner + (a.due ? ', ' + a.due : '') + ')')); L.push(''); }
  if (i.questions.length) { L.push('Open questions:'); i.questions.forEach(q => L.push('- ' + q)); }
  return L.join('\n');
}
async function copyText(text: string, label: string): Promise<void> {
  try { await api.copyText(text); toast(label + ' copied', 'ok'); } catch (e) { fail(e); }
}

/* ============ dialogs ============ */
function openDlg(sel: string): HTMLDialogElement {
  const d = $<HTMLDialogElement>(sel);
  if (!d.open) d.showModal();
  requestAnimationFrame(() => {
    const f = d.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, .btn-primary, button');
    f?.focus();
  });
  return d;
}
const closeDlg = (d: HTMLDialogElement | null) => { if (d?.open) d.close(); };
let pendingConfirm: null | (() => void) = null;
function confirmDlg(title: string, text: string, go: string, fn: () => void): void {
  $('#cfTitle').textContent = title;
  $('#cfBody').textContent = text;
  $('#cfGo').textContent = go;
  pendingConfirm = fn;
  openDlg('#dlgConfirm');
}

/* --- pair account --- */
const ACCENTS: Accent[] = ['green', 'blue', 'amber', 'violet', 'cyan'];
function renderPair(): void {
  const body = $('#pairBody');
  const p = state.pair;
  const steps = (at: number) => '<div class="pair-steps">' + ['Name it', 'Scan QR', 'Linked'].map((s, i) => '<span' + (i === at ? ' aria-current="step"' : '') + '>' + (i + 1) + ' · ' + s + '</span>').join('') + '</div>';
  $('#pairRefresh').hidden = p.phase !== 'wait';
  const next = $<HTMLButtonElement>('#pairNext');
  next.hidden = p.phase !== 'name' && p.phase !== 'linked';
  next.textContent = p.phase === 'linked' ? 'Done' : 'Show QR code';
  $('#pairCancel').hidden = p.phase === 'linked';
  if (p.phase === 'name') {
    body.innerHTML = steps(0) +
      '<label class="f"><span class="lb">Number name <span class="req" aria-hidden="true">*</span></span><input type="text" id="pairName" maxlength="24" placeholder="e.g. Work" value="' + esc(state.pairForm.name) + '"></label>' +
      '<label class="f"><span class="lb">Description</span><input type="text" id="pairDesc" maxlength="48" placeholder="e.g. Customer support line" value="' + esc(state.pairForm.desc) + '"><span class="hp">Shown under the name in the account rail.</span></label>' +
      '<div class="f"><span class="lb">Accent</span><div class="sw-row" role="group" aria-label="Accent colour">' +
        ACCENTS.map(a => '<button type="button" data-accent="' + a + '" aria-pressed="' + (state.pairForm.accent === a) + '" aria-label="' + a + '" style="--sw:' + ACCENT[a] + '"></button>').join('') + '</div></div>' +
      '<p class="err" id="pairErr" hidden></p>';
  } else if (p.phase === 'wait' || p.phase === 'linking') {
    body.innerHTML = steps(1) + '<div class="qr"><div class="qr-box">' + (p.qrSvg ?? '<span class="scrim"><span class="spin"></span></span>') +
      (p.phase === 'linking' ? '<span class="scrim"><span class="spin"></span></span>' : '') + '</div>' +
      '<div class="steps-txt">' + (p.phase === 'linking'
        ? '<b>Scanned — linking</b><span>Syncing chat history into an isolated session store for this account. This can take a minute for a busy number.</span>'
        : p.qrSvg ? '<b>Waiting for your phone</b><span>Scan the code with WhatsApp. The code refreshes automatically if it expires.</span>'
        : '<b>Getting a code from WhatsApp</b><span>One moment.</span>') + '</div></div>' +
      '<div class="banner info">' + icon('warn', 15) + '<span>WA Turbo keeps each account in its own isolated session store, so accounts never see each other’s messages. It only reads: nothing is ever sent from ' + HERE + '.</span></div>' +
      (p.error ? '<p class="err">' + icon('warn', 13) + ' ' + esc(p.error) + '</p>' : '');
  } else if (p.phase === 'linked') {
    const a = acctById(p.accountId);
    body.innerHTML = steps(2) + '<div class="qr">' +
      '<span class="av" style="width:56px;height:56px;border-radius:16px;background:' + ACCENT[a?.accent ?? state.pairForm.accent] + ';font-size:19px" aria-hidden="true">' + esc(initials(a?.name ?? state.pairForm.name)) + '</span>' +
      '<div class="steps-txt"><b>' + esc(a?.name ?? state.pairForm.name) + ' linked</b><span>' + esc((a?.phone || 'Your number') + ' is now in your account rail. History syncs in the background and new chats arrive as they come.') + '</span></div></div>' +
      '<div class="banner ok">' + icon('check', 15) + '<span>' + state.accounts.length + ' number' + (state.accounts.length === 1 ? '' : 's') + ' linked. SUM UP! now covers all of them.</span></div>';
  }
}
function startPairing(): void {
  state.pair = { accountId: null, phase: 'name', qrSvg: null, error: null };
  state.pairForm = { name: '', desc: '', accent: ACCENTS[state.accounts.length % ACCENTS.length] };
  openDlg('#dlgPair');
  renderPair();
}

/* --- partner tag --- */
function openPartnerDialog(): void {
  const c = chatById(state.chat); if (!c) return;
  const opts = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).map(x => '<option value="' + esc(x) + '"></option>').join('');
  $('#ptPartners').innerHTML = opts(state.partners.map(p => p.id));
  $('#ptTypes').innerHTML = opts(state.partners.map(p => p.type));
  $<HTMLInputElement>('#ptPartner').value = c.partner ?? '';
  $<HTMLInputElement>('#ptType').value = partnerOf(c)?.type ?? '';
  $<HTMLInputElement>('#ptService').value = c.service ?? partnerOf(c)?.service ?? '';
  $('#ptSub').textContent = c.kind === 'group' ? 'Tagging a group also lets local rules scan it for open loops.' : 'Shown on loops and in the Reply debt report.';
  syncPartnerStage(c.stage);
  openDlg('#dlgPartner');
}
/** Suggestions follow the partner typed: its type, service and the stages used before. */
function syncPartnerStage(current?: string | null): void {
  const name = $<HTMLInputElement>('#ptPartner').value.trim();
  const p = partnerById(name || null);
  const stages = new Set([...(p?.steps ?? []), ...state.chats.filter(x => x.partner === name && x.stage).map(x => x.stage!)]);
  $('#ptStages').innerHTML = Array.from(stages).map(s => '<option value="' + esc(s) + '"></option>').join('');
  if (current !== undefined) $<HTMLInputElement>('#ptStage').value = current ?? '';
  if (p && !$<HTMLInputElement>('#ptType').value) $<HTMLInputElement>('#ptType').value = p.type;
  if (p && !$<HTMLInputElement>('#ptService').value) $<HTMLInputElement>('#ptService').value = p.service;
}

/* --- new report --- */
function openReportDialog(presetId: PresetId, preselect: string[]): void {
  $('#repPreset').innerHTML = PRESETS.map(p => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
  $<HTMLSelectElement>('#repPreset').value = presetId || 'digest';
  $<HTMLSelectElement>('#repRange').value = '7';
  $<HTMLTextAreaElement>('#repCustom').value = state.settings.customPrompt;
  $('#repNoKey').hidden = state.ai.connected;
  state.pick = new Set(preselect.filter(Boolean));
  renderPick(); syncReportDialog();
  openDlg('#dlgReport');
}
function renderPick(): void {
  $('#repPick').innerHTML = state.accounts.map(a => {
    const list = state.chats.filter(c => c.acct === a.id).sort((x, y) => y.lastAt - x.lastAt);
    if (!list.length) return '';
    return '<div class="pick-acct"><div class="hd">' +
      '<span class="av" style="width:22px;height:22px;border-radius:6px;font-size:10px;background:' + ACCENT[a.accent] + '" aria-hidden="true">' + esc(initials(a.name)) + '</span>' +
      '<span class="nm od-fill od-truncate">' + esc(a.name) + ' · ' + esc(a.phone) + '</span>' +
      '<button type="button" class="btn btn-sm" data-pickacct="' + a.id + '">All</button></div>' +
      '<div class="items">' + list.map(c =>
        '<label class="ck"><input type="checkbox" data-pick="' + c.id + '"' + (state.pick.has(c.id) ? ' checked' : '') + '>' +
        '<span class="od-field od-fill"><span class="cn od-truncate">' + esc(c.name) + '</span>' +
        '<span class="cm od-truncate">' + esc(c.msgCount + ' messages · last ' + relTime(c.lastAt)) + '</span></span></label>').join('') + '</div></div>';
  }).join('');
}
function syncReportDialog(): void {
  const n = state.pick.size;
  $('#repCustomWrap').hidden = $<HTMLSelectElement>('#repPreset').value !== 'custom';
  $('#repSummary').textContent = n === 0 ? 'No chats selected'
    : n + (n === 1 ? ' chat' : ' chats') + ' · ' + Array.from(state.pick).reduce((t, id) => t + (chatById(id)?.msgCount ?? 0), 0) + ' messages';
  $<HTMLButtonElement>('#repGenerate').disabled = !state.ai.connected;
  if (n > 0) $('#repPickErr').hidden = true;
}

/* --- export --- */
async function exportReport(r: Report): Promise<void> {
  const md = reportMarkdown(r);
  $('#expOut').textContent = md;
  try {
    const { path } = await api.exportReport(r.id, md);
    $('#expSub').textContent = 'Saved to ' + path.replace(/^\/Users\/[^/]+/, '~') + '. The full text is below if you would rather copy it.';
  } catch (e) {
    $('#expSub').textContent = 'Could not save the file (' + (e instanceof Error ? e.message : String(e)) + '). Copy the markdown below instead.';
  }
  openDlg('#dlgExport');
}

/* --- rail menu --- */
function openAcctMenu(a: Account, x: number, y: number): void {
  closeAcctMenu();
  const m = document.createElement('div');
  m.className = 'acct-menu';
  m.id = 'acctMenu';
  m.style.left = x + 'px';
  m.style.top = y + 'px';
  m.innerHTML = '<button type="button" data-menu="reconnect" data-id="' + a.id + '">Reconnect ' + esc(a.name) + '</button>' +
    '<button type="button" class="danger" data-menu="unlink" data-id="' + a.id + '">Unlink ' + esc(a.name) + ' and delete its chats</button>';
  document.body.appendChild(m);
}
const closeAcctMenu = () => document.getElementById('acctMenu')?.remove();

function viewMedia(id: string): void {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = '<img src="wat-media://full/' + id + '" alt="Photo">' +
    '<button type="button" class="btn viewer-save" data-save-media="' + id + '">' + icon('save', 14) + 'Save to ' + HERE + '</button>';
  v.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('[data-save-media]')) v.remove(); });
  v.querySelector('img')!.addEventListener('error', () => { v.remove(); toast('That photo is no longer available on WhatsApp.', 'bad'); });
  document.body.appendChild(v);
}

/* ============ events ============ */
// A photo WhatsApp no longer serves falls back to its thumbnail, then to a plain placeholder.
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.closest('.shot')) return;
  if (img.dataset.fallback) { img.src = img.dataset.fallback; delete img.dataset.fallback; return; }
  const box = img.closest('.sh-thumb');
  if (box) { box.classList.add('ph'); box.innerHTML = icon('doc', 18) + '<span>Photo not available</span>'; }
}, true);

document.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  if (!t.closest('#acctMenu')) closeAcctMenu();

  if (t.closest('#themeToggle')) { toggleDark(); return; }
  const md = t.closest<HTMLElement>('[data-mode]');
  if (md) { setMode(md.dataset.mode as 'light' | 'dark' | 'system'); return; }
  const th = t.closest<HTMLElement>('[data-theme-id]');
  if (th) { setTheme(th.dataset.themeId!); return; }
  const rd = t.closest<HTMLElement>('[data-redetect]');
  if (rd) {
    void api.setNumberLang(rd.dataset.redetect!, null).then(a => { state.accounts = a; renderLangList(); toast('Detecting the language again from its first conversations'); }).catch(fail);
    return;
  }

  const lu = t.closest<HTMLElement>('[data-lm-use]');
  if (lu) {
    const name = lu.dataset.lmUse!;
    void api.saveSettings({ localModel: name }).then(s => { state.settings = s; return checkAi(false); }).then(() => toast(modelLabel('local:' + name) + ' selected', 'ok'));
    return;
  }
  const dc = t.closest<HTMLElement>('[data-dbcopy]');
  if (dc) { void copyText(dc.dataset.dbcopy ?? '', dc.dataset.dblabel ?? 'Value'); return; }

  const mm = t.closest<HTMLElement>('[data-msgmenu]');
  if (mm) {
    const m = msgById(mm.dataset.msgmenu!); const r = mm.getBoundingClientRect();
    if (m) openMessageMenu(m, r.right - 220, r.bottom + 4);
    return;
  }
  const ma = t.closest<HTMLElement>('[data-msgact]');
  if (ma) { closeAcctMenu(); messageAction(ma.dataset.msgact!, ma.dataset.id!); return; }

  const cm = t.closest<HTMLElement>('[data-chatmenu]');
  if (cm) {
    closeAcctMenu();
    const c = chatById(cm.dataset.id!); if (!c) return;
    const act = cm.dataset.chatmenu!;
    if (act === 'pin') void togglePin(c);
    else if (act === 'unmute') void setMuted(c, null);
    else if (act === 'mute:inf') void setMuted(c, Infinity);
    else if (act.startsWith('mute:')) void setMuted(c, Date.now() + Number(act.slice(5)) * 60_000);
    return;
  }

  const menu = t.closest<HTMLElement>('[data-menu]');
  if (menu) {
    closeAcctMenu();
    const a = acctById(menu.dataset.id!); if (!a) return;
    if (menu.dataset.menu === 'reconnect') void api.reconnect(a.id).then(() => toast('Reconnecting ' + a.name)).catch(fail);
    else confirmDlg('Unlink ' + a.name, 'This removes WA Turbo from ' + a.name + '’s Linked devices and deletes its chats, loops and summaries from ' + HERE + '. Reports stay. This cannot be undone.', 'Unlink', () => {
      void api.unlink(a.id).then(async () => {
        toast(a.name + ' unlinked');
        state.messages.clear();
        if (state.acct === a.id) { state.acct = null; state.chat = null; }
        await refreshAll();
      }).catch(fail);
    });
    return;
  }

  const close = t.closest('[data-close]');
  if (close) {
    const d = close.closest('dialog');
    if (d?.id === 'dlgPair') void cancelPair();
    closeDlg(d);
    return;
  }

  const tab = t.closest<HTMLElement>('.seg button');
  if (tab) { setView(tab.dataset.view as typeof state.view); return; }

  const go = t.closest<HTMLElement>('[data-go]');
  if (go) { setView(go.dataset.go as typeof state.view); return; }

  if (t.closest('[data-pair]')) { startPairing(); return; }

  const faq = t.closest('[data-faq]');
  if (faq) {
    setView('settings');
    const block = $('#faqBlock');
    if (block) scrollWithin($('#view-settings'), block, 'start');
    block?.focus({ preventScroll: true });
    return;
  }

  const acct = t.closest<HTMLElement>('[data-acct]');
  if (acct) {
    state.acct = acct.dataset.acct!;
    if (state.view !== 'inbox') state.view = 'inbox';
    const here = visibleChats();
    if (!here.some(c => c.id === state.chat)) { state.chat = null; if (here.length) { void openChat(here[0].id); } }
    document.body.classList.remove('mob-convo');
    render(); return;
  }

  const row = t.closest<HTMLElement>('[data-chat]');
  if (row) { void openChat(row.dataset.chat!); return; }

  const chip = t.closest<HTMLElement>('.chip[data-filter]');
  if (chip) {
    state.filter = chip.dataset.filter!;
    $$('.chip[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === chip)));
    renderList(); return;
  }

  const media = t.closest<HTMLElement>('[data-view-media]');
  if (media) { viewMedia(media.dataset.viewMedia!); return; }

  const cite = t.closest<HTMLElement>('[data-cite]');
  if (cite) { const [cid, mid] = cite.dataset.cite!.split(':'); void jumpToCitation(cid, mid); return; }

  const lact = t.closest<HTMLElement>('[data-lact]');
  if (lact) { void loopAction(lact.dataset.lact!, lact.dataset.loop!); return; }

  const mflag = t.closest<HTMLElement>('[data-mflag]');
  if (mflag) { const [cid, mid] = mflag.dataset.mflag!.split(':'); void flagMessage(cid, mid); return; }

  const preset = t.closest<HTMLElement>('[data-preset]');
  if (preset) { openReportDialog(preset.dataset.preset as PresetId, [state.chat ?? '']); return; }

  const usePreset = t.closest<HTMLElement>('[data-usepreset]');
  if (usePreset) { openReportDialog(usePreset.dataset.usepreset as PresetId, [state.chat ?? '']); return; }

  const rep = t.closest<HTMLElement>('[data-report]');
  if (rep) { state.report = rep.dataset.report!; document.body.classList.add('mob-convo'); render(); return; }

  const accent = t.closest<HTMLElement>('[data-accent]');
  if (accent) { readPairForm(); state.pairForm.accent = accent.dataset.accent as Accent; renderPair(); return; }

  const pickAcct = t.closest<HTMLElement>('[data-pickacct]');
  if (pickAcct) {
    const ids = state.chats.filter(c => c.acct === pickAcct.dataset.pickacct).map(c => c.id);
    const allOn = ids.every(id => state.pick.has(id));
    ids.forEach(id => (allOn ? state.pick.delete(id) : state.pick.add(id)));
    renderPick(); syncReportDialog(); return;
  }

  const uu = t.closest<HTMLElement>('[data-usage]');
  if (uu) { state.usageUnit = uu.dataset.usage as 'day' | 'week'; renderUsage(); return; }

  const unteam = t.closest<HTMLElement>('[data-unteam]');
  if (unteam) {
    void api.removeTeam(unteam.dataset.unteam!).then(async list => {
      state.team = list; renderTeam(); toast('Removed from your team', 'ok');
      if (state.chat && state.messages.has(state.chat)) await loadMessages(state.chat, Math.max(PAGE, state.messages.get(state.chat)!.length));
    }).catch(fail);
    return;
  }

  const save = t.closest<HTMLElement>('[data-save-media]');
  if (save) { void saveMedia(save.dataset.saveMedia!); return; }
  const tag = t.closest<HTMLElement>('[data-mention-pick]');
  if (tag) { pickMention(Number(tag.dataset.mentionPick)); return; }

  const btn = t.closest('button');
  switch (btn?.id) {
    case 'sendBtn': void sendFromComposer(); return;
    case 'attachBtn': void attachPhoto(); return;
    case 'attachClear': state.photo = null; renderConvo(); return;
    case 'editSave': void saveEdit(); return;
    case 'editCancel': state.editing = null; renderConvoKeepScroll(); return;
    case 'addAccount': startPairing(); return;
    case 'pairNext': void pairNext(); return;
    case 'pairCancel': void cancelPair(); closeDlg($<HTMLDialogElement>('#dlgPair')); return;
    case 'pairRefresh': void api.refreshPairing().then(p => { state.pair = p; renderPair(); }).catch(fail); return;
    case 'showClosed': state.loopClosed = !state.loopClosed; renderLoops(); return;
    case 'loopScopeClear': state.loopChat = null; renderLoops(); return;
    case 'chatLoops': case 'openTracker': state.loopChat = state.chat; setView('loops'); return;
    case 'chatPartner': openPartnerDialog(); return;
    case 'ptRemove': void savePartner(null, null, null, null); return;
    case 'ptSave': void savePartner($<HTMLInputElement>('#ptPartner').value.trim() || null, $<HTMLInputElement>('#ptType').value.trim() || null, $<HTMLInputElement>('#ptService').value.trim() || null, $<HTMLInputElement>('#ptStage').value.trim() || null); return;
    case 'loopReport': {
      const ids = Array.from(new Set(openLoops().map(l => l.chatId)));
      openReportDialog('debt', state.loopChat ? [state.loopChat] : ids);
      return;
    }
    case 'railSettings': case 'aiChip': setView('settings'); return;
    case 'panelToggle': state.panelOpen = !state.panelOpen; syncPanel(); if (state.panelOpen) renderPanel(); return;
    case 'panelClose': case 'panelScrim': state.panelOpen = false; syncPanel(); return;
    case 'convoBack': case 'repBack': document.body.classList.remove('mob-convo'); return;
    case 'searchClear': $<HTMLInputElement>('#search').value = ''; state.q = ''; state.hits = null; $('#searchClear').hidden = true; renderList(); $('#search').focus(); return;
    case 'summarizeBtn':
      if (!state.ai.connected) { toast('Connect an AI first', 'bad'); setView('settings'); return; }
      state.panelOpen = true; syncPanel(); void runSummary(); return;
    case 'runSummary': void runSummary(); return;
    case 'resummarize': void runSummary({ force: true }); return;
    case 'summarize50': void runSummary({ window: 50 }); return;
    case 'pinBtn': { const c = chatById(state.chat); if (c) void togglePin(c); return; }
    case 'rerunSonnet': void api.saveSettings({ model: 'claude-sonnet-5-5' }).then(s => { state.settings = s; void runSummary(); }); return;
    case 'cancelSummary': if (state.summary.chatId) void api.cancelRun('summary:' + state.summary.chatId); return;
    case 'copySummary': { const c = chatById(state.chat); if (c && state.summary.result) void copyText(summaryText(c, state.summary.result.insight), 'Summary'); return; }
    case 'toReport': openReportDialog('digest', [state.chat ?? '']); return;
    case 'newReport': openReportDialog('digest', state.chats.filter(c => c.acct === state.acct).slice(0, 8).map(c => c.id)); return;
    case 'cancelGen': void api.cancelRun('report'); return;
    case 'reconnectBtn': {
      const a = acctById(chatById(state.chat)?.acct ?? null); if (!a) return;
      (btn as HTMLButtonElement).disabled = true; btn!.textContent = 'Reconnecting…';
      void api.reconnect(a.id).catch(fail);
      return;
    }
    case 'repSelectAll': state.pick = new Set(state.chats.map(c => c.id)); renderPick(); syncReportDialog(); return;
    case 'repSelectNone': state.pick = new Set(); renderPick(); syncReportDialog(); return;
    case 'repGenerate': {
      let bad = false;
      if (!state.pick.size) { $('#repPickErr').innerHTML = icon('warn', 13) + ' Pick at least one chat to read.'; $('#repPickErr').hidden = false; bad = true; }
      const custom = $<HTMLSelectElement>('#repPreset').value === 'custom';
      const text = $<HTMLTextAreaElement>('#repCustom').value.trim();
      if (custom && !text) {
        $('#repCustomErr').innerHTML = icon('warn', 13) + ' Write what the AI should pull out, or choose another report type.';
        $('#repCustomErr').hidden = false; $('#repCustom').setAttribute('aria-invalid', 'true'); bad = true;
      }
      if (bad) return;
      if (custom) state.settings.customPrompt = text;
      closeDlg($<HTMLDialogElement>('#dlgReport'));
      void startGeneration($<HTMLSelectElement>('#repPreset').value as PresetId, $<HTMLSelectElement>('#repRange').value as Report['days'], Array.from(state.pick), custom ? text : '');
      return;
    }
    case 'keyReveal': {
      const i = $<HTMLInputElement>('#apiKey'), on = i.type === 'password';
      i.type = on ? 'text' : 'password';
      btn!.textContent = on ? 'Hide' : 'Show';
      btn!.setAttribute('aria-pressed', String(on));
      btn!.setAttribute('aria-label', on ? 'Hide API key' : 'Show API key');
      return;
    }
    case 'testKey': void testKey(); return;
    case 'checkCc': case 'checkAgy': case 'checkCodex': void checkAi(true); return;
    case 'checkLocal': state.localFound = null; void checkAi(true); return;
    case 'diagLocal': case 'diagAgy': case 'diagCodex':
      void api.aiDiagnostics(state.settings.provider).then(t => copyText(t, 'Diagnostics')).catch(fail);
      return;
    case 'testGemini': void testProvider('gemini'); return;
    case 'testOpenai': void testProvider('openai'); return;
    case 'disconnectGemini': case 'disconnectOpenai': {
      const k = btn!.id === 'disconnectGemini' ? 'gemini' : 'openai';
      void api.disconnectProvider(k).then(() => checkAi(false)).then(() => toast(k === 'gemini' ? 'Gemini key removed' : 'Key forgotten'));
      return;
    }
    case 'testNotify': void api.testNotification().then(() => toast('Test sent. Two banners: pinned, then other.', 'ok')).catch(fail); return;
    case 'openNotifySettings': void api.openNotificationSettings().catch(fail); return;
    case 'disconnectKey':
      void api.disconnectKey().then(() => {
        state.ai.connected = false;
        $<HTMLInputElement>('#apiKey').value = '';
        state.summary = { chatId: null, running: false, progress: null, result: null, error: null };
        render(); toast('Claude disconnected');
      });
      return;
    case 'docCopy': { const r = state.reports.find(x => x.id === state.report); if (r) void copyText(reportMarkdown(r), 'Report'); return; }
    case 'docExport': { const r = state.reports.find(x => x.id === state.report); if (r) void exportReport(r); return; }
    case 'docRerun': { const r = state.reports.find(x => x.id === state.report); if (r) void startGeneration(r.presetId, r.days, r.chatIds, r.custom); return; }
    case 'docDelete': {
      const r = state.reports.find(x => x.id === state.report); if (!r) return;
      confirmDlg('Delete report', '“' + r.title + '” will be removed from ' + HERE + '. This cannot be undone.', 'Delete', () => {
        void api.deleteReport(r.id).then(() => {
          const i = state.reports.findIndex(x => x.id === r.id);
          state.reports.splice(i, 1);
          state.report = state.reports.length ? state.reports[Math.min(i, state.reports.length - 1)].id : null;
          document.body.classList.remove('mob-convo');
          render(); toast('Report deleted');
        }).catch(fail);
      });
      return;
    }
    case 'cfGo': closeDlg($<HTMLDialogElement>('#dlgConfirm')); if (pendingConfirm) { const p = pendingConfirm; pendingConfirm = null; p(); } return;
    case 'expCopy': void copyText($('#expOut').textContent ?? '', 'Markdown'); return;
    case 'dbRetry': void bootDb(() => api.retryDb()); return;
    case 'vcfPick': $<HTMLInputElement>('#vcfFile').click(); return;
    case 'ctUseFile': bulkKeep('file'); return;
    case 'ctKeepCurrent': bulkKeep('current'); return;
    case 'ctGo': void importContacts(); return;
    case 'contactsClear':
      confirmDlg('Remove imported names', 'Chats go back to the names WhatsApp has. You can import your contacts again any time.', 'Remove', () => {
        void api.clearContacts().then(n => { toast(n.toLocaleString() + ' imported names removed', 'ok'); void loadContacts(); }).catch(fail);
      });
      return;
    case 'dbShow': case 'dbFolder': void api.showDbFolder().catch(fail); return;
    case 'dbPw': state.dbPwShown = !state.dbPwShown; renderDb(); return;
  }
}, false);

const isMuted = (c: ChatSummaryRow): boolean => c.mutedUntil !== null && c.mutedUntil > Date.now();
function mutedLabel(c: ChatSummaryRow): string {
  if (!isMuted(c)) return '';
  return c.mutedUntil === Infinity ? 'Notifications muted' : 'Notifications muted until ' + new Date(c.mutedUntil!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function setMuted(c: ChatSummaryRow, until: number | null): Promise<void> {
  try {
    await api.setMuted(c.id, until);
    c.mutedUntil = until;
    render();
    toast(until === null ? c.name + ' unmuted' : mutedLabel(c) + ' · ' + c.name, 'ok');
  } catch (e) { fail(e); }
}

/** Tells the main process which chat you're reading, so it doesn't notify for it. */
function syncActiveChat(): void {
  void api.setActiveChat(state.view === 'inbox' ? state.chat : null).catch(() => {});
}

async function togglePin(c: ChatSummaryRow): Promise<void> {
  const pinned = !c.pinned;
  try {
    await api.setPinned(c.id, pinned);
    c.pinned = pinned;
    render();
    toast(pinned ? c.name + ' pinned · auto summary every ' + state.settings.pinEveryMin + ' min' : c.name + ' unpinned', 'ok');
  } catch (e) { fail(e); }
}

function openChatMenu(c: ChatSummaryRow, x: number, y: number): void {
  closeAcctMenu();
  const m = document.createElement('div');
  m.className = 'acct-menu';
  m.id = 'acctMenu';
  m.style.left = Math.min(x, innerWidth - 220) + 'px';
  m.style.top = Math.min(y, innerHeight - 60) + 'px';
  const b = (act: string, label: string) => '<button type="button" data-chatmenu="' + act + '" data-id="' + c.id + '">' + label + '</button>';
  m.innerHTML = b('pin', (c.pinned ? 'Unpin ' : 'Pin ') + esc(c.name)) + '<hr>' +
    (isMuted(c) ? b('unmute', 'Unmute notifications') + '<p class="menu-note">' + esc(mutedLabel(c)) + '</p>'
      : b('mute:60', 'Mute notifications for 1 hour') + b('mute:480', 'Mute notifications for 8 hours') + b('mute:inf', 'Mute until I unmute'));
  document.body.appendChild(m);
}

document.addEventListener('contextmenu', e => {
  const bubble = (e.target as HTMLElement).closest<HTMLElement>('.msg[data-mid]');
  if (bubble && !(e.target as HTMLElement).closest('textarea')) {
    const m = msgById(bubble.dataset.mid!);
    if (m) { e.preventDefault(); openMessageMenu(m, (e as MouseEvent).clientX, (e as MouseEvent).clientY); }
    return;
  }
  const row = (e.target as HTMLElement).closest<HTMLElement>('[data-chat]');
  if (row) {
    e.preventDefault();
    const c = chatById(row.dataset.chat!);
    if (c) openChatMenu(c, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
    return;
  }
  const acct = (e.target as HTMLElement).closest<HTMLElement>('[data-acct]');
  if (!acct) return;
  e.preventDefault();
  const a = acctById(acct.dataset.acct!);
  if (a) openAcctMenu(a, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
});

function readPairForm(): void {
  const n = document.getElementById('pairName') as HTMLInputElement | null;
  const d = document.getElementById('pairDesc') as HTMLInputElement | null;
  if (n) state.pairForm.name = n.value;
  if (d) state.pairForm.desc = d.value;
}
async function pairNext(): Promise<void> {
  if (state.pair.phase === 'linked') { closeDlg($<HTMLDialogElement>('#dlgPair')); return; }
  readPairForm();
  const name = state.pairForm.name.trim();
  if (!name) {
    const err = $('#pairErr');
    err.innerHTML = icon('warn', 13) + ' Give this number a name, for example Work or Personal.';
    err.hidden = false; $('#pairName').focus(); return;
  }
  try {
    state.pair = await api.startPairing(name, state.pairForm.desc, state.pairForm.accent);
    renderPair();
  } catch (e) { fail(e); }
}
async function cancelPair(): Promise<void> {
  if (state.pair.phase !== 'linked' && state.pair.accountId) await api.cancelPairing().catch(() => {});
  state.pair = { accountId: null, phase: 'name', qrSvg: null, error: null };
}
async function savePartner(partner: string | null, type: string | null, service: string | null, stage: string | null): Promise<void> {
  const c = chatById(state.chat); if (!c) return;
  try {
    await api.setChatPartner(c.id, partner, type, service, stage);
    Object.assign(c, { partner, service, stage });
    closeDlg($<HTMLDialogElement>('#dlgPartner'));
    render();
    toast(partner ? c.name + ' tagged ' + partner : 'Partner tag removed', 'ok');
  } catch (e) { fail(e); }
}

async function checkAi(announce: boolean): Promise<void> {
  state.ai.testing = true; renderSettings();
  try {
    state.ai = await api.checkAi(announce);
  } catch (e) {
    state.ai.testing = false; fail(e);
  }
  state.summary = { ...state.summary, error: null };
  render();
  const p = state.ai.provider;
  if (announce || p === 'claude-code') {
    if (state.ai.connected) toast(p === 'claude-code' ? 'Claude Code connected' : modelLabel(model()) + ' connected', 'ok');
    else if (announce) toast(notConnected(state.ai), 'bad');
  }
}

/** Why the selected provider isn't connected, in a few words for a toast. */
function notConnected(ai: AiStatus): string {
  switch (ai.provider) {
    case 'claude-code': return ai.cliFound ? 'Claude Code is not signed in' : 'Claude Code not found';
    case 'codex': return ai.cliFound ? 'Codex is not signed in' : 'Codex CLI not found';
    case 'antigravity': return ai.cliFound ? (ai.detail ?? 'Antigravity is not signed in') : 'Antigravity CLI not found';
    case 'local': return ai.cliFound ? 'Ollama has no model installed yet' : 'Ollama is not running on ' + HERE;
    default: return 'Not connected';
  }
}

/* --- AI connection boxes (Settings) --- */
const BOXES: Record<AiProvider, string> = {
  'claude-code': '#ccBox', api: '#keyBox', local: '#localBox', gemini: '#geminiBox', openai: '#openaiBox', antigravity: '#agyBox', codex: '#codexBox',
};

/** Fills a text field from settings unless the person is typing in it. */
function fill(id: string, v: string): void {
  const i = $<HTMLInputElement>('#' + id);
  if (document.activeElement !== i) i.value = v;
}

function showErr(id: string, msg: string | null | undefined): void {
  const el = $('#' + id);
  el.hidden = !msg;
  if (msg) el.innerHTML = icon('warn', 13) + ' ' + esc(msg);
}

function renderProviderBox(): void {
  const s = state.settings, ai = state.ai, p = s.provider;
  const mine = ai.provider === p;
  const on = mine && ai.connected;
  const checking = ai.testing ? 'Checking…' : null;
  if (p === 'local') {
    const have = mine ? ai.models ?? [] : [];
    const running = mine && ai.cliFound;
    $('#localState').textContent = checking ?? (on ? 'Connected · ' + (ai.account ?? 'Ollama') : running ? 'Ollama is running, but has no model yet' : 'Ollama not found');
    $('#localModels').innerHTML = have.map(name => {
      const use = name === s.localModel;
      return '<div class="lm' + (use ? ' on' : '') + '"><b translate="no">' + esc(name) + '</b><span class="kv">Installed in Ollama</span><span class="acts">' +
        (use ? '<span class="kv">In use</span>' : '<button type="button" class="btn btn-sm" data-lm-use="' + esc(name) + '">Use</button>') + '</span></div>';
    }).join('');
    $('#localGuide').hidden = ai.testing || !mine || have.length > 0;
  }
  if (p === 'gemini') {
    $<HTMLInputElement>('#geminiAgreed').checked = s.geminiAgreed;
    fill('geminiModel', s.geminiModel);
    $('#geminiState').textContent = checking ?? (on ? 'Connected' : 'Not connected');
    $('#disconnectGemini').hidden = !on;
    const b = $<HTMLButtonElement>('#testGemini');
    b.disabled = ai.testing || !s.geminiAgreed;
    b.textContent = ai.testing ? 'Testing…' : on ? 'Re-test connection' : 'Test connection';
  }
  if (p === 'openai') {
    fill('openaiBaseUrl', s.openaiBaseUrl);
    fill('openaiModel', s.openaiModel);
    $('#openaiState').textContent = checking ?? (on ? 'Connected' : 'Not connected');
    $('#disconnectOpenai').hidden = !on;
    $<HTMLButtonElement>('#testOpenai').disabled = ai.testing;
  }
  if (p === 'antigravity') {
    fill('agyModel', s.agyModel);
    $('#agyState').textContent = checking ?? (on ? 'Connected' : mine && ai.cliFound ? 'Not checked yet' : 'Not installed');
    $<HTMLButtonElement>('#checkAgy').disabled = ai.testing;
    showErr('agyErr', mine && !ai.testing ? ai.detail : null);
  }
  if (p === 'codex') {
    fill('codexModel', s.codexModel);
    $('#codexState').textContent = checking ?? (on ? 'Signed in' + (ai.account ? ' · ' + ai.account : '') : mine && ai.cliFound ? 'Not signed in' : 'Not installed');
    $<HTMLButtonElement>('#checkCodex').disabled = ai.testing;
    showErr('codexErr', mine && !ai.testing && ai.cliFound && !ai.connected ? 'Run codex login in Terminal, then press Check again.' : null);
  }
}

/** Looks for Ollama and its models, for the note on the Local model card. */
let detecting = false;
function detectLocal(): void {
  if (detecting) return;
  detecting = true;
  void api.detectLocal().then(f => { state.localFound = f; renderLocalFound(); }).catch(() => {}).finally(() => { detecting = false; });
}

function renderLocalFound(): void {
  const el = document.getElementById('localFound'); if (!el) return;
  const f = state.localFound;
  if (!f) { el.hidden = true; detectLocal(); return; }
  const top = f.models.filter(m => !/embed/i.test(m));
  el.hidden = false;
  el.className = 'found' + (top.length ? '' : ' none');
  el.textContent = top.length ? 'Found: ' + top.slice(0, 2).join(', ') + (top.length > 2 ? ' +' + (top.length - 2) : '')
    : f.running ? 'Ollama found, no model yet' : 'Not found on ' + HERE;
}

async function testProvider(kind: 'gemini' | 'openai'): Promise<void> {
  const input = $<HTMLInputElement>(kind === 'gemini' ? '#geminiKey' : '#openaiKey');
  const errId = kind === 'gemini' ? 'geminiErr' : 'openaiErr';
  showErr(errId, null);
  if (kind === 'gemini' && !state.settings.geminiAgreed) { showErr(errId, 'Tick the box above first: it says Google may use what you send.'); return; }
  const patch: Partial<Settings> = kind === 'gemini'
    ? { geminiModel: $<HTMLInputElement>('#geminiModel').value.trim() }
    : { openaiBaseUrl: $<HTMLInputElement>('#openaiBaseUrl').value.trim(), openaiModel: $<HTMLInputElement>('#openaiModel').value.trim() };
  state.settings = await api.saveSettings(patch);
  state.ai.testing = true; renderSettings();
  const r = await api.testProviderKey(kind, input.value.trim() || null);
  state.ai.testing = false;
  if (r.ok) {
    input.value = '';
    await checkAi(false);
    toast(modelLabel(model()) + ' connected', 'ok');
  } else {
    showErr(errId, r.error ?? 'That did not work.');
    renderSettings();
  }
}

async function testKey(): Promise<void> {
  const input = $<HTMLInputElement>('#apiKey'), err = $('#apiKeyErr');
  const key = input.value.trim();
  err.hidden = true; input.removeAttribute('aria-invalid');
  if (!key) {
    if (state.ai.connected) { toast(modelLabel(model()) + ' is connected', 'ok'); return; }
    err.innerHTML = icon('warn', 13) + ' Paste a key first — it starts with sk-ant-.';
    err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return;
  }
  if (!/^sk-ant-/.test(key) || key.length < 20) {
    err.innerHTML = icon('warn', 13) + ' That does not look like an Anthropic key. Keys start with sk-ant- and are longer than 20 characters.';
    err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return;
  }
  state.ai.testing = true; renderSettings();
  const r = await api.testKey(key);
  state.ai.testing = false;
  if (r.ok) {
    state.ai.connected = true;
    input.value = '';
    render();
    toast(modelLabel(model()) + ' connected', 'ok');
  } else {
    err.innerHTML = icon('warn', 13) + ' ' + esc(r.error ?? 'That key did not work.');
    err.hidden = false; input.setAttribute('aria-invalid', 'true');
    renderSettings();
  }
}

let searchTimer: number | undefined;
let promptTimer: number | undefined;
document.addEventListener('input', e => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'composer' && state.chat) {
    state.drafts.set(state.chat, t.value);
    const sb = document.getElementById('sendBtn') as HTMLButtonElement | null;
    if (sb) sb.disabled = state.sending || !(t.value.trim() || state.photo?.chatId === state.chat);
    fitComposer(t as unknown as HTMLTextAreaElement);
    syncMention(t as unknown as HTMLTextAreaElement);
  }
  if (t.id === 'editBox' && state.editing) { state.editing.text = t.value; fitComposer(t as unknown as HTMLTextAreaElement, 240); }
  if (t.id === 'search') {
    state.q = t.value;
    $('#searchClear').hidden = !t.value;
    renderList();
    clearTimeout(searchTimer);
    const q = t.value.trim();
    if (!q || !state.acct) { state.hits = null; return; }
    const acct = state.acct;
    searchTimer = window.setTimeout(() => void api.searchChats(acct, q).then(ids => { if (state.q.trim() === q) { state.hits = new Set(ids); renderList(); } }), 180);
  }
  if (t.id === 'repCustom' && t.value.trim()) { $('#repCustomErr').hidden = true; t.removeAttribute('aria-invalid'); }
  if (t.id === 'customPrompt') {
    state.settings.customPrompt = t.value;
    clearTimeout(promptTimer);
    promptTimer = window.setTimeout(() => void api.saveSettings({ customPrompt: t.value }), 500);
  }
  if (t.id === 'pairName' && t.value.trim()) { const err = document.getElementById('pairErr'); if (err) err.hidden = true; }
});

document.addEventListener('change', e => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'appLang' && (t.value === 'en' || t.value === 'id') && t.value !== lang) {
    try { sessionStorage.setItem('wat.view', state.view); } catch { /* opens on the inbox */ }
    setLang(t.value);
    return;
  }
  if (t.dataset.numlang && (t.value === 'en' || t.value === 'id')) {
    const a = acctById(t.dataset.numlang);
    void api.setNumberLang(t.dataset.numlang, t.value).then(accts => {
      state.accounts = accts; renderLangList();
      toast((a?.name ?? 'Number') + ': the AI now writes in ' + (t.value === 'id' ? 'Bahasa Indonesia' : 'English'), 'ok');
    }).catch(fail);
    return;
  }
  if (t.id === 'model') void api.saveSettings({ model: t.value as ClaudeModel }).then(s => { state.settings = s; render(); toast(modelLabel(s.model) + ' selected'); });
  if (t.name === 'provider') {
    if (t.value === 'local') state.localFound = null;
    state.ai = { ...state.ai, provider: t.value as AiProvider, connected: false, testing: true };
    void api.saveSettings({ provider: t.value as AiProvider }).then(s => { state.settings = s; return checkAi(false); });
  }
  if (t.id === 'geminiAgreed') void api.saveSettings({ geminiAgreed: t.checked }).then(s => { state.settings = s; return checkAi(false); });
  if (['geminiModel', 'openaiModel', 'openaiBaseUrl', 'agyModel', 'codexModel'].includes(t.id)) {
    void api.saveSettings({ [t.id]: t.value.trim() } as Partial<Settings>).then(s => { state.settings = s; return t.id.startsWith('openai') ? checkAi(false) : renderSettings(); });
  }
  if (t.id === 'autoDailyBudget') void api.saveSettings({ autoDailyBudget: Number(t.value) }).then(s => { state.settings = s; renderAutoState(); });
  if (t.id === 'window') void api.saveSettings({ window: (t.value === 'week' ? 'week' : Number(t.value)) as Settings['window'] }).then(s => { state.settings = s; render(); });
  if (['notifyOn', 'notifyPreview', 'notifyOverdue', 'menuBar'].includes(t.id)) void api.saveSettings({ [t.id]: t.checked } as Partial<Settings>).then(s => { state.settings = s; renderSettings(); });
  if (['notifyPinnedSound', 'notifyOtherSound', 'notifyOthers', 'notifyBadge'].includes(t.id)) void api.saveSettings({ [t.id]: t.value } as Partial<Settings>).then(s => { state.settings = s; renderSettings(); });
  if (t.id === 'notifyRemindMin') void api.saveSettings({ notifyRemindMin: Number(t.value) }).then(s => { state.settings = s; renderSettings(); });
  if (t.id === 'notifyPause' && t.value !== 'keep') {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0);
    const until = t.value === 'tomorrow' ? d.getTime() : t.value === '0' ? 0 : Date.now() + Number(t.value) * 60_000;
    void api.saveSettings({ notifyPausedUntil: until }).then(s => { state.settings = s; renderSettings(); toast(until ? 'Notifications paused' : 'Notifications resumed', 'ok'); });
  }
  if (t.id === 'dbTools') void setDbTools(t.checked);
  if (t.id === 'vcfFile') { void readVcf(t.files?.[0]); t.value = ''; }
  if (t.id === 'ctCountry') void recountry(t.value.trim());
  if (t.dataset.ctphone && state.ct) state.ct.keep[t.dataset.ctphone] = t.value;
  if (t.id === 'autoOn') void api.saveSettings({ autoOn: t.checked }).then(s => { state.settings = s; renderSettings(); toast(s.autoOn ? 'Auto summary on' : 'Auto summary off'); });
  if (['pinEveryMin', 'pinWindow', 'otherEveryMin', 'otherWindow'].includes(t.id)) void api.saveSettings({ [t.id]: Number(t.value) } as Partial<Settings>).then(s => { state.settings = s; renderSettings(); });
  if (t.id === 'aiImages') void api.saveSettings({ aiImages: t.checked }).then(s => { state.settings = s; toast(s.aiImages ? 'The AI will see photos in summaries' : 'Summaries now use text only'); });
  if (t.id === 'openAtLogin') void api.saveSettings({ openAtLogin: t.checked }).then(s => { state.settings = s; toast(s.openAtLogin ? 'WA Turbo opens at login' : 'WA Turbo no longer opens at login'); });
  if (t.id === 'repPreset') syncReportDialog();
  if (t.id === 'loopGroup') { state.loopGroup = t.value; renderLoops(); }
  if (t.id === 'loopType') { state.loopType = t.value; renderLoops(); }
  if (t.id === 'loopAcct') { state.loopAcct = t.value; renderLoops(); }
  if (t.id === 'ptPartner') syncPartnerStage();
  if (t.matches('[data-pick]')) {
    const id = t.dataset.pick!;
    if (t.checked) state.pick.add(id); else state.pick.delete(id);
    syncReportDialog();
  }
});

document.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).id === 'composer' && mentionKey(e)) return;
  if ((e.target as HTMLElement).id === 'composer' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void sendFromComposer(); }
  if ((e.target as HTMLElement).id === 'editBox' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void saveEdit(); }
  if ((e.target as HTMLElement).id === 'editBox' && e.key === 'Escape') { state.editing = null; renderConvoKeepScroll(); return; }
  if (e.key === 'Escape') closeAcctMenu();
  if ((e.target as HTMLElement).id === 'pairName' && e.key === 'Enter') { e.preventDefault(); void pairNext(); }
  if (e.key === 'Escape' && state.panelOpen && !wide.matches && !document.querySelector('dialog[open]')) { state.panelOpen = false; syncPanel(); }
});

// Pasting a photo (a screenshot, a copied image or image file) attaches it, as the paperclip does.
document.addEventListener('paste', e => {
  if ((e.target as HTMLElement).id !== 'composer' || !state.chat) return;
  const dt = e.clipboardData;
  if (!dt) return;
  // Copied cells and rich text often carry a picture of themselves as well; those paste as text.
  if (dt.types.includes('text/html') && dt.getData('text/plain').trim()) return;
  const file = [...dt.items].find(i => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
  if (!file) return;
  e.preventDefault();
  void pastePhoto(file);
});
// The tag list keeps focus in the composer while it is clicked, and closes when the composer loses it.
document.addEventListener('mousedown', e => { if ((e.target as HTMLElement).closest('[data-mention-pick]')) e.preventDefault(); });
document.addEventListener('focusout', e => {
  if ((e.target as HTMLElement).id === 'composer' && state.mention) { state.mention = null; renderMentionPop(); }
});

$('#dlgReport').addEventListener('close', () => { $('#repCustomErr').hidden = true; $('#repPickErr').hidden = true; });
$('#dlgPair').addEventListener('cancel', () => void cancelPair());
$('#dlgConfirm').addEventListener('close', () => { pendingConfirm = null; });
wide.addEventListener('change', () => { state.panelOpen = wide.matches; syncPanel(); });

document.addEventListener('mouseover', e => { const h = (e.target as Element).closest?.('#usageChart .hit'); if (h) showUsageTip(h); });
document.addEventListener('focusin', e => { const h = (e.target as Element).closest?.('#usageChart .hit'); if (h) showUsageTip(h); });
document.addEventListener('mouseout', e => {
  const chart = document.getElementById('usageChart');
  if (chart && (e.target as Element).closest?.('#usageChart') && !chart.contains(e.relatedTarget as Node)) {
    const tip = document.getElementById('usageTip'); if (tip) tip.hidden = true;
    $$('#usageChart .hit').forEach(h => h.classList.remove('on'));
  }
});

/* ============ live updates from the main process ============ */
let chatsTimer: number | undefined;
api.on('accounts', accounts => {
  state.accounts = accounts;
  if (!state.acct && accounts.length) state.acct = accounts[0].id;
  render();
  if (state.view === 'settings') renderLangList();
  if ($<HTMLDialogElement>('#dlgPair').open) renderPair();
});
api.on('chats-changed', () => {
  clearTimeout(chatsTimer);
  chatsTimer = window.setTimeout(async () => {
    await loadChats().catch(() => {});
    const keepChat = state.chat;
    if (state.view === 'inbox') { renderRail(); renderList(); if (keepChat && !state.messages.has(keepChat)) void openChat(keepChat); }
    else renderRail();
  }, 350);
});
api.on('messages', ({ chatId, messages }) => {
  const have = state.messages.get(chatId);
  if (!have) return;
  const ids = new Set(have.map(m => m.id));
  have.push(...messages.filter(m => !ids.has(m.id)));
  have.sort((a, b) => a.at - b.at);
  if (state.chat === chatId && state.view === 'inbox') {
    const th = document.getElementById('thread');
    const atBottom = th ? th.scrollHeight - th.scrollTop - th.clientHeight < 80 : true;
    renderConvo();
    if (!atBottom) { const nth = document.getElementById('thread'); if (nth && th) nth.scrollTop = th.scrollTop; }
    void api.openChat(chatId);
  }
});
// A message here was edited or deleted (by you, on your phone, or by the other side): reload this chat.
api.on('messages-changed', ({ chatId }) => {
  const have = state.messages.get(chatId);
  if (!have) return;
  void loadMessages(chatId, Math.max(PAGE, have.length)).then(() => {
    if (state.chat === chatId && state.view === 'inbox') renderConvoKeepScroll();
  }).catch(() => {});
});
api.on('loops-changed', loops => { state.loops = loops; render(); });
// A notification or the menu bar asked for this chat.
api.on('open-chat', ({ chatId, messageId }) => {
  if (!chatById(chatId)) return;
  if (messageId) void jumpToCitation(chatId, messageId);
  else { setView('inbox'); void openChat(chatId); }
});
// A pinned chat got a message while you're in WA Turbo on another chat.
api.on('notify', p => {
  if (state.view === 'inbox' && state.chat === p.chatId) return;
  toast(p.title + ': ' + p.body, undefined, { label: 'Open', run: () => void jumpToCitation(p.chatId, p.messageId) });
});
api.on('settings', s => { state.settings = s; if (state.view === 'settings') renderSettings(); });
// An auto run refreshed a pinned chat: show it if that chat is open and you are not running one yourself.
api.on('summary', s => {
  if (state.chat === s.chatId && !(state.summary.chatId === s.chatId && state.summary.running)) {
    state.summary = { chatId: s.chatId, running: false, progress: null, result: s, error: null };
    if (state.view === 'inbox') renderPanel();
  }
});
api.on('auto', a => { state.auto = a; if (state.view === 'settings') renderAutoState(); });
api.on('pair', p => {
  const wasLinked = state.pair.phase === 'linked';
  state.pair = p;
  if ($<HTMLDialogElement>('#dlgPair').open) renderPair();
  if (p.phase === 'linked' && !wasLinked) { toast((acctById(p.accountId)?.name ?? 'Number') + ' linked', 'ok'); state.acct = p.accountId; }
});
api.on('progress', p => {
  if (p.kind === 'summary' && state.summary.running && state.summary.chatId === p.chatId) { state.summary.progress = p; if (state.view === 'inbox') renderPanel(); }
  if (p.kind === 'report' && state.gen) { state.gen = p; if (state.view === 'reports') renderReportDoc(); }
});
api.on('partners', p => { state.partners = p; });

/* ============ boot ============ */
async function refreshAll(): Promise<void> {
  const b = await api.bootstrap();
  state.accounts = b.accounts; state.partners = b.partners; state.settings = b.settings; state.ai = b.ai;
  void api.autoStatus().then(a => { state.auto = a; renderAutoState(); }).catch(() => {});
  await loadChats();
  state.loops = await api.listLoops();
  state.team = await api.listTeam();
  render();
}

async function bootDb(call: () => Promise<Awaited<ReturnType<Bridge['bootstrap']>>>): Promise<void> {
  const btn = document.getElementById('dbRetry') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  const b = await call().catch(e => ({ dbOk: false, dbError: e instanceof Error ? e.message : String(e) }) as Awaited<ReturnType<Bridge['bootstrap']>>);
  if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
  $('#dbScreen').hidden = b.dbOk;
  if (!b.dbOk) {
    const [first, ...log] = (b.dbError ?? "WA Turbo's database isn't answering.").split('\n');
    const lead = /didn't start\.?$/.test(first) ? '' : first + ' ';
    $('#dbError').textContent = lead + 'Your chats are kept in a database built into WA Turbo, on ' + HERE + '. Try again, or send the lines below to whoever set WA Turbo up for you.';
    $('#dbLog').textContent = log.join('\n');
    $('#dbLog').hidden = !log.length;
    return;
  }
  await refreshAll();
  if (state.acct) {
    const first = visibleChats()[0];
    if (first && !state.chat) void openChat(first.id);
  }
}

// On Windows the static copy is reworded once at startup (platform.ts), the sounds are the ones Windows
// offers, and the database-tools switch goes: there the database always listens on 127.0.0.1.
function windowsShell(): void {
  document.documentElement.classList.add('win');
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = toWindows(n.nodeValue ?? '');
    if (t !== n.nodeValue) n.nodeValue = t;
  }
  for (const id of ['notifyPinnedSound', 'notifyOtherSound']) {
    $<HTMLSelectElement>('#' + id).innerHTML = WIN_SOUNDS.map(s => '<option value="' + s + '">' + WIN_SOUND_LABEL[s] + '</option>').join('');
  }
  $('#dbTools').closest('label')!.hidden = true;
}

(function init() {
  // Windows wording first, so the translator below reads (and translates) the Windows text.
  if (IS_WIN) windowsShell();
  startTranslating();
  onThemeChange(() => { reportUi(); if (state.view === 'settings') renderAppearance(); });
  reportUi();
  document.documentElement.dataset.ready = '';
  // A language switch reloads the window; come back to the tab it was switched from.
  try {
    const v = sessionStorage.getItem('wat.view');
    sessionStorage.removeItem('wat.view');
    if (v === 'settings' || v === 'loops' || v === 'reports') state.view = v;
  } catch { /* start on the inbox */ }
  $$('.chip[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter)));
  render();
  void bootDb(() => api.bootstrap());
  // SLA clocks move on their own; redraw the tracker and strips once a minute.
  setInterval(() => {
    renderRail();
    if (state.view === 'loops') renderLoops();
    const over = openLoops().filter(l => sla(l) === 'over').length;
    $('#segLoops').textContent = String(over);
    $('#segLoops').hidden = over === 0;
  }, 60_000);
})();

// A .vcf dropped on the Contacts card opens the import.
document.addEventListener('dragover', e => {
  const drop = (e.target as HTMLElement).closest?.('#vcfDrop');
  if (drop) { e.preventDefault(); drop.classList.add('over'); }
});
document.addEventListener('dragleave', e => { (e.target as HTMLElement).closest?.('#vcfDrop')?.classList.remove('over'); });
document.addEventListener('drop', e => {
  const drop = (e.target as HTMLElement).closest?.('#vcfDrop');
  e.preventDefault();
  if (!drop) return;
  drop.classList.remove('over');
  void readVcf(e.dataTransfer?.files[0]);
});
