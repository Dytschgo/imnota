import type { CaptureDisplay, CaptureRectangle } from '../src/shared/capture.js';
import type { CaptureWindowCandidate } from './capture-windows.js';

export interface CaptureSourceDetails {
  windowTitle?: string;
  app?: string;
  display?: string;
}

/**
 * What a finished capture can say about its source without any further OS query: the
 * window the user picked in Window mode (title, and the app where the platform reports it)
 * and, with several displays, which display the selection's centre is on. Area and Display
 * captures have no window, so they record only the display.
 */
export function captureSourceDetails(input: {
  selection: CaptureRectangle;
  windowId?: string | null;
  windows: readonly CaptureWindowCandidate[];
  displays: readonly CaptureDisplay[];
}): CaptureSourceDetails {
  const details: CaptureSourceDetails = {};
  const window = input.windowId
    ? input.windows.find((candidate) => candidate.id === input.windowId)
    : undefined;
  if (window) {
    details.windowTitle = window.title;
    if (window.app) details.app = window.app;
  }
  if (input.displays.length > 1) {
    const x = input.selection.x + input.selection.width / 2;
    const y = input.selection.y + input.selection.height / 2;
    const index = input.displays.findIndex(
      ({ bounds }) =>
        x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height,
    );
    if (index >= 0) details.display = `Display ${index + 1} of ${input.displays.length}`;
  }
  return details;
}
