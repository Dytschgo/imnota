import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = resolve(repositoryRoot, 'package.json');
const argumentsList = process.argv.slice(2);
if (argumentsList.some((argument) => argument.startsWith('--') && argument !== '--dry-run'))
  throw new Error('Unknown option. Only --dry-run is supported.');
const dryRun = argumentsList.includes('--dry-run');
const requestedVersion = argumentsList.find((argument) => !argument.startsWith('--')) ?? 'patch';

function command(commandName, commandArguments, options = {}) {
  const result = spawnSync(commandName, commandArguments, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: false,
  });

  if (result.error || result.status !== 0) {
    if (options.allowFailure) return result;
    throw new Error(`Command failed: ${commandName} ${commandArguments.join(' ')}`);
  }

  return result;
}

function capture(commandName, commandArguments) {
  return command(commandName, commandArguments, { capture: true }).stdout.trim();
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected a stable semantic version, received ${version}`);
  return match.slice(1).map(Number);
}

function formatVersion(version) {
  return version.join('.');
}

function nextVersion(currentVersion, request) {
  const current = parseVersion(currentVersion);
  const normalizedRequest = request.toLowerCase();

  if (/^\d+\.\d+\.\d+$/.test(request)) {
    const explicit = parseVersion(request);
    if (explicit.every((part, index) => part === current[index])) {
      throw new Error(`Version ${request} is already the current version`);
    }
    for (let index = 0; index < current.length; index += 1) {
      if (explicit[index] > current[index]) return request;
      if (explicit[index] < current[index]) {
        throw new Error(`Version ${request} is older than ${currentVersion}`);
      }
    }
  }

  if (!['major', 'minor', 'patch'].includes(normalizedRequest)) {
    throw new Error('Use patch, minor, major, or an explicit version such as 0.2.0');
  }

  const next = [...current];
  const index = normalizedRequest === 'major' ? 0 : normalizedRequest === 'minor' ? 1 : 2;
  next[index] += 1;
  if (index === 0) next[1] = 0;
  if (index < 2) next[2] = 0;
  return formatVersion(next);
}

function writePackageVersion(version) {
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  packageJson.version = version;
  const temporaryPath = `${packagePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, packagePath);
}

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const version = nextVersion(packageJson.version, requestedVersion);
const tag = `v${version}`;

if (capture('git', ['status', '--porcelain'])) {
  throw new Error('The working tree is not clean. Commit or stash changes before releasing.');
}

if (capture('git', ['branch', '--show-current']) !== 'main') {
  throw new Error('Releases must be created from the main branch.');
}

const remote = capture('git', ['remote', 'get-url', 'origin']);
if (!/github\.com[/:]Dytschgo\/imnota(?:\.git)?$/i.test(remote)) {
  throw new Error(`origin must point to Dytschgo/imnota, received ${remote}`);
}

if (
  command('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { capture: true, allowFailure: true })
    .status === 0
) {
  throw new Error(`Local tag ${tag} already exists`);
}

command('git', ['fetch', 'origin', 'main']);
command(process.execPath, ['scripts/secret-scan.mjs']);
command('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);
const remoteTag = command('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], {
  capture: true,
  allowFailure: true,
});
if (remoteTag.status !== 0 && remoteTag.status !== 2)
  throw new Error('Could not verify remote tags. Check GitHub access.');
if (remoteTag.status === 0) {
  throw new Error(`Remote tag ${tag} already exists`);
}

console.log(`Preparing Imnota ${version} from ${packageJson.version}`);
console.log('Running release checks...');
for (const script of ['format:check', 'lint', 'typecheck', 'test', 'build']) {
  if (!process.env.npm_execpath) throw new Error('Run this command through pnpm release.');
  command(process.execPath, [process.env.npm_execpath, script]);
}

if (dryRun) {
  console.log(`Dry run complete. Would commit, tag ${tag}, and push main plus ${tag}.`);
  process.exit(0);
}

writePackageVersion(version);
command('git', ['add', 'package.json']);
command('git', ['commit', '-m', `release: ${tag}`]);
command('git', ['tag', '-a', tag, '-m', `Imnota ${tag}`]);
command('git', ['push', '--atomic', 'origin', 'main', `refs/tags/${tag}`]);

console.log(
  `Release ${tag} pushed. GitHub Actions will publish it at https://github.com/Dytschgo/imnota/releases/tag/${tag}`,
);
