// @vitest-environment node
import { mkdtemp, readFile, readdir, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { atomicWrite, assertNoLinks, isWithin } from '../../../electron/files';
import { annotationSchema, filenameSchema, settingsPatchSchema, validateProject } from '../schema';
import { emptyProject } from '../utils';

describe('filesystem and IPC boundaries', () => {
  it('rejects traversal, alternate streams and settings-based workspace changes', () => {
    for (const name of [
      '../image.png',
      '..\\image.png',
      '/tmp/image.png',
      'C:\\image.png',
      'image.png:secret',
      '..',
    ])
      expect(filenameSchema.safeParse(name).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ workspacePath: '/tmp' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ theme: 'dark' }).success).toBe(true);
    expect(isWithin('/workspace', '/workspace-other/project')).toBe(false);
    expect(isWithin('/workspace', '/workspace/../secret')).toBe(false);
  });
  it('rejects unsupported schemas and invalid annotation geometry', () => {
    expect(() => validateProject({ ...emptyProject('Future', ''), schemaVersion: 3 })).toThrow();
    expect(
      annotationSchema.safeParse({ id: 'a', kind: 'rectangle', x: Infinity, y: 0, zIndex: 0 }).success,
    ).toBe(false);
    const legacy = emptyProject('Legacy', '');
    expect(validateProject({ ...legacy, exportPreferences: undefined }).exportPreferences.template).toBe(
      'default',
    );
  });
  it('writes complete JSON under contention and cleans temporary files', async () => {
    const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'imnota-write-test-')));
    try {
      const target = path.join(folder, 'project.json');
      await Promise.all(
        Array.from({ length: 20 }, (_, index) => atomicWrite(target, JSON.stringify({ index }))),
      );
      expect(JSON.parse(await readFile(target, 'utf8')).index).toBeTypeOf('number');
      expect(await readdir(folder)).toEqual(['project.json']);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  it('blocks directory junctions before writing outside the workspace', async () => {
    const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'imnota-link-test-')));
    const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'imnota-outside-test-')));
    try {
      await symlink(outside, path.join(folder, 'exports'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(assertNoLinks(path.join(folder, 'exports', 'context.md'))).rejects.toThrow('Linked');
      await expect(atomicWrite(path.join(folder, 'exports', 'context.md'), 'secret')).rejects.toThrow(
        'Linked',
      );
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(folder, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
