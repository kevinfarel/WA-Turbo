import type { Loop, Message, MessageType } from '@shared/types';
import { redact, type AliasFor } from './redact';

// Builds the text that leaves the Mac: message text and captions. Photos the run attaches are
// marked as such and sent alongside as images; every other file or voice note is a placeholder.

const PLACEHOLDER: Partial<Record<MessageType, string>> = {
  image: '[photo, not available to AI]',
  video: '[video, not read by AI]',
  audio: '[voice note, not read by AI]',
  document: '[document, not read by AI]',
  sticker: '[sticker]',
  location: '[location, not read by AI]',
  contact: '[contact card, not read by AI]',
};

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

export function stamp(t: number): string {
  const d = new Date(t);
  return DAY.format(d).replace(',', '') + ' ' + TIME.format(d);
}

export function lineOf(m: Message, aliasFor: AliasFor, attached?: Set<string>): string {
  const who = m.who === 'me' ? 'You' : m.team ? m.who + ' (your team)' : m.who;
  const ph = attached?.has(m.id) ? `[photo, attached above as "Photo [#${m.id}]"]` : PLACEHOLDER[m.type];
  const body = [ph, m.text].filter(Boolean).join(' ');
  return `[#${m.id}] ${stamp(m.at)} · ${redact(who, aliasFor)}: ${redact(body || '[empty]', aliasFor)}`;
}

export function transcript(chatName: string, org: string, messages: Message[], aliasFor: AliasFor, attached?: Set<string>): string {
  const head = `Conversation: ${redact(chatName, aliasFor)}${org ? ' (' + redact(org, aliasFor) + ')' : ''}`;
  return [head, '', ...messages.map(m => lineOf(m, aliasFor, attached))].join('\n');
}

export function openLoopsBlock(loops: Loop[], aliasFor: AliasFor): string {
  const open = loops.filter(l => l.state === 'open');
  if (!open.length) return 'Open loops: none.';
  return ['Open loops:', ...open.map(l =>
    `- loop ${l.id} · ${l.dir === 'owed' ? 'You owe' : 'Waiting on them'} · ${l.kind} · asked by ${redact(l.askedBy, aliasFor)}` +
    `${l.msgId ? ' at [#' + l.msgId + ']' : ''} · ${l.source === 'rule' ? 'auto-detected' : l.source === 'ai' ? 'found by AI' : 'flagged by You'} · "${redact(l.topic, aliasFor)}"`)].join('\n');
}

export const textOnly = (messages: Message[]): Message[] => messages.filter(m => m.type !== 'system');
