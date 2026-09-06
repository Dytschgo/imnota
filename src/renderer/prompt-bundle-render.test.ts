import { describe, expect, it, vi } from 'vitest';
import { planPromptBundles, type PromptBundle } from '../shared/prompt-bundles';
import {
  composePromptBundle,
  type PromptBundleRenderEnvironment,
  type PromptCanvasContext,
} from './prompt-bundle-render';

function bundle(pictureCount = 2): PromptBundle {
  const screenshots = Array.from({ length: pictureCount }, (_, index) => ({
    id: `shot-${index + 1}`,
    position: index,
    title: `Screen ${index + 1}`,
    originalFilename: `screen-${index + 1}.png`,
    description: '',
    priority: 'medium' as const,
    includeInExport: true,
    nativeWidth: 100,
    nativeHeight: 80,
    contentRevision: `revision-${index + 1}`,
    annotations: [],
  }));
  const rendered = screenshots.map((screenshot) => ({
    screenshotId: screenshot.id,
    width: 100,
    height: 80,
  }));
  const result = planPromptBundles(
    { collectionId: 'collection', collectionName: 'Collection', overallContext: '', screenshots },
    rendered,
  );
  if (result.kind !== 'ready') throw new Error(result.message);
  return result.bundles[0];
}

function environment(outputLength = 100) {
  const events: string[] = [];
  const fillRect = vi.fn();
  const fillText = vi.fn();
  const drawImage = vi.fn();
  const context: PromptCanvasContext = {
    fillStyle: '',
    font: '',
    textBaseline: 'alphabetic',
    fillRect,
    fillText,
    drawImage,
  };
  let activeDecodes = 0;
  let maximumActiveDecodes = 0;
  const renderEnvironment: PromptBundleRenderEnvironment = {
    createSurface: (width, height) => {
      events.push(`surface:${width}x${height}`);
      return {
        context,
        toPngDataUrl: () => `data:image/png;base64,${'A'.repeat(outputLength)}`,
        destroy: () => events.push('destroy'),
      };
    },
    decodePng: async (dataUrl) => {
      activeDecodes++;
      maximumActiveDecodes = Math.max(maximumActiveDecodes, activeDecodes);
      events.push(`decode:${dataUrl.slice(-6)}`);
      return {
        source: dataUrl,
        width: 100,
        height: 80,
        release: () => {
          activeDecodes--;
          events.push('release');
        },
      };
    },
    yieldControl: async () => {
      events.push('yield');
    },
  };
  return {
    renderEnvironment,
    events,
    fillRect,
    fillText,
    drawImage,
    maximumActiveDecodes: () => maximumActiveDecodes,
  };
}

function resolver(events: string[] = []) {
  let active = 0;
  let maximum = 0;
  return {
    resolve: async (picture: PromptBundle['pictures'][number]) => {
      active++;
      maximum = Math.max(maximum, active);
      const dataUrl = `data:image/png;base64,source-${picture.screenshotId}`;
      events.push(`resolve:${picture.screenshotId}`);
      return {
        dataUrl,
        width: picture.width,
        height: picture.height,
        contentRevision: picture.contentRevision,
        release: () => {
          active--;
          events.push(`source-release:${picture.screenshotId}`);
        },
      };
    },
    maximum: () => maximum,
  };
}

describe('prompt bundle composition', () => {
  it('draws native-size PNGs in order and releases each before decoding the next', async () => {
    const testEnvironment = environment();
    const pictureResolver = resolver(testEnvironment.events);
    const input = bundle();
    const result = await composePromptBundle(input, {
      environment: testEnvironment.renderEnvironment,
      resolvePicturePng: pictureResolver.resolve,
    });
    expect(result.kind).toBe('composed');
    expect(testEnvironment.maximumActiveDecodes()).toBe(1);
    expect(pictureResolver.maximum()).toBe(1);
    expect(testEnvironment.drawImage).toHaveBeenNthCalledWith(
      1,
      'data:image/png;base64,source-shot-1',
      input.layout.items[0].x,
      input.layout.items[0].imageY,
      100,
      80,
    );
    expect(testEnvironment.drawImage).toHaveBeenNthCalledWith(
      2,
      'data:image/png;base64,source-shot-2',
      input.layout.items[1].x,
      input.layout.items[1].imageY,
      100,
      80,
    );
    expect(testEnvironment.fillRect).toHaveBeenCalledWith(0, 0, input.layout.width, input.layout.height);
    expect(testEnvironment.fillText.mock.calls[0][0]).toBe('Picture 1 — Screen 1');
    expect(testEnvironment.events.at(-1)).toBe('destroy');
  });

  it('requests automatic re-planning when a multi-picture encoded PNG exceeds the actual limit', async () => {
    const testEnvironment = environment(200);
    const result = await composePromptBundle(bundle(), {
      environment: testEnvironment.renderEnvironment,
      maxClipboardPngCharacters: 100,
      resolvePicturePng: resolver().resolve,
    });
    expect(result).toMatchObject({
      kind: 'encoded-overflow',
      breakBeforeScreenshotId: 'shot-2',
    });
    expect(testEnvironment.events.at(-1)).toBe('destroy');
  });

  it('keeps one oversized screenshot full-resolution and marks it file-only', async () => {
    const testEnvironment = environment(200);
    const result = await composePromptBundle(bundle(1), {
      environment: testEnvironment.renderEnvironment,
      maxClipboardPngCharacters: 100,
      resolvePicturePng: resolver().resolve,
    });
    expect(result).toMatchObject({ kind: 'composed', delivery: 'file-only' });
    if (result.kind === 'composed') expect(result.warning).toMatch(/saved PNG and Markdown/);
  });

  it('rejects decoded dimensions that differ without drawing a resized image', async () => {
    const testEnvironment = environment();
    testEnvironment.renderEnvironment.decodePng = async () => ({
      source: {},
      width: 99,
      height: 80,
      release: vi.fn(),
    });
    await expect(
      composePromptBundle(bundle(1), {
        environment: testEnvironment.renderEnvironment,
        resolvePicturePng: resolver().resolve,
      }),
    ).rejects.toThrow(/dimensions changed/);
    expect(testEnvironment.drawImage).not.toHaveBeenCalled();
    expect(testEnvironment.events.at(-1)).toBe('destroy');
  });

  it('rejects a same-sized render from a stale content revision', async () => {
    const testEnvironment = environment();
    const stale = resolver();
    const resolve = async (picture: PromptBundle['pictures'][number]) => ({
      ...(await stale.resolve(picture)),
      contentRevision: 'stale-revision',
    });
    await expect(
      composePromptBundle(bundle(1), {
        environment: testEnvironment.renderEnvironment,
        resolvePicturePng: resolve,
      }),
    ).rejects.toThrow(/content or dimensions changed/);
    expect(testEnvironment.drawImage).not.toHaveBeenCalled();
  });

  it('stops before resolving the next picture when cancellation is requested', async () => {
    const controller = new AbortController();
    const testEnvironment = environment();
    testEnvironment.renderEnvironment.yieldControl = async () => controller.abort();
    const pictureResolver = resolver(testEnvironment.events);
    await expect(
      composePromptBundle(bundle(), {
        environment: testEnvironment.renderEnvironment,
        resolvePicturePng: pictureResolver.resolve,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(testEnvironment.events.filter((event) => event.startsWith('resolve:'))).toEqual([
      'resolve:shot-1',
    ]);
    expect(testEnvironment.events.at(-1)).toBe('destroy');
  });

  it('rejects pathological output dimensions before allocating a canvas', async () => {
    const testEnvironment = environment();
    await expect(
      composePromptBundle(bundle(1), {
        environment: testEnvironment.renderEnvironment,
        maxCanvasPixels: 1,
        resolvePicturePng: resolver().resolve,
      }),
    ).rejects.toThrow(/canvas safety limits/);
    expect(testEnvironment.events).toEqual([]);
  });
});
