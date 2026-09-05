import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseEvidence } from './release-readiness.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = resolve(repositoryRoot, 'package.json');
const argumentsList = process.argv.slice(2);
let dryRun = false;
let evidencePath;
let requestedVersion;
for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === '--dry-run') {
    dryRun = true;
  } else if (argument === '--evidence') {
    evidencePath = argumentsList[index + 1];
    index += 1;
    if (!evidencePath || evidencePath.startsWith('--'))
      throw new Error('--evidence requires a local JSON file path.');
  } else if (argument.startsWith('--')) {
    throw new Error('Unknown option. Use --dry-run and required --evidence <local-json-path>.');
  } else if (requestedVersion) {
    throw new Error('Use one version request: patch, minor, major, or an explicit stable version.');
  } else {
    requestedVersion = argument;
  }
}
if (!evidencePath) throw new Error('Release readiness evidence is required: --evidence <local-json-path>.');
requestedVersion ??= 'patch';

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
      return request;
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

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const version = nextVersion(packageJson.version, requestedVersion);
const tag = `v${version}`;
if (!dryRun && version !== packageJson.version) {
  throw new Error(
    `Prepare version ${version} in package.json through a reviewed pull request first. After it merges, run pnpm release ${version} from main. Branch protections are not bypassed.`,
  );
}

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
if (capture('git', ['rev-parse', 'HEAD']) !== capture('git', ['rev-parse', 'origin/main'])) {
  throw new Error('Release only the exact reviewed origin/main commit. Pull main before releasing.');
}
const candidateSha = capture('git', ['rev-parse', 'HEAD']);
assertReleaseEvidence(resolve(repositoryRoot, evidencePath), { sha: candidateSha, version });
console.log(`Release readiness evidence accepted for ${version} at ${candidateSha}.`);
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
  console.log(
    `Dry run complete. Version ${version} must be merged through a reviewed PR before its tag can be published.`,
  );
  process.exit(0);
}

command('git', ['tag', '-a', tag, '-m', `Imnota ${tag}`]);
command('git', ['push', 'origin', `refs/tags/${tag}`]);

console.log(
  `Release ${tag} pushed. GitHub Actions will publish it at https://github.com/Dytschgo/imnota/releases/tag/${tag}`,
);
