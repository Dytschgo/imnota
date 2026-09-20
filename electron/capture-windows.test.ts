import { describe, expect, it } from 'vitest';
import { WINDOW_CAPTURE_UNAVAILABLE_MESSAGE } from '../src/shared/capture.js';
import {
  captureWindowAtPoint,
  clipRectangleToDisplays,
  identifiableCaptureWindows,
  windowCaptureUnavailableMessage,
  type NativeCaptureWindow,
} from './capture-windows.js';
import { tryListWindowsCaptureWindows } from './windows-capture-windows.js';

const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };

function native(
  partial: Partial<NativeCaptureWindow> & Pick<NativeCaptureWindow, 'id' | 'title' | 'bounds'>,
): NativeCaptureWindow {
  return {
    className: 'Chrome_WidgetWin_1',
    visible: true,
    cloaked: false,
    toolWindow: false,
    minimized: false,
    currentProcess: false,
    ...partial,
  };
}

describe('identifiable capture windows', () => {
  it('keeps z-order, drops shell chrome, and clips to the captured display', () => {
    const windows = identifiableCaptureWindows(
      [
        native({ id: 'front', title: '  Notes  ', bounds: { x: 40, y: 40, width: 200, height: 120 } }),
        native({
          id: 'tray',
          title: 'Taskbar',
          className: 'Shell_TrayWnd',
          bounds: { x: 0, y: 1040, width: 1920, height: 40 },
        }),
        native({
          id: 'self',
          title: 'Imnota',
          currentProcess: true,
          bounds: { x: 10, y: 10, width: 100, height: 80 },
        }),
        native({
          id: 'hidden',
          title: 'Background',
          visible: false,
          bounds: { x: 20, y: 20, width: 100, height: 80 },
        }),
        native({
          id: 'overflow',
          title: 'Offscreen',
          bounds: { x: 1800, y: 100, width: 400, height: 200 },
        }),
      ],
      [display],
    );
    expect(windows).toEqual([
      { id: 'front', title: 'Notes', bounds: { x: 40, y: 40, width: 200, height: 120 } },
      { id: 'overflow', title: 'Offscreen', bounds: { x: 1800, y: 100, width: 120, height: 200 } },
    ]);
    expect(captureWindowAtPoint(windows, { x: 50, y: 50 })?.id).toBe('front');
    expect(windowCaptureUnavailableMessage(windows)).toBeNull();
  });

  it('reports that window capture is unavailable when Electron cannot identify windows', () => {
    expect(identifiableCaptureWindows([], [display])).toEqual([]);
    expect(windowCaptureUnavailableMessage([])).toBe(WINDOW_CAPTURE_UNAVAILABLE_MESSAGE);
    expect(clipRectangleToDisplays({ x: -10, y: -10, width: 5, height: 5 }, [display])).toBeNull();
    expect(Array.isArray(tryListWindowsCaptureWindows((rect) => rect))).toBe(true);
  });
});
