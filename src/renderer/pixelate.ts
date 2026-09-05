import type { Annotation } from '../shared/types';
import { exportBounds } from '../shared/crop';

export function pixelatedRegion(image: HTMLImageElement, annotation: Annotation): HTMLCanvasElement {
  const bounds = exportBounds(image.naturalWidth, image.naturalHeight, [{ ...annotation, kind: 'crop' }]);
  const block = Math.max(4, Math.min(100, annotation.blurIntensity ?? 14));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.ceil(bounds.width / block));
  small.height = Math.max(1, Math.ceil(bounds.height / block));
  const context = small.getContext('2d');
  if (!context) throw new Error('Image processing is unavailable. Use an opaque mask instead.');
  context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, small.width, small.height);
  const result = document.createElement('canvas');
  result.width = bounds.width;
  result.height = bounds.height;
  const output = result.getContext('2d');
  if (!output) throw new Error('Image processing is unavailable.');
  output.imageSmoothingEnabled = false;
  output.drawImage(small, 0, 0, result.width, result.height);
  return result;
}
