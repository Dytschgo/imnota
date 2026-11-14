import type { MenuItemConstructorOptions } from 'electron';
import type { CaptureOverlayMode } from '../src/shared/capture.js';

export function captureTrayTemplate(input: {
  windowCapture: boolean;
  onCapture(mode: CaptureOverlayMode): void;
  onOpen(): void;
  onQuit(): void;
  onPendingCaptures?(): void;
}): MenuItemConstructorOptions[] {
  return [
    { label: 'Capture region', click: () => input.onCapture('region') },
    {
      label: 'Capture window',
      enabled: input.windowCapture,
      click: () => input.onCapture('window'),
    },
    { label: 'Capture display', click: () => input.onCapture('display') },
    { type: 'separator' },
    ...(input.onPendingCaptures ? [{ label: 'Pending captures', click: input.onPendingCaptures }] : []),
    { label: 'Open Imnota', click: () => input.onOpen() },
    { label: 'Quit Imnota', click: () => input.onQuit() },
  ];
}
