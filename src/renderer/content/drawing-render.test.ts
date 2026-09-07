import { beforeEach, expect, it, vi } from 'vitest';

const excalidraw = vi.hoisted(() => ({
  exportToBlob: vi.fn(),
  getNonDeletedElements: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('@excalidraw/excalidraw', () => ({
  exportToBlob: excalidraw.exportToBlob,
  getNonDeletedElements: excalidraw.getNonDeletedElements,
  restore: excalidraw.restore,
}));

import { renderDrawing } from './drawing-render';

beforeEach(() => {
  vi.clearAllMocks();
  excalidraw.restore.mockReturnValue({ elements: [], appState: {}, files: {} });
  excalidraw.getNonDeletedElements.mockReturnValue([]);
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ fillRect: vi.fn(), fillStyle: '' }),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value: () => 'data:image/png;base64,empty',
  });
});

it('returns a white 160 × 120 PNG for an empty source', async () => {
  const result = await renderDrawing('');

  expect(result).toMatchObject({ filename: 'drawing.png', width: 160, height: 120 });
  expect(result.dataUrl).toBe('data:image/png;base64,empty');
  expect(excalidraw.exportToBlob).not.toHaveBeenCalled();
});

it('rejects malformed source instead of replacing it with a blank drawing', async () => {
  await expect(renderDrawing('not JSON')).rejects.toThrow('original source was left unchanged');
  expect(excalidraw.exportToBlob).not.toHaveBeenCalled();
});

it('restores bindings and exports non-deleted scene content on white', async () => {
  const element = { id: 'connector', type: 'arrow' };
  excalidraw.restore.mockReturnValue({ elements: [element], appState: {}, files: {} });
  excalidraw.getNonDeletedElements.mockReturnValue([element]);
  excalidraw.exportToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));

  class SuccessfulReader {
    result = 'data:image/png;base64,drawing';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() {
      this.onload?.();
    }
  }
  vi.stubGlobal('FileReader', SuccessfulReader);
  class SuccessfulImage {
    width = 240;
    height = 160;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      this.onload?.();
    }
  }
  vi.stubGlobal('Image', SuccessfulImage);

  const result = await renderDrawing('{"elements":[{"id":"connector","type":"arrow"}]}');

  expect(excalidraw.restore).toHaveBeenCalledWith(expect.anything(), null, null, { repairBindings: true });
  expect(excalidraw.exportToBlob).toHaveBeenCalledWith(
    expect.objectContaining({
      elements: [element],
      exportPadding: 24,
      mimeType: 'image/png',
      quality: 1,
      appState: expect.objectContaining({ exportWithDarkMode: false, viewBackgroundColor: '#ffffff' }),
    }),
  );
  expect(result).toMatchObject({ width: 240, height: 160 });
  const dimensions = excalidraw.exportToBlob.mock.calls[0][0].getDimensions;
  expect(dimensions(240, 160)).toEqual({ width: 480, height: 320, scale: 2 });
  expect(dimensions(10000, 10000)).toEqual({ width: 4000, height: 4000, scale: 0.4 });
});
