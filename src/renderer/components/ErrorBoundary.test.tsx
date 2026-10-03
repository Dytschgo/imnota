import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadWindow, setReloadProtection } from '../app/reload-guard';
import { ErrorBoundary } from './ErrorBoundary';

let broken = true;
function Fragile() {
  if (broken) throw new Error('Konva exploded');
  return <p>Canvas ready</p>;
}

beforeEach(() => {
  broken = true;
  // React reports the caught render error; the boundary logs it too.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  setReloadProtection(null);
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('replaces a crashed window with a plain explanation and a Reload action', async () => {
    const onReload = vi.fn(async () => true);
    render(
      <ErrorBoundary variant="app" onReload={onReload}>
        <Fragile />
      </ErrorBoundary>,
    );
    const fallback = screen.getByRole('alert');
    expect(fallback).toHaveTextContent('Imnota ran into a problem');
    expect(fallback).toHaveTextContent('saves your pending changes first');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(onReload).toHaveBeenCalledWith({ discardUnsaved: false }));
  });

  it('keeps a canvas crash inside its panel and recovers with Try again', () => {
    render(
      <main>
        <nav>Collection rail</nav>
        <ErrorBoundary variant="panel">
          <Fragile />
        </ErrorBoundary>
      </main>,
    );
    expect(screen.getByText('Collection rail')).toBeInTheDocument();
    expect(screen.getByTestId('error-fallback-panel')).toHaveTextContent('This item could not be shown');
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Canvas ready')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the fallback again when Try again hits the same failure', () => {
    render(
      <ErrorBoundary variant="panel">
        <Fragile />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByTestId('error-fallback-panel')).toBeInTheDocument();
  });

  it('recovers a panel when another item is opened', () => {
    const { rerender } = render(
      <ErrorBoundary variant="panel" resetKey="shot-1">
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    broken = false;
    rerender(
      <ErrorBoundary variant="panel" resetKey="shot-2">
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Canvas ready')).toBeInTheDocument();
  });

  it('does not reload over a failed save unless the user chooses to discard it', async () => {
    const onReload = vi.fn(async ({ discardUnsaved }: { discardUnsaved?: boolean }) =>
      Boolean(discardUnsaved),
    );
    render(
      <ErrorBoundary variant="app" onReload={onReload}>
        <Fragile />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByText(/could not be saved/)).toBeInTheDocument();
    expect(onReload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reload without saving' }));
    await waitFor(() => expect(onReload).toHaveBeenLastCalledWith({ discardUnsaved: true }));
  });
});

describe('reloadWindow', () => {
  it('saves pending work and releases the unload guard before reloading', async () => {
    const order: string[] = [];
    setReloadProtection({
      flush: async () => {
        order.push('flush');
        return true;
      },
      allowUnload: () => order.push('allow'),
    });
    expect(await reloadWindow({}, () => order.push('reload'))).toBe(true);
    expect(order).toEqual(['flush', 'allow', 'reload']);
  });

  it.each([
    ['resolves false', async () => false],
    [
      'rejects',
      async () => {
        throw new Error('Disk full');
      },
    ],
  ])('keeps the window open when the save %s', async (_label, flush) => {
    const allowUnload = vi.fn();
    const reload = vi.fn();
    setReloadProtection({ flush, allowUnload });
    expect(await reloadWindow({}, reload)).toBe(false);
    expect(allowUnload).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('skips the save only when discarding was chosen', async () => {
    const flush = vi.fn(async () => false);
    const allowUnload = vi.fn();
    const reload = vi.fn();
    setReloadProtection({ flush, allowUnload });
    expect(await reloadWindow({ discardUnsaved: true }, reload)).toBe(true);
    expect(flush).not.toHaveBeenCalled();
    expect(allowUnload).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads directly when nothing registered pending work', async () => {
    const reload = vi.fn();
    expect(await reloadWindow({}, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });
});
