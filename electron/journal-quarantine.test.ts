// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { quarantineDamagedJournal } from './journal-quarantine.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it('refuses linked descendants and paths outside the project without moving either', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-quarantine-')));
  roots.push(root);
  const project = path.join(root, 'project');
  const journal = path.join(project, '.imnota-undo', 'delete-00000000-0000-4000-8000-000000000001');
  const external = path.join(root, 'external');
  await fs.mkdir(journal, { recursive: true });
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'keep.txt'), 'preserve');
  await fs.symlink(external, path.join(journal, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(quarantineDamagedJournal(project, journal)).rejects.toThrow('Linked');
  await expect(quarantineDamagedJournal(project, external)).rejects.toThrow('inside');
  expect(await fs.readFile(path.join(external, 'keep.txt'), 'utf8')).toBe('preserve');
  expect(await fs.readdir(path.dirname(journal))).toEqual([path.basename(journal)]);
});
