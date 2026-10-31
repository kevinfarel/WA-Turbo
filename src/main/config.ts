import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { UiPrefs } from '@shared/types';

// config.json in userData (~/Library/Application Support/WA Turbo, %APPDATA%\WA Turbo on Windows; mode 600) holds
// the Anthropic key, encrypted with safeStorage (macOS Keychain, Windows DPAPI) and never stored in Postgres, plus the password database tools use to reach the
// built-in Postgres over 127.0.0.1 when that is switched on. The app itself connects over a private socket.

interface ConfigFile {
  apiKeyEnc?: string;
  dbPassword?: string;
  dbTools?: boolean;
  /** App language and theme as the window last set them, so the next launch opens in the right colours. */
  ui?: UiPrefs;
}

/** How the app names the computer in its copy. */
export const HERE = process.platform === 'win32' ? 'this PC' : 'this Mac';

export const dataDir = (): string => app.getPath('userData');
export const mediaDir = (): string => join(dataDir(), 'media');
const configPath = (): string => join(dataDir(), 'config.json');

function read(): ConfigFile {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as ConfigFile;
  } catch {
    return {};
  }
}

function write(c: ConfigFile): void {
  // Older versions stored an external Postgres URL (with its password) here; the built-in database replaced it.
  const { databaseUrl: _legacy, ...keep } = c as ConfigFile & { databaseUrl?: string };
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(keep, null, 2), { mode: 0o600 });
}

/** Set only for dev, tests and screenshots: use that Postgres instead of the built-in one. */
export const externalDatabaseUrl = (): string | null => process.env.WA_TURBO_DATABASE_URL || null;

export function dbPassword(): string {
  const c = read();
  if (c.dbPassword) return c.dbPassword;
  const pw = randomBytes(18).toString('base64url');
  write({ ...c, dbPassword: pw });
  return pw;
}

export const dbTools = (): boolean => read().dbTools === true;

export function setDbTools(on: boolean): void {
  write({ ...read(), dbTools: on });
}

export const uiPrefs = (): UiPrefs | null => read().ui ?? null;

export function setUiPrefs(ui: UiPrefs): void {
  write({ ...read(), ui });
}

export function getApiKey(): string | null {
  const enc = read().apiKeyEnc;
  if (!enc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
}

export function setApiKey(key: string | null): void {
  const c = read();
  if (key === null) delete c.apiKeyEnc;
  else c.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
  write(c);
}

export function migrationsDir(): string {
  const packaged = join(process.resourcesPath ?? '', 'migrations');
  return app.isPackaged && existsSync(packaged) ? packaged : join(app.getAppPath(), 'migrations');
}
