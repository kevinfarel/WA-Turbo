import type { ChatInsight, Loop, Message, ModelId, RunProgress, SummaryResult, SummaryWindow } from '@shared/types';
import { EMPTY_WEEK } from '@shared/presets';
import { weekStart, ymd } from '@shared/week';
import {
  addAliases, cachedSummary, chatMeta, chatRev, createLoop, getSettings, messagesSinceCapped, getMessages, lastMessageId, listAliases, loopsForChat, reviewLoop, saveSummary, setLoopState, setSummarized,
} from '../db/queries';
import { MODEL_NAMES, structured, type AiImage } from './client';
import { imageForAi } from '../media';
import { resolveLoops } from '../loops/service';
import { openLoopsBlock, stamp, transcript } from './context';
import { CHAT_SYSTEM } from './prompts';
import { AliasBook, restore } from './redact';
import { ChatInsightOut } from './schemas';

export type Progress = (p: RunProgress) => void;

export function stepper(runId: string, kind: RunProgress['kind'], chatId: string | null, labels: string[], emit: Progress) {
  let at = 0;
  const send = () => emit({ runId, kind, chatId, steps: labels.map((label, i) => ({ label, state: i < at ? 'done' : i === at ? 'run' : 'wait' })) });
  send();
  return { next: () => { at++; send(); }, label: (i: number, l: string) => { labels[i] = l; send(); } };
}

export const MAX_PHOTOS = 10;

/** The most recent photos in the window, when AI setup lets Claude see them. Unreadable ones stay placeholders. */
async function photosFor(messages: Message[]): Promise<(AiImage & { msgId: string })[]> {
  if (!(await getSettings()).aiImages) return [];
  const photos = messages.filter(m => m.type === 'image' && m.media).slice(-MAX_PHOTOS);
  const out = await Promise.all(photos.map(async m => {
    const img = await imageForAi(Number(m.id), `Photo [#${m.id}]` + (m.text ? ' (caption in the transcript)' : '') + ':');
    return img ? { ...img, msgId: m.id } : null;
  }));
  return out.filter((x): x is AiImage & { msgId: string } => x !== null);
}

export interface ChatRun {
  insight: ChatInsight;
  msgCount: number;
  lastMsgId: number | null;
}

/** Reads one chat window, asks Claude for the brief, and merges what it found into the loops table. */
export async function analyzeChat(chatId: string, messages: Message[], model: ModelId, signal: AbortSignal | undefined, onRedacted?: () => void, onSent?: () => void, kind = 'summary'): Promise<ChatRun> {
  const chat = await chatMeta(chatId);
  if (!chat) throw new Error('That chat no longer exists.');
  const book = new AliasBook(await listAliases());
  // Claude reviews only loops whose message it can see; a short window can't judge older ones.
  const inWindow = new Set(messages.map(m => m.id));
  const loops = (await loopsForChat(chatId)).filter(l => l.msgId !== null && inWindow.has(l.msgId));
  const images = await photosFor(messages);
  const text = transcript(chat.name, '', messages, book.aliasFor, new Set(images.map(i => i.msgId)));
  const loopText = openLoopsBlock(loops, book.aliasFor);
  await addAliases(book.added);
  onRedacted?.();

  const user = `Now: ${stamp(Date.now())}\n\n${loopText}\n\n${text}`;
  onSent?.();
  const out = await structured({ kind, model, system: CHAT_SYSTEM, user, images, schema: ChatInsightOut, effort: 'medium', signal, chatId });

  const display = book.displayMap();
  // Citations live in the cite fields; [#id] markers in prose would show up as raw text.
  const r = (s: string) => restore(s, display).replace(/\s*\(?\[#\d+\]\)?/g, '');
  const ids = new Set(messages.map(m => Number(m.id)));
  const valid = (c: number | null) => (c !== null && ids.has(c) ? c : null);

  const insight: ChatInsight = {
    summary: r(out.summary),
    highlights: out.highlights.map(r),
    actions: out.actions.map(a => ({ t: r(a.text), owner: r(a.owner), due: a.due, cite: valid(a.cite) === null ? null : String(a.cite) })),
    decisions: out.decisions.map(r),
    questions: out.questions.map(r),
    status: { stage: r(out.status.stage), risk: out.status.risk, next: r(out.status.next) },
  };

  await mergeLoops(chatId, chat.partner_id, loops, out, messages, valid, r);
  return { insight, msgCount: messages.length, lastMsgId: await lastMessageId(chatId) };
}

async function mergeLoops(
  chatId: string, partner: string | null, existing: Loop[], out: ChatInsightOut, messages: Message[],
  valid: (c: number | null) => number | null, r: (s: string) => string,
): Promise<void> {
  const byId = new Map(existing.map(l => [l.id, l]));
  for (const rv of out.loop_reviews) {
    const l = byId.get(String(rv.loop_id));
    if (!l || l.state !== 'open') continue;
    if (rv.verdict === 'not_a_loop') {
      // Claude may dismiss what a rule created, never what you flagged.
      if (l.source === 'rule') await setLoopState(l.id, 'dismissed');
      continue;
    }
    await reviewLoop(l.id, {
      topic: l.source === 'rule' && rv.topic ? r(rv.topic) : null,
      blocks: rv.blocks ? r(rv.blocks) : null,
      aiHint: rv.verdict === 'likely_answered' ? r(rv.reason || 'Claude thinks a later message answered this.') : null,
    });
  }
  const anchored = new Set(existing.map(l => `${l.msgId}|${l.dir}`));
  for (const nl of out.loops) {
    const cite = valid(nl.cite);
    if (cite === null || anchored.has(`${cite}|${nl.dir}`)) continue;
    const m = messages.find(x => Number(x.id) === cite)!;
    // Your team's asks wait on the other party, whatever Claude labelled them.
    const dir = m.team && nl.dir === 'owed' ? 'waiting' : nl.dir;
    if (dir !== nl.dir && anchored.has(`${cite}|${dir}`)) continue;
    await createLoop({
      chatId, messageId: String(cite), dir, kind: nl.kind, source: 'ai', topic: r(nl.topic),
      askedBy: m.who === 'me' ? 'You' : m.team ? `${m.who} (Team)` : partner ? `${m.who} (${partner})` : m.who, askedAt: m.at,
      slaH: dir === 'owed' ? 24 : 48, blocks: nl.blocks ? r(nl.blocks) : null,
    });
  }
}

export const WEEK_CAP = 300;

/** What one run reads, and the cache key for it. */
export async function readWindow(chatId: string, w: SummaryWindow | { auto: number }): Promise<{ key: string; size: number; messages: Message[]; skipped: number }> {
  if (typeof w === 'object') return { key: 'auto:' + w.auto, size: w.auto, messages: await getMessages(chatId, w.auto), skipped: 0 };
  if (w === 'week') {
    const start = weekStart();
    const r = await messagesSinceCapped(chatId, start.getTime(), WEEK_CAP);
    return { key: 'week:' + ymd(start), size: WEEK_CAP, ...r };
  }
  return { key: 'n:' + w, size: w, messages: await getMessages(chatId, w), skipped: 0 };
}

export interface SummarizeOpts { window: SummaryWindow | { auto: number }; force?: boolean; auto?: boolean; save?: boolean }

/**
 * Summarizes one chat, unless the cache already holds a summary of this exact chat revision read
 * with the same model and window: then that one comes back with cached: true and Claude is not called.
 */
export async function summarizeChat(chatId: string, model: ModelId, opts: SummarizeOpts, runId: string, emit: Progress, signal?: AbortSignal): Promise<SummaryResult> {
  const rev = await chatRev(chatId);
  const win = await readWindow(chatId, opts.window);
  if (!opts.force) {
    const hit = await cachedSummary(chatId, model, win.key, rev);
    if (hit) return { ...hit, cached: true };
  }
  const { messages } = win;
  if (!messages.length) throw new Error(opts.window === 'week' ? EMPTY_WEEK : 'This chat has no messages yet.');
  const s = stepper(runId, 'summary', chatId, [
    `Reading text from ${messages.length} messages`, 'Redacting phone numbers', 'Checking open loops', `${MODEL_NAMES[model]} is summarizing`, 'Formatting the summary',
  ], emit);
  s.next();
  const run = await analyzeChat(chatId, messages, model, signal, () => s.next(), () => { s.next(); s.next(); }, opts.auto ? 'auto' : 'summary');
  s.next();
  const result: SummaryResult = { chatId, model, createdAt: Date.now(), msgCount: run.msgCount, insight: run.insight, windowKey: win.key, auto: !!opts.auto, skipped: win.skipped };
  if (opts.save !== false) {
    await saveSummary(result, win.size, run.lastMsgId, rev);
    if (!opts.auto) await setSummarized([chatId]);
  }
  await resolveLoops(chatId);
  return result;
}
