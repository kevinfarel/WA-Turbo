import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ~/Library/Application Support/WA Turbo/config.json holds the database URL and the
// Anthropic key. The key is encrypted with safeStorage (macOS Keychain) and never stored in Postgres.

interface ConfigFile {
  databaseUrl?: string;
  apiKeyEnc?: string;
}

export const DEFAULT_DATABASE_URL = 'postgres://wa_turbo@localhost:5432/wa_turbo';

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
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(c, null, 2), { mode: 0o600 });
}

export function databaseUrl(): string {
  return process.env.WA_TURBO_DATABASE_URL || read().databaseUrl || DEFAULT_DATABASE_URL;
}

export function setDatabaseUrl(url: string): void {
  write({ ...read(), databaseUrl: url });
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
