import { planPromptBundles, type PromptBundle, type PromptBundleProgress } from '../../shared/prompt-bundles';
import type { ImagePayload, ScreenshotRecord } from '../../shared/types';
import type { ComposedPromptBundle, PromptBundleComposition } from '../prompt-bundle-render';
import {
  PreparedPromptMetadata,
  PreparedPromptPlan,
  SettledPromptPlan,
  assertBundleRenderLimit,
  cloneAndFreeze,
  failure,
  MAX_RETAINED_EXPORT_CHARACTERS,
  planId,
  throwIfAborted,
} from './prompt-export-controller-helpers';
import type {
  PromptBundleControllerBridge,
  PromptBundleControllerRendering,
  PromptPictureResolveResult,
} from './prompt-export-controller-core';

async function imageFingerprint(image: ImagePayload): Promise<string> {
  const bytes = new TextEncoder().encode(`${image.width}:${image.height}:${image.dataUrl}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface PromptExportPipelineOptions {
  bridge: PromptBundleControllerBridge;
  rendering: PromptBundleControllerRendering;
  loadContentItem: NonNullable<PromptBundleControllerBridge['loadContentItem']>;
  onProgress(progress: PromptBundleProgress): void;
}

/** Plans, renders, and validates a single immutable prompt export snapshot. */
export class PromptExportPipeline {
  constructor(private readonly options: PromptExportPipelineOptions) {}

  plan(
    metadata: PreparedPromptMetadata,
    breakBeforeScreenshotIds: ReadonlySet<string> = new Set(),
  ): PreparedPromptPlan {
    const result = planPromptBundles(metadata.input, metadata.measured, { breakBeforeScreenshotIds });
    if (result.kind === 'no-content') throw failure('no-content', result.message, true);
    return { ...metadata, plan: result, planId: planId() };
  }

  async compose(
    prepared: PreparedPromptPlan,
    bundle: PromptBundle,
    signal: AbortSignal,
    fingerprints?: Map<string, string>,
  ): Promise<PromptBundleComposition> {
    if (!bundle.pictures.length)
      return {
        kind: 'composed',
        dataUrl: undefined,
        width: 0,
        height: 0,
        encodedCharacters: 0,
        delivery: 'clipboard',
      };
    assertBundleRenderLimit(bundle);
    return await this.options.rendering.compose(bundle, {
      signal,
      resolvePicturePng: (picture) => this.resolvePicture(prepared, picture, signal, fingerprints),
    });
  }

  async verifyBundleContent(
    prepared: PreparedPromptPlan,
    bundle: PromptBundle,
    signal: AbortSignal,
    fingerprints?: ReadonlyMap<string, string>,
  ): Promise<readonly { filename: string; source: string }[]> {
    const assets: { filename: string; source: string }[] = [];
    for (const text of bundle.textItems) {
      throwIfAborted(signal);
      const loaded = await this.options.loadContentItem({
        projectPath: prepared.context.snapshot.projectPath,
        itemId: text.itemId,
      });
      if (loaded.contentRevision !== text.contentRevision || (loaded.markdown ?? '') !== text.markdown)
        throw failure(
          'content-changed',
          'Text content changed after export planning. Save and export again.',
          true,
        );
    }
    for (const picture of bundle.pictures) {
      if (picture.kind !== 'drawing') {
        if (fingerprints) {
          throwIfAborted(signal);
          const screenshot = prepared.context.snapshot.project.screenshots.find(
            (item) => item.id === picture.screenshotId && item.collectionId === prepared.context.collectionId,
          );
          if (!screenshot) throw failure('content-changed', 'The screenshot is no longer available.', true);
          const loaded = await this.options.bridge.loadScreenshotContent({
            projectPath: prepared.context.snapshot.projectPath,
            screenshot,
          });
          if (
            loaded.contentRevision !== picture.contentRevision ||
            (await imageFingerprint(loaded.image)) !== fingerprints.get(picture.screenshotId)
          )
            throw failure(
              'content-changed',
              'Picture content changed after export planning. Save and export again.',
              true,
            );
        }
        continue;
      }
      throwIfAborted(signal);
      const loaded = await this.options.loadContentItem({
        projectPath: prepared.context.snapshot.projectPath,
        itemId: picture.screenshotId,
      });
      if (loaded.contentRevision !== picture.contentRevision || !loaded.source)
        throw failure(
          'content-changed',
          `Drawing ${picture.pictureNumber} changed after export planning. Save and export again.`,
          true,
        );
      const expected = prepared.sourceByItemId.get(picture.screenshotId);
      if (
        !expected ||
        expected.contentRevision !== loaded.contentRevision ||
        expected.source !== loaded.source
      )
        throw failure(
          'content-changed',
          `Drawing ${picture.pictureNumber} changed after export planning. Save and export again.`,
          true,
        );
      assets.push({ filename: expected.filename, source: expected.source });
    }
    throwIfAborted(signal);
    return assets;
  }

  async settleSplits(
    metadata: PreparedPromptMetadata,
    compositions: Map<number, ComposedPromptBundle>,
    fingerprints: Map<string, string>,
    signal: AbortSignal,
    assertActive: () => void,
  ): Promise<SettledPromptPlan> {
    const breaks = new Set<string>();
    const includedCount = (metadata.input.items ?? metadata.input.screenshots).filter(
      (item) => item.includeInExport && item.kind !== 'text',
    ).length;
    for (let attempt = 0; attempt <= includedCount; attempt += 1) {
      compositions.clear();
      fingerprints.clear();
      let retainedCharacters = 0;
      assertActive();
      const prepared = this.plan(metadata, breaks);
      const encoded = new Map<number, number>();
      let changed = false;
      for (const bundle of prepared.plan.bundles) {
        this.options.onProgress({
          phase: 'rendering',
          bundleNumber: bundle.number,
          totalBundles: prepared.plan.bundles.length,
          message: `Checking Bundle ${bundle.number} of ${prepared.plan.bundles.length}`,
        });
        const composition = await this.compose(prepared, bundle, signal, fingerprints);
        assertActive();
        if (composition.kind === 'encoded-overflow') {
          if (breaks.has(composition.breakBeforeScreenshotId))
            throw failure(
              'render-limit',
              'Prompt splitting could not reach a stable encoded size. Reduce oversized content and try again.',
              true,
            );
          breaks.add(composition.breakBeforeScreenshotId);
          changed = true;
          break;
        }
        encoded.set(bundle.number, composition.encodedCharacters);
        const characters = composition.dataUrl?.length ?? 0;
        if (retainedCharacters + characters <= MAX_RETAINED_EXPORT_CHARACTERS) {
          compositions.set(bundle.number, composition);
          retainedCharacters += characters;
        }
        bundle.delivery = composition.delivery;
        bundle.warning = composition.warning;
      }
      if (!changed) return { ...prepared, encodedCharacters: encoded };
    }
    throw failure('render-limit', 'Prompt splitting exceeded the safe number of attempts.', true);
  }

  private async resolvePicture(
    prepared: PreparedPromptPlan,
    picture: PromptBundle['pictures'][number],
    signal: AbortSignal,
    fingerprints?: Map<string, string>,
  ): Promise<PromptPictureResolveResult> {
    throwIfAborted(signal);
    if (picture.kind === 'drawing') {
      const loaded = await this.options.loadContentItem({
        projectPath: prepared.context.snapshot.projectPath,
        itemId: picture.screenshotId,
      });
      throwIfAborted(signal);
      if (!loaded.image || loaded.contentRevision !== picture.contentRevision)
        throw failure(
          'content-changed',
          `Drawing ${picture.pictureNumber} changed after export planning. Save and export again.`,
          true,
        );
      return {
        dataUrl: loaded.image.dataUrl,
        width: loaded.image.width,
        height: loaded.image.height,
        contentRevision: loaded.contentRevision,
        release: () => undefined,
      };
    }
    const screenshot = prepared.context.snapshot.project.screenshots.find(
      (item) => item.collectionId === prepared.context.collectionId && item.id === picture.screenshotId,
    );
    if (!screenshot)
      throw failure(
        'content-changed',
        `Picture ${picture.pictureNumber} is no longer in this collection. Save and export again.`,
        true,
      );
    const loaded = await this.options.bridge.loadScreenshotContent({
      projectPath: prepared.context.snapshot.projectPath,
      screenshot: cloneAndFreeze(screenshot) as ScreenshotRecord,
    });
    throwIfAborted(signal);
    if (loaded.contentRevision !== picture.contentRevision)
      throw failure(
        'content-changed',
        `Picture ${picture.pictureNumber} changed after export planning. Save the latest version and export again.`,
        true,
      );
    if (fingerprints) fingerprints.set(picture.screenshotId, await imageFingerprint(loaded.image));
    throwIfAborted(signal);
    const rendered = await this.options.rendering.render(loaded.image, loaded.annotations, { signal });
    throwIfAborted(signal);
    return {
      dataUrl: rendered.dataUrl,
      width: rendered.width,
      height: rendered.height,
      contentRevision: loaded.contentRevision,
      release: () => undefined,
    };
  }
}
