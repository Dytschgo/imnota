import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CaptureRectangle } from '../src/shared/capture.js';

/**
 * Window mode captures the chosen window's own pixels, so apps in front of it are not
 * included. Every helper returns null instead of throwing; the caller then falls back to
 * cropping the frozen screen still, which is what the user saw while selecting.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_WINDOW_PNG_BYTES = 64 * 1024 * 1024;

function pngOrNull(png: Buffer): Buffer | null {
  return png.length > PNG_SIGNATURE.length &&
    png.length <= MAX_WINDOW_PNG_BYTES &&
    png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    ? png
    : null;
}

export type RunScreencapture = (args: readonly string[]) => Promise<void>;

const nativeScreencapture: RunScreencapture = (args) =>
  new Promise((resolve, reject) =>
    execFile('/usr/sbin/screencapture', [...args], { timeout: 10_000 }, (error) =>
      error ? reject(error) : resolve(),
    ),
  );

/**
 * macOS: the built-in screencapture tool captures one window by its WindowServer id at
 * full backing resolution, even when other windows cover it. It runs under Imnota's
 * Screen Recording permission. -o omits the window shadow and -x the shutter sound.
 */
export async function captureMacWindowPng(
  windowId: string,
  run: RunScreencapture = nativeScreencapture,
  temporaryRoot = os.tmpdir(),
): Promise<Buffer | null> {
  const number = /^window:(\d{1,10})$/.exec(windowId)?.[1];
  if (!number) return null;
  const directory = await mkdtemp(path.join(temporaryRoot, 'imnota-window-'));
  try {
    const file = path.join(directory, 'window.png');
    await run(['-x', '-o', '-t', 'png', `-l${number}`, file]);
    return pngOrNull(await readFile(file));
  } catch {
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export interface WindowSourceImage {
  isEmpty(): boolean;
  toPNG(): Buffer;
}

export type GetWindowSources = (options: {
  types: ['window'];
  thumbnailSize: { width: number; height: number };
  fetchWindowIcons: false;
}) => Promise<Array<{ id: string; thumbnail: WindowSourceImage }>>;

/**
 * Windows: Electron's window sources capture each window's own content (Windows Graphics
 * Capture), so a covered window is captured as it is. Source ids are the window id plus
 * a ":<n>" suffix. Requesting the window's physical size keeps its native resolution.
 */
export async function captureElectronWindowPng(
  windowId: string,
  bounds: CaptureRectangle,
  scaleFactor: number,
  getSources: GetWindowSources,
): Promise<Buffer | null> {
  if (!/^window:\d{1,20}$/.test(windowId)) return null;
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  try {
    const sources = await getSources({
      types: ['window'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false,
    });
    const source = sources.find((candidate) => candidate.id.startsWith(`${windowId}:`));
    if (!source || source.thumbnail.isEmpty()) return null;
    return pngOrNull(source.thumbnail.toPNG());
  } catch {
    return null;
  }
}

/** Use the selected window's own pixels when available, otherwise the frozen selection. */
export async function captureSelectedImagePng(
  selection: CaptureRectangle,
  windowId: string | null | undefined,
  captureWindow: (windowId: string, selection: CaptureRectangle) => Promise<Buffer | null>,
  cropStill: () => Buffer,
): Promise<Buffer> {
  if (windowId) {
    try {
      const windowPng = await captureWindow(windowId, selection);
      if (windowPng) return windowPng;
    } catch {
      // Native capture is best-effort; keep the frozen selection as the fallback.
    }
  }
  return cropStill();
}
