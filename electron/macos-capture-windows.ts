import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CaptureDisplay, CaptureRectangle } from '../src/shared/capture.js';
import {
  identifiableCaptureWindows,
  type CaptureWindowCandidate,
  type NativeCaptureWindow,
} from './capture-windows.js';

const execute = promisify(execFile);

export interface MacCaptureHelperLocation {
  packaged: boolean;
  resourcesPath: string;
  sourcePath: string;
}

export type RunMacCaptureHelper = (command: string, args: readonly string[]) => Promise<string>;

const runHelper =
  (location: MacCaptureHelperLocation): RunMacCaptureHelper =>
  async (command, args) => {
    const { stdout } = await execute(command, [...args], {
      timeout: location.packaged ? 4_000 : 20_000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
    return stdout;
  };

/** Packaged builds run the bundled binary; development runs the Swift source. */
function helperCommand(location: MacCaptureHelperLocation, ownProcessId: number): [string, string[]] {
  return location.packaged
    ? [path.join(location.resourcesPath, 'imnota-capture-helper'), ['windows', String(ownProcessId)]]
    : ['/usr/bin/xcrun', ['swift', location.sourcePath, 'windows', String(ownProcessId)]];
}

function captureRectangle(value: unknown): CaptureRectangle | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const { x, y, width, height } = candidate;
  if (
    ![x, y, width, height].every((entry) => typeof entry === 'number' && Number.isFinite(entry)) ||
    (width as number) < 1 ||
    (height as number) < 1 ||
    (width as number) > 100_000 ||
    (height as number) > 100_000
  )
    return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

/** Validate helper output before handing window bounds to the existing hit-test path. */
export function parseMacCaptureWindows(
  source: string,
  displays: readonly CaptureDisplay[],
): CaptureWindowCandidate[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed) || parsed.length > 80) throw new Error('The macOS window list is invalid.');
  const natives: NativeCaptureWindow[] = [];
  for (const value of parsed) {
    if (!value || typeof value !== 'object') continue;
    const candidate = value as Record<string, unknown>;
    const bounds = captureRectangle(candidate.bounds);
    if (
      typeof candidate.id !== 'string' ||
      !/^window:\d{1,10}$/.test(candidate.id) ||
      typeof candidate.title !== 'string' ||
      !candidate.title.trim() ||
      candidate.title.length > 120 ||
      !bounds
    )
      continue;
    natives.push({
      id: candidate.id,
      title: candidate.title,
      ...(typeof candidate.app === 'string' && candidate.app.trim() && candidate.app.length <= 120
        ? { app: candidate.app }
        : {}),
      bounds,
      className: '',
      visible: true,
      cloaked: false,
      toolWindow: false,
      minimized: false,
      currentProcess: false,
    });
  }
  return identifiableCaptureWindows(natives, displays);
}

export async function listMacCaptureWindows(
  location: MacCaptureHelperLocation,
  ownProcessId: number,
  displays: readonly CaptureDisplay[],
  run: RunMacCaptureHelper = runHelper(location),
): Promise<CaptureWindowCandidate[]> {
  const [command, args] = helperCommand(location, ownProcessId);
  return parseMacCaptureWindows((await run(command, args)).trim(), displays);
}
