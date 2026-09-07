import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  PromptBundleControllerEngine,
  type PromptBundleControllerActionResult,
  type PromptBundleControllerBridge,
  type PromptBundleControllerRendering,
  type PromptBundleSelection,
  type SavedPromptExportContext,
} from './prompt-export-controller-core';

export interface UsePromptBundleControllerOptions {
  /** Must flush UI edits and return the CAS-confirmed latest saved snapshot. */
  getSavedContext(): Promise<SavedPromptExportContext>;
  /** Test/integration seam; production uses the workflow methods exposed on window.imnota. */
  bridge?: PromptBundleControllerBridge;
  /** Test seam for deterministic browser-free orchestration tests. */
  rendering?: Partial<PromptBundleControllerRendering>;
  includeMasterOverview?: boolean;
}

export interface PromptBundleController {
  cards: ReturnType<PromptBundleControllerEngine['getState']>['cards'];
  progress?: ReturnType<PromptBundleControllerEngine['getState']>['progress'];
  error?: ReturnType<PromptBundleControllerEngine['getState']>['error'];
  isOpen: boolean;
  cleanupPending: boolean;
  noContentMessage?: ReturnType<PromptBundleControllerEngine['getState']>['noContentMessage'];
  preview?: ReturnType<PromptBundleControllerEngine['getState']>['preview'];
  open(): Promise<PromptBundleControllerActionResult>;
  close(): void;
  clearPreview(): void;
  copyFresh(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  prepareFreshFiles(selection?: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  copyMarkdown(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  copyImage(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  openFiles(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  openFolder(): Promise<PromptBundleControllerActionResult>;
  cancel(): Promise<PromptBundleControllerActionResult>;
  retryCleanup(): Promise<PromptBundleControllerActionResult>;
  loadPreview(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
}

function browserBridge(): PromptBundleControllerBridge {
  return window.imnota as unknown as PromptBundleControllerBridge;
}

export function usePromptBundleController(options: UsePromptBundleControllerOptions): PromptBundleController {
  const getSavedContextRef = useRef(options.getSavedContext);
  const disposalGeneration = useRef(0);
  getSavedContextRef.current = options.getSavedContext;
  const engineRef = useRef<PromptBundleControllerEngine>();
  if (!engineRef.current) {
    engineRef.current = new PromptBundleControllerEngine({
      getSavedContext: () => getSavedContextRef.current(),
      bridge: options.bridge ?? browserBridge(),
      rendering: options.rendering,
      includeMasterOverview: options.includeMasterOverview,
    });
  }
  const engine = engineRef.current;
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);

  useEffect(() => {
    disposalGeneration.current += 1;
    return () => {
      const generation = ++disposalGeneration.current;
      queueMicrotask(() => {
        if (disposalGeneration.current === generation) engine.dispose();
      });
    };
  }, [engine]);

  return useMemo(
    () => ({
      ...state,
      open: () => engine.open(),
      close: () => engine.close(),
      clearPreview: () => engine.clearPreview(),
      copyFresh: (selection: PromptBundleSelection) => engine.copyFresh(selection),
      prepareFreshFiles: (selection?: PromptBundleSelection) => engine.prepareFreshFiles(selection),
      copyMarkdown: (selection: PromptBundleSelection) => engine.copyMarkdown(selection),
      copyImage: (selection: PromptBundleSelection) => engine.copyImage(selection),
      openFiles: (selection: PromptBundleSelection) => engine.openFiles(selection),
      openFolder: () => engine.openFolder(),
      cancel: () => engine.cancel(),
      retryCleanup: () => engine.retryCleanup(),
      loadPreview: (selection: PromptBundleSelection) => engine.loadPreview(selection),
    }),
    [engine, state],
  );
}
