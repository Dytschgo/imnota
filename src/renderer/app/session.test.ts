import { beforeEach, describe, expect, it } from 'vitest';
import { clearSessionCheckpoint, readSessionCheckpoint, saveSessionCheckpoint } from './session';

describe('session checkpoints', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips the workflow location used for update restarts', () => {
    const checkpoint = {
      workspacePath: '/workspace',
      view: 'workspace' as const,
      projectPath: '/workspace/project',
      collectionId: '001-collection',
      itemId: 'shot-2',
      search: 'checkout',
      savedAt: '2026-09-08T16:00:00.000Z',
    };

    saveSessionCheckpoint(checkpoint);

    expect(readSessionCheckpoint()).toEqual(checkpoint);
  });

  it('ignores malformed checkpoints and can clear a saved location', () => {
    localStorage.setItem('imnota:last-session', '{bad json');
    expect(readSessionCheckpoint()).toBeNull();

    saveSessionCheckpoint({
      workspacePath: null,
      view: 'settings',
      projectPath: null,
      collectionId: '001-collection',
      itemId: null,
      search: '',
      savedAt: '2026-09-08T16:00:00.000Z',
    });
    clearSessionCheckpoint();
    expect(readSessionCheckpoint()).toBeNull();
  });
});
