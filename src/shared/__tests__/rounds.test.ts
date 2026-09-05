// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { emptyProject } from '../utils';
import { validateProject } from '../schema';
import { migrateRounds, screenshotPath } from '../../../electron/rounds';

const temporary: string[] = [];
afterEach(async () => {
  for (const folder of temporary.splice(0)) await fs.rm(folder, { recursive: true, force: true });
});
async function fixture() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-round-test-')));
  temporary.push(dir);
  const project = validateProject({
    ...emptyProject('Legacy', ''),
    schemaVersion: 1,
    screenshots: [
      {
        id: 'shot',
        originalFilename: 'example.png',
        storedFilename: '001-example.png',
        title: 'Example',
        description: '',
        position: 0,
        createdAt: '',
        updatedAt: '',
        tags: [],
        priority: 'medium',
        status: 'draft',
        annotationFile: 'annotations/example.json',
        notesFile: 'notes/example.md',
        originalWidth: 1,
        originalHeight: 1,
        includeInExport: true,
      },
    ],
  });
  for (const folder of ['screenshots', 'annotations', 'notes']) await fs.mkdir(path.join(dir, folder));
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project));
  await fs.writeFile(path.join(dir, 'screenshots/001-example.png'), Buffer.from([1, 2, 3]));
  await fs.writeFile(path.join(dir, 'annotations/example.json'), '[{"id":"annotation"}]');
  await fs.writeFile(path.join(dir, 'notes/example.md'), '## summary\n\nKeep this feedback.');
  return { dir, project };
}
describe('feedback round migration', () => {
  it('copies originals and editable content, keeps rollback files, and is idempotent', async () => {
    const { dir, project } = await fixture();
    const next = await migrateRounds(dir, project);
    expect(validateProject(next).schemaVersion).toBe(2);
    const shot = next.screenshots[0];
    expect(await fs.readFile(screenshotPath(dir, shot))).toEqual(Buffer.from([1, 2, 3]));
    expect(await fs.readFile(path.join(dir, shot.notesFile), 'utf8')).toContain('Keep this feedback.');
    expect(await fs.readFile(path.join(dir, shot.annotationFile), 'utf8')).toContain('annotation');
    expect(
      JSON.parse(await fs.readFile(path.join(dir, 'project.v1.backup.json'), 'utf8')).schemaVersion,
    ).toBe(1);
    expect(await fs.readFile(path.join(dir, 'screenshots/001-example.png'))).toEqual(Buffer.from([1, 2, 3]));
    expect(await migrateRounds(dir, next)).toEqual(next);
  });
  it('does not commit new metadata when an original image is missing', async () => {
    const { dir, project } = await fixture();
    await fs.unlink(path.join(dir, 'screenshots/001-example.png'));
    await expect(migrateRounds(dir, project)).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')).schemaVersion).toBe(1);
  });
  it('rejects unknown rounds, duplicate IDs and mismatched content paths', () => {
    const project = emptyProject('New', '');
    expect(() =>
      validateProject({ ...project, rounds: [{ ...project.rounds[0], id: '../escape' }] }),
    ).toThrow();
    expect(() => validateProject({ ...project, rounds: [project.rounds[0], project.rounds[0]] })).toThrow();
  });
});
