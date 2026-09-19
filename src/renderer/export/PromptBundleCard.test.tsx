import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
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
      fileClipboardAvailable
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
  fireEvent.click(screen.getByRole('button', { name: 'Rich copy' }));
  expect(onCopyFresh).toHaveBeenCalledWith({
    planId: 'plan-current',
    artifactSessionId: 'session-current',
    bundleNumber: 2,
  });
  expect(screen.getByRole('heading', { name: 'Bundle 2' })).toBeInTheDocument();
  expect(screen.getByText('Pictures 3, 4')).toBeInTheDocument();
  expect(screen.getByText('2.0 MB estimated')).toBeInTheDocument();
});

it('uses the saved Windows function for the primary action and keeps every variant in its dropdown', () => {
  const onCopyVariant = vi.fn();
  const onSelectCopyVariant = vi.fn();
  render(
    <PromptBundleCard
      bundle={model()}
      fileClipboardAvailable
      defaultCopyVariant="files"
      onCopyFresh={vi.fn()}
      onCopyVariant={onCopyVariant}
      onSelectCopyVariant={onSelectCopyVariant}
      onPrepareFreshFiles={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy files' }));
  expect(onCopyVariant).toHaveBeenCalledWith(
    { planId: 'plan-current', artifactSessionId: 'session-current', bundleNumber: 2 },
    'files',
  );

  fireEvent.click(screen.getByRole('button', { name: 'Copy options' }));
  expect(screen.getByText('Default copy format')).toBeVisible();
  expect(screen.getByText('Changes the main button')).toBeVisible();
  expect(screen.getByRole('separator')).toBeVisible();
  const enabledItems = screen.getAllByRole('menuitem').filter((item) => !item.hasAttribute('disabled'));
  expect(enabledItems[0]).toHaveFocus();
  fireEvent.keyDown(enabledItems[0]!, { key: 'ArrowDown' });
  expect(enabledItems[1]).toHaveFocus();
  fireEvent.keyDown(enabledItems[1]!, { key: 'End' });
  expect(enabledItems.at(-1)).toHaveFocus();
  fireEvent.keyDown(enabledItems.at(-1)!, { key: 'Home' });
  expect(enabledItems[0]).toHaveFocus();
  fireEvent.keyDown(enabledItems[0]!, { key: 'ArrowUp' });
  expect(enabledItems.at(-1)).toHaveFocus();
  expect(screen.getByRole('menu')).toHaveTextContent(
    'Copy filesMD + PNG filesFiles + rich copyFiles, text + imageRich copyText + image',
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Files + rich copy' }));
  expect(onSelectCopyVariant).toHaveBeenCalledWith(
    { planId: 'plan-current', artifactSessionId: 'session-current', bundleNumber: 2 },
    'files-rich',
  );
  expect(onCopyVariant).toHaveBeenCalledTimes(1);
});

it('keeps rich copy available without showing unsupported file clipboard variants', () => {
  render(<PromptBundleCard bundle={model()} onCopyFresh={vi.fn()} onPrepareFreshFiles={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Rich copy' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Copy options' }));
  expect(screen.queryByRole('menuitem', { name: 'Copy files' })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Files + rich copy' })).not.toBeInTheDocument();
});

it('uses rich copy for a text-only bundle without changing the saved Windows default', () => {
  const onCopyFresh = vi.fn();
  render(
    <PromptBundleCard
      bundle={model({ pictureNumbers: [], screenshotCount: 0, textCount: 1 })}
      fileClipboardAvailable
      defaultCopyVariant="files"
      onCopyFresh={onCopyFresh}
      onCopyVariant={vi.fn()}
      onSelectCopyVariant={vi.fn()}
      onPrepareFreshFiles={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Rich copy' }));
  expect(onCopyFresh).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Copy options' }));
  expect(screen.queryByText('Default copy format')).not.toBeInTheDocument();
});

it('offers independent fallbacks before artifacts exist and an honest primary action for oversized prompts', () => {
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
  expect(screen.getByRole('button', { name: /markdown/i })).toBeEnabled();
  expect(screen.getByRole('button', { name: /image/i })).toBeEnabled();
  expect(screen.getByRole('button', { name: /^open files$/i })).toBeEnabled();
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
  const copyMarkdown = screen.getByRole('menuitem', { name: 'Copy Markdown' });
  copyMarkdown.focus();
  fireEvent.click(copyMarkdown);
  expect(onCopyMarkdown).toHaveBeenCalledWith({
    planId: 'plan-current',
    artifactSessionId: 'session-current',
    bundleNumber: 2,
  });
  expect(menu).not.toBeInTheDocument();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /options/i }));

  fireEvent.click(screen.getByRole('button', { name: /options/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy PNG' }));
  expect(onCopyImage).toHaveBeenCalledWith({
    planId: 'plan-current',
    artifactSessionId: 'session-current',
    bundleNumber: 2,
  });
});

function BusyTransitionCard() {
  const [state, setState] = useState<PromptBundleCardModel['state']>('idle');
  return (
    <section role="dialog" tabIndex={-1}>
      <button type="button">Dialog fallback</button>
      <PromptBundleCard
        bundle={model({ state })}
        onCopyFresh={vi.fn()}
        onPrepareFreshFiles={vi.fn()}
        onCopyMarkdown={() => setState('copying')}
      />
    </section>
  );
}

it('keeps focus inside the dialog when an option makes its trigger busy', () => {
  render(<BusyTransitionCard />);

  fireEvent.click(screen.getByRole('button', { name: /options/i }));
  const copyMarkdown = screen.getByRole('menuitem', { name: 'Copy Markdown' });
  copyMarkdown.focus();
  fireEvent.click(copyMarkdown);

  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /options/i })).toBeDisabled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dialog fallback' }));
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

  const button = screen.getByRole('button', { name: 'Rich copy' });
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

it('identifies prepared formats and exposes generated filenames and path copying', () => {
  const copyPaths = vi.fn();
  render(
    <PromptBundleCard
      bundle={model({ outcome: 'combined', filenames: ['Prompt-2.md', 'Prompt-2.png'] })}
      onCopyFresh={vi.fn()}
      onPrepareFreshFiles={vi.fn()}
      onCopyPaths={copyPaths}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Markdown + image prepared');
  expect(screen.getByText('Prompt-2.png')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /options/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Copy file paths' }));
  expect(copyPaths).toHaveBeenCalledWith(
    expect.objectContaining({ artifactSessionId: 'session-current', bundleNumber: 2 }),
  );
});
