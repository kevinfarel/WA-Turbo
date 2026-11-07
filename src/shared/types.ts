// Domain types shared by the main process and the window. Times are epoch milliseconds.

export type AccountStatus = 'pairing' | 'online' | 'reconnecting' | 'logged_out';
export type Accent = 'green' | 'blue' | 'amber' | 'violet' | 'cyan';
/** The languages WA Turbo speaks: the app itself, and what the AI writes for a number. */
export type Lang = 'en' | 'id';
export type ThemeMode = 'light' | 'dark' | 'system';
/** What the window tells the main process about how it looks: language, light/dark, and the colours of the theme in use. */
export interface UiPrefs { lang: Lang; mode: ThemeMode; dark: boolean; bg: string; titlebar: string; titlebarText: string }

export interface Account {
  id: string;
  name: string;
  desc: string;
  phone: string;
  accent: Accent;
  status: AccountStatus;
  pairedAt: number | null;
  /** What the AI writes in for this number; null until picked or detected from its chats. */
  lang: Lang | null;
  /** True when lang was detected from the chats rather than picked. */
  langDetected: boolean;
  /** Words this number must never mention. */
  restricted: RestrictedRule;
}

/** A number's restricted words. hard = no Send anyway. */
export interface RestrictedRule { on: boolean; hard: boolean; words: string[] }

/** What became of a send or an edit: it went out, or the restricted words check held it back. */
export type SendOutcome =
  | { sent: true; aiSkipped: boolean }
  | { sent: false; number: string; words: string[]; by: 'exact' | 'ai'; hard: boolean; /** Set when only the attachment's name matched. */ file?: string };

export type ChatKind = 'dm' | 'group';

export interface ChatSummaryRow {
  id: string;
  acct: string;
  name: string;
  org: string;
  kind: ChatKind;
  unread: number;
  partner: string | null;
  service: string | null;
  stage: string | null;
  lastAt: number;
  lastWho: string;
  lastText: string;
  msgCount: number;
  summarizedAt: number | null;
  pinned: boolean;
  /** The latest saved summary: when, whether the scheduler made it, and messages since. */
  lastSumAt: number | null;
  lastSumAuto: boolean;
  newSince: number;
  /** When auto summary last looked at this chat (unpinned chats update loops only). */
  autoCheckedAt: number | null;
  /** Notifications muted in WA Turbo until this time (Infinity = until unmuted). Null = not muted. */
  mutedUntil: number | null;
}

export type MessageType =
  | 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker'
  | 'location' | 'contact' | 'system' | 'other';

export interface Message {
  id: string;
  chatId: string;
  who: string; // 'me' for own messages, otherwise the sender's display name
  at: number;
  type: MessageType;
  text: string; // message text or caption
  media: { mime: string; fileName: string | null; hasThumb: boolean } | null;
  edited: boolean;
  /** Sent by someone you marked as your team. */
  team?: boolean;
  /** People tagged in the text: "@<number>" as written → the name to show ('You' for you). */
  mentions?: Record<string, string>;
}

/** Someone in a group you can tag with @ in the composer. */
export interface GroupMember { jid: string; name: string; phone: string }

export type LoopDir = 'owed' | 'waiting';
export type LoopKind = 'question' | 'confirmation' | 'commitment';
export type LoopState = 'open' | 'answered' | 'snoozed' | 'dismissed';
export type LoopSource = 'manual' | 'rule' | 'ai';

export interface Loop {
  id: string;
  chatId: string;
  msgId: string | null;
  dir: LoopDir;
  kind: LoopKind;
  state: LoopState;
  source: LoopSource;
  topic: string;
  askedBy: string;
  askedAt: number;
  slaH: number;
  blocks: string | null;
  snoozeNote: string | null;
  answeredAt: number | null;
  nudges: number[]; // times of your own follow-ups, newest first
  chases: number; // follow-ups from the other side (counted, do not restart the clock)
  aiHint: string | null; // e.g. the AI thinks this was answered
  closeNote: string | null; // why the rules closed it on their own
}

/** Whatever you call them: Customer, Supplier, Agency… (empty when not set). */
export type PartnerType = string;

export interface Partner {
  id: string;
  type: PartnerType;
  service: string;
  steps: string[];
  at: number;
}

export type ClaudeModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';
/** A Claude model, or "<provider>:<model>" for the other providers (shared/ai.ts). */
export type ModelId = string;

/**
 * How WA Turbo reaches an AI: the Claude Code login (the person's Claude plan), an Anthropic API key, the engine
 * person's own Ollama models (local), a Gemini or DeepSeek key, any OpenAI-compatible service, or the Antigravity and Codex CLIs.
 */
export type AiProvider = 'claude-code' | 'api' | 'local' | 'gemini' | 'deepseek' | 'openai' | 'antigravity' | 'codex';

/** What the Summarize button reads: this week (Monday 00:00 to now, newest 300 at most) or a fixed count. */
export type SummaryWindow = 'week' | 50 | 100 | 300;

/** The word lists behind the local loop rules, as named in Settings → SUM UP! rules. */
export type RuleGroupId = 'ask' | 'myAsk' | 'promise' | 'followUp' | 'ignore' | 'thanks' | 'okay' | 'defer';
/** Changes to one list: built-in terms switched off (by label), and terms the person added. */
export interface RuleEdits { off?: string[]; add?: string[] }
export type LoopRules = Partial<Record<RuleGroupId, RuleEdits>>;

export interface Settings {
  provider: AiProvider;
  /** The Claude model, used by the Claude Code login and the API key. */
  model: ClaudeModel;
  /** Each other provider's model; empty means that provider's own default. */
  localModel: string;
  geminiModel: string;
  deepseekModel: string;
  openaiModel: string;
  /** OpenAI-compatible: the service's base URL, e.g. https://api.groq.com/openai/v1. */
  openaiBaseUrl: string;
  agyModel: string;
  codexModel: string;
  /** The person accepted that Google may use messages sent with a free Gemini key to improve its products. */
  geminiAgreed: boolean;
  /** The person accepted that messages go to DeepSeek, in China, under its data terms. */
  deepseekAgreed: boolean;
  /** Gemini and Antigravity: auto summary stops after this many runs a day (0 = no limit). */
  autoDailyBudget: number;
  window: SummaryWindow;
  customPrompt: string;
  openAtLogin: boolean;
  /** Let the AI see photos in the chat (the most recent 10 per chat) when summarizing. */
  aiImages: boolean;
  /** Auto summary: pinned chats every pinEveryMin from their last pinWindow messages; others likewise (0 = off). */
  autoOn: boolean;
  pinEveryMin: number;
  pinWindow: number;
  otherEveryMin: number;
  otherWindow: number;
  /** Notifications. Pinned chats: every message, their own sound, Dock bounce and a reminder when left unread. */
  notifyOn: boolean;
  notifyPinnedSound: string;
  /** Minutes before a pinned chat left unread gets one reminder (0 = off). */
  notifyRemindMin: number;
  /** Other chats: 'direct' = direct chats plus group mentions and replies to you. */
  notifyOthers: NotifyOthers;
  notifyOtherSound: string;
  notifyPreview: boolean;
  notifyBadge: NotifyBadge;
  /** Notify when a pinned chat has waited past its SLA for your reply. */
  notifyOverdue: boolean;
  /** Menu bar icon; its number counts pinned chats waiting too long for your reply. */
  menuBar: boolean;
  /** All banners paused until this time (epoch ms, 0 = not paused). */
  notifyPausedUntil: number;
  /** Calling code for local numbers in imported contacts ("0812…" → +62 812…). Empty = guess from the linked number. */
  contactsCountry: string;
  /** Changes to the local loop rules. Empty means the built-in rules exactly as shipped. */
  loopRules: LoopRules;
}

/** Where a name in the contacts import came from: the file, an earlier import, or the phone that owns the number (via WhatsApp). */
export type ContactSource = 'file' | 'import' | 'phone';
export interface ContactOption { name: string; from: ContactSource[] }
/** A number with more than one contact name; the person picks which one WA Turbo keeps. */
export interface ContactDuplicate { phone: string; display: string; chat: string | null; options: ContactOption[]; keep: string }
export interface ContactImportPreview {
  token: string; fileName: string; countryCode: string;
  cards: number; numbers: number; added: number; unchanged: number; skipped: number;
  duplicates: ContactDuplicate[];
}
export interface ContactImportResult { saved: number; kept: number; renamedChats: number }
export interface ContactsInfo { count: number; updatedAt: number | null; countryCode: string }

/** AI tokens for one hour and one number (acct null = report overviews across numbers). */
export interface UsageBucket { hour: number; acct: string | null; input: number; output: number; cacheRead: number; cacheWrite: number; runs: number }

/** Someone on your side in group chats. */
export interface TeamMember { id: string; name: string; phones: string[]; addedAt: number }

export type NotifyOthers = 'all' | 'direct' | 'mentions' | 'off';
export type NotifyBadge = 'chats' | 'messages' | 'pinned' | 'off';

/** A pinned chat that has waited past its SLA for your reply (menu bar list). */
export interface OverdueChat { chatId: string; name: string; acct: string; waitedH: number; topic: string }

export interface AutoStatus {
  on: boolean;
  /** Chats with new messages waiting for their turn. */
  pending: number;
  nextAt: number | null;
  runningChat: string | null;
  pausedUntil: number | null;
  pausedWhy: string | null;
}

export interface AiStatus {
  provider: AiProvider;
  connected: boolean;
  testing: boolean;
  /** CLI providers: whether the CLI was found. Local model: whether Ollama is running. DeepSeek: whether a key was found. */
  cliFound: boolean;
  /** Who or what it runs as: "me@x.com · Pro", "Ollama 0.40.5", or the variable a DeepSeek key came from. */
  account: string | null;
  /** Local model: the models installed in Ollama. */
  models?: string[];
  /** Why it isn't connected, when there is more to say than the banners. */
  detail?: string | null;
}

/** Ollama on this computer: running or not, and the models installed there. */
export interface LocalFound { running: boolean; models: string[]; version: string | null }

export interface InsightAction { t: string; owner: string; due: string; cite: string | null }

export interface ChatInsight {
  summary: string;
  highlights: string[];
  actions: InsightAction[];
  decisions: string[];
  questions: string[];
  status: { stage: string; risk: 'high' | 'watch' | 'low'; next: string };
}

export interface SummaryResult {
  chatId: string;
  model: ModelId;
  createdAt: number;
  msgCount: number;
  insight: ChatInsight;
  /** 'week:2026-10-26', 'n:50', 'auto:10' or 'days:7': what was read. */
  windowKey: string | null;
  auto: boolean;
  /** The language the summary is written in. */
  lang?: Lang;
  /** Older messages this week left out by the 300-message cap. */
  skipped?: number;
  /** True when nothing changed and the saved summary was returned without calling the AI. */
  cached?: boolean;
}

export type PresetId = 'digest' | 'actions' | 'decisions' | 'client' | 'debt' | 'custom';

export interface Report {
  id: string;
  presetId: PresetId;
  title: string;
  days: '1' | '7' | '30';
  custom: string;
  model: ModelId;
  createdAt: number;
  chatIds: string[];
  overview: string;
  loopIds: string[];
  insights: Record<string, ChatInsight>; // by chat id
  stats: {
    chats: number; msgs: number; actions: number; questions: number;
    owed: number; waiting: number; overdue: number; longestH: number;
  };
}

export type PairPhase = 'name' | 'wait' | 'linking' | 'linked' | 'error';

export interface PairState {
  accountId: string | null;
  phase: PairPhase;
  qrSvg: string | null;
  error: string | null;
}

export type RunStep = { label: string; state: 'wait' | 'run' | 'done' };

export interface RunProgress {
  runId: string;
  kind: 'summary' | 'report';
  chatId: string | null;
  steps: RunStep[];
}

/** The database WA Turbo is using: the built-in Postgres, or (dev only) one named by WA_TURBO_DATABASE_URL. */
export interface DbInfo {
  mode: 'bundled' | 'external';
  version: string | null;
  folder: string | null;
  sizeBytes: number | null;
  /** Switched on in Settings: DBeaver and similar tools may connect over 127.0.0.1. */
  toolsOn: boolean;
  tools: { host: string; port: number; database: string; user: string; password: string } | null;
  toolsError: string | null;
}

export interface Bootstrap {
  dbOk: boolean;
  dbError: string | null;
  accounts: Account[];
  partners: Partner[];
  settings: Settings;
  ai: AiStatus;
}
