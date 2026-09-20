import type { MenuItemConstructorOptions } from 'electron';
import type { CaptureOverlayMode } from '../src/shared/capture.js';

export function captureTrayTemplate(input: {
  windowCapture: boolean;
  onCapture(mode: CaptureOverlayMode): void;
  onOpen(): void;
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
    { label: 'Open Imnota', click: () => input.onOpen() },
  ];
}
