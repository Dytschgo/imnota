import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A deliberately narrow allowlist. New document locations require review.
function isProsePath(path) {
  return (
    path === 'README.md' ||
    path === 'AGENTS.md' ||
    /^docs\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.md$/.test(path)
  );
}

export function isDocsOnlyDiff(raw) {
  if (!raw || !raw.endsWith('\0')) return false;
  const fields = raw.slice(0, -1).split('\0');
  if (fields.length % 2 !== 0) return false;
  for (let index = 0; index < fields.length; index += 2) {
    const entry = /^:(\d{6}) (\d{6}) [a-f0-9]{40} [a-f0-9]{40} ([AMD])$/.exec(fields[index]);
    if (!entry || !isProsePath(fields[index + 1])) return false;
    const [, before, after, status] = entry;
    const expectedModes = { A: '000000:100644', M: '100644:100644', D: '100644:000000' };
    if (`${before}:${after}` !== expectedModes[status]) return false;
  }
  return true;
}

export function classifyChanges({ eventName, base, head, cwd = process.cwd() }) {
  if (
    eventName !== 'pull_request' ||
    !/^[a-f0-9]{40}$/.test(base ?? '') ||
    !/^[a-f0-9]{40}$/.test(head ?? '') ||
    base === head
  )
    return false;
  const diff = spawnSync(
    'git',
    ['diff', '--raw', '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', base, head, '--'],
    { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  return !diff.error && diff.status === 0 && isDocsOnlyDiff(diff.stdout);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const docsOnly = classifyChanges({
    eventName: process.env.GITHUB_EVENT_NAME,
    base: process.env.IMNOTA_BASE_SHA,
    head: process.env.IMNOTA_HEAD_SHA,
  });
  console.log(docsOnly ? 'Prose-only PR: format and review documentation.' : 'Full validation required.');
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${docsOnly}\n`);
  }
}
