// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { afterEach, expect, it, vi } from 'vitest';
import { atomicWrite } from './files.js';
import {
  commitScreenshotTransaction,
  stageScreenshotTransaction,
  screenshotTransactionBaseline,
  listScreenshotTransactions,
  recoverScreenshotTransactions,
  discardScreenshotTransaction,
} from './screenshot-transactions.js';
import { commitScreenshotFileTransaction } from './screenshot-transaction-adapter.js';
import {
  witnessSaveStage,
  witnessFailedSaveJournal,
  preserveSupersededSaveJournal,
} from './failed-save-journals.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    expect(path.dirname(root)).toBe(await fs.realpath(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^imnota-retirement-test-/);
    await fs.rm(root, { recursive: true, force: true });
  }
});
const operations = {
  write: atomicWrite,
  unlink: (target: string) => fs.unlink(target),
  removeDirectory: (target: string) => fs.rm(target, { recursive: true, force: true }),
};
async function inventory(directory: string) {
  return Promise.all(
    (await fs.readdir(directory))
      .sort()
      .map(async (name) => [name, await fs.readFile(path.join(directory, name))] as const),
  );
}
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-retirement-test-')));
  roots.push(root);
  const metadata = path.join(root, 'project.json');
  await fs.writeFile(metadata, 'baseline metadata');
  await fs.writeFile(path.join(root, 'text.md'), 'baseline text');
  const writes = [
    {
      relativePath: 'text.md',
      after: Buffer.from('retry text'),
      expectedBefore: screenshotTransactionBaseline(Buffer.from('baseline text')),
    },
    {
      relativePath: 'project.json',
      after: Buffer.from('candidate metadata'),
      expectedBefore: screenshotTransactionBaseline(Buffer.from('baseline metadata')),
    },
  ];
  const staged = await stageScreenshotTransaction(root, { kind: 'content-save', writes });
  const stageWitness = await witnessSaveStage(root, staged.token);
  await expect(
    commitScreenshotTransaction(root, staged.token, {
      ...operations,
      write: async (target, bytes) => {
        if (target === metadata) throw new Error('controlled metadata failure');
        await atomicWrite(target, bytes);
      },
    }),
  ).rejects.toThrow();
  const directory = path.join(root, '.imnota-transactions', staged.token);
  const witness = await witnessFailedSaveJournal(stageWitness, 'content-save', writes);
  return { root, metadata, writes, directory, witness, stageWitness, token: staged.token };
}

it('preserves every prior byte while a durable replacement remains active', async () => {
  const f = await fixture();
  const previous = await inventory(f.directory);
  const replacement = await stageScreenshotTransaction(f.root, { kind: 'content-save', writes: f.writes });
  const location = await preserveSupersededSaveJournal(f.root, f.witness);
  expect(location).toMatch(/^\.imnota-transactions\/superseded-txn-/);
  expect(await inventory(path.join(f.root, location!))).toEqual(previous);
  await expect(fs.stat(f.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await listScreenshotTransactions(f.root)).map((entry) => entry.token)).toEqual([replacement.token]);
  expect(await fs.readFile(f.metadata, 'utf8')).toBe('baseline metadata');
  expect(await fs.readFile(path.join(f.root, 'text.md'), 'utf8')).toBe('baseline text');
});

it.each(['blob', 'same-byte-rewrite', 'added-file', 'manifest', 'directory-replacement'] as const)(
  'refuses %s changes without moving or deleting recovery material',
  async (change) => {
    const f = await fixture();
    const blob = path.join(f.directory, 'after-0000.bin');
    if (change === 'blob') await fs.writeFile(blob, 'changed candidate');
    if (change === 'same-byte-rewrite') await atomicWrite(blob, await fs.readFile(blob));
    if (change === 'added-file') await fs.writeFile(path.join(f.directory, 'personal.txt'), 'foreign bytes');
    if (change === 'manifest') await fs.appendFile(path.join(f.directory, 'manifest.json'), ' ');
    if (change === 'directory-replacement') {
      const original = path.join(f.root, 'displaced-owned-journal');
      await fs.rename(f.directory, original);
      await fs.cp(original, f.directory, { recursive: true });
    }
    const changed = await inventory(f.directory);
    await expect(preserveSupersededSaveJournal(f.root, f.witness)).rejects.toThrow();
    expect(await inventory(f.directory)).toEqual(changed);
    expect((await fs.readdir(path.dirname(f.directory))).some((name) => name.startsWith('superseded-'))).toBe(
      false,
    );
  },
);

it('refuses a forged process witness and a different project', async () => {
  const f = await fixture();
  await expect(preserveSupersededSaveJournal(f.root, { token: f.token })).rejects.toThrow(/process-owned/);
  const other = await fixture();
  await expect(preserveSupersededSaveJournal(other.root, f.witness)).rejects.toThrow(/project identity/);
  expect(await fs.readFile(f.metadata, 'utf8')).toBe('baseline metadata');
});

it('requires the original stage identity and original request when capturing failure ownership', async () => {
  const f = await fixture();
  await expect(witnessFailedSaveJournal({ token: f.token }, 'content-save', f.writes)).rejects.toThrow(
    /original stage/,
  );
  await expect(
    witnessFailedSaveJournal(
      f.stageWitness,
      'content-save',
      f.writes.map((entry, index) => (index ? entry : { ...entry, after: Buffer.from('unrelated request') })),
    ),
  ).rejects.toThrow(/witnessed save request/);
  const original = path.join(f.root, 'original-failed-journal');
  await fs.rename(f.directory, original);
  await fs.cp(original, f.directory, { recursive: true });
  await expect(witnessFailedSaveJournal(f.stageWitness, 'content-save', f.writes)).rejects.toThrow(
    /replaced during/,
  );
  expect(await inventory(f.directory)).toEqual(await inventory(original));
});

it('forgets an already resolved absent token without touching project files', async () => {
  const f = await fixture();
  await discardScreenshotTransaction(f.root, f.token);
  await expect(preserveSupersededSaveJournal(f.root, f.witness)).resolves.toBeUndefined();
  expect(await fs.readFile(f.metadata, 'utf8')).toBe('baseline metadata');
});

it.skipIf(process.platform === 'win32')('refuses a real FIFO without waiting for a writer', async () => {
  const f = await fixture();
  const blob = path.join(f.directory, 'after-0000.bin');
  await fs.rename(blob, path.join(f.root, 'preserved-original-blob'));
  expect(spawnSync('mkfifo', [blob], { encoding: 'utf8' }).status).toBe(0);
  await expect(preserveSupersededSaveJournal(f.root, f.witness)).rejects.toThrow();
  expect((await fs.lstat(blob)).isFIFO()).toBe(true);
  expect(await fs.readFile(path.join(f.root, 'preserved-original-blob'), 'utf8')).toBe('retry text');
});

it.skipIf(process.platform !== 'win32')(
  'preserves a journal held by a real exclusive Windows file handle',
  async () => {
    const f = await fixture();
    const before = await inventory(f.directory);
    const script = path.join(f.root, 'owned-file-lock.ps1');
    await fs.writeFile(
      script,
      `param([string]$TargetPath)
$ownedLock = [System.IO.File]::Open($TargetPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
try { [Console]::WriteLine('ready'); [Console]::ReadLine() | Out-Null } finally { $ownedLock.Dispose() }
`,
    );
    const child = spawn(
      path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        path.join(f.directory, 'manifest.json'),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const exited = once(child, 'close');
    const lines = createInterface({ input: child.stdout });
    try {
      const ready = await Promise.race([
        once(lines, 'line', { signal: AbortSignal.timeout(5_000) }),
        exited.then(() => {
          throw new Error('Owned lock helper exited before acquiring its handle.');
        }),
      ]);
      expect(ready[0]).toBe('ready');
      await expect(preserveSupersededSaveJournal(f.root, f.witness)).rejects.toMatchObject({
        code: expect.stringMatching(/EACCES|EPERM|EBUSY/),
      });
    } finally {
      child.stdin.end('\n');
      await exited;
      lines.close();
    }
    expect(await inventory(f.directory)).toEqual(before);
  },
  15_000,
);

it('refuses a junction/symlink and a hardlink without touching their other targets', async () => {
  const f = await fixture();
  const foreign = await fixture();
  const foreignBefore = await inventory(foreign.directory);
  const original = path.join(f.root, 'displaced-journal');
  await fs.rename(f.directory, original);
  await fs.symlink(foreign.directory, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(preserveSupersededSaveJournal(f.root, f.witness)).rejects.toThrow(/Linked/);
  expect(await inventory(foreign.directory)).toEqual(foreignBefore);
  const linked = await fixture();
  await fs.link(path.join(linked.directory, 'after-0000.bin'), path.join(linked.root, 'foreign-hardlink'));
  await expect(preserveSupersededSaveJournal(linked.root, linked.witness)).rejects.toThrow(/link count/);
  expect(await fs.readFile(path.join(linked.root, 'foreign-hardlink'), 'utf8')).toBe('retry text');
});

it('preserves the active journal on a native rename refusal', async () => {
  const f = await fixture();
  const before = await inventory(f.directory);
  const rename = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
    if (source === f.directory)
      throw Object.assign(new Error('controlled locked journal'), { code: 'EACCES' });
    return rename(source, destination);
  });
  await expect(preserveSupersededSaveJournal(f.root, f.witness)).rejects.toMatchObject({ code: 'EACCES' });
  expect(await inventory(f.directory)).toEqual(before);
});

it('keeps the replacement recoverable if execution stops after transfer but before live commit', async () => {
  const f = await fixture();
  const before = await inventory(f.directory);
  let preserved = '';
  await expect(
    commitScreenshotFileTransaction(f.root, {
      kind: 'content-save',
      writes: f.writes,
      operations,
      assertBaseline: async () => undefined,
      beforeCommit: async () => {
        preserved = (await preserveSupersededSaveJournal(f.root, f.witness))!;
        throw new Error('controlled interruption before live writes');
      },
    }),
  ).rejects.toMatchObject({ code: 'cleanup-failed', candidateAvailable: true });
  expect(await inventory(path.join(f.root, preserved))).toEqual(before);
  expect(await fs.readFile(f.metadata, 'utf8')).toBe('baseline metadata');
  const recovered = await recoverScreenshotTransactions(f.root);
  expect(recovered).toHaveLength(1);
  expect(recovered[0]).toMatchObject({ status: 'candidate-staged', candidateAvailable: true });
});
