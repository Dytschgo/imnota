// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mcpVerificationProfile } from './mcp-verification-profile.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'imnota-smoke-result-')));
  roots.push(root);
  const profile = path.join(root, 'mcp-enabled');
  mkdirSync(profile);
  mkdirSync(path.join(root, 'workspace'));
  const token = 'a'.repeat(64);
  writeFileSync(path.join(root, '.imnota-smoke-owned'), 'disposable native verification fixture\n');
  writeFileSync(path.join(root, '.imnota-mcp-owned'), token);
  writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({ workspacePath: path.join(root, 'workspace') }),
  );
  const env = { IMNOTA_MCP_VERIFY_PROFILE: profile, IMNOTA_MCP_VERIFY_OWNER: token };
  return { root, profile, env };
}
it('leaves ordinary launches unchanged and accepts only a prepared CLI fixture', () => {
  expect(mcpVerificationProfile({}, [])).toBeUndefined();
  const { env, profile } = fixture();
  expect(mcpVerificationProfile(env, ['--mcp'])).toBe(profile);
  expect(() => mcpVerificationProfile(env, [])).toThrow();
  expect(() => mcpVerificationProfile({ ...env, IMNOTA_SMOKE: '1' }, ['--mcp'])).toThrow();
});
it('rejects relative, unowned and personal profile targets without changing their bytes', () => {
  const { env, root, profile } = fixture();
  for (const target of ['mcp-enabled', root, path.join(root, 'personal'), tmpdir()])
    expect(() => mcpVerificationProfile({ ...env, IMNOTA_MCP_VERIFY_PROFILE: target }, ['--mcp'])).toThrow();
  expect(() =>
    mcpVerificationProfile({ ...env, IMNOTA_MCP_VERIFY_OWNER: 'b'.repeat(64) }, ['--mcp']),
  ).toThrow();
  rmSync(path.join(root, '.imnota-mcp-owned'));
  expect(() => mcpVerificationProfile(env, ['--mcp'])).toThrow();
  expect(realpathSync(profile)).toBe(profile);
});
it('rejects a junction/symlink to a foreign profile and a linked fixture root', () => {
  const { env, root, profile } = fixture();
  const foreign = fixture();
  rmSync(profile, { recursive: true });
  symlinkSync(foreign.profile, profile, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => mcpVerificationProfile(env, ['--mcp'])).toThrow();
  rmSync(profile);
  rmSync(root, { recursive: true });
  symlinkSync(foreign.root, root, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => mcpVerificationProfile(env, ['--mcp'])).toThrow();
});
it('rejects hardlinked ownership and settings files', () => {
  for (const name of ['.imnota-mcp-owned', 'mcp-enabled/settings.json']) {
    const { root, env } = fixture();
    linkSync(path.join(root, name), path.join(root, 'foreign-link'));
    expect(() => mcpVerificationProfile(env, ['--mcp'])).toThrow();
  }
});
it('rejects pre-existing cache links and settings pointing outside the disposable workspace', () => {
  const { profile, env } = fixture();
  mkdirSync(path.join(profile, 'Cache'));
  expect(() => mcpVerificationProfile(env, ['--mcp'])).toThrow();
  rmSync(path.join(profile, 'Cache'), { recursive: true });
  writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ workspacePath: tmpdir() }));
  expect(() => mcpVerificationProfile(env, ['--mcp'])).toThrow();
});
