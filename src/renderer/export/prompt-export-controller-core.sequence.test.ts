import { describe, expect, test, vi } from 'vitest';
import type { ProjectSnapshot, ScreenshotRecord } from '../../shared/types';
import type {
  PromptExportBundleContent,
  PromptExportBundleGrant,
  PromptExportFinalized,
  PromptExportSessionInfo,
  WorkflowResult,
} from '../../shared/workflow-bridge';
import {
  PromptBundleControllerEngine,
  type PromptBundleControllerBridge,
  type PromptBundleControllerRendering,
  type PromptBundleSelection,
  type SavedPromptExportContext,
} from './prompt-export-controller-core';

/*
 * Work-count invariants for the export controller: whatever order the user picks the format
 * actions in, one content version must be rendered and exported at most once, and must end up
 * in exactly one bundle folder. Orders come from a seeded shuffle so failures are reproducible.
 */

const PNG = 'data:image/png;base64,QUJD';

function ok<T>(value: T): WorkflowResult<T> {
  return { ok: true, value };
}

function screenshot(): ScreenshotRecord {
  return {
    collectionId: 'collection',
    id: 'shot-1',
    originalFilename: 'shot-1.png',
    storedFilename: 'shot-1.png',
    title: 'Picture title 1',
    description: 'Description 1',
    position: 0,
    createdAt: '2026-09-07T10:00:00.000Z',
    updatedAt: '2026-09-07T10:00:00.000Z',
    priority: 'medium',
    annotationFile: 'shot-1.annotations.json',
    descriptionFile: 'shot-1.md',
    originalWidth: 100,
    originalHeight: 80,
    includeInExport: true,
  };
}

function savedContext(): SavedPromptExportContext {
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
      screenshots: [screenshot()],
      exportPreferences: {
        includeOriginalScreenshots: false,
        includeAnnotationMetadata: false,
        template: 'default',
      },
    },
    thumbnails: { 'shot-1': PNG },
    recoveryFound: false,
  };
  return { snapshot, collectionId: 'collection' };
}

/** Bridge whose exported files live in timestamped "folders" (one per export session). */
function harness() {
  let pixels = PNG;
  let sessions = 0;
  let renders = 0;
  const folders: string[] = [];
  const writes: Array<{ sessionId: string; bundleNumber: number; markdown: string; pngDataUrl?: string }> =
    [];
  const grants = (sessionId: string): PromptExportBundleGrant[] =>
    writes
      .filter((write) => write.sessionId === sessionId)
      .map((write) => ({
        bundleNumber: write.bundleNumber,
        pngFilename: `Prompt-${write.bundleNumber}.png`,
        markdownFilename: `Prompt-${write.bundleNumber}.md`,
      }));
  const finalized = (sessionId: string): WorkflowResult<PromptExportFinalized> =>
    ok({
      status: 'completed',
      published: true,
      bundles: grants(sessionId),
      hasMasterMarkdown: false,
      warnings: [],
    });
  const bridge: PromptBundleControllerBridge = {
    copyText: vi.fn(async () => undefined),
    async loadScreenshotContent({ screenshot: item }) {
      return {
        image: { filename: item.originalFilename, dataUrl: pixels, width: 100, height: 80 },
        annotations: [],
        description: item.description,
        contentRevision: `revision-${pixels}`,
      };
    },
    async loadContentItem() {
      throw new Error('The sequence fixture has screenshots only.');
    },
    startPromptExport: vi.fn(async (input) => {
      sessions += 1;
      const timestamp = `260907-18420${sessions}`;
      folders.push(`${input.collectionId}/exports/${timestamp}`);
      return ok<PromptExportSessionInfo>({
        sessionId: `session-${sessions}`,
        collectionId: input.collectionId,
        timestamp,
        setName: `Checkout review - ${timestamp}`,
      });
    }),
    writePromptExportBundle: vi.fn(async (input) => {
      writes.push(structuredClone(input));
      return ok({
        bundleNumber: input.bundleNumber,
        pngFilename: `Prompt-${input.bundleNumber}.png`,
        markdownFilename: `Prompt-${input.bundleNumber}.md`,
      });
    }),
    async finishPromptExport({ sessionId }) {
      return finalized(sessionId);
    },
    async cancelPromptExport({ sessionId }) {
      return finalized(sessionId);
    },
    async readPromptExportBundle({ sessionId, bundleNumber }) {
      const write = writes.find((item) => item.sessionId === sessionId && item.bundleNumber === bundleNumber);
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
      return ok({ target: input.target, placed: { text: true, html: true, image: true, files: true } });
    },
    async openPromptExportBundle() {
      return ok(undefined);
    },
  };
  const rendering: PromptBundleControllerRendering = {
    async preflight() {
      return { screenshotId: '', width: 100, height: 80, estimatedPngCharacters: 16 };
    },
    async render(image) {
      return {
        dataUrl: image.dataUrl,
        width: image.width,
        height: image.height,
        bounds: { x: 0, y: 0, width: image.width, height: image.height },
        sourceBounds: { x: 0, y: 0, width: image.width, height: image.height },
      };
    },
    async compose(bundle, options) {
      renders += 1;
      let dataUrl = PNG;
      for (const picture of bundle.pictures) {
        const resolved = await options.resolvePicturePng(picture);
        dataUrl = resolved.dataUrl;
        resolved.release?.();
      }
      return {
        kind: 'composed',
        dataUrl,
        width: bundle.layout.width,
        height: bundle.layout.height,
        encodedCharacters: 120,
        delivery: bundle.delivery,
        warning: bundle.warning,
      };
    },
  };
  const controller = new PromptBundleControllerEngine({
    getSavedContext: async () => savedContext(),
    bridge,
    rendering,
  });
  return {
    controller,
    bridge,
    folders,
    writes,
    get renders() {
      return renders;
    },
    edit(version: number) {
      pixels = `data:image/png;base64,VkVSU0lPTi${version}`;
    },
  };
}

type Harness = ReturnType<typeof harness>;

/** Dialog actions name a card by plan and bundle; alternate whether they carry the session id. */
function selection(h: Harness, stripSession: boolean): PromptBundleSelection {
  const card = h.controller.getState().cards[0];
  return stripSession ? { ...card, artifactSessionId: undefined } : card;
}

const ACTIONS = {
  copyMarkdown: (h: Harness, strip: boolean) => h.controller.copyMarkdown(selection(h, strip)),
  copyRich: (h: Harness, strip: boolean) => h.controller.copyFresh(selection(h, strip)),
  copyFiles: (h: Harness, strip: boolean) => h.controller.copyVariant(selection(h, strip), 'files'),
  copyFilesRich: (h: Harness, strip: boolean) => h.controller.copyVariant(selection(h, strip), 'files-rich'),
  copyImageOnly: (h: Harness, strip: boolean) => h.controller.copyImage(selection(h, strip)),
  copyPaths: (h: Harness, strip: boolean) => h.controller.copyPaths(selection(h, strip)),
  openFiles: (h: Harness, strip: boolean) => h.controller.openFiles(selection(h, strip)),
  openFolder: (h: Harness) => h.controller.openFolder(),
  reopenDialog: async (h: Harness) => {
    h.controller.close();
    return h.controller.open();
  },
} as const;
type ActionName = keyof typeof ACTIONS;
const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];

/** mulberry32: tiny deterministic PRNG so every order can be replayed from its seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

const SEEDS = Array.from({ length: 40 }, (_, index) => 0x5eed + index);
const CONTENT_VERSIONS = 3;

describe('prompt export controller work invariants', () => {
  test.each(SEEDS)('seed %i: each content version renders and exports at most once', async (seed) => {
    const random = seededRandom(seed);
    const h = harness();
    await h.controller.open();
    const trace: string[] = [];
    for (let version = 0; version < CONTENT_VERSIONS; version += 1) {
      if (version > 0) h.edit(version);
      const before = {
        starts: vi.mocked(h.bridge.startPromptExport).mock.calls.length,
        writes: vi.mocked(h.bridge.writePromptExportBundle).mock.calls.length,
        renders: h.renders,
      };
      // Every format action once, in a random order, plus a few random repeats.
      const order = [
        ...shuffled(ACTION_NAMES, random),
        ...Array.from({ length: 4 }, () => ACTION_NAMES[Math.floor(random() * ACTION_NAMES.length)]),
      ];
      for (const name of order) {
        const strip = random() < 0.5;
        const result = await ACTIONS[name](h, strip);
        trace.push(
          `v${version}:${name}${strip ? '(no session)' : ''}=${result.ok ? 'ok' : result.error?.code}`,
        );
        // Stale files may be refused for edited content, but nothing else may fail.
        if (!result.ok) expect(result.error?.code, trace.join(' ')).toBe('content-changed');
      }
      // Whatever happened above, the user can still get this version's files.
      const files = await ACTIONS.copyFiles(h, false);
      expect(files.ok, trace.join(' ')).toBe(true);

      const starts = vi.mocked(h.bridge.startPromptExport).mock.calls.length - before.starts;
      const writes = vi.mocked(h.bridge.writePromptExportBundle).mock.calls.length - before.writes;
      const renders = h.renders - before.renders;
      expect({ version, starts, writes }, trace.join(' ')).toEqual({ version, starts: 1, writes: 1 });
      expect(renders, trace.join(' ')).toBeLessThanOrEqual(1);
    }
    // Smoke: one bundle folder per content version, each holding that version's pixels.
    expect(h.folders).toHaveLength(CONTENT_VERSIONS);
    expect(new Set(h.folders).size).toBe(CONTENT_VERSIONS);
    expect(new Set(h.writes.map((write) => write.pngDataUrl)).size).toBe(CONTENT_VERSIONS);
  });
});
