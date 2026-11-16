import type { Annotation } from '../../shared/types';
import { pixelatedRegion, pixelationSample } from '../pixelate';

type Pixelate = (image: HTMLImageElement, annotation: Annotation) => HTMLCanvasElement;

export interface PixelationCache {
  /**
   * Returns each pixelate annotation's region by id. A region is rebuilt only when its image,
   * sampled bounds or block size changes. New regions stay cached until `retain` releases them.
   */
  regions(image: HTMLImageElement, annotations: readonly Annotation[]): Map<string, HTMLCanvasElement>;
  /**
   * Releases every cached region that is not in `inUse`. Call it after the regions are committed,
   * so a canvas still displayed by the previous render is never released early.
   */
  retain(inUse: ReadonlyMap<string, HTMLCanvasElement>): void;
  /** Releases every region, for example on unmount. */
  clear(): void;
  readonly size: number;
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

export function createPixelationCache(pixelate: Pixelate = pixelatedRegion): PixelationCache {
  const imageTokens = new WeakMap<HTMLImageElement, number>();
  let nextImageToken = 0;
  const entries = new Map<string, HTMLCanvasElement>();

  function imageToken(image: HTMLImageElement): number {
    let token = imageTokens.get(image);
    if (token === undefined) {
      token = nextImageToken++;
      imageTokens.set(image, token);
    }
    return token;
  }

  return {
    regions(image, annotations) {
      const token = imageToken(image);
      const result = new Map<string, HTMLCanvasElement>();
      for (const annotation of annotations) {
        if (annotation.kind !== 'pixelate') continue;
        const { bounds, block } = pixelationSample(image, annotation);
        const key = `${token}:${bounds.x},${bounds.y},${bounds.width},${bounds.height}:${block}`;
        let canvas = entries.get(key);
        if (!canvas) {
          canvas = pixelate(image, annotation);
          entries.set(key, canvas);
        }
        result.set(annotation.id, canvas);
      }
      return result;
    },
    retain(inUse) {
      const kept = new Set(inUse.values());
      for (const [key, canvas] of entries) {
        if (kept.has(canvas)) continue;
        release(canvas);
        entries.delete(key);
      }
    },
    clear() {
      for (const canvas of entries.values()) release(canvas);
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
