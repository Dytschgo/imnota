// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { captureSourceDetails } from './capture-source.js';

const left = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
const right = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5 };
const windows = [
  { id: '1311', title: 'C:\\Users\\Dylan\\shop\\App.tsx - Visual Studio Code', bounds: left.bounds },
  { id: 'window:42', title: 'Docs', bounds: right.bounds, app: 'Safari' },
];

describe('capture source details', () => {
  it('names the picked window and app in Window mode and the display with several displays', () => {
    expect(
      captureSourceDetails({
        selection: right.bounds,
        windowId: 'window:42',
        windows,
        displays: [left, right],
      }),
    ).toEqual({ windowTitle: 'Docs', app: 'Safari', display: 'Display 2 of 2' });
    expect(
      captureSourceDetails({ selection: left.bounds, windowId: '1311', windows, displays: [left] }),
    ).toEqual({
      windowTitle: 'C:\\Users\\Dylan\\shop\\App.tsx - Visual Studio Code',
    });
  });

  it('records no window for Area or Display capture, or an unknown window id', () => {
    const area = { x: 100, y: 100, width: 50, height: 50 };
    expect(captureSourceDetails({ selection: area, windows, displays: [left, right] })).toEqual({
      display: 'Display 1 of 2',
    });
    expect(captureSourceDetails({ selection: area, windowId: 'gone', windows, displays: [left] })).toEqual(
      {},
    );
  });
});
