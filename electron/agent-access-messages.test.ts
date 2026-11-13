// @vitest-environment node
import { expect, it } from 'vitest';
import { AGENT_ACCESS_OFF_MESSAGE, AGENT_ACCESS_PORT_IN_USE_MESSAGE } from './agent-access-messages.js';

// `imnota --mcp` with access off prints AGENT_ACCESS_OFF_MESSAGE on stderr and exits 1 (the packaged
// CLI path is also asserted by scripts/verify-mcp.mjs); a busy port shows the second message.
// tests/settings-references.test.ts checks that every "Settings → X" names a real section.
it.each([
  ['--mcp with local agent access off', AGENT_ACCESS_OFF_MESSAGE],
  ['local agent access port already in use', AGENT_ACCESS_PORT_IN_USE_MESSAGE],
])('%s points to Settings → Features, where the MCP access toggle lives', (_case, message) => {
  expect(message).toMatch(/Settings → Features\.$/);
  expect(message).not.toContain('Workspace');
});

it('keeps the CLI wording that scripts rely on', () => {
  expect(AGENT_ACCESS_OFF_MESSAGE).toMatch(/^Local agent access is off\./);
  expect(AGENT_ACCESS_PORT_IN_USE_MESSAGE).toMatch(/Port 17384 may be in use\. Access is off;/);
});
