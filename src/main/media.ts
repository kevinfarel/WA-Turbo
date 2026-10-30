import { nativeImage } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaDir } from './config';
import { messageMedia, setMediaPath } from './db/queries';
import type { AiImage } from './ai/client';
import type { WaSession } from './wa/session';

// One place that turns a stored message into its media bytes: from the local cache when it has
// been opened before, otherwise downloaded from WhatsApp once and cached under mediaDir.

let sessionFor: (accountId: string) => WaSession | undefined = () => undefined;
export const initMedia = (fn: typeof sessionFor): void => { sessionFor = fn; };

export interface MediaFile { buf: Buffer; mime: string; fileName: string | null; path: string | null }

export class MediaError extends Error {
  constructor(message: string, readonly status: 404 | 410 | 503) { super(message); }
}

export async function loadMedia(messageId: number): Promise<MediaFile> {
  const row = await messageMedia(messageId);
  if (!row?.media) throw new MediaError('This message has no attachment.', 404);
  const { mime, fileName } = row.media;
  if (row.media.path && existsSync(row.media.path)) return { buf: await readFile(row.media.path), mime, fileName, path: row.media.path };
  const session = sessionFor(row.account_id);
  if (!session) throw new MediaError('This number is offline, so the photo cannot be downloaded yet.', 503);
  let buf: Buffer;
  try {
    buf = await session.downloadMedia(row.raw);
  } catch {
    throw new MediaError('WhatsApp no longer has this file. Ask the sender to send it again.', 410);
  }
  const path = await cacheMedia(row.account_id, messageId, mime, buf);
  return { buf, mime, fileName, path };
}

export async function cacheMedia(accountId: string, messageId: number, mime: string, buf: Buffer): Promise<string> {
  const dir = join(mediaDir(), accountId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${messageId}.${extOf(mime)}`);
  await writeFile(path, buf);
  await setMediaPath(messageId, path);
  return path;
}

export const extOf = (mime: string): string => {
  const e = (mime.split('/')[1] ?? 'bin').split(';')[0];
  return e === 'jpeg' ? 'jpg' : e;
};

const MAX_SIDE = 1568; // larger images cost more tokens without reading better

/** A photo resized and re-encoded for Claude, or null when it can't be read. */
export async function imageForAi(messageId: number, label: string): Promise<AiImage | null> {
  try {
    const f = await loadMedia(messageId);
    let img = nativeImage.createFromBuffer(f.buf);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (Math.max(width, height) > MAX_SIDE) img = img.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
    return { label, mime: 'image/jpeg', data: img.toJPEG(82).toString('base64') };
  } catch {
    return null;
  }
}
