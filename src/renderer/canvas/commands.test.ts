import { describe, expect, it, vi } from 'vitest';
import {
  CANVAS_COMMAND_EVENT,
  canvasCommandFromEvent,
  dispatchCanvasCommand,
  viewportForCanvasCommand,
  type CanvasCommand,
} from './commands';

describe('canvas commands', () => {
  it.each<CanvasCommand>(['fit', 'actual-size', 'zoom-in', 'zoom-out'])(
    'dispatches %s only to the owning stage container',
    (command) => {
      const container = document.createElement('div');
      const otherCanvas = document.createElement('div');
      const received: CanvasCommand[] = [];
      const keydown = vi.fn();
      container.addEventListener(CANVAS_COMMAND_EVENT, (event) => {
        const detail = canvasCommandFromEvent(event);
        if (detail) received.push(detail);
      });
      otherCanvas.addEventListener(CANVAS_COMMAND_EVENT, vi.fn());
      window.addEventListener('keydown', keydown);

      dispatchCanvasCommand({ container: () => container }, command);

      expect(received).toEqual([command]);
      expect(keydown).not.toHaveBeenCalled();
      window.removeEventListener('keydown', keydown);
    },
  );

  it('ignores malformed events and a missing stage', () => {
    expect(canvasCommandFromEvent(new CustomEvent(CANVAS_COMMAND_EVENT, { detail: 'reset' }))).toBeNull();
    expect(() => dispatchCanvasCommand(null, 'fit')).not.toThrow();
  });

  it('calculates fit, actual-size, and centred zoom viewports', () => {
    const canvas = { width: 900, height: 600 };
    const image = { width: 1920, height: 1080 };
    const current = { x: 12, y: 20, scale: 0.5 };

    expect(viewportForCanvasCommand(current, 'fit', canvas, image)).toEqual({
      x: 32,
      y: 64.875,
      scale: 836 / 1920,
    });
    expect(viewportForCanvasCommand(current, 'actual-size', canvas, image)).toEqual({
      x: -510,
      y: -240,
      scale: 1,
    });
    expect(viewportForCanvasCommand(current, 'zoom-in', canvas, image).scale).toBeCloseTo(0.55);
    expect(viewportForCanvasCommand(current, 'zoom-out', canvas, image).scale).toBeCloseTo(0.5 / 1.1);
  });
});
