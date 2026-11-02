import type { PresetId } from './types';

export const PRESETS: { id: PresetId; name: string; blurb: string }[] = [
  { id: 'digest', name: 'Daily digest', blurb: 'Narrative summary, highlights, actions and open questions.' },
  { id: 'actions', name: 'Action items', blurb: 'Only commitments, with owner and due date.' },
  { id: 'decisions', name: 'Decisions made', blurb: 'What was agreed, and what is still open.' },
  { id: 'client', name: 'Client status board', blurb: 'One status line per conversation with a risk flag.' },
  { id: 'debt', name: 'Reply debt', blurb: 'Who owes whom, how long it has waited, and what is past SLA.' },
  { id: 'custom', name: 'Custom brief', blurb: 'Your own prompt, run over the selected chats.' },
];

/** Summarize on "This week" with nothing since Monday 00:00; the panel offers the last 50 instead. */
export const EMPTY_WEEK = 'No messages since Monday.';

