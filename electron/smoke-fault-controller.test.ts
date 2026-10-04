import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { atomicWrite, CommittedWriteError } from './files.js';
import { faultDigest, faultIdentity, validateFaultLaunch } from './smoke-fault-ownership.js';
import { OwnedSmokeFaultController } from './smoke-fault-controller.js';
import type { NativeFaultOwnership } from '../src/shared/native-faults.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    expect(path.dirname(root)).toBe(await fs.realpath(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^imnota-native-fault-unit-/);
    await fs.rm(root, { recursive: true });
  }
});
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-native-fault-unit-')));
  roots.push(root);
  const nonce = randomUUID();
  await fs.writeFile(path.join(root, '.imnota-native-fault-fixture.json'), JSON.stringify({ nonce }));
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  const id = `project_${randomUUID()}`;
  const source = JSON.stringify({ id, name: 'before' });
  await fs.writeFile(path.join(project, 'project.json'), source);
  const proof: NativeFaultOwnership = {
    schemaVersion: 1,
    nonce,
    grantId: 'unit',
    runRoot: root,
    profileRoot: path.join(root, 'profile'),
    artifactRoot: path.join(root, 'artifacts'),
    launcherPid: process.pid,
    caseSet: 'recovery-repair',
    sourceSha: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    version: 'unit',
    suppliedExecutable: path.join(root, 'synthetic.exe'),
    suppliedSha256: 'a'.repeat(64),
    executableSha256: 'b'.repeat(64),
    asarSha256: 'c'.repeat(64),
    buildSha256: 'd'.repeat(64),
  };
  const controller = new OwnedSmokeFaultController(proof, root);
  return { root, project, id, source, proof, controller, target: path.join(project, 'project.json') };
}

describe('owned real-filesystem fault boundary', () => {
  it('keeps B exact with A armed, consumes A before sync once, then writes A ordinarily', async () => {
    const value = await fixture();
    const { controller, target, source } = value;
    await controller.arm({ caseId: 'baseline-repair', projectPath: value.project, projectId: value.id });
    const other = path.join(value.project, 'other.json');
    expect(controller.atomicVerification(other)).toBeUndefined();
    await atomicWrite(other, 'B exact', controller.atomicVerification(other));
    expect(await fs.readFile(other, 'utf8')).toBe('B exact');
    expect(controller.events.filter((event) => event.event === 'consumed')).toHaveLength(0);
    const next = JSON.stringify({ id: value.id, name: 'after' });
    const transaction = path.join(value.project, '.imnota-transactions', `txn-${randomUUID()}`);
    await fs.mkdir(transaction, { recursive: true });
    await fs.writeFile(
      path.join(transaction, 'manifest.json'),
      JSON.stringify({
        token: path.basename(transaction),
        phase: 'applying',
        entries: [
          {
            relativePath: 'project.json',
            before: { sha256: faultDigest(source) },
            after: { sha256: faultDigest(next) },
          },
        ],
      }),
    );
    const write = () => atomicWrite(target, next, controller.atomicVerification(target));
    await expect(
      controller.invoke('content:save', [{ projectPath: value.project }], write),
    ).rejects.toMatchObject({ code: 'EIO' });
    expect(await fs.readFile(target, 'utf8')).toBe(source);
    expect(controller.events.filter((event) => event.event === 'consumed')).toHaveLength(1);
    await controller.invoke('content:save', [{ projectPath: value.project }], write);
    expect(JSON.parse(await fs.readFile(target, 'utf8')).name).toBe('after');
    expect(controller.events.filter((event) => event.event === 'consumed')).toHaveLength(1);
    controller.cancel();
    expect(controller.atomicVerification(target)).toBeUndefined();
    await atomicWrite(target, source);
    expect(await fs.readFile(target, 'utf8')).toBe(source);
  });
  it('refuses duplicate arming, foreign project identity and terminal plans', async () => {
    const value = await fixture();
    await expect(
      value.controller.arm({ caseId: 'baseline-repair', projectPath: value.project, projectId: 'foreign' }),
    ).rejects.toThrow('identity');
    const next = await fixture();
    const input = { caseId: 'baseline-repair', projectPath: next.project, projectId: next.id };
    await next.controller.arm(input);
    await expect(next.controller.arm(input)).rejects.toThrow('duplicate');
    next.controller.cancel();
    await expect(next.controller.arm(input)).rejects.toThrow('terminal');
  });
  it('retains the real IPC error if its evidence observer also fails', async () => {
    const value = await fixture();
    await value.controller.arm({
      caseId: 'baseline-repair',
      projectPath: value.project,
      projectId: value.id,
    });
    while (value.controller.events.length < 2000) value.controller.events.push({ event: 'bounded-fixture' });
    const original = new Error('original persistence failure');
    await expect(
      value.controller.invoke('content:save', [{ projectPath: value.project }], () => {
        throw original;
      }),
    ).rejects.toMatchObject({ errors: [original, expect.any(Error)] });
    expect(() => value.controller.assertHealthy()).toThrow('evidence bound');
    await expect(value.controller.disarm([])).rejects.toThrow('Disarm and its evidence');
    expect(value.controller.atomicVerification(value.target)).toBeUndefined();
    expect(() => value.controller.cancel()).not.toThrow();
    expect(value.controller.events.at(-1)).toMatchObject({ event: 'terminal', disarmed: true });
  });
  it('refuses hardlinks, aliases and missing markers without touching their targets', async () => {
    const value = await fixture();
    const alias = path.join(value.root, 'alias');
    await fs.symlink(value.project, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(faultIdentity(alias, true)).rejects.toThrow();
    const hard = path.join(value.root, 'hard.json');
    await fs.link(value.target, hard);
    await expect(faultIdentity(value.target)).rejects.toThrow('unlinked');
    expect(await fs.readFile(hard, 'utf8')).toBe(value.source);
    await fs.unlink(hard);
    await fs.unlink(path.join(value.root, '.imnota-native-fault-fixture.json'));
    await expect(
      value.controller.arm({ caseId: 'baseline-repair', projectPath: value.project, projectId: value.id }),
    ).rejects.toThrow();
  });
  it('labels the actual platform boundary and preserves typed postrename commit semantics', async () => {
    const value = await fixture();
    const seen: string[] = [];
    const operation = atomicWrite(value.target, 'committed bytes', {
      beforeParentSync: async (_target, _directory, boundary) => {
        seen.push(boundary);
        expect(await fs.readFile(value.target, 'utf8')).toBe('committed bytes');
        throw Object.assign(new Error('synthetic boundary'), { code: 'EACCES' });
      },
    });
    await expect(operation).rejects.toBeInstanceOf(CommittedWriteError);
    expect(seen).toEqual([
      process.platform === 'win32' ? 'windows-directory-sync-unsupported' : 'posix-directory-handle',
    ]);
    expect(faultDigest(await fs.readFile(value.target))).toBe(faultDigest('committed bytes'));
  });
  it('does not enable ordinary launches and rejects a fault flag without packaged ownership', async () => {
    const input = {
      env: {},
      temporaryRoot: os.tmpdir(),
      executable: '',
      asar: '',
      version: '',
      packaged: false,
    };
    expect(await validateFaultLaunch(input)).toBeUndefined();
    await expect(validateFaultLaunch({ ...input, env: { IMNOTA_SMOKE_MODE: 'faults' } })).rejects.toThrow(
      'owned packaged',
    );
  });
  it.each(['stale', 'replaced-same-bytes', 'wrong-token', 'wrong-stage', 'observer-hardlink'] as const)(
    'fails closed for Restore %s without consuming a fault',
    async (reason) => {
      const value = await fixture();
      const controller = new OwnedSmokeFaultController(
        { ...value.proof, caseSet: 'restore-eio' },
        value.root,
      );
      const token = `delete-${randomUUID()}`;
      const journal = path.join(value.project, '.imnota-undo', token);
      await fs.mkdir(journal, { recursive: true });
      const manifest = { token, phase: 'deleted', screenshot: { id: 'shot_fixture' } };
      await fs.writeFile(path.join(journal, 'manifest.json'), JSON.stringify(manifest));
      await controller.arm({
        caseId: 'screenshot',
        projectPath: value.project,
        projectId: value.id,
        token,
        itemId: 'shot_fixture',
        kind: 'screenshot',
      });
      await fs.writeFile(
        path.join(journal, 'manifest.json'),
        JSON.stringify({ ...manifest, phase: reason === 'wrong-stage' ? 'deleted' : 'undoing' }),
      );
      if (reason === 'stale')
        await fs.writeFile(value.target, JSON.stringify({ id: value.id, name: 'foreign' }));
      if (reason === 'replaced-same-bytes') await atomicWrite(value.target, value.source);
      if (reason === 'observer-hardlink') await fs.link(value.target, path.join(value.root, 'hard-peer'));
      const preserved = await fs.readFile(value.target);
      await expect(
        controller.invoke(
          'screenshots:undo-delete',
          [
            {
              projectPath: value.project,
              undoToken: reason === 'wrong-token' ? `delete-${randomUUID()}` : token,
            },
          ],
          () => atomicWrite(value.target, 'must not write', controller.atomicVerification(value.target)),
        ),
      ).rejects.toThrow();
      expect(await fs.readFile(value.target)).toEqual(preserved);
      expect(controller.events.filter((event) => event.event === 'consumed')).toHaveLength(0);
      expect(() => controller.assertHealthy()).toThrow();
    },
  );
  it('fails the restored marker BEFORE its candidate and keeps the old undoing bytes exact', async () => {
    const value = await fixture();
    const controller = new OwnedSmokeFaultController(
      { ...value.proof, caseSet: 'restore-marker' },
      value.root,
    );
    const token = `delete-${randomUUID()}`;
    const journal = path.join(value.project, '.imnota-undo', token);
    await fs.mkdir(journal, { recursive: true });
    const manifest = { token, phase: 'deleted', screenshot: { id: 'shot_fixture' } };
    const marker = path.join(journal, 'manifest.json');
    await fs.writeFile(marker, JSON.stringify(manifest));
    await controller.arm({
      caseId: 'screenshot',
      projectPath: value.project,
      projectId: value.id,
      token,
      itemId: 'shot_fixture',
      kind: 'screenshot',
    });
    const undoing = JSON.stringify({ ...manifest, phase: 'undoing' });
    const after = JSON.stringify({ id: value.id, name: 'restored' });
    await fs.writeFile(marker, undoing);
    await fs.writeFile(path.join(journal, 'undo-after.bin'), after);
    vi.spyOn(controller, 'command').mockResolvedValue({
      pendingMetadata: true,
      nativeMutations: 1,
    } as Awaited<ReturnType<typeof controller.command>>);
    await controller.invoke(
      'screenshots:undo-delete',
      [{ projectPath: value.project, undoToken: token }],
      async () => {
        await expect(
          atomicWrite(value.target, after, controller.atomicVerification(value.target)),
        ).rejects.toBeInstanceOf(CommittedWriteError);
        await expect(
          atomicWrite(
            marker,
            JSON.stringify({ ...manifest, phase: 'restored', undoAfter: { sha256: faultDigest(after) } }),
            controller.atomicVerification(marker),
          ),
        ).rejects.toMatchObject({ code: 'EACCES' });
      },
    );
    expect(await fs.readFile(marker, 'utf8')).toBe(undoing);
    expect(await fs.readFile(value.target, 'utf8')).toBe(after);
    expect((await fs.readdir(journal)).some((name) => name.includes('.tmp-'))).toBe(false);
    expect(
      controller.events.filter((event) => event.event === 'consumed').map((event) => event.fault),
    ).toEqual(['metadata', 'marker']);
    expect(() => controller.assertHealthy()).not.toThrow();
  });
});
