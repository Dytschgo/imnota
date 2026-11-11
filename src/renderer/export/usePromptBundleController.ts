import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  PromptBundleControllerEngine,
  type PromptBundleControllerActionResult,
  type PromptBundleRetryResult,
  type PromptBundleControllerBridge,
  type PromptBundleControllerRendering,
  type PromptBundleSelection,
  type HostedShareArtifacts,
  type PromptBundleControllerError,
  type SavedPromptExportContext,
} from './prompt-export-controller-core';
import type { WindowsCopyVariantId } from '../../shared/workflow-bridge';

export interface UsePromptBundleControllerOptions {
  /** Must flush UI edits and return the CAS-confirmed latest saved snapshot. */
  getSavedContext(): Promise<SavedPromptExportContext>;
  /** Test/integration seam; production uses the workflow methods exposed on window.imnota. */
  bridge?: PromptBundleControllerBridge;
  /** Test seam for deterministic browser-free orchestration tests. */
  rendering?: Partial<PromptBundleControllerRendering>;
  includeMasterOverview?: boolean;
  getIncludeRecognisedText?(): boolean;
}

export interface PromptBundleController {
  cards: ReturnType<PromptBundleControllerEngine['getState']>['cards'];
  progress?: ReturnType<PromptBundleControllerEngine['getState']>['progress'];
  error?: ReturnType<PromptBundleControllerEngine['getState']>['error'];
  isOpen: boolean;
  isErrorShowing(error: PromptBundleControllerError): boolean;
  canRetry: boolean;
  retry(): Promise<PromptBundleRetryResult>;
  cleanupPending: boolean;
  noContentMessage?: ReturnType<PromptBundleControllerEngine['getState']>['noContentMessage'];
  preview?: ReturnType<PromptBundleControllerEngine['getState']>['preview'];
  open(): Promise<PromptBundleControllerActionResult>;
  close(): void;
  clearPreview(): void;
  copyFresh(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  copyVariant(
    selection: PromptBundleSelection,
    variant: WindowsCopyVariantId,
  ): Promise<PromptBundleControllerActionResult>;
  prepareFreshFiles(selection?: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  copyMarkdown(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  copyImage(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  openFiles(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  copyPaths(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  openFolder(): Promise<PromptBundleControllerActionResult>;
  cancel(): Promise<PromptBundleControllerActionResult>;
  retryCleanup(): Promise<PromptBundleControllerActionResult>;
  loadPreview(selection: PromptBundleSelection): Promise<PromptBundleControllerActionResult>;
  prepareHostedShare(): Promise<
    { ok: true; value: HostedShareArtifacts } | { ok: false; error: PromptBundleControllerError }
  >;
}

function browserBridge(): PromptBundleControllerBridge {
  const imnota = window.imnota;
  return {
    ...(imnota as unknown as PromptBundleControllerBridge),
    async recognizeScreenshotText(input) {
      if (imnota.onDeviceOcrAvailable !== true) return '';
      if (typeof imnota.recognizeOnDeviceText !== 'function') return '';
      try {
        const result = await imnota.recognizeOnDeviceText({
          pngDataUrl: input.pngDataUrl,
          crop: input.crop,
        });
        if (!result.ok) return '';
        return result.value.text;
      } catch {
        return '';
      }
    },
  };
}

export function usePromptBundleController(options: UsePromptBundleControllerOptions): PromptBundleController {
  const getSavedContextRef = useRef(options.getSavedContext);
  const getIncludeRecognisedTextRef = useRef(options.getIncludeRecognisedText);
  const disposalGeneration = useRef(0);
  getSavedContextRef.current = options.getSavedContext;
  getIncludeRecognisedTextRef.current = options.getIncludeRecognisedText;
  const engineRef = useRef<PromptBundleControllerEngine | undefined>(undefined);
  if (!engineRef.current) {
    engineRef.current = new PromptBundleControllerEngine({
      getSavedContext: () => getSavedContextRef.current(),
      getIncludeRecognisedText: () => getIncludeRecognisedTextRef.current?.() ?? true,
      bridge: options.bridge ?? browserBridge(),
      rendering: options.rendering,
      includeMasterOverview: options.includeMasterOverview,
    });
  }
  const engine = engineRef.current;
  const retryTargetRef = useRef<
    | {
        error: PromptBundleControllerError;
        replay: () => Promise<PromptBundleRetryResult>;
      }
    | undefined
  >(undefined);
  const [retryTarget, setRetryTarget] = useState(retryTargetRef.current);
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

  return useMemo(() => {
    const run = async <T extends PromptBundleRetryResult>(
      action: () => Promise<T>,
      replay: () => Promise<PromptBundleRetryResult> = action,
    ): Promise<T> => {
      const result = await action();
      // Only the action that published the current error may supply its retry.
      // Superseded/cancelled completions and successful previews cannot replace it.
      if (!result.ok && engine.getState().error === result.error) {
        const target = { error: result.error, replay: () => run(replay, replay) };
        retryTargetRef.current = target;
        setRetryTarget(target);
      }
      return result;
    };
    const runForBundle = (
      selection: PromptBundleSelection,
      action: (current: PromptBundleSelection) => Promise<PromptBundleControllerActionResult>,
    ) => {
      const bundleNumber = typeof selection === 'number' ? selection : selection.bundleNumber;
      return run(
        () => action(selection),
        () => {
          const card = engine.getState().cards.find((item) => item.bundleNumber === bundleNumber);
          // Preparation replaces plan/session identities. Replay the user's action on
          // the current card; if it disappeared, rebuild for a new explicit choice.
          return card ? action(card) : engine.prepareFreshFiles();
        },
      );
    };
    return {
      ...state,
      canRetry: Boolean(state.error && retryTarget?.error === state.error),
      isErrorShowing: (error: PromptBundleControllerError) => {
        const current = engine.getState();
        return current.isOpen && !current.preview && current.error === error;
      },
      retry: () => {
        const target = retryTargetRef.current;
        return target && engine.getState().error === target.error
          ? target.replay()
          : Promise.resolve({ ok: true });
      },
      open: () => run(() => engine.open()),
      close: () => engine.close(),
      clearPreview: () => engine.clearPreview(),
      copyFresh: (selection: PromptBundleSelection) =>
        runForBundle(selection, (current) => engine.copyFresh(current)),
      copyVariant: (selection: PromptBundleSelection, variant: WindowsCopyVariantId) =>
        runForBundle(selection, (current) => engine.copyVariant(current, variant)),
      prepareFreshFiles: (selection?: PromptBundleSelection) =>
        selection === undefined
          ? run(() => engine.prepareFreshFiles())
          : runForBundle(selection, (current) => engine.prepareFreshFiles(current)),
      copyMarkdown: (selection: PromptBundleSelection) =>
        runForBundle(selection, (current) => engine.copyMarkdown(current)),
      copyImage: (selection: PromptBundleSelection) =>
        runForBundle(selection, (current) => engine.copyImage(current)),
      openFiles: (selection: PromptBundleSelection) =>
        runForBundle(selection, (current) => engine.openFiles(current)),
      copyPaths: (selection: PromptBundleSelection) =>
        runForBundle(selection, (current) => engine.copyPaths(current)),
      openFolder: () => run(() => engine.openFolder()),
      cancel: () => engine.cancel(),
      retryCleanup: () => engine.retryCleanup(),
      loadPreview: (selection: PromptBundleSelection) =>
        run(
          () => engine.loadPreview(selection),
          () => {
            const bundleNumber = typeof selection === 'number' ? selection : selection.bundleNumber;
            const card = engine.getState().cards.find((item) => item.bundleNumber === bundleNumber);
            return engine.loadPreview(card ?? bundleNumber);
          },
        ),
      prepareHostedShare: () => run(() => engine.prepareHostedShare()),
    };
  }, [engine, state, retryTarget]);
}
