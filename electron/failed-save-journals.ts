import fs from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  assertNoLinks,
  readStableRegularFileBytes,
  writtenFileIdentity,
  type WrittenFileEvidence,
  type WrittenFileIdentity,
} from './files.js';
import {
  parseScreenshotTransactionManifest,
  type ScreenshotTransactionWrite,
} from './screenshot-transactions.js';

/** Only witnesses issued in this process can transfer a known failed save. */
export interface FailedSaveJournalWitness {
  readonly token: string;
}
export interface SaveStageWitness {
  readonly token: string;
}
type DirectoryIdentity = { dev: bigint; ino: bigint };
type JournalSnapshot = { directory: DirectoryIdentity; files: Map<string, WrittenFileEvidence> };
type WitnessData = JournalSnapshot & { root: string; project: DirectoryIdentity };
const witnesses = new WeakMap<FailedSaveJournalWitness, WitnessData>();
const stages = new WeakMap<SaveStageWitness, Pick<WitnessData, 'root' | 'project' | 'directory'>>();
const MAX_WITNESS_BYTES = 512 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function sameFile(a: WrittenFileIdentity, b: WrittenFileIdentity): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}
function directoryIdentity(stat: BigIntStats): DirectoryIdentity {
  if (!stat.isDirectory() || stat.dev <= 0n || stat.ino <= 0n)
    throw new Error('Recovery directory identity is unavailable.');
  return { dev: stat.dev, ino: stat.ino };
}
function sameDirectory(a: DirectoryIdentity, b: DirectoryIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/** A fixed buffer, no-follow/nonblocking open, exact handle/path checks and EOF sentinel. */
async function hashFile(target: string, maximumBytes: number): Promise<WrittenFileEvidence> {
  await assertNoLinks(target);
  const flags = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const handle = await fs.open(target, constants.O_RDONLY | flags);
  try {
    const stat = await handle.stat({ bigint: true });
    const before = writtenFileIdentity(stat);
    const named = writtenFileIdentity(await fs.lstat(target, { bigint: true }));
    if (
      !before ||
      !named ||
      stat.nlink !== 1n ||
      !sameFile(before, named) ||
      before.size > BigInt(maximumBytes)
    )
      throw new Error('Recovery file identity, size or link count changed.');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    const size = Number(before.size);
    let bytes = 0;
    while (bytes <= size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size + 1 - bytes), bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > size) throw new Error('Recovery file grew while it was inspected.');
      hash.update(buffer.subarray(0, bytesRead));
    }
    await assertNoLinks(target);
    const finalStat = await fs.lstat(target, { bigint: true });
    const finalPath = writtenFileIdentity(finalStat);
    const finalHandle = writtenFileIdentity(await handle.stat({ bigint: true }));
    if (
      bytes !== size ||
      !finalPath ||
      !finalHandle ||
      finalStat.nlink !== 1n ||
      !sameFile(before, finalPath) ||
      !sameFile(before, finalHandle)
    )
      throw new Error('Recovery file changed while it was inspected.');
    return { ...before, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
}

async function snapshot(directory: string, names: string[]): Promise<JournalSnapshot> {
  await assertNoLinks(directory);
  const first = await fs.lstat(directory, { bigint: true });
  const identity = directoryIdentity(first);
  const entries = (await fs.readdir(directory)).sort();
  if (entries.join('\0') !== [...names].sort().join('\0'))
    throw new Error('Recovery journal inventory changed.');
  const files = new Map<string, WrittenFileEvidence>();
  let remaining = MAX_WITNESS_BYTES;
  for (const name of entries) {
    const evidence = await hashFile(path.join(directory, name), remaining);
    remaining -= Number(evidence.size);
    files.set(name, evidence);
  }
  const last = await fs.lstat(directory, { bigint: true });
  if (
    !sameDirectory(identity, directoryIdentity(last)) ||
    first.mtimeNs !== last.mtimeNs ||
    first.ctimeNs !== last.ctimeNs ||
    (await fs.readdir(directory)).sort().join('\0') !== entries.join('\0')
  )
    throw new Error('Recovery directory changed while it was inspected.');
  return { directory: identity, files };
}

/** Anchor the operation's directory before any live write or injected failure. */
export async function witnessSaveStage(projectPath: string, token: string): Promise<SaveStageWitness> {
  if (!/^txn-[0-9a-f-]{36}$/.test(token)) throw new Error('Invalid save-stage token.');
  await assertNoLinks(projectPath);
  const root = await fs.realpath(projectPath);
  const directory = path.join(root, '.imnota-transactions', token);
  await assertNoLinks(directory);
  const witness = Object.freeze({ token });
  stages.set(witness, {
    root,
    project: directoryIdentity(await fs.lstat(root, { bigint: true })),
    directory: directoryIdentity(await fs.lstat(directory, { bigint: true })),
  });
  return witness;
}

export async function witnessFailedSaveJournal(
  stage: SaveStageWitness,
  kind: 'content-save' | 'content-conflict',
  writes: ScreenshotTransactionWrite[],
): Promise<FailedSaveJournalWitness> {
  if (writes.length < 2 || writes.length > 3)
    throw new Error('Failed-save ownership only supports the bounded content-save write set.');
  const original = stages.get(stage);
  if (!original) throw new Error('Failed save has no original stage witness.');
  const { root, project } = original;
  const token = stage.token;
  await assertNoLinks(root);
  if (!sameDirectory(project, directoryIdentity(await fs.lstat(root, { bigint: true }))))
    throw new Error('The staged project was replaced during the failed save.');
  const directory = path.join(root, '.imnota-transactions', token);
  await assertNoLinks(directory);
  if (!sameDirectory(original.directory, directoryIdentity(await fs.lstat(directory, { bigint: true }))))
    throw new Error('The original save journal was replaced during the failed save.');
  const bytes = await readStableRegularFileBytes(path.join(directory, 'manifest.json'), 1_000_000);
  if (!bytes) throw new Error('Failed-save journal is missing.');
  const manifest = parseScreenshotTransactionManifest(JSON.parse(bytes.toString('utf8')), token);
  if (manifest.kind !== kind || manifest.phase === 'committed' || manifest.entries.length !== writes.length)
    throw new Error('Failed-save journal no longer describes this operation.');
  const names = new Set(['manifest.json']);
  for (const entry of manifest.entries) {
    const write = writes.find((value) => value.relativePath === entry.relativePath);
    if (
      !write ||
      entry.before.present !== (write.expectedBefore.state === 'present') ||
      (write.expectedBefore.state === 'present' && entry.before.sha256 !== write.expectedBefore.sha256) ||
      entry.after.present !== (write.after !== null) ||
      (write.after !== null &&
        (entry.after.sha256 !== digest(write.after) || entry.after.size !== write.after.byteLength))
    )
      throw new Error('Failed-save journal differs from the witnessed save request.');
    for (const image of [entry.before, entry.after]) if (image.blob) names.add(image.blob);
  }
  const evidence = await snapshot(directory, [...names]);
  if (evidence.files.get('manifest.json')?.sha256 !== digest(bytes))
    throw new Error('Failed-save manifest changed during ownership capture.');
  for (const entry of manifest.entries)
    for (const image of [entry.before, entry.after])
      if (
        image.blob &&
        (evidence.files.get(image.blob)?.sha256 !== image.sha256 ||
          evidence.files.get(image.blob)?.size !== BigInt(image.size))
      )
        throw new Error('Failed-save recovery image differs from its manifest.');
  const witness = Object.freeze({ token });
  witnesses.set(witness, { root, project, ...evidence });
  return witness;
}

/** Caller must first durably stage/validate the same original item's replacement. No bytes are deleted. */
export async function preserveSupersededSaveJournal(
  projectPath: string,
  witness: FailedSaveJournalWitness,
): Promise<string | undefined> {
  const expected = witnesses.get(witness);
  if (!expected) throw new Error('Failed-save journal has no process-owned witness.');
  await assertNoLinks(projectPath);
  const root = await fs.realpath(projectPath);
  if (
    root !== expected.root ||
    !sameDirectory(expected.project, directoryIdentity(await fs.lstat(root, { bigint: true })))
  )
    throw new Error('Failed-save project identity changed.');
  const directory = path.join(root, '.imnota-transactions', witness.token);
  const present = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  // A completed manual replay/discard may already have removed the active token.
  // Forgetting an absent witness performs no filesystem mutation.
  if (!present) return undefined;
  const actual = await snapshot(directory, [...expected.files.keys()]);
  if (
    !sameDirectory(expected.directory, actual.directory) ||
    [...expected.files].some(([name, file]) => {
      const current = actual.files.get(name);
      return !current || !sameFile(file, current) || file.sha256 !== current.sha256;
    })
  )
    throw new Error('Failed-save journal changed; recovery material was preserved in place.');
  const destination = path.join(path.dirname(directory), `superseded-${witness.token}-${randomUUID()}`);
  await assertNoLinks(destination);
  // Node has no conditional directory rename. A change after the last check may
  // move with the directory; all bytes remain preserved and no live project file is rewritten.
  await fs.rename(directory, destination);
  witnesses.delete(witness);
  return path.relative(root, destination).split(path.sep).join('/');
}
