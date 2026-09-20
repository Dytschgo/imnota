import { describe, expect, test, vi } from 'vitest';
import type { Annotation, ProjectData, ProjectSnapshot, ScreenshotRecord } from '../../shared/types';
import type {
  PromptExportBundleContent,
  PromptExportBundleGrant,
  PromptExportFinalized,
  PromptExportSessionInfo,
  WorkflowResult,
} from '../../shared/workflow-bridge';
import type { PromptBundleComposition } from '../prompt-bundle-render';
import {
  PromptBundleControllerEngine,
  type PromptBundleComposeControllerOptions,
  type PromptBundleControllerBridge,
  type PromptBundleControllerRendering,
  type PromptExportBundleManifestInput,
  type SavedPromptExportContext,
} from './prompt-export-controller-core';

const PNG = 'data:image/png;base64,QUJD';
const THUMBNAIL = 'data:image/png;base64,VEhVTUI=';

function ok<T>(value: T): WorkflowResult<T> {
  return { ok: true, value };
}

function screenshot(index: number, includeInExport = true): ScreenshotRecord {
  const id = `shot-${index + 1}`;
  return {
    collectionId: 'collection',
    id,
    originalFilename: `${id}.png`,
    storedFilename: `${id}.png`,
    title: `Picture title ${index + 1}`,
    description: `Description ${index + 1}`,
    position: index,
    createdAt: '2026-09-07T10:00:00.000Z',
    updatedAt: '2026-09-07T10:00:00.000Z',
    priority: 'medium',
    annotationFile: `${id}.annotations.json`,
    descriptionFile: `${id}.md`,
    originalWidth: 100,
    originalHeight: 80,
    includeInExport,
  };
}

function savedContext(screenshots: ScreenshotRecord[]): SavedPromptExportContext {
  const snapshot: ProjectSnapshot = {
    projectPath: 'P:/opaque-project-grant',
    project: {
      schemaVersion: 3,
      collections: [
        {
          id: 'collection',
          name: 'Checkout review',
          archived: false,
          createdAt: '2026-09-07T10:00:00.000Z',
          updatedAt: '2026-09-07T10:00:00.000Z',
          overallContext: 'Keep the checkout accessible.',
        },
      ],
      id: 'project',
      name: 'Project',
      description: '',
      createdAt: '2026-09-07T10:00:00.000Z',
      updatedAt: '2026-09-07T10:00:00.000Z',
      status: 'active',
      favourite: false,
      screenshots,
      exportPreferences: {
        includeOriginalScreenshots: false,
        includeAnnotationMetadata: false,
        template: 'default',
      },
    },
    thumbnails: Object.fromEntries(screenshots.map((item) => [item.id, THUMBNAIL])),
    recoveryFound: false,
  };
  return { snapshot, collectionId: 'collection' };
}

interface FakeBridgeOptions {
  annotations?: Readonly<Record<string, Annotation[]>>;
  revisionForLoad?: (screenshotId: string, callNumber: number) => string;
  failContextCopy?: boolean;
  /** Clipboard read-back for combined copies; defaults to every format present. */
  placed?: { text: boolean; html: boolean; image: boolean; files: boolean };
  failFinish?: boolean;
}

function fakeBridge(options: FakeBridgeOptions = {}) {
  const loadCounts = new Map<string, number>();
  const starts: Array<{
    projectPath: string;
    collectionId: string;
    bundles: readonly PromptExportBundleManifestInput[];
  }> = [];
  const writes: Array<{
    sessionId: string;
    bundleNumber: number;
    pngDataUrl?: string;
    markdown: string;
    sourceAssets?: readonly { filename: string; source: string }[];
  }> = [];
  const copies: Array<{ sessionId: string; bundleNumber: number; target: string }> = [];
  const opens: Array<{ sessionId: string; bundleNumber: number; target: string }> = [];
  const finishes: Array<{ sessionId: string; masterMarkdown?: string }> = [];
  const cancellations: string[] = [];
  let sessionCount = 0;

  const grants = (sessionId: string): PromptExportBundleGrant[] =>
    writes
      .filter((write) => write.sessionId === sessionId)
      .map((write) => ({
        bundleNumber: write.bundleNumber,
        pngFilename: write.pngDataUrl ? `Prompt-${write.bundleNumber}.png` : '',
        markdownFilename: `Prompt-${write.bundleNumber}.md`,
      }));

  const bridge: PromptBundleControllerBridge = {
    async loadScreenshotContent({ screenshot: item }) {
      const callNumber = (loadCounts.get(item.id) ?? 0) + 1;
      loadCounts.set(item.id, callNumber);
      return {
        image: {
          filename: item.originalFilename,
          dataUrl: PNG,
          width: item.originalWidth,
          height: item.originalHeight,
        },
        annotations: structuredClone(options.annotations?.[item.id] ?? []),
        description: item.description,
        contentRevision: options.revisionForLoad?.(item.id, callNumber) ?? `revision-${item.id}`,
      };
    },
    async loadContentItem({ itemId }) {
      if (itemId.startsWith('text'))
        return {
          item: {
            id: itemId,
            collectionId: 'collection',
            kind: 'text' as const,
            position: 0,
            includeInExport: true,
            createdAt: '2026-09-07T10:00:00.000Z',
            updatedAt: '2026-09-07T10:00:00.000Z',
            markdownFilename: `${itemId}.md`,
          },
          markdown: `Text body for ${itemId}.`,
          contentRevision: `revision-${itemId}`,
        };
      return {
        item: {
          id: itemId,
          collectionId: 'collection',
          kind: 'drawing' as const,
          position: 0,
          includeInExport: true,
          createdAt: '2026-09-07T10:00:00.000Z',
          updatedAt: '2026-09-07T10:00:00.000Z',
          title: 'Drawing',
          sourceFilename: `${itemId}.json`,
          imageFilename: `${itemId}.png`,
          originalWidth: 100,
          originalHeight: 80,
        },
        source: '{"type":"excalidraw"}',
        image: { filename: `${itemId}.png`, dataUrl: PNG, width: 100, height: 80 },
        contentRevision: `revision-${itemId}`,
      };
    },
    async startPromptExport(input) {
      starts.push(structuredClone(input));
      sessionCount += 1;
      return ok<PromptExportSessionInfo>({
        sessionId: `session-${sessionCount}`,
        collectionId: input.collectionId,
        timestamp: '260907-184205',
        setName: `Checkout review - 260907-184205-${sessionCount}`,
      });
    },
    async writePromptExportBundle(input) {
      writes.push(structuredClone(input));
      return ok({
        bundleNumber: input.bundleNumber,
        pngFilename: `Prompt-${input.bundleNumber}.png`,
        markdownFilename: `Prompt-${input.bundleNumber}.md`,
      });
    },
    async finishPromptExport(input) {
      finishes.push(structuredClone(input));
      if (options.failFinish)
        return {
          ok: false,
          error: { code: 'io-failure', message: 'Could not finalize export.', retryable: true },
        };
      return ok<PromptExportFinalized>({
        status: 'completed',
        published: true,
        bundles: grants(input.sessionId),
        hasMasterMarkdown: Boolean(input.masterMarkdown),
        warnings: [],
      });
    },
    async cancelPromptExport({ sessionId }) {
      cancellations.push(sessionId);
      return ok<PromptExportFinalized>({
        status: 'cancelled',
        published: grants(sessionId).length > 0,
        bundles: grants(sessionId),
        hasMasterMarkdown: false,
        warnings: [],
      });
    },
    async readPromptExportBundle({ sessionId, bundleNumber }) {
      const write = writes.find(
        (candidate) => candidate.sessionId === sessionId && candidate.bundleNumber === bundleNumber,
      );
      if (!write) throw new Error('Missing fake bundle');
      return ok<PromptExportBundleContent>({
        bundleNumber,
        pngFilename: `Prompt-${bundleNumber}.png`,
        markdownFilename: `Prompt-${bundleNumber}.md`,
        markdown: write.markdown,
        imageDataUrl: write.pngDataUrl,
      });
    },
    async copyPromptExportBundle(input) {
      copies.push(structuredClone(input));
      if (options.failContextCopy && input.target === 'rich')
        return {
          ok: false,
          error: {
            code: 'clipboard-limit',
            message: 'Combined clipboard content exceeded the native limit.',
            retryable: true,
          },
        };
      return ok({
        target: input.target,
        placed:
          input.target === 'rich' || input.target === 'files' || input.target === 'files-rich'
            ? (options.placed ?? { text: true, html: true, image: true, files: false })
            : undefined,
      });
    },
    async openPromptExportBundle(input) {
      opens.push(structuredClone(input));
      return ok(undefined);
    },
  };
  return { bridge, starts, writes, copies, opens, finishes, cancellations, loadCounts };
}

interface FakeRenderingOptions {
  preflightSize?: { width: number; height: number };
  compose?: (
    bundleNumber: number,
    pictureIds: readonly string[],
    options: PromptBundleComposeControllerOptions,
    defaultCompose: () => Promise<PromptBundleComposition>,
  ) => Promise<PromptBundleComposition>;
}

function fakeRendering(options: FakeRenderingOptions = {}) {
  let activeRenders = 0;
  let maxActiveRenders = 0;
  let renderCount = 0;
  let composeCount = 0;
  const rendering: PromptBundleControllerRendering = {
    async preflight() {
      const size = options.preflightSize ?? { width: 100, height: 80 };
      return { screenshotId: '', ...size, estimatedPngCharacters: 16 };
    },
    async render(image, _annotations, renderOptions) {
      if (renderOptions.signal.aborted) throw new Error('aborted');
      activeRenders += 1;
      maxActiveRenders = Math.max(maxActiveRenders, activeRenders);
      renderCount += 1;
      await Promise.resolve();
      activeRenders -= 1;
      return {
        dataUrl: PNG,
        width: options.preflightSize?.width ?? image.width,
        height: options.preflightSize?.height ?? image.height,
        bounds: { x: 0, y: 0, width: image.width, height: image.height },
        sourceBounds: { x: 0, y: 0, width: image.width, height: image.height },
      };
    },
    async compose(bundle, composeOptions) {
      composeCount += 1;
      const defaultCompose = async (): Promise<PromptBundleComposition> => {
        for (const picture of bundle.pictures) {
          const resolved = await composeOptions.resolvePicturePng(picture);
          expect(resolved.contentRevision).toBe(picture.contentRevision);
          expect({ width: resolved.width, height: resolved.height }).toEqual({
            width: picture.width,
            height: picture.height,
          });
          resolved.release?.();
        }
        return {
          kind: 'composed',
          dataUrl: PNG,
          width: bundle.layout.width,
          height: bundle.layout.height,
          encodedCharacters: 120,
          delivery: bundle.delivery,
          warning: bundle.warning,
        };
      };
      return options.compose
        ? options.compose(
            bundle.number,
            bundle.pictures.map((picture) => picture.screenshotId),
            composeOptions,
            defaultCompose,
          )
        : defaultCompose();
    },
  };
  return {
    rendering,
    stats: {
      get maxActiveRenders() {
        return maxActiveRenders;
      },
      get renderCount() {
        return renderCount;
      },
      get composeCount() {
        return composeCount;
      },
    },
  };
}

function engine(
  getSavedContext: () => Promise<SavedPromptExportContext>,
  bridge: PromptBundleControllerBridge,
  rendering: PromptBundleControllerRendering,
) {
  return new PromptBundleControllerEngine({ getSavedContext, bridge, rendering });
}

describe('prompt export controller orchestration', () => {
  test('numbers the full scope before exclusion and shares creation-order note references', async () => {
    const screenshots = [screenshot(0), screenshot(1, false), screenshot(2)];
    const annotations: Record<string, Annotation[]> = {
      'shot-1': [
        { id: 'first', kind: 'text', x: 0, y: 0, text: 'First note', zIndex: 99 },
        { id: 'shape', kind: 'rectangle', x: 10, y: 8, width: 20, height: 16, zIndex: 2 },
        { id: 'blank', kind: 'text', x: 0, y: 0, text: '   ', zIndex: 1 },
        { id: 'a1', kind: 'arrow', x: 12, y: 32, points: [0, 0, 38, 8], zIndex: 3 },
        { id: 's2', kind: 'step', x: 70, y: 40, stepNumber: 1, zIndex: 4 },
        { id: 'second', kind: 'callout', x: 0, y: 0, text: 'Second note', zIndex: 0 },
      ],
    };
    const native = fakeBridge({ annotations });
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext(screenshots), native.bridge, renderer.rendering);

    const result = await controller.prepareFreshFiles();

    expect(result.ok).toBe(true);
    expect(native.writes).toHaveLength(1);
    expect(native.writes[0].markdown).toContain('## Picture 1 — Picture title 1');
    expect(native.writes[0].markdown).toContain('## Picture 3 — Picture title 3');
    expect(native.writes[0].markdown).toContain('Picture 2 was intentionally excluded');
    expect(native.writes[0].markdown.indexOf('Picture 1 / Note 1')).toBeLessThan(
      native.writes[0].markdown.indexOf('Picture 1 / Note 2'),
    );
    expect(native.writes[0].markdown).toContain(
      [
        '### Picture 1 / Marks',
        '',
        '- text `first` note 1 at 0.0%,0.0% 0.0%×0.0%',
        '- rectangle `shape` at 10.0%,10.0% 20.0%×20.0%',
        '- arrow `a1` from 12.0%,40.0% to 50.0%,50.0%',
        '- step `s2` number 1 at 70.0%,50.0%',
        '- callout `second` note 2 at 0.0%,0.0% 0.0%×0.0%',
      ].join('\n'),
    );
    expect(native.writes[0].markdown).not.toContain('Note 3');
    expect(native.writes[0].markdown).not.toContain('opaque-project-grant');
    expect(native.finishes[0].masterMarkdown).toContain('Picture 2 — Picture title 2');
    expect(native.finishes[0].masterMarkdown).toContain('Keep the checkout accessible.');
    expect(native.finishes[0].masterMarkdown).not.toContain('opaque-project-grant');
  });

  test('preserves indented Markdown in master context and descriptions while normalizing line endings', async () => {
    const context = savedContext([screenshot(0)]);
    context.snapshot.project.collections[0].overallContext =
      '    const enabled = true;\r\n        return enabled;\r\n';
    context.snapshot.project.screenshots[0].description =
      'Run this command:\r\n\r\n    corepack pnpm test\r\n';
    const native = fakeBridge();
    const renderer = fakeRendering();
    const controller = engine(async () => context, native.bridge, renderer.rendering);

    await controller.prepareFreshFiles();

    const overview = native.finishes[0].masterMarkdown;
    expect(overview).toContain('## Overall context\n\n    const enabled = true;\n        return enabled;\n');
    expect(overview).toContain('Run this command:\n\n    corepack pnpm test\n');
    expect(overview).not.toContain('\r');
  });

  test('copy fresh ignores an open-time plan and exports the latest saved state with reserved identity', async () => {
    const older = savedContext([screenshot(0)]);
    const newerShot = { ...screenshot(0), title: 'Latest saved title' };
    const newer = savedContext([newerShot]);
    let saveCall = 0;
    const native = fakeBridge();
    const renderer = fakeRendering();
    const controller = engine(
      async () => structuredClone(saveCall++ === 0 ? older : newer),
      native.bridge,
      renderer.rendering,
    );

    await controller.open();
    const result = await controller.copyFresh(1);

    expect(result.ok).toBe(true);
    expect(native.writes[0].markdown).toContain('Latest saved title');
    expect(native.writes[0].markdown).not.toContain('Picture title 1');
    expect(native.writes[0].markdown).toContain('Export set: Checkout review - 260907-184205-1');
    expect(native.copies).toEqual([{ sessionId: 'session-1', bundleNumber: 1, target: 'rich' }]);
  });

  test('rejects a changed content revision before reserving a native session', async () => {
    const native = fakeBridge({
      revisionForLoad: (_id, call) => (call === 1 ? 'planned-revision' : 'changed-revision'),
    });
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);

    const result = await controller.prepareFreshFiles();

    expect(result).toMatchObject({ ok: false, error: { code: 'content-changed' } });
    expect(native.starts).toHaveLength(0);
    expect(native.writes).toHaveLength(0);
  });

  test('settles actual encoded overflow before manifest reservation or Markdown commit', async () => {
    const events: string[] = [];
    let overflowReturned = false;
    const native = fakeBridge();
    const originalStart = native.bridge.startPromptExport;
    native.bridge.startPromptExport = async (input) => {
      events.push('start');
      return originalStart(input);
    };
    const renderer = fakeRendering({
      compose: async (_number, pictureIds, _options, defaultCompose) => {
        if (!overflowReturned && pictureIds.length === 4) {
          overflowReturned = true;
          events.push('overflow');
          return {
            kind: 'encoded-overflow',
            encodedCharacters: 40_000_000,
            breakBeforeScreenshotId: pictureIds[2],
            message: 'split',
          };
        }
        return defaultCompose();
      },
    });
    const controller = engine(
      async () => savedContext(Array.from({ length: 4 }, (_, index) => screenshot(index))),
      native.bridge,
      renderer.rendering,
    );

    const result = await controller.prepareFreshFiles();

    expect(result.ok).toBe(true);
    expect(events).toEqual(['overflow', 'start']);
    expect(native.starts[0].bundles).toHaveLength(2);
    expect(native.starts[0].bundles).toEqual([
      { bundleNumber: 1, width: 164, height: 352 },
      { bundleNumber: 2, width: 164, height: 352 },
    ]);
    expect(native.writes).toHaveLength(2);
    expect(native.writes[0].markdown).toContain('Bundle 1 of 2');
    expect(native.writes[1].markdown).toContain('Shared collection context is included in Bundle 1.');
    expect(native.writes[1].markdown).not.toContain('## Overall context');
  });

  test('cancellation stops rendering and keeps only complete native pairs', async () => {
    let composeCall = 0;
    let releaseGate!: () => void;
    const gateEntered = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const native = fakeBridge();
    const renderer = fakeRendering({
      preflightSize: { width: 7000, height: 5000 },
      compose: async (_number, _ids, options, defaultCompose) => {
        composeCall += 1;
        if (composeCall === 4) {
          releaseGate();
          await new Promise<void>((resolve) =>
            options.signal.addEventListener('abort', () => resolve(), { once: true }),
          );
        }
        return defaultCompose();
      },
    });
    const controller = engine(
      async () => savedContext([screenshot(0), screenshot(1)]),
      native.bridge,
      renderer.rendering,
    );

    const exportPromise = controller.prepareFreshFiles();
    await gateEntered;
    const cancelResult = await controller.cancel();
    const exportResult = await exportPromise;

    expect(cancelResult.ok).toBe(true);
    expect(exportResult).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(native.writes).toHaveLength(1);
    expect(native.cancellations).toEqual(['session-1']);
    expect(native.finishes).toHaveLength(0);
    expect(controller.getState().progress?.phase).toBe('cancelled');
    expect(controller.getState().cards[0].artifactSessionId).toBe('session-1');
    expect(controller.getState().cards[1].artifactSessionId).toBeUndefined();
  });

  test('cancels a session that resolves after cancellation during startPromptExport', async () => {
    let releaseStart!: () => void;
    let reportStartEntered!: () => void;
    const startEntered = new Promise<void>((resolve) => {
      reportStartEntered = resolve;
    });
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const native = fakeBridge();
    const originalStart = native.bridge.startPromptExport;
    native.bridge.startPromptExport = async (input) => {
      const result = await originalStart(input);
      reportStartEntered();
      await startGate;
      return result;
    };
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);

    const exportPromise = controller.prepareFreshFiles();
    await startEntered;
    const cancelResult = await controller.cancel();
    releaseStart();
    const exportResult = await exportPromise;

    expect(cancelResult.ok).toBe(true);
    expect(exportResult).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(native.cancellations).toEqual(['session-1']);
    expect(native.finishes).toHaveLength(0);
  });

  test.each([1, 10, 20, 100])(
    'keeps %i-screenshot planning metadata-only and rendering sequential',
    async (count) => {
      const screenshots = Array.from({ length: count }, (_, index) => screenshot(index));
      const native = fakeBridge();
      const renderer = fakeRendering();
      const controller = engine(async () => savedContext(screenshots), native.bridge, renderer.rendering);

      const result = await controller.prepareFreshFiles();

      expect(result.ok).toBe(true);
      expect(controller.getState().cards.reduce((total, card) => total + card.screenshotCount, 0)).toBe(
        count,
      );
      expect(controller.getState().cards.every((card) => card.previewDataUrl === THUMBNAIL)).toBe(true);
      expect(controller.getState().cards.every((card) => !card.previewDataUrl?.includes('QUJD'))).toBe(true);
      expect(renderer.stats.maxActiveRenders).toBe(1);
      expect(renderer.stats.renderCount).toBe(count * 2);
      expect(native.loadCounts.size).toBe(count);
    },
  );

  test('copies Markdown directly without image rendering or a combined-copy attempt', async () => {
    const native = fakeBridge();
    native.bridge.copyText = vi.fn(async () => undefined);
    const renderer = fakeRendering();
    renderer.rendering.compose = vi.fn(async () => {
      throw new Error('No bitmap memory');
    });
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);
    await controller.open();
    const result = await controller.copyMarkdown(controller.getState().cards[0]);
    expect(result.ok).toBe(true);
    expect(native.bridge.copyText).toHaveBeenCalledWith(expect.stringContaining('Description 1'));
    expect(renderer.rendering.compose).not.toHaveBeenCalled();
    expect(native.copies).toEqual([]);
    expect(controller.getState().cards[0].outcome).toBe('markdown');
  });

  test('prepares files on demand for path copying and serializes fallback clipboard actions', async () => {
    const native = fakeBridge();
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);
    await controller.open();
    const pending = controller.copyPaths(controller.getState().cards[0]);
    expect((await controller.copyImage(1)).ok).toBe(false);
    expect((await pending).ok).toBe(true);
    expect(native.copies).toEqual([{ sessionId: 'session-1', bundleNumber: 1, target: 'paths' }]);
    expect(controller.getState().cards[0]).toMatchObject({
      outcome: 'paths',
      filenames: ['Prompt-1.md', 'Prompt-1.png'],
    });
  });

  test('reports a partial Windows clipboard write and points at the separate fallback', async () => {
    const native = fakeBridge({ placed: { text: true, html: true, image: false, files: false } });
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);
    const copy = await controller.copyFresh(1);
    expect(copy.ok).toBe(true);
    expect(controller.getState().cards[0]).toMatchObject({
      state: 'copied',
      outcome: 'markdown',
      warning: expect.stringMatching(/Image was not confirmed.*Copy image only or Open files/),
    });
    const image = await controller.copyImage(controller.getState().cards[0]);
    expect(image.ok).toBe(true);
    expect(controller.getState().cards[0]).toMatchObject({ outcome: 'image', warning: undefined });
  });

  test('reports image-only Windows retention without claiming Markdown + image', async () => {
    const native = fakeBridge({ placed: { text: false, html: false, image: true, files: false } });
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);
    const copy = await controller.copyFresh(1);
    expect(copy.ok).toBe(true);
    expect(controller.getState().cards[0]).toMatchObject({
      state: 'copied',
      outcome: 'image',
      warning: expect.stringMatching(/Markdown was not confirmed.*Copy Markdown only or Open files/),
    });
  });

  test('reports an unverified clipboard read-back without claiming Markdown + image', async () => {
    const native = fakeBridge({ placed: { text: false, html: false, image: false, files: false } });
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);
    const copy = await controller.copyFresh(1);
    expect(copy.ok).toBe(true);
    expect(controller.getState().cards[0].outcome).toBeUndefined();
    expect(controller.getState().cards[0]).toMatchObject({
      state: 'copied',
      warning: expect.stringMatching(
        /Markdown and image were not confirmed.*Copy Markdown only, Copy image only, or Open files/,
      ),
    });
  });

  test('exposes same-session fallbacks when combined clipboard copy fails', async () => {
    const native = fakeBridge({ failContextCopy: true });
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);

    const copy = await controller.copyFresh(1);
    const card = controller.getState().cards[0];
    const markdown = await controller.copyMarkdown(card);

    expect(copy).toMatchObject({
      ok: false,
      error: { nativeCode: 'clipboard-limit', fallbackAvailable: true },
    });
    expect(markdown).toEqual({ ok: true, sessionId: 'session-1', bundleNumber: 1 });
    expect(native.copies).toEqual([
      { sessionId: 'session-1', bundleNumber: 1, target: 'rich' },
      { sessionId: 'session-1', bundleNumber: 1, target: 'markdown' },
    ]);
    expect(card.state).toBe('error');
    expect(card.artifactSessionId).toBe('session-1');
    expect(controller.getState().error).toBeUndefined();
    expect(controller.getState().cards[0]).toMatchObject({ outcome: 'markdown', error: undefined });
  });

  test('requires fresh files before copying a fallback after source revisions change', async () => {
    let revision = 'first';
    const native = fakeBridge({ revisionForLoad: () => revision });
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);
    await controller.prepareFreshFiles();
    const card = controller.getState().cards[0];
    revision = 'external-edit';
    const result = await controller.copyMarkdown(card);
    expect(result).toMatchObject({ ok: false, error: { code: 'content-changed' } });
    expect(native.copies).toEqual([]);
  });

  describe.each([
    { name: 'project path', path: 'P:/different-project', id: 'project' },
    { name: 'project ID', path: 'P:/opaque-project-grant', id: 'different-project' },
    { name: 'project path and ID', path: 'P:/different-project', id: 'different-project' },
  ])('retained artifact ownership: changed $name', ({ path, id }) => {
    test.each(['openFolder', 'copyMarkdown', 'copyImage', 'copyPaths', 'openFiles', 'loadPreview'] as const)(
      'rejects %s for an identical collection in another project without generating replacement files',
      async (action) => {
        let context = savedContext([screenshot(0)]);
        const native = fakeBridge();
        const read = vi.spyOn(native.bridge, 'readPromptExportBundle');
        native.bridge.copyText = vi.fn(async () => undefined);
        const controller = engine(async () => context, native.bridge, fakeRendering().rendering);
        expect((await controller.prepareFreshFiles()).ok).toBe(true);
        const card = controller.getState().cards[0];
        context = structuredClone(context);
        context.snapshot.projectPath = path;
        context.snapshot.project.id = id;
        // Opening another collection rebuilds cards, but retains the previous export folder.
        if (action === 'openFolder') await controller.open();

        const result =
          action === 'openFolder' ? await controller.openFolder() : await controller[action](card);

        expect(result).toMatchObject({
          ok: false,
          error: { code: 'content-changed', fallbackAvailable: false },
        });
        expect(native.copies).toEqual([]);
        expect(native.opens).toEqual([]);
        expect(read).not.toHaveBeenCalled();
        expect(native.bridge.copyText).not.toHaveBeenCalled();
        expect(native.starts).toHaveLength(1);
        expect(controller.getState().preview).toBeUndefined();
      },
    );
  });

  test('rejects numeric fallback selections after switching to an identical project', async () => {
    let context = savedContext([screenshot(0)]);
    const native = fakeBridge();
    const controller = engine(async () => context, native.bridge, fakeRendering().rendering);
    await controller.prepareFreshFiles();
    context = structuredClone(context);
    context.snapshot.projectPath = 'P:/different-project';
    context.snapshot.project.id = 'different-project';

    expect(await controller.copyMarkdown(1)).toMatchObject({ ok: false, error: { code: 'content-changed' } });
    expect(native.copies).toEqual([]);
    expect(native.starts).toHaveLength(1);
  });

  test('does not open the Markdown file if the project switches while its PNG is opening', async () => {
    let context = savedContext([screenshot(0)]);
    const native = fakeBridge();
    const controller = engine(async () => context, native.bridge, fakeRendering().rendering);
    await controller.prepareFreshFiles();
    const open = native.bridge.openPromptExportBundle;
    native.bridge.openPromptExportBundle = async (input) => {
      const result = await open(input);
      context = structuredClone(context);
      context.snapshot.projectPath = 'P:/different-project';
      return result;
    };

    expect(await controller.openFiles(controller.getState().cards[0])).toMatchObject({
      ok: false,
      error: { code: 'content-changed' },
    });
    expect(native.opens).toEqual([{ sessionId: 'session-1', bundleNumber: 1, target: 'png' }]);
    expect(native.starts).toHaveLength(1);
  });

  test('rechecks project ownership after asynchronous metadata validation', async () => {
    let context = savedContext([screenshot(0)]);
    const native = fakeBridge();
    const controller = engine(async () => context, native.bridge, fakeRendering().rendering);
    await controller.prepareFreshFiles();
    const load = native.bridge.loadScreenshotContent;
    native.bridge.loadScreenshotContent = async (input) => {
      const result = await load(input);
      context = structuredClone(context);
      context.snapshot.projectPath = 'P:/different-project';
      return result;
    };

    expect(await controller.copyImage(controller.getState().cards[0])).toMatchObject({
      ok: false,
      error: { code: 'content-changed' },
    });
    expect(native.copies).toEqual([]);
    expect(native.starts).toHaveLength(1);
  });

  test('rejects an old preview grant after the dialog plans an identical collection in another project', async () => {
    let context = savedContext([screenshot(0)]);
    const native = fakeBridge();
    const read = vi.spyOn(native.bridge, 'readPromptExportBundle');
    const renderer = fakeRendering();
    const controller = engine(async () => context, native.bridge, renderer.rendering);
    await controller.prepareFreshFiles();
    const card = controller.getState().cards[0];
    context = structuredClone(context);
    context.snapshot.projectPath = 'P:/different-project';
    await controller.open();
    const composeCount = renderer.stats.composeCount;

    expect(await controller.loadPreview(card)).toMatchObject({
      ok: false,
      error: { code: 'content-changed' },
    });
    expect(read).not.toHaveBeenCalled();
    expect(renderer.stats.composeCount).toBe(composeCount);
    expect(controller.getState().preview).toBeUndefined();
  });

  test('does not publish a preview if the project switches while the artifact is read', async () => {
    let context = savedContext([screenshot(0)]);
    const native = fakeBridge();
    const controller = engine(async () => context, native.bridge, fakeRendering().rendering);
    await controller.prepareFreshFiles();
    const read = native.bridge.readPromptExportBundle;
    native.bridge.readPromptExportBundle = async (input) => {
      const result = await read(input);
      context = structuredClone(context);
      context.snapshot.project.id = 'different-project';
      return result;
    };

    expect(await controller.loadPreview(controller.getState().cards[0])).toMatchObject({
      ok: false,
      error: { code: 'content-changed' },
    });
    expect(controller.getState().preview).toBeUndefined();
  });

  test('keeps the latest preview when an older ownership check resolves later', async () => {
    const context = savedContext([screenshot(0)]);
    const native = fakeBridge();
    const getSavedContext = vi.fn(async () => context);
    const controller = engine(getSavedContext, native.bridge, fakeRendering().rendering);
    await controller.prepareFreshFiles();
    const card = controller.getState().cards[0];
    let release!: (context: SavedPromptExportContext) => void;
    getSavedContext.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = controller.loadPreview(card);
    expect((await controller.loadPreview(card)).ok).toBe(true);
    const preview = controller.getState().preview;
    release(context);

    expect(await first).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(controller.getState().preview).toBe(preview);
    expect(controller.getState().error).toBeUndefined();
  });

  test('does not open a second file after cancellation during the first native open', async () => {
    const native = fakeBridge();
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);
    await controller.prepareFreshFiles();
    let finishOpen!: () => void;
    let firstOpened!: () => void;
    const opened = new Promise<void>((resolve) => {
      firstOpened = resolve;
    });
    const pendingOpen = new Promise<void>((resolve) => {
      finishOpen = resolve;
    });
    native.bridge.openPromptExportBundle = vi.fn(async () => {
      firstOpened();
      await pendingOpen;
      return ok(undefined);
    });
    const result = controller.openFiles(controller.getState().cards[0]);
    await opened;
    await controller.cancel();
    finishOpen();
    expect((await result).ok).toBe(false);
    expect(native.bridge.openPromptExportBundle).toHaveBeenCalledTimes(1);
  });

  test('does not copy freshly planned Markdown if a screenshot changes before validation', async () => {
    const native = fakeBridge({ revisionForLoad: (_id, count) => (count === 1 ? 'one' : 'two') });
    native.bridge.copyText = vi.fn(async () => undefined);
    const controller = engine(
      async () => savedContext([screenshot(0)]),
      native.bridge,
      fakeRendering().rendering,
    );
    const result = await controller.copyMarkdown(1);
    expect(result).toMatchObject({ ok: false, error: { code: 'content-changed' } });
    expect(native.bridge.copyText).not.toHaveBeenCalled();
  });

  test.each(['markdown', 'image'] as const)(
    'prepares the selected format from the first dropdown copy: %s',
    async (target) => {
      const native = fakeBridge();
      const renderer = fakeRendering();
      const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);
      await controller.open();
      const card = controller.getState().cards[0];
      const result = await (target === 'markdown'
        ? controller.copyMarkdown(card)
        : controller.copyImage(card));
      expect(result.ok).toBe(true);
      expect(native.copies).toEqual([{ sessionId: 'session-1', bundleNumber: 1, target }]);
      expect(controller.getState().cards[0].state).not.toBe('copied');
    },
  );

  test('loads one committed full preview and clears it without closing the dialog', async () => {
    const native = fakeBridge();
    const read = vi.spyOn(native.bridge, 'readPromptExportBundle');
    const renderer = fakeRendering();
    const controller = engine(
      async () => savedContext([screenshot(0), screenshot(1)]),
      native.bridge,
      renderer.rendering,
    );
    await controller.open();
    await controller.prepareFreshFiles();
    const card = controller.getState().cards[0];

    await controller.loadPreview(card);

    expect(read).toHaveBeenCalledOnce();
    expect(controller.getState().preview).toMatchObject({ bundleNumber: 1, dataUrl: PNG });
    controller.clearPreview();
    expect(controller.getState().preview).toBeUndefined();
    expect(controller.getState().isOpen).toBe(true);
  });

  test('does not reuse an older committed preview after the dialog creates a new plan', async () => {
    const native = fakeBridge();
    const read = vi.spyOn(native.bridge, 'readPromptExportBundle');
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);
    await controller.prepareFreshFiles();
    await controller.open();
    const freshPlanCard = controller.getState().cards[0];

    await controller.loadPreview(freshPlanCard);

    expect(freshPlanCard.artifactSessionId).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(controller.getState().preview).toMatchObject({ bundleNumber: 1, dataUrl: PNG });
  });

  test.each([
    { name: 'empty', screenshots: [] },
    { name: 'fully excluded', screenshots: [screenshot(0, false), screenshot(1, false)] },
  ])('does not start a native export for an $name collection', async ({ screenshots }) => {
    const native = fakeBridge();
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext(screenshots), native.bridge, renderer.rendering);

    const result = await controller.prepareFreshFiles();

    expect(result).toMatchObject({ ok: false, error: { code: 'no-content' } });
    expect(native.starts).toHaveLength(0);
    expect(native.writes).toHaveLength(0);
    expect(renderer.stats.renderCount).toBe(0);
  });

  test('stops after a save failure instead of exporting stale state', async () => {
    const native = fakeBridge();
    const renderer = fakeRendering();
    const controller = engine(
      async () => {
        throw new Error('CAS conflict');
      },
      native.bridge,
      renderer.rendering,
    );

    const result = await controller.copyFresh(1);

    expect(result).toMatchObject({ ok: false, error: { code: 'save-failed' } });
    expect(native.starts).toHaveLength(0);
    expect(native.copies).toHaveLength(0);
  });

  test('exports an all-text collection as Markdown only without a fake image', async () => {
    const context = savedContext([]);
    (context.snapshot.project as ProjectData & { contentItems: unknown[] }).contentItems = [
      {
        id: 'text-1',
        collectionId: 'collection',
        kind: 'text',
        position: 0,
        includeInExport: true,
        createdAt: '2026-09-07T10:00:00.000Z',
        updatedAt: '2026-09-07T10:00:00.000Z',
        markdownFilename: 'text-1.md',
      },
    ];
    const native = fakeBridge();
    const renderer = fakeRendering();
    const controller = engine(async () => context, native.bridge, renderer.rendering);

    const result = await controller.copyFresh(1);

    expect(result.ok).toBe(true);
    expect(native.starts[0].bundles).toEqual([{ bundleNumber: 1, hasImage: false, width: 0, height: 0 }]);
    expect(native.writes[0]).toMatchObject({
      pngDataUrl: undefined,
      markdown: expect.stringContaining('Text body for text-1.'),
    });
    expect(renderer.stats.renderCount).toBe(0);
    expect(native.copies).toEqual([{ sessionId: 'session-1', bundleNumber: 1, target: 'rich' }]);
    expect(controller.getState().cards[0]).toMatchObject({ state: 'copied', outcome: 'markdown' });
    expect((await controller.openFiles(1)).ok).toBe(true);
    expect(native.opens).toEqual([{ sessionId: 'session-1', bundleNumber: 1, target: 'markdown' }]);
    expect((await controller.loadPreview(1)).ok).toBe(false);
  });

  test('prepares and opens files on the first request without changing the clipboard', async () => {
    const native = fakeBridge();
    const controller = engine(
      async () => savedContext([screenshot(0)]),
      native.bridge,
      fakeRendering().rendering,
    );

    const result = await controller.openFiles({
      planId: 'planned-card',
      bundleNumber: 1,
    });

    expect(result).toMatchObject({ ok: true, sessionId: 'session-1', bundleNumber: 1 });
    expect(native.starts).toHaveLength(1);
    expect(native.copies).toEqual([]);
    expect(native.opens).toEqual([
      { sessionId: 'session-1', bundleNumber: 1, target: 'png' },
      { sessionId: 'session-1', bundleNumber: 1, target: 'markdown' },
    ]);
  });

  test('prepares and opens the export folder on the first request without copying', async () => {
    const native = fakeBridge();
    const controller = engine(
      async () => savedContext([screenshot(0)]),
      native.bridge,
      fakeRendering().rendering,
    );

    const result = await controller.openFolder();

    expect(result).toMatchObject({ ok: true, sessionId: 'session-1', bundleNumber: 1 });
    expect(native.starts).toHaveLength(1);
    expect(native.copies).toEqual([]);
    expect(native.opens).toEqual([{ sessionId: 'session-1', bundleNumber: 1, target: 'folder' }]);
  });

  test('reports the exact finalized bundles that contain PNG artifacts for hosted review', async () => {
    const visualNative = fakeBridge();
    const visualController = engine(
      async () => savedContext([screenshot(0)]),
      visualNative.bridge,
      fakeRendering().rendering,
    );
    await expect(visualController.prepareHostedShare()).resolves.toMatchObject({
      ok: true,
      value: { bundleNumbers: [1], imageBundleNumbers: [1] },
    });

    const textContext = savedContext([]);
    (textContext.snapshot.project as ProjectData & { contentItems: unknown[] }).contentItems = [
      {
        id: 'text-1',
        collectionId: 'collection',
        kind: 'text',
        position: 0,
        includeInExport: true,
        createdAt: '2026-09-07T10:00:00.000Z',
        updatedAt: '2026-09-07T10:00:00.000Z',
        markdownFilename: 'text-1.md',
      },
    ];
    const textNative = fakeBridge();
    const textController = engine(async () => textContext, textNative.bridge, fakeRendering().rendering);
    await expect(textController.prepareHostedShare()).resolves.toMatchObject({
      ok: true,
      value: { bundleNumbers: [1], imageBundleNumbers: [] },
    });
  });

  test('uses final drawing PNG dimensions without screenshot annotation padding', async () => {
    const context = savedContext([]);
    const native = fakeBridge();
    const loaded = await native.bridge.loadContentItem!({
      projectPath: context.snapshot.projectPath,
      itemId: 'drawing-1',
    });
    context.snapshot.project.schemaVersion = 4;
    if (loaded.item.kind !== 'drawing') throw new Error('Expected a drawing fixture.');
    context.snapshot.project.contentItems = [
      { ...loaded.item, description: '    Queue before workers.\r\n\r\nKeep ordering.' },
    ];
    const renderer = fakeRendering({ preflightSize: { width: 180, height: 160 } });
    const preflight = vi.spyOn(renderer.rendering, 'preflight');
    const controller = engine(async () => context, native.bridge, renderer.rendering);
    expect((await controller.copyFresh(1)).ok).toBe(true);
    expect(preflight).not.toHaveBeenCalled();
    expect(native.writes[0].markdown).toContain('Drawing 1');
    expect(native.writes[0].markdown).toContain('    Queue before workers.\n\nKeep ordering.');
    expect(native.finishes[0].masterMarkdown).toContain('    Queue before workers.\n\nKeep ordering.');
    expect(native.writes[0].sourceAssets).toEqual([{ filename: 'drawing-1.json', source: loaded.source }]);
  });

  test('cancels the native session when finalization fails', async () => {
    const native = fakeBridge({ failFinish: true });
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);

    const result = await controller.prepareFreshFiles();

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'native-failure', nativeCode: 'io-failure' },
    });
    expect(native.finishes).toHaveLength(1);
    expect(native.cancellations).toEqual(['session-1']);
  });

  test('keeps failed finish cleanup retryable when native cancellation transport rejects', async () => {
    const native = fakeBridge({ failFinish: true });
    const originalCancel = native.bridge.cancelPromptExport;
    let cancelAttempts = 0;
    native.bridge.cancelPromptExport = async (input) => {
      cancelAttempts += 1;
      if (cancelAttempts === 1) throw new Error('IPC transport disconnected');
      return originalCancel(input);
    };
    const renderer = fakeRendering();
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);

    const exportResult = await controller.prepareFreshFiles();

    expect(exportResult).toMatchObject({ ok: false, error: { code: 'cleanup-pending' } });
    expect(controller.getState().cleanupPending).toBe(true);
    expect(cancelAttempts).toBe(1);

    const retryResult = await controller.retryCleanup();

    expect(retryResult).toEqual({ ok: true, sessionId: 'session-1' });
    expect(cancelAttempts).toBe(2);
    expect(controller.getState().cleanupPending).toBe(false);
    expect(controller.getState().cards[0].artifactSessionId).toBe('session-1');
  });

  test('reports the hard 16384px/64MP render cap without suggesting an unavailable file escape', async () => {
    const native = fakeBridge();
    const renderer = fakeRendering({ preflightSize: { width: 16_384, height: 100 } });
    const controller = engine(async () => savedContext([screenshot(0)]), native.bridge, renderer.rendering);

    const result = await controller.prepareFreshFiles();

    expect(result).toMatchObject({ ok: false, error: { code: 'render-limit' } });
    if (!result.ok) {
      expect(result.error.message).toContain('16384px per side and 64 MP');
      expect(result.error.message).toContain('Move distant annotations closer');
      expect(result.error.message).not.toMatch(/use (the )?saved files|save separately/i);
    }
    expect(native.starts).toHaveLength(0);
  });
});
