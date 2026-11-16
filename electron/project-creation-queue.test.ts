// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withinProjectCreationQueue } from './project-creation-queue.js';
import { createTemplateProject } from './template-project.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-creation-queue-'));
  roots.push(root);
  return root;
}

describe('project creation queue', () => {
  it('orders blank and template creation so they never pick the same folder', async () => {
    const root = await workspace();
    let releaseBlank!: () => void;
    const blankGate = new Promise<void>((resolve) => (releaseBlank = resolve));
    let markChosen!: () => void;
    const blankChosen = new Promise<void>((resolve) => (markChosen = resolve));
    // A blank creation that has chosen its free folder name but has not created it yet.
    const blank = withinProjectCreationQueue(async () => {
      const folder = path.join(root, 'shared-name');
      await expect(fs.stat(folder)).rejects.toMatchObject({ code: 'ENOENT' });
      markChosen();
      await blankGate;
      await fs.mkdir(folder);
      return folder;
    });
    await blankChosen;
    let templateSettled = false;
    const template = createTemplateProject(root, {
      name: 'Shared name',
      description: '',
      templateId: 'bug-report',
    }).finally(() => (templateSettled = true));
    // With separate queues the template claimed shared-name here, before the blank project.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(templateSettled).toBe(false);
    expect(await fs.readdir(root)).toEqual([]);
    releaseBlank();
    expect(await blank).toBe(path.join(root, 'shared-name'));
    expect(await template).toBe(path.join(root, 'shared-name-2'));
  });

  it('lets a queued operation create a template without waiting behind itself', async () => {
    const root = await workspace();
    const folder = await withinProjectCreationQueue(() =>
      createTemplateProject(root, { name: 'Nested', description: '', templateId: 'bug-report' }),
    );
    expect(folder).toBe(path.join(root, 'nested'));
    await expect(withinProjectCreationQueue(async () => 'next')).resolves.toBe('next');
  });

  it('makes async work left behind by a finished operation wait for the current holder', async () => {
    const events: string[] = [];
    let releaseChild!: () => void;
    const childGate = new Promise<void>((resolve) => (releaseChild = resolve));
    let releaseB!: () => void;
    const bGate = new Promise<void>((resolve) => (releaseB = resolve));
    let markBStarted!: () => void;
    const bStarted = new Promise<void>((resolve) => (markBStarted = resolve));
    let child!: Promise<void>;
    // Review reproduction: A starts a detached async child and finishes without awaiting it.
    await withinProjectCreationQueue(async () => {
      events.push('A');
      child = (async () => {
        await childGate;
        await withinProjectCreationQueue(async () => {
          events.push('child');
        });
      })();
    });
    const b = withinProjectCreationQueue(async () => {
      events.push('B start');
      markBStarted();
      await bGate;
      events.push('B end');
    });
    await bStarted;
    releaseChild();
    // Give the child every chance to run if it wrongly reused A's finished turn.
    for (let tick = 0; tick < 20; tick++) await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual(['A', 'B start']);
    releaseB();
    await b;
    await child;
    expect(events).toEqual(['A', 'B start', 'B end', 'child']);
  });

  it('keeps running later operations after one fails', async () => {
    const failed = withinProjectCreationQueue(async () => {
      throw new Error('disk unavailable');
    });
    const next = withinProjectCreationQueue(async () => 'created');
    await expect(failed).rejects.toThrow('disk unavailable');
    await expect(next).resolves.toBe('created');
  });
});
