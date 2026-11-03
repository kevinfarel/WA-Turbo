import type {
  Account, Accent, AiStatus, AutoStatus, Bootstrap, ChatSummaryRow, Loop, LoopDir, Message, PairState, Partner, PresetId,
  AiProvider, ContactImportPreview, GroupMember, ContactImportResult, ContactsInfo, DbInfo, Lang, LocalFound, UiPrefs, Report, RunProgress, Settings, SummaryResult, SummaryWindow, TeamMember, UsageBucket,
} from './types';

// Every call the window can make. The main process registers one handler per key (ipc/router.ts),
// and the preload exposes them as window.api.<key>(...). sendMessage, editMessage and deleteForEveryone
// are the only calls that reach WhatsApp, and only the person's own click or key press makes them.
export interface Api {
  bootstrap(): Promise<Bootstrap>;
  retryDb(): Promise<Bootstrap>;
  dbInfo(): Promise<DbInfo>;
  /** Lets DBeaver and similar tools on this Mac connect over 127.0.0.1. Restarts the database for a moment. */
  setDbTools(on: boolean): Promise<DbInfo>;
  showDbFolder(): Promise<void>;

  /** Reads a .vcf file and reports what importing it would change, including numbers with more than one name. */
  previewContacts(data: Uint8Array, fileName: string, countryCode: string | null): Promise<ContactImportPreview>;
  /** Saves the previewed contacts; `keep` maps each duplicate number to the name the person picked. */
  applyContacts(token: string, keep: Record<string, string>): Promise<ContactImportResult>;
  contactsInfo(): Promise<ContactsInfo>;
  /** Forgets every imported name; chats go back to the names WhatsApp has. */
  clearContacts(): Promise<number>;

  listChats(acct: string): Promise<ChatSummaryRow[]>;
  listAllChats(): Promise<ChatSummaryRow[]>;
  searchChats(acct: string, q: string): Promise<string[]>;
  getMessages(chatId: string, limit: number): Promise<Message[]>;
  openChat(chatId: string): Promise<void>;
  /** Sends what the person typed, plus the photo they picked or pasted, tagging `mentions` (group members' IDs). */
  sendMessage(chatId: string, text: string, photoToken: string | null, mentions: string[]): Promise<void>;
  pickPhoto(): Promise<PickedPhoto | null>;
  /** A photo pasted into the composer, held like a picked one until it is sent. */
  pastePhoto(data: Uint8Array, mime: string): Promise<PickedPhoto>;
  /** The people in a group chat, for @ tags. Empty for direct chats. */
  groupMembers(chatId: string): Promise<GroupMember[]>;
  /** The chat open in the window (null on other tabs), so it doesn't notify while you read it. */
  setActiveChat(chatId: string | null): Promise<void>;
  /** Mutes notifications for a chat in WA Turbo only (not on your phone). Null unmutes; Infinity = until unmuted. */
  setMuted(chatId: string, until: number | null): Promise<void>;
  testNotification(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  /** Replaces the text of a message you sent, within WhatsApp's 15-minute limit. */
  editMessage(messageId: string, text: string): Promise<void>;
  /** Deletes a message you sent for everyone in the chat, within about 2 days. */
  deleteForEveryone(messageId: string): Promise<void>;
  /** Save-as dialog for a photo or file in the chat. Null when cancelled. */
  saveMedia(messageId: string): Promise<{ path: string } | null>;
  /** Tags a chat with a partner you name; a new name becomes a partner. Null partner removes the tag. */
  setChatPartner(chatId: string, partner: string | null, type: string | null, service: string | null, stage: string | null): Promise<void>;

  listLoops(): Promise<Loop[]>;
  flagMessage(chatId: string, msgId: string): Promise<Loop>;
  loopAction(loopId: string, act: 'answered' | 'nudge' | 'snooze' | 'reopen' | 'dismiss' | 'flip'): Promise<Loop>;
  /** My team: people on your side in group chats, marked from one of their messages. */
  listTeam(): Promise<TeamMember[]>;
  /** AI token usage per hour and number since a time (epoch ms). */
  usage(since: number): Promise<UsageBucket[]>;
  setTeam(messageId: string, onTeam: boolean): Promise<TeamMember[]>;
  removeTeam(memberId: string): Promise<TeamMember[]>;

  startPairing(name: string, desc: string, accent: Accent): Promise<PairState>;
  refreshPairing(): Promise<PairState>;
  cancelPairing(): Promise<void>;
  reconnect(accountId: string): Promise<void>;
  unlink(accountId: string): Promise<void>;
  /** The language the AI writes in for a number. Null forgets it, so it is detected again from the chats. */
  setNumberLang(accountId: string, lang: Lang | null): Promise<Account[]>;
  /** App language and theme, so notifications, the menu bar and the window background match. */
  setUiPrefs(p: UiPrefs): Promise<void>;

  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  /** Re-checks the selected AI connection (looks for the CLI again). deep: also run Antigravity's tiny sign-in check. */
  checkAi(deep?: boolean): Promise<AiStatus>;
  testKey(key: string): Promise<{ ok: boolean; error: string | null }>;
  disconnectKey(): Promise<void>;
  /** Gemini or OpenAI-compatible: checks the key (null = the saved one) with the model and address in Settings, then saves it. */
  testProviderKey(provider: 'gemini' | 'deepseek' | 'openai', key: string | null): Promise<{ ok: boolean; error: string | null }>;
  disconnectProvider(provider: 'gemini' | 'deepseek' | 'openai'): Promise<void>;
  /** Looks for Ollama on this computer and the models installed there (for the Local model card). */
  detectLocal(): Promise<LocalFound>;
  /** Experimental providers: what their last run did, without any message text. */
  aiDiagnostics(provider: AiProvider): Promise<string>;

  /** Uses the saved summary when nothing changed (result.cached); force reads again anyway. */
  summarize(chatId: string, opts?: { window?: SummaryWindow; force?: boolean }): Promise<SummaryResult>;
  setPinned(chatId: string, pinned: boolean): Promise<void>;
  autoStatus(): Promise<AutoStatus>;
  cancelRun(runId: string): Promise<void>;
  lastSummary(chatId: string): Promise<SummaryResult | null>;

  listReports(): Promise<Report[]>;
  generateReport(presetId: PresetId, days: '1' | '7' | '30', chatIds: string[], custom: string): Promise<Report>;
  deleteReport(id: string): Promise<void>;
  exportReport(id: string, markdown: string): Promise<{ path: string }>;
  copyText(text: string): Promise<void>;
}

// Events pushed from the main process to the window.
export interface Events {
  'accounts': Account[];
  'chats-changed': { acct: string };
  'messages': { chatId: string; messages: Message[] };
  /** A notification or the menu bar asked to show this chat. */
  'open-chat': { chatId: string; messageId: string | null };
  /** A pinned chat got a message while WA Turbo is in front on another chat. */
  'notify': { chatId: string; messageId: string; title: string; body: string };
  /** Settings changed outside the window (menu bar pause). */
  'settings': Settings;
  /** Stored messages in this chat were edited or deleted: reload them. */
  'messages-changed': { chatId: string };
  'loops-changed': Loop[];
  'pair': PairState;
  'progress': RunProgress;
  'partners': Partner[];
  /** An auto run finished on a pinned chat: its new summary. */
  'summary': SummaryResult;
  'auto': AutoStatus;
}

export interface PickedPhoto { token: string; name: string; size: number; preview: string }

export type ApiKey = keyof Api;
export type EventKey = keyof Events;

export const API_KEYS: ApiKey[] = [
  'bootstrap', 'retryDb', 'dbInfo', 'setDbTools', 'showDbFolder', 'previewContacts', 'applyContacts', 'contactsInfo', 'clearContacts',
  'listChats', 'listAllChats', 'searchChats', 'getMessages', 'openChat', 'setActiveChat', 'setMuted', 'testNotification', 'openNotificationSettings', 'sendMessage', 'editMessage', 'deleteForEveryone', 'pickPhoto', 'pastePhoto', 'groupMembers', 'saveMedia', 'setChatPartner',
  'listLoops', 'flagMessage', 'loopAction', 'listTeam', 'setTeam', 'removeTeam', 'usage',
  'startPairing', 'refreshPairing', 'cancelPairing', 'reconnect', 'unlink', 'setNumberLang', 'setUiPrefs',
  'getSettings', 'saveSettings', 'checkAi', 'testKey', 'disconnectKey', 'testProviderKey', 'disconnectProvider', 'detectLocal', 'aiDiagnostics',
  'summarize', 'cancelRun', 'lastSummary', 'setPinned', 'autoStatus',
  'listReports', 'generateReport', 'deleteReport', 'exportReport', 'copyText',
];

export const EVENT_KEYS: EventKey[] = ['accounts', 'chats-changed', 'messages', 'messages-changed', 'open-chat', 'notify', 'settings', 'loops-changed', 'pair', 'progress', 'partners', 'summary', 'auto'];

export type Unsubscribe = () => void;

export interface Bridge extends Api {
  on<K extends EventKey>(event: K, cb: (payload: Events[K]) => void): Unsubscribe;
}

export type { LoopDir };
