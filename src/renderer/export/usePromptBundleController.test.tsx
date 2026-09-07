import { StrictMode, type PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ProjectSnapshot } from '../../shared/types';
import type { PromptBundleControllerBridge } from './prompt-export-controller-core';
import { usePromptBundleController } from './usePromptBundleController';

afterEach(cleanup);

function emptySnapshot(): ProjectSnapshot {
  return {
    projectPath: 'P:/opaque-project-grant',
    project: {
      schemaVersion: 3,
      collections: [
        {
          id: 'collection',
          name: 'Empty collection',
          archived: false,
          createdAt: '2026-09-07T10:00:00.000Z',
          updatedAt: '2026-09-07T10:00:00.000Z',
          overallContext: '',
        },
      ],
      id: 'project',
      name: 'Project',
      description: '',
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:00.000Z',
      status: 'active',
      favourite: false,
      screenshots: [],
      exportPreferences: {
        includeOriginalScreenshots: false,
        includeAnnotationMetadata: false,
        template: 'default',
      },
    },
    thumbnails: {},
    recoveryFound: false,
  };
}

test('remains usable after the React Strict Mode effect cleanup probe', async () => {
  const getSavedContext = vi.fn(async () => ({
    snapshot: emptySnapshot(),
    collectionId: 'collection',
  }));
  const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
  const { result } = renderHook(
    () =>
      usePromptBundleController({
        getSavedContext,
        bridge: {} as PromptBundleControllerBridge,
      }),
    { wrapper },
  );

  let outcome: Awaited<ReturnType<typeof result.current.open>> | undefined;
  await act(async () => {
    outcome = await result.current.open();
  });

  expect(outcome).toEqual({ ok: true });
  expect(result.current.isOpen).toBe(true);
  expect(result.current.noContentMessage).toContain('no screenshots');
  expect(getSavedContext).toHaveBeenCalledOnce();
});
