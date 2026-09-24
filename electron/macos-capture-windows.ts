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

async function invokeMacCaptureHelper(
  location: MacCaptureHelperLocation,
  mode: 'windows' | 'hidden',
  value: number,
): Promise<string> {
  const command = location.packaged
    ? path.join(location.resourcesPath, 'imnota-capture-helper')
    : '/usr/bin/xcrun';
  const args = location.packaged
    ? [mode, String(value)]
    : ['swift', location.sourcePath, mode, String(value)];
  const { stdout } = await execute(command, args, {
    timeout: location.packaged ? 4_000 : 20_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
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
): Promise<CaptureWindowCandidate[]> {
  return parseMacCaptureWindows(await invokeMacCaptureHelper(location, 'windows', ownProcessId), displays);
}

export async function waitForMacCaptureWindowHidden(
  location: MacCaptureHelperLocation,
  mediaSourceId: string,
): Promise<void> {
  const match = /^window:(\d+):[01]$/.exec(mediaSourceId);
  if (!match) throw new Error('Imnota could not identify its window before capture.');
  const windowId = Number(match[1]);
  if (!Number.isSafeInteger(windowId)) throw new Error('Imnota window ID is invalid.');
  const result = await invokeMacCaptureHelper(location, 'hidden', windowId);
  if (result !== 'hidden') throw new Error('Imnota remained visible while capture was prepared.');
}
