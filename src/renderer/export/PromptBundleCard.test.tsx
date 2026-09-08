import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptBundleCard, type PromptBundleCardModel } from './PromptBundleCard';

const initialShowPopover = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover');
const initialHidePopover = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidePopover');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (initialShowPopover) Object.defineProperty(HTMLElement.prototype, 'showPopover', initialShowPopover);
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).showPopover;
  if (initialHidePopover) Object.defineProperty(HTMLElement.prototype, 'hidePopover', initialHidePopover);
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).hidePopover;
});

it('disables preview while another prompt operation is running', () => {
  const onLoadPreview = vi.fn();
  render(
    <PromptBundleCard
      bundle={model()}
      disabled
      onCopyFresh={vi.fn()}
      onPrepareFreshFiles={vi.fn()}
      onLoadPreview={onLoadPreview}
    />,
  );
  const preview = screen.getByRole('button', { name: /full-resolution preview/i });
  expect(preview).toBeDisabled();
  fireEvent.click(preview);
  expect(onLoadPreview).not.toHaveBeenCalled();
});

function model(overrides: Partial<PromptBundleCardModel> = {}): PromptBundleCardModel {
  return {
    planId: 'plan-current',
    artifactSessionId: 'session-current',
    bundleNumber: 2,
    pictureNumbers: [3, 4],
    screenshotCount: 2,
    excludedCount: 1,
    width: 1952,
    height: 2300,
    estimatedBytes: 2 * 1024 * 1024,
    delivery: 'clipboard',
    state: 'idle',
    ...overrides,
  };
}

it('sends plan and artifact freshness identity with the primary action', () => {
  const onCopyFresh = vi.fn();
  render(<PromptBundleCard bundle={model()} onCopyFresh={onCopyFresh} onPrepareFreshFiles={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy Bundle' }));
  expect(onCopyFresh).toHaveBeenCalledWith({
    planId: 'plan-current',
    artifactSessionId: 'session-current',
    bundleNumber: 2,
  });
  expect(screen.getByRole('heading', { name: 'Bundle 2' })).toBeInTheDocument();
  expect(screen.getByText('Pictures 3, 4')).toBeInTheDocument();
  expect(screen.getByText('2.0 MB estimated')).toBeInTheDocument();
});

it('uses an honest file action for oversized prompts and disables fallbacks before artifacts exist', () => {
  const onPrepareFreshFiles = vi.fn();
  render(
    <PromptBundleCard
      bundle={model({ artifactSessionId: undefined, delivery: 'file-only', warning: 'Use saved files.' })}
      onCopyFresh={vi.fn()}
      onPrepareFreshFiles={onPrepareFreshFiles}
      onCopyMarkdown={vi.fn()}
      onCopyImage={vi.fn()}
      onOpenFiles={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /prepare files/i }));
  expect(onPrepareFreshFiles).toHaveBeenCalledOnce();
  expect(screen.getByText('Use saved files.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /options/i })).toBeEnabled();
});

it('offers Open files before an artifact exists so the controller can prepare it', () => {
  const onOpenFiles = vi.fn();
  render(
    <PromptBundleCard
      bundle={model({ artifactSessionId: undefined })}
      onCopyFresh={vi.fn()}
      onPrepareFreshFiles={vi.fn()}
      onOpenFiles={onOpenFiles}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /options/i }));
  const openFiles = screen.getByRole('menuitem', { name: 'Open files' });
  expect(openFiles).toBeEnabled();
  fireEvent.click(openFiles);
  expect(onOpenFiles).toHaveBeenCalledWith({
    planId: 'plan-current',
    artifactSessionId: undefined,
    bundleNumber: 2,
  });
});

it('keeps individual formats in an accessible options menu', () => {
  const onCopyMarkdown = vi.fn();
  const onCopyImage = vi.fn();
  render(
    <PromptBundleCard
      bundle={model()}
      onCopyFresh={vi.fn()}
      onPrepareFreshFiles={vi.fn()}
      onCopyMarkdown={onCopyMarkdown}
      onCopyImage={onCopyImage}
      onOpenFiles={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: /options/i }));
  const menu = screen.getByRole('menu', { name: 'Bundle 2 options' });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Markdown' }));
  expect(onCopyMarkdown).toHaveBeenCalledWith({
    planId: 'plan-current',
    artifactSessionId: 'session-current',
    bundleNumber: 2,
  });
  expect(menu).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /options/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy PNG' }));
  expect(onCopyImage).toHaveBeenCalledWith({
    planId: 'plan-current',
    artifactSessionId: 'session-current',
    bundleNumber: 2,
  });
});

it('shows a gray copied state while leaving Copy Bundle available again', () => {
  const onCopyFresh = vi.fn();
  render(
    <PromptBundleCard
      bundle={model({ state: 'copied' })}
      onCopyFresh={onCopyFresh}
      onPrepareFreshFiles={vi.fn()}
    />,
  );

  const button = screen.getByRole('button', { name: 'Copied' });
  expect(button).toHaveClass('is-copied');
  fireEvent.click(button);
  expect(onCopyFresh).toHaveBeenCalledOnce();
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

it('uses a native top-layer popover inside the dialog and keeps it within the viewport', async () => {
  let triggerTop = 132;
  const order: string[] = [];
  const showPopover = vi.fn(function (this: HTMLElement) {
    order.push('show');
    this.setAttribute('data-popover-open', 'true');
  });
  const hidePopover = vi.fn(function (this: HTMLElement) {
    order.push('hide');
    this.removeAttribute('data-popover-open');
  });
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: showPopover });
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', { configurable: true, value: hidePopover });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute('role') === 'dialog') return rect(40, 20, 260, 140);
    if (this.getAttribute('aria-label') === 'Copy options') return rect(260, triggerTop, 36, 32);
    if (this.getAttribute('role') === 'menu') {
      order.push('measure');
      return rect(0, 0, 160, 100);
    }
    return rect(0, 0, 0, 0);
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 180 });
  render(
    <section role="dialog" style={{ backdropFilter: 'blur(18px)' }}>
      <PromptBundleCard bundle={model()} onCopyFresh={vi.fn()} onPrepareFreshFiles={vi.fn()} />
    </section>,
  );

  const dialog = screen.getByRole('dialog');
  const options = screen.getByRole('button', { name: /options/i });
  fireEvent.click(options);
  const menu = screen.getByRole('menu', { name: 'Bundle 2 options' });
  expect(dialog).toContainElement(menu);
  expect(menu).toHaveAttribute('popover', 'manual');
  await waitFor(() => expect(menu).toHaveStyle({ left: '136px', top: '26px' }));
  expect(menu).toHaveClass('prompt-bundle-options-menu');
  expect(showPopover).toHaveBeenCalledOnce();
  expect(order.indexOf('show')).toBeLessThan(order.indexOf('measure'));

  triggerTop = 28;
  fireEvent.scroll(dialog);
  await waitFor(() => expect(menu).toHaveStyle({ top: '20px' }));

  fireEvent.keyDown(menu, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  expect(document.activeElement).toBe(options);
  expect(hidePopover).toHaveBeenCalledOnce();

  fireEvent.click(options);
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  expect(showPopover).toHaveBeenCalledTimes(2);
  expect(hidePopover).toHaveBeenCalledTimes(2);
});
