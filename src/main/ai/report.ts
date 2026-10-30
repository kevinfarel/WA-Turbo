import type { ChatInsight, Message, ModelId, PresetId, Report } from '@shared/types';
import { fmtDur, loopAge, loopPending, loopSla, SLA_ORDER } from '@shared/sla';
import { PRESETS } from '@shared/presets';
import {
  addAliases, cachedSummary, chatMeta, chatRev, listAccounts, listAliases, listLoops, messagesSince, saveReport, saveSummary, setSummarized,
} from '../db/queries';
import { MODEL_NAMES, structured } from './client';
import { stamp, transcript } from './context';
import { CUSTOM_SYSTEM, PRESET_FOCUS, SYNTH_SYSTEM } from './prompts';
import { AliasBook, redact, restore } from './redact';
import { SynthesisOut } from './schemas';
import { analyzeChat, stepper, type Progress } from './summarize';
import { resolveLoops } from '../loops/service';

const RANGE_LABEL = { '1': 'last 24 hours', '7': 'last 7 days', '30': 'last 30 days' } as const;
const RISK_ORDER = { high: 0, watch: 1, low: 2 } as const;
const RAW_BUDGET_CHARS = 450_000; // about 150k tokens of transcript for a custom brief

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export async function generateReport(
  presetId: PresetId, days: Report['days'], chatIds: string[], custom: string, model: ModelId, runId: string, emit: Progress, signal?: AbortSignal,
): Promise<Report> {
  const s = stepper(runId, 'report', null, [
    `Reading text from ${chatIds.length} chat${chatIds.length === 1 ? '' : 's'}`, 'Redacting phone numbers', `${MODEL_NAMES[model]} is summarizing`, 'Assembling the report',
  ], emit);
  const since = Date.now() - Number(days) * 24 * 3_600_000;
  const now = Date.now();

  const chats = (await Promise.all(chatIds.map(async id => ({ id, meta: await chatMeta(id), msgs: await messagesSince(id, since) }))))
    .filter(c => c.meta && c.msgs.length) as { id: string; meta: NonNullable<Awaited<ReturnType<typeof chatMeta>>>; msgs: Message[] }[];
  s.next();
  s.next();

  // Per-chat briefs: reuse the saved summary when nothing newer has arrived and it covered this window.
  const insights: Record<string, ChatInsight> = {};
  await pool(chats, 3, async c => {
    const key = 'days:' + days;
    const rev = await chatRev(c.id);
    const prev = await cachedSummary(c.id, model, key, rev);
    if (prev) { insights[c.id] = prev.insight; return; }
    const run = await analyzeChat(c.id, c.msgs, model, signal);
    insights[c.id] = run.insight;
    await saveSummary({ chatId: c.id, model, createdAt: Date.now(), msgCount: run.msgCount, insight: run.insight, windowKey: key, auto: false }, c.msgs.length, run.lastMsgId, rev);
    await resolveLoops(c.id);
  });

  const picked = chats
    .filter(c => insights[c.id])
    .sort((a, b) => (RISK_ORDER[insights[a.id].status.risk] - RISK_ORDER[insights[b.id].status.risk]) || (b.msgs.at(-1)!.at - a.msgs.at(-1)!.at));
  const ids = picked.map(c => c.id);

  const loops = (await listLoops())
    .filter(l => l.state === 'open' && ids.includes(l.chatId))
    .sort((a, b) => (SLA_ORDER[loopSla(a, now)] - SLA_ORDER[loopSla(b, now)]) || (loopPending(b, now) - loopPending(a, now)));
  const owed = loops.filter(l => l.dir === 'owed');
  const waiting = loops.filter(l => l.dir === 'waiting');
  const overdue = loops.filter(l => loopSla(l, now) === 'over');
  const longestH = loops.length ? Math.max(...loops.map(l => loopAge(l, now))) : 0;
  const msgCount = picked.reduce((n, c) => n + c.msgs.length, 0);
  const actions = picked.reduce((n, c) => n + insights[c.id].actions.length, 0);
  const questions = picked.reduce((n, c) => n + insights[c.id].questions.length, 0);

  const accounts = await listAccounts();
  const acctNames = [...new Set(picked.map(c => c.meta.account_id))].map(id => accounts.find(a => a.id === id)?.name ?? '');

  let overview = '';
  if (picked.length && presetId === 'debt') {
    const neverChased = waiting.filter(l => !l.nudges.length).length;
    overview = `${loops.length} open loop${loops.length === 1 ? '' : 's'} across ${picked.length} conversation${picked.length === 1 ? '' : 's'}: ` +
      `${owed.length} waiting on your reply, ${waiting.length} waiting on the other side, ${overdue.length} past SLA. ` +
      (longestH ? `The oldest has been open for ${fmtDur(longestH)}. ` : '') +
      (neverChased ? `${neverChased} of the items you are waiting on have never been chased.` : 'Everything you are waiting on has been chased at least once.');
  } else if (picked.length) {
    const book = new AliasBook(await listAliases());
    let user: string;
    let system: string;
    if (presetId === 'custom') {
      system = CUSTOM_SYSTEM;
      const raw = picked.map(c => transcript(c.meta.name, '', c.msgs, book.aliasFor)).join('\n\n---\n\n');
      const material = raw.length <= RAW_BUDGET_CHARS ? raw : redact(JSON.stringify(picked.map(c => ({ chat: c.meta.name, brief: insights[c.id] }))), book.aliasFor);
      user = `Now: ${stamp(now)}\nWindow: ${RANGE_LABEL[days]}\n\nQuestion: ${redact(custom, book.aliasFor)}\n\n${material}`;
    } else {
      system = SYNTH_SYSTEM;
      const briefs = picked.map(c => ({ chat: c.meta.name, number: accounts.find(a => a.id === c.meta.account_id)?.name, messages: c.msgs.length, brief: insights[c.id] }));
      user = `Now: ${stamp(now)}\nWindow: ${RANGE_LABEL[days]}\nReport type: ${PRESETS.find(p => p.id === presetId)?.name}. ${PRESET_FOCUS[presetId]}\n\n` +
        redact(JSON.stringify(briefs, null, 1), book.aliasFor);
    }
    await addAliases(book.added);
    const out = await structured({ kind: 'report', model, system, user, schema: SynthesisOut, effort: 'high', signal });
    overview = restore(out.overview, book.displayMap());
  }
  s.next();

  const preset = PRESETS.find(p => p.id === presetId) ?? PRESETS[0];
  const report = await saveReport({
    presetId: preset.id,
    title: `${preset.name} — ${acctNames.slice(0, 2).join(' + ')}${acctNames.length > 2 ? ' +' + (acctNames.length - 2) : ''}`,
    days, custom, model, chatIds: ids, overview, loopIds: loops.map(l => l.id),
    insights: Object.fromEntries(ids.map(id => [id, insights[id]])),
    stats: { chats: picked.length, msgs: msgCount, actions, questions, owed: owed.length, waiting: waiting.length, overdue: overdue.length, longestH },
  });
  await setSummarized(ids);
  s.next();
  return report;
}
