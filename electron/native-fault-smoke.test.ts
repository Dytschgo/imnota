// @vitest-environment node
import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { FaultObservation } from '../src/shared/native-faults.js';
import { editExternalFaultMember } from './native-fault-smoke.js';

vi.mock('electron', () => ({ nativeImage: {} }));

it.each([null, 'old-revision'])(
  'does not edit a reopened fixture with watch revision %s before the expected revision',
  async (initialRevision) => {
    const temporaryRoot = await fs.realpath(os.tmpdir());
    const root = await fs.mkdtemp(path.join(temporaryRoot, 'imnota-native-watch-ready-'));
    const target = path.join(root, 'description.md');
    const original = 'fixture-own-shot';
    await fs.writeFile(target, original);
    let release!: (value: FaultObservation) => void;
    const pendingWatch = new Promise<FaultObservation>((resolve) => {
      release = resolve;
    });
    const observation = (revision: string | null) =>
      ({
        acceptedRevision: revision,
        pendingMetadata: false,
        nativeMutations: 0,
      }) as FaultObservation;
    let requested!: () => void;
    const firstObservation = new Promise<void>((resolve) => {
      requested = resolve;
    });
    let attempts = 0;
    const controller = {
      caseEvents: [],
      command: vi.fn(async () => {
        if (++attempts === 1) return observation(initialRevision);
        requested();
        return pendingWatch;
      }),
    };
    let watcher: ReturnType<typeof watch> | undefined;
    const edit = editExternalFaultMember(controller, target, 'ready-revision');
    try {
      // An early completion means the edit escaped before monitoring existed.
      await Promise.race([firstObservation, edit]);
      expect(await fs.readFile(target, 'utf8')).toBe(original);
      let changed!: () => void;
      const notification = new Promise<void>((resolve) => {
        changed = resolve;
      });
      watcher = watch(root, (_event, filename) => {
        if (filename?.toString() === 'description.md') changed();
      });
      release(observation('ready-revision'));
      const result = await edit;
      await notification;
      expect(await fs.readFile(target, 'utf8')).toBe('fixture-ext-shot');
      expect(result.next.length).toBe(result.prior.length);
      expect((await fs.stat(target)).mtimeMs).toBeCloseTo(result.priorStat.mtimeMs, 0);
    } finally {
      release(observation('ready-revision'));
      await edit.catch(() => undefined);
      watcher?.close();
      expect(path.dirname(root)).toBe(temporaryRoot);
      expect(path.basename(root)).toMatch(/^imnota-native-watch-ready-/);
      await fs.rm(root, { recursive: true });
    }
  },
);
