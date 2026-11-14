// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listMacCaptureWindows, parseMacCaptureWindows } from './macos-capture-windows.js';

const displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }];

describe('macOS capture helper boundary', () => {
  it('preserves WindowServer order, clips windows, and rejects invalid metadata', () => {
    const source = JSON.stringify([
      { id: 'window:11', title: 'Front', bounds: { x: 100, y: 100, width: 400, height: 300 } },
      { id: 'window:12', title: 'Back', bounds: { x: 1350, y: 70, width: 200, height: 300 } },
      { id: 'window:13', title: '', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'window:14', title: 'Offscreen', bounds: { x: 2000, y: 0, width: 200, height: 200 } },
      { id: 'window:15', title: 'Invalid', bounds: { x: 0, y: 0, width: -1, height: 100 } },
    ]);
    expect(parseMacCaptureWindows(source, displays)).toEqual([
      { id: 'window:11', title: 'Front', bounds: { x: 100, y: 100, width: 400, height: 300 } },
      { id: 'window:12', title: 'Back', bounds: { x: 1350, y: 70, width: 90, height: 300 } },
    ]);
  });

  it('keeps the owning app name the helper reports and ignores an invalid one', () => {
    const source = JSON.stringify([
      { id: 'window:11', title: 'Docs', app: 'Safari', bounds: { x: 0, y: 0, width: 400, height: 300 } },
      { id: 'window:12', title: 'Notes', app: '', bounds: { x: 0, y: 0, width: 400, height: 300 } },
      { id: 'window:13', title: 'Odd', app: 7, bounds: { x: 0, y: 0, width: 400, height: 300 } },
    ]);
    expect(parseMacCaptureWindows(source, displays).map((window) => window.app)).toEqual([
      'Safari',
      undefined,
      undefined,
    ]);
  });

  it('fails closed on an oversized or malformed helper list', () => {
    expect(() => parseMacCaptureWindows('{}', displays)).toThrow('invalid');
    expect(() =>
      parseMacCaptureWindows(JSON.stringify(Array.from({ length: 81 }, () => ({}))), displays),
    ).toThrow('invalid');
  });

  it('asks the helper for windows excluding Imnota and validates what it returns', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const windows = await listMacCaptureWindows(
      { packaged: true, resourcesPath: '/Applications/Imnota.app/Contents/Resources', sourcePath: 'unused' },
      4242,
      displays,
      async (command, args) => {
        calls.push({ command, args });
        return JSON.stringify([
          { id: 'window:7', title: 'Browser', bounds: { x: 10, y: 20, width: 300, height: 200 } },
        ]);
      },
    );
    expect(calls).toEqual([
      {
        command: path.join('/Applications/Imnota.app/Contents/Resources', 'imnota-capture-helper'),
        args: ['windows', '4242'],
      },
    ]);
    expect(windows).toEqual([
      { id: 'window:7', title: 'Browser', bounds: { x: 10, y: 20, width: 300, height: 200 } },
    ]);
  });
});
