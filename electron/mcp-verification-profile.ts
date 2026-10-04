import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Only the disposable fixture created by scripts/verify-mcp.mjs may override a CLI profile. */
export function mcpVerificationProfile(
  environment: NodeJS.ProcessEnv,
  argv: readonly string[],
): string | undefined {
  const profile = environment.IMNOTA_MCP_VERIFY_PROFILE;
  const token = environment.IMNOTA_MCP_VERIFY_OWNER;
  if (profile === undefined && token === undefined) return undefined;
  const fail = () => {
    throw new Error('Invalid owned MCP verification profile. Use scripts/verify-mcp.mjs.');
  };
  if (
    !argv.includes('--mcp') ||
    environment.IMNOTA_SMOKE === '1' ||
    !profile ||
    !path.isAbsolute(profile) ||
    !token ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    return fail();
  const resolved = path.resolve(profile);
  const root = path.dirname(resolved);
  const comparable = (value: string) => (process.platform === 'win32' ? value.toLowerCase() : value);
  const same = (left: string, right: string) => comparable(left) === comparable(right);
  const directory = (target: string) => {
    const stat = lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !same(realpathSync(target), target)) fail();
  };
  const file = (target: string, maxBytes: number) => {
    const stat = lstatSync(target);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > maxBytes ||
      !same(realpathSync(target), target)
    )
      fail();
    return readFileSync(target, 'utf8');
  };
  // Canonical tmpdir permits the OS's /var -> /private/var alias on macOS, but not fixture aliases.
  if (
    !same(path.dirname(root), realpathSync(tmpdir())) ||
    !/^imnota-smoke-result-[a-z0-9_-]+$/i.test(path.basename(root)) ||
    !/^mcp-(enabled|disabled)$/.test(path.basename(resolved))
  )
    return fail();
  directory(root);
  directory(resolved);
  if (
    file(path.join(root, '.imnota-smoke-owned'), 100) !== 'disposable native verification fixture\n' ||
    file(path.join(root, '.imnota-mcp-owned'), 64) !== token
  )
    return fail();
  // No pre-existing cache, diagnostic path, links, or personal settings may be redirected here.
  if (readdirSync(resolved).join(',') !== 'settings.json') return fail();
  const settings: unknown = JSON.parse(file(path.join(resolved, 'settings.json'), 65_536));
  const workspace = path.join(root, 'workspace');
  directory(workspace);
  if (
    !settings ||
    typeof settings !== 'object' ||
    !('workspacePath' in settings) ||
    settings.workspacePath !== workspace
  )
    return fail();
  return resolved;
}
