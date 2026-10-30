import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { findViolations } from '../../scripts/check-send.mjs';

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'wat-send-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}

describe('send guard', () => {
  it('passes on the real source: only the composer sends', () => {
    expect(findViolations('src')).toEqual([]);
  });

  it('catches a send from AI or rule code', () => {
    const root = tree({ 'main/ai/x.ts': 'await manager.send(acct, jid, { text: out.reply });' });
    expect(findViolations(root).join('\n')).toMatch(/AI, rules, ingest and notifications may not send/);
  });

  it('notification code may not send either', () => {
    const root = tree({ 'main/notify/center.ts': "import { WaManager } from '../wa/manager';" });
    expect(findViolations(root).join('\n')).toMatch(/notifications may not send/);
  });

  it('catches a timed or scheduled send in the window', () => {
    const root = tree({
      'renderer/app.ts': "async function sendFromComposer() {\n  setTimeout(() => api.sendMessage(id, t, null), 60000);\n}\nsetInterval(() => sendFromComposer(), 1000);\n",
    });
    const hits = findViolations(root).join('\n');
    expect(hits).toMatch(/never on a timer/);
    expect(hits).toMatch(/only the Send button or Enter may send/);
  });

  it('edit and delete for everyone only from a click, key or the confirm dialog', () => {
    const root = tree({
      'renderer/app.ts': "async function saveEdit() {\n  await api.editMessage(id, t);\n}\nasync function removeForEveryone(id) {\n  await api.deleteForEveryone(id);\n}\napi.on('summary', () => saveEdit());\nfor (const m of mine) void removeForEveryone(m.id);\n",
    });
    const hits = findViolations(root).join('\n');
    expect(hits).toMatch(/only the Save button or Enter may save an edit/);
    expect(hits).toMatch(/only after the confirm dialog/);
  });

  it('still forbids receipts and presence', () => {
    const root = tree({ 'main/wa/session.ts': 'await sock.readMessages([key]);\nawait sock.sendPresenceUpdate("available");' });
    expect(findViolations(root)).toHaveLength(2);
  });
});
