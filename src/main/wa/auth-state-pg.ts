import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from 'baileys';
import { authClear, authGet, authSet } from '../db/queries';

// Baileys auth state stored per account in wa_auth_state (replaces useMultiFileAuthState).
// Values go through BufferJSON so Buffers and Uint8Arrays survive the jsonb round trip.

const toJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v, BufferJSON.replacer));
const fromJson = <T>(v: unknown): T => JSON.parse(JSON.stringify(v), BufferJSON.reviver) as T;

export async function usePgAuthState(accountId: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; hasCreds: boolean }> {
  const stored = (await authGet(accountId, 'creds', ['creds'])).get('creds');
  const creds: AuthenticationCreds = stored ? fromJson<AuthenticationCreds>(stored) : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const rows = await authGet(accountId, type, ids);
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          const raw = rows.get(id);
          if (raw === undefined) continue;
          let value = fromJson<SignalDataTypeMap[T]>(raw);
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value as object) as unknown as SignalDataTypeMap[T];
          }
          out[id] = value;
        }
        return out;
      },
      set: async data => {
        const rows: { kind: string; keyId: string; value: unknown | null }[] = [];
        for (const kind of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
          for (const [keyId, value] of Object.entries(data[kind] ?? {})) {
            rows.push({ kind, keyId, value: value ? toJson(value) : null });
          }
        }
        await authSet(accountId, rows);
      },
      clear: async () => authClear(accountId),
    },
  };

  return {
    state,
    saveCreds: () => authSet(accountId, [{ kind: 'creds', keyId: 'creds', value: toJson(creds) }]),
    hasCreds: !!stored && !!creds.me,
  };
}
