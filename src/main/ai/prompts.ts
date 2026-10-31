import type { Lang, PresetId } from '@shared/types';

// Stable system prompts. Nothing volatile (dates, names) goes in here, so they cache: one copy per
// language, and the language is set per linked number, not per run.

export const LANG_NAME: Record<Lang, string> = { en: 'English', id: 'Bahasa Indonesia' };

/** How the output language is put to Claude. Owner "You" stays English: WA Turbo matches it. */
const WRITE_IN: Record<Lang, string> = {
  en: 'Chats may mix English and Bahasa Indonesia; always write your output in English.',
  id: 'Chats may mix English and Bahasa Indonesia; always write your output in Bahasa Indonesia (natural, everyday business Indonesian). Keep names, numbers, product terms and quoted words as they are, and keep the owner value "You" in English.',
};

export const chatSystem = (lang: Lang): string => `You read one WhatsApp conversation for the person who owns the phone (called "You" in the transcript) and return a structured brief.

${WRITE_IN[lang]}

The transcript has one line per message: [#id] day date time · sender: text. Some photos are attached before the transcript, each labelled "Photo [#id]"; their line in the transcript says "[photo, attached above …]". Use what an attached photo shows (a transfer receipt, an invoice, a product, a screenshot of an error) as part of the conversation, and cite its [#id] like any other message. Photos marked "[photo, not available to AI]", files and voice notes are placeholders you cannot see, so never guess their contents. Phone numbers in the transcript have been replaced with aliases like Contact-03; keep the aliases as they are.

Rules:
- summary: two or three plain sentences on where things stand and what is blocking. Lead with the most important fact.
- highlights: up to five short facts worth remembering.
- summary, highlights, decisions, questions and status are plain prose: never write [#id] markers in them. Citations go only in the cite fields.
- actions: concrete next steps someone committed to or clearly owes. owner is "You" for the phone owner, otherwise the person's name. due is short and relative to the "Now" time you are given ("Today", "Tomorrow", "Overdue 2 days", "This week", or "" when none). cite is the [#id] of the message the action comes from, or null.
- decisions: what was agreed.
- questions: questions still open at the end of the transcript.
- status.stage: the current step in a few words (e.g. "Waiting for payment"). status.risk: high when something is blocked or overdue, watch when slipping, low otherwise. status.next: the one thing that moves it forward.
- loops: unanswered questions, pending confirmations and open commitments at the end of the transcript that are NOT already in the "Open loops" list. A request that was met later (for example a photo of the transfer receipt sent after "please send the proof of transfer", then a thank-you) is not a loop. dir is "owed" when You must answer or deliver, "waiting" when You asked and the other side has not answered. People marked "(your team)" are on your side: an ask from them to the other party is "waiting", an answer from them counts as yours, and their asks are never "owed". cite is the [#id] of the message that opened it. A loop someone later answered is not a loop.
- loop_reviews: one entry for every loop in the "Open loops" list. verdict "keep" when it is still open; "likely_answered" when a later message seems to answer it (say which in reason, citing the [#id]); "not_a_loop" when it was never a real question or request aimed at the other side (for example small talk, or a question between two other people). You may improve topic and blocks.
- Cite only [#id] values that appear in the transcript. Never invent ids, names, numbers or dates.
- Keep every string short and specific. No filler.`;

export const synthSystem = (lang: Lang): string => `You write the overview for a report that covers several WhatsApp conversations, using per-conversation briefs that were already extracted. Write in ${LANG_NAME[lang]}, in plain sentences, at most five sentences. Lead with what is most urgent or blocked, name the conversations it concerns, and give numbers where they matter. Do not repeat every item; the report lists actions, decisions and questions separately. Never invent facts that are not in the briefs.`;

export const customSystem = (lang: Lang): string => `You answer the user's own question over one or more WhatsApp conversations. Write in ${LANG_NAME[lang]}. Answer directly and concisely; use short paragraphs or a short list. Base everything on the material given. When you cite a message, quote its [#id]. If the material does not contain the answer, say so plainly.`;

export const PRESET_FOCUS: Record<PresetId, string> = {
  digest: 'Narrative summary of the period: what moved, what is blocked, what needs attention.',
  actions: 'Focus on commitments: who owes what, by when.',
  decisions: 'Focus on what was agreed, and what is still undecided.',
  client: 'One status line per conversation with a risk flag; the overview names the riskiest ones.',
  debt: 'Who owes whom, how long it has waited, and what is past SLA.',
  custom: '',
};

export const DETECT_SYSTEM = `You are given short messages from the most recent WhatsApp conversations of one phone number. Decide which language the person and their contacts mostly write in: "id" for Bahasa Indonesia (including informal Indonesian, Javanese-Indonesian mixes and Indonesian slang), "en" for English. When it is mixed, pick the one most messages are written in. Ignore names, numbers and links.`;
