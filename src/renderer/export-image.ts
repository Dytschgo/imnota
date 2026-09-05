import Konva from 'konva';
import type { Annotation, ImagePayload } from '../shared/types';

/** Render each reference at its original resolution, independent of viewport/selection. */
export async function renderAnnotatedImage(image: ImagePayload, annotations: Annotation[]): Promise<string> {
  const bitmap = new Image();
  bitmap.src = image.dataUrl;
  await bitmap.decode();
  const container = document.createElement('div');
  const stage = new Konva.Stage({ container, width: image.width, height: image.height });
  const layer = new Konva.Layer();
  stage.add(layer);
  try {
    layer.add(new Konva.Image({ image: bitmap }));
    for (const annotation of [...annotations].sort((a, b) => a.zIndex - b.zIndex)) {
      const a = { ...annotation, width: annotation.width ?? 20, height: annotation.height ?? 20 };
      const config = {
        ...a,
        stroke: a.stroke ?? '#ef4444',
        strokeWidth: a.strokeWidth ?? 4,
        fill: a.fill === 'transparent' ? undefined : a.fill,
      };
      switch (a.kind) {
        case 'arrow':
          layer.add(
            new Konva.Arrow({
              ...config,
              points: a.points ?? [0, 0, a.width, a.height],
              pointerLength: 12,
              pointerWidth: 10,
              fill: config.stroke,
            }),
          );
          break;
        case 'line':
        case 'pen':
          layer.add(
            new Konva.Line({
              ...config,
              points: a.points ?? [0, 0, a.width, a.height],
              lineCap: 'round',
              lineJoin: 'round',
            }),
          );
          break;
        case 'ellipse':
          layer.add(
            new Konva.Ellipse({
              ...config,
              x: a.x + a.width / 2,
              y: a.y + a.height / 2,
              radiusX: a.width / 2,
              radiusY: a.height / 2,
            }),
          );
          break;
        case 'text':
          layer.add(
            new Konva.Text({
              ...config,
              strokeEnabled: false,
              text: a.text ?? 'Text',
              fontSize: a.fontSize ?? 24,
              padding: 6,
            }),
          );
          break;
        case 'callout': {
          const group = new Konva.Group({ x: a.x, y: a.y, rotation: a.rotation, opacity: a.opacity });
          group.add(
            new Konva.Rect({ width: a.width, height: a.height, fill: a.fill ?? '#6857f5', cornerRadius: 8 }),
          );
          group.add(
            new Konva.Text({
              text: a.text ?? 'Callout',
              width: a.width,
              height: a.height,
              fill: '#fff',
              fontSize: a.fontSize ?? 18,
              padding: 10,
              verticalAlign: 'middle',
            }),
          );
          layer.add(group);
          break;
        }
        case 'step': {
          const group = new Konva.Group({ x: a.x, y: a.y, rotation: a.rotation, opacity: a.opacity });
          group.add(
            new Konva.Circle({
              x: 24,
              y: 24,
              radius: 24,
              fill: a.fill ?? '#6857f5',
              stroke: '#fff',
              strokeWidth: 2,
            }),
          );
          group.add(
            new Konva.Text({
              text: String(a.stepNumber ?? 1),
              width: 48,
              height: 48,
              fontSize: 22,
              fontStyle: 'bold',
              fill: '#fff',
              align: 'center',
              verticalAlign: 'middle',
            }),
          );
          layer.add(group);
          break;
        }
        case 'blur':
          layer.add(new Konva.Rect({ ...config, fill: '#0b0d12', opacity: 1 }));
          break;
        default:
          layer.add(
            new Konva.Rect({
              ...config,
              cornerRadius: a.kind === 'rounded-rectangle' ? 8 : 0,
              dash: a.kind === 'crop' ? [8, 6] : undefined,
            }),
          );
      }
    }
    layer.draw();
    return stage.toDataURL({ pixelRatio: 1 });
  } finally {
    stage.destroy();
  }
}
