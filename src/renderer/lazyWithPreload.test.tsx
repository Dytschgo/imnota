import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { lazyWithPreload } from './lazyWithPreload';

afterEach(cleanup);

function Greeting({ name }: { name: string }) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      Hello {name} {count}
    </button>
  );
}

it('shows the fallback until the module loads, then keeps the mounted instance', async () => {
  let resolve!: (component: typeof Greeting) => void;
  const Surface = lazyWithPreload(
    () => new Promise<typeof Greeting>((done) => (resolve = done)),
    <p>Loading</p>,
  );
  const view = render(<Surface name="Ada" />);
  expect(screen.getByText('Loading')).toBeInTheDocument();
  await act(async () => resolve(Greeting));
  act(() => screen.getByRole('button').click());
  expect(screen.getByRole('button')).toHaveTextContent('Hello Ada 1');
  // A later render after loading must not remount the instance and lose its state.
  view.rerender(<Surface name="Grace" />);
  expect(screen.getByRole('button')).toHaveTextContent('Hello Grace 1');
});

it('renders a preloaded surface without suspending', async () => {
  const load = vi.fn(async () => Greeting);
  const Surface = lazyWithPreload(load, <p>Loading</p>);
  await Surface.preload();
  await Surface.preload();
  render(<Surface name="Ada" />);
  expect(screen.queryByText('Loading')).not.toBeInTheDocument();
  expect(screen.getByRole('button')).toHaveTextContent('Hello Ada 0');
  expect(load).toHaveBeenCalledOnce();
});

it('retries a load that failed during preload', async () => {
  const load = vi.fn<() => Promise<typeof Greeting>>().mockRejectedValueOnce(new Error('chunk unavailable'));
  load.mockResolvedValue(Greeting);
  const Surface = lazyWithPreload(load);
  await expect(Surface.preload()).rejects.toThrow('chunk unavailable');
  await Surface.preload();
  render(<Surface name="Ada" />);
  expect(screen.getByRole('button')).toHaveTextContent('Hello Ada 0');
  expect(load).toHaveBeenCalledTimes(2);
});
