import { contextBridge, ipcRenderer } from 'electron';
import { API_KEYS, EVENT_KEYS, type Bridge, type EventKey } from '@shared/ipc';

// Exposes window.api: one promise per backend call, plus `on` for pushed events.
// Errors thrown in the main process come back as rejected promises with the same message.

const api: Record<string, unknown> = {};
for (const key of API_KEYS) {
  api[key] = async (...args: unknown[]) => {
    const r = (await ipcRenderer.invoke('api:' + key, ...args)) as { ok: boolean; value?: unknown; error?: string };
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
}

const listeners = new Map<EventKey, Set<(p: unknown) => void>>();
ipcRenderer.on('evt', (_e, key: EventKey, payload: unknown) => listeners.get(key)?.forEach(cb => cb(payload)));

api.on = (event: EventKey, cb: (p: unknown) => void) => {
  if (!EVENT_KEYS.includes(event)) throw new Error('Unknown event ' + event);
  const set = listeners.get(event) ?? new Set();
  set.add(cb);
  listeners.set(event, set);
  return () => set.delete(cb);
};

contextBridge.exposeInMainWorld('api', api as unknown as Bridge);
