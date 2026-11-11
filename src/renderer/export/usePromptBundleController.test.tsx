import { StrictMode, type PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ProjectSnapshot } from '../../shared/types';
import {
  PromptBundleControllerEngine,
  type PromptBundleControllerBridge,
} from './prompt-export-controller-core';
import { controllerExportFailure } from './export-failure-catalog';
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

test('checks the current dialog after an action opens it, and keeps errors reportable when it closes', async () => {
  const { result } = renderHook(() =>
    usePromptBundleController({
      getSavedContext: async () => {
        throw new Error('Cannot save D:/private/project');
      },
      bridge: {} as PromptBundleControllerBridge,
    }),
  );
  const original = result.current;
  await act(async () => {
    const failure = await original.open();
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(original.isErrorShowing(failure.error)).toBe(true);
  });
  const failure = result.current.error!;
  act(() => result.current.close());
  expect(original.isErrorShowing(failure)).toBe(false);
});

test('Try again repeats the failed action before cards exist', async () => {
  const getSavedContext = vi.fn<() => Promise<{ snapshot: ProjectSnapshot; collectionId: string }>>(
    async () => {
      throw new Error('Save failed');
    },
  );
  const { result } = renderHook(() =>
    usePromptBundleController({
      getSavedContext,
      bridge: {} as PromptBundleControllerBridge,
    }),
  );
  await act(async () => {
    await result.current.open();
  });
  getSavedContext.mockImplementation(async () => ({ snapshot: emptySnapshot(), collectionId: 'collection' }));
  await act(async () => {
    expect(await result.current.retry()).toEqual({ ok: true });
  });
  expect(result.current.error).toBeUndefined();
  expect(getSavedContext).toHaveBeenCalledTimes(2);
});

test('a disposed action without a displayed error leaves retry harmless', async () => {
  const rejected = vi.spyOn(PromptBundleControllerEngine.prototype, 'copyImage').mockResolvedValue({
    ok: false,
    error: controllerExportFailure('disposed'),
  });
  const getSavedContext = vi.fn(async () => ({ snapshot: emptySnapshot(), collectionId: 'collection' }));
  const { result } = renderHook(() =>
    usePromptBundleController({ getSavedContext, bridge: {} as PromptBundleControllerBridge }),
  );
  try {
    await act(async () => {
      await result.current.open();
    });
    await act(async () => {
      await result.current.copyImage(1);
    });
    await act(async () => {
      expect((await result.current.retry()).ok).toBe(true);
    });
    expect(result.current.canRetry).toBe(false);
    expect(getSavedContext).toHaveBeenCalledOnce();
    expect(rejected).toHaveBeenCalledOnce();
  } finally {
    rejected.mockRestore();
  }
});
