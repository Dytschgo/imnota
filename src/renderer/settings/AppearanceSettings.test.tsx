import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKGROUND_IMAGE_MAX_BYTES, DEFAULT_APPEARANCE } from '../../shared/preferences';
import { AppearanceSettings } from './AppearanceSettings';
import { savedBackgrounds } from './background-library';
vi.mock('./background-library', () => ({
  savedBackgrounds: vi.fn(async () => []),
  saveBackground: vi.fn(async () => {}),
  removeBackground: vi.fn(async () => {}),
}));

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(reason?: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  return { promise: new Promise<T>((next, fail) => ((resolve = next), (reject = fail))), resolve, reject };
}

class MockFileReader {
  static instances: MockFileReader[] = [];
  result: string | null = null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

  readAsDataURL() {
    MockFileReader.instances.push(this);
  }

  complete(value: string) {
    this.result = value;
    this.onload?.({} as ProgressEvent<FileReader>);
  }
}

const imageDecodes: Array<Deferred<void>> = [];

class MockImage {
  decoding = 'async';
  naturalWidth = 1280;
  naturalHeight = 720;
  src = '';

  decode() {
    const next = deferred<void>();
    imageDecodes.push(next);
    return next.promise;
  }
}

function renderSettings(onChange = vi.fn(), backgroundImage = '') {
  return render(
    <AppearanceSettings value={{ ...DEFAULT_APPEARANCE, backgroundImage }} onChange={onChange} />,
  );
}

function upload(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.stubGlobal('FileReader', MockFileReader);
  vi.stubGlobal('Image', MockImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AA==');
});

afterEach(() => {
  cleanup();
  MockFileReader.instances = [];
  imageDecodes.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AppearanceSettings backdrop upload ownership', () => {
  it('keeps separate backdrop choices and opacity scoped to the effective theme', async () => {
    const onChange = vi.fn();
    const separate = {
      ...DEFAULT_APPEARANCE,
      useSameBackdropForBoth: false,
      darkBackgroundImage: 'preset:graphite',
      darkBackgroundOpacity: 0.35,
    };
    render(
      <AppearanceSettings
        value={separate}
        effectiveAppearance={{
          theme: 'dark',
          accent: 'indigo',
          requestedGlassLevel: 'balanced',
          glassLevel: 'balanced',
          glassFallbackReason: 'none',
        }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('backdrop-preset-emerald'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        useSameBackdropForBoth: false,
        darkBackgroundImage: 'preset:emerald',
        lightBackgroundImage: '',
      }),
    );
    await waitFor(() => expect(screen.getByRole('slider')).not.toBeDisabled());
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.65' } });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ darkBackgroundOpacity: 0.65, lightBackgroundOpacity: 0.42 }),
      ),
    );
  });

  it('offers native desktop glass without forgetting uploaded thumbnails', async () => {
    vi.mocked(savedBackgrounds).mockResolvedValueOnce([
      { id: 'one', name: 'My image', dataUrl: 'data:image/png;base64,AA==', addedAt: 1 },
    ]);
    const onChange = vi.fn();
    renderSettings(onChange);
    await screen.findByRole('button', { name: 'My image' });
    fireEvent.click(screen.getByRole('button', { name: 'Desktop glass (Beta)' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ desktopGlass: true, backgroundImage: '', glassLevel: 'balanced' }),
    );
  });
  it('does not let a delayed FileReader completion overwrite a later bundled preset', async () => {
    const onChange = vi.fn();
    renderSettings(onChange);
    upload(new File(['image'], 'upload.png', { type: 'image/png' }));

    fireEvent.click(screen.getByTestId('backdrop-preset-emerald'));
    await act(async () => {
      MockFileReader.instances[0].complete('data:image/png;base64,AA==');
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ backgroundImage: 'preset:emerald' }));
    expect(imageDecodes).toHaveLength(0);
  });

  it('does not let a delayed upload restore a removed backdrop', async () => {
    const onChange = vi.fn();
    renderSettings(onChange, 'preset:graphite');
    upload(new File(['image'], 'upload.png', { type: 'image/png' }));

    await act(async () => {
      MockFileReader.instances[0].complete('data:image/png;base64,AA==');
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId('backdrop-remove'));
    await act(async () => {
      imageDecodes[0].resolve();
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ backgroundImage: '' }));
  });

  it('reports a decode failure without saving a backdrop', async () => {
    const onChange = vi.fn();
    renderSettings(onChange);
    upload(new File(['image'], 'broken.png', { type: 'image/png' }));

    await act(async () => {
      MockFileReader.instances[0].complete('data:image/png;base64,AA==');
      await Promise.resolve();
      imageDecodes[0].reject(new Error('decode failed'));
      await Promise.resolve();
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be normalized');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the 5.5 MB allowance', () => {
    renderSettings();
    upload(new File([new Uint8Array(BACKGROUND_IMAGE_MAX_BYTES)], 'limit.png', { type: 'image/png' }));
    expect(MockFileReader.instances).toHaveLength(1);
  });
});
