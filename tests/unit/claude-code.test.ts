import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Claude Code CLI is an agent that can run commands. WA Turbo only ever lets it read and answer.
describe('Claude Code runs are tool-less', () => {
  const src = readFileSync('src/main/ai/claude-code.ts', 'utf8');
  it('switches off every tool, MCP server, setting, hook and plugin', () => {
    expect(src).toContain("'--tools', ''");
    expect(src).toContain("'--strict-mcp-config'");
    expect(src).toContain("'--setting-sources', ''");
    expect(src).toContain("'--safe-mode'");
    expect(src).toContain("'--no-session-persistence'");
  });
  it('never widens permissions', () => {
    expect(src).not.toMatch(/dangerously|bypassPermissions|--allowed-?tools|--add-dir|--mcp-config/i);
  });
});
