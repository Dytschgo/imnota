import { zoomAt, type Viewport } from '../viewport';

export const CANVAS_COMMAND_EVENT = 'imnota:canvas-command';

export type CanvasCommand = 'fit' | 'actual-size' | 'zoom-in' | 'zoom-out';

export interface CanvasCommandStage {
  container(): HTMLElement;
}

export interface CanvasDimensions {
  width: number;
  height: number;
}

export function dispatchCanvasCommand(stage: CanvasCommandStage | null, command: CanvasCommand): void {
  stage?.container().dispatchEvent(new CustomEvent<CanvasCommand>(CANVAS_COMMAND_EVENT, { detail: command }));
}

export function canvasCommandFromEvent(event: Event): CanvasCommand | null {
  const command = (event as CustomEvent<unknown>).detail;
  return command === 'fit' || command === 'actual-size' || command === 'zoom-in' || command === 'zoom-out'
    ? command
    : null;
}

export function viewportForCanvasCommand(
  current: Viewport,
  command: CanvasCommand,
  canvas: CanvasDimensions,
  image: CanvasDimensions,
): Viewport {
  if (command === 'fit') {
    const scale = Math.max(
      0.02,
      Math.min((canvas.width - 64) / image.width, (canvas.height - 64) / image.height, 1),
    );
    return {
      x: (canvas.width - image.width * scale) / 2,
      y: (canvas.height - image.height * scale) / 2,
      scale,
    };
  }
  if (command === 'actual-size') {
    return {
      x: (canvas.width - image.width) / 2,
      y: (canvas.height - image.height) / 2,
      scale: 1,
    };
  }
  return zoomAt(
    current,
    { x: canvas.width / 2, y: canvas.height / 2 },
    command === 'zoom-out' ? 1 / 1.1 : 1.1,
  );
}
