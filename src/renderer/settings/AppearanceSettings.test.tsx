import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('shows image controls when a backdrop image overrides stored desktop glass', () => {
    const value = {
      ...DEFAULT_APPEARANCE,
      mode: 'system' as const,
      desktopGlass: true,
      backgroundImage: 'preset:mist-light',
    };
    const effective = {
      theme: 'light' as const,
      accent: 'indigo' as const,
      requestedGlassLevel: 'strong' as const,
      glassLevel: 'strong' as const,
      glassFallbackReason: 'none' as const,
      desktopGlassStatus: 'off' as const,
    };
    const { rerender } = render(
      <AppearanceSettings value={value} effectiveAppearance={effective} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('slider', { name: /Background opacity/ })).toBeEnabled();
    expect(screen.queryByText(/Solid fallback is active/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desktop glass (Beta)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    rerender(
      <AppearanceSettings
        value={{ ...value, backgroundImage: '' }}
        effectiveAppearance={{ ...effective, theme: 'dark', desktopGlassStatus: 'active' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('slider', { name: /Glass tint/ })).toBeEnabled();
    expect(screen.getByText(/Desktop glass \(Beta\) is active/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desktop glass (Beta)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps the selected character and offers generic artwork as explicit choices', async () => {
    const onChange = vi.fn();
    renderSettings(onChange, 'preset:emerald');
    const characters = screen.getByRole('group', { name: 'Characters backdrops' });
    const generic = screen.getByRole('group', { name: 'Generic backdrops' });
    expect(within(characters).getAllByRole('button')).toHaveLength(4);
    expect(within(characters).getByRole('button', { name: 'Emerald' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(generic).getAllByRole('button')).toHaveLength(4);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(generic).getByRole('button', { name: 'Mist light' }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ backgroundImage: 'preset:mist-light' }),
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
