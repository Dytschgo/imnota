import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { Modal } from '../components/ui';
import { useKeyboardShortcuts } from '../settings/useKeyboardShortcuts';
import { OnboardingDemo, PromptBundleDialogHost } from './lazy-surfaces';

// Each lazily loaded module waits for its gate, so a test controls exactly when its chunk resolves.
const gates = vi.hoisted(() => {
  const gate = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { opened, open };
  };
  return { promptBundles: gate(), onboarding: gate() };
});

vi.mock('../export/PromptBundleDialogHost', async () => {
  await gates.promptBundles.opened;
  return {
    PromptBundleDialogHost: ({ controller }: { controller: { isOpen: boolean; close(): void } }) =>
      controller.isOpen ? (
        <Modal title="Share bundles" onClose={() => controller.close()}>
          <button type="button" data-autofocus>
            Copy bundle 1
          </button>
        </Modal>
      ) : null,
  };
});

vi.mock('../onboarding/OnboardingDemo', async () => {
  await gates.onboarding.opened;
  return {
    OnboardingDemo: ({ onDismiss }: { onDismiss?: () => void }) => (
      <Modal title="Try the complete handoff" onClose={() => onDismiss?.()}>
        <button type="button" data-autofocus>
          Load sample
        </button>
      </Modal>
    ),
  };
});

afterEach(cleanup);

type HostController = ComponentProps<typeof PromptBundleDialogHost>['controller'];

/** A focused screenshot row with background shortcuts; Ctrl+F opens Share bundles. */
function Background() {
  const [open, setOpen] = useState(false);
  useKeyboardShortcuts({
    bindings: {},
    platform: 'windows',
    handlers: {
      'project.search': () => setOpen(true),
      'tool.text': backgroundShortcut,
      'item.delete': backgroundShortcut,
    },
  });
  const controller = { isOpen: open, close: () => setOpen(false) } as unknown as HostController;
  return (
    <>
      <button type="button" data-testid="screenshot-row" onKeyDown={rowKeyDown}>
        Screen
      </button>
      <PromptBundleDialogHost controller={controller} onError={() => undefined} />
    </>
  );
}
const backgroundShortcut = vi.fn();
const rowKeyDown = vi.fn();

function type(key: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
}

it('is modal from the first frame while its chunk loads, then focuses the loaded dialog', async () => {
  render(<Background />);
  const row = screen.getByTestId('screenshot-row');
  row.focus();

  type('f', { ctrlKey: true });
  rowKeyDown.mockClear(); // The opening keystroke itself was the row's.
  const shell = screen.getByRole('dialog', { name: 'Share bundles' });
  expect(shell).toHaveAttribute('aria-busy', 'true');
  expect(shell).toHaveTextContent('Loading…');
  expect(shell).toContainElement(document.activeElement as HTMLElement);

  // Typing and Delete go to the shell, not to the background tool shortcuts or the focused row.
  type('t');
  type('Delete');
  type('Delete', { ctrlKey: true });
  expect(backgroundShortcut).not.toHaveBeenCalled();
  expect(rowKeyDown).not.toHaveBeenCalled();

  type('Escape');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(row).toHaveFocus();

  // Reopened, the shell records the row as the opener; the loaded dialog then takes focus.
  type('f', { ctrlKey: true });
  rowKeyDown.mockClear();
  expect(screen.getByRole('dialog', { name: 'Share bundles' })).toHaveAttribute('aria-busy', 'true');
  await act(async () => gates.promptBundles.open());
  const loaded = await screen.findByRole('button', { name: 'Copy bundle 1' });
  expect(loaded).toHaveFocus();
  expect(screen.getByRole('dialog', { name: 'Share bundles' })).not.toHaveAttribute('aria-busy');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);

  type('Escape');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(row).toHaveFocus();
  expect(rowKeyDown).not.toHaveBeenCalled();
});

it('lets the loading guide be cancelled without recording it as seen', async () => {
  const onMarkCompleted = vi.fn(async () => undefined);
  const onDismiss = vi.fn();
  const props = { onMarkCompleted, onCreateFirstProject: async () => undefined, onDismiss };
  const opener = document.body.appendChild(document.createElement('button'));
  opener.focus();
  const view = render(<OnboardingDemo {...props} />);
  const shell = screen.getByRole('dialog', { name: 'Try the complete handoff' });
  expect(shell).toHaveAttribute('aria-busy', 'true');
  expect(shell).toContainElement(document.activeElement as HTMLElement);

  type('Escape');
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(onMarkCompleted).not.toHaveBeenCalled();
  view.unmount();
  expect(opener).toHaveFocus();

  render(<OnboardingDemo {...props} />);
  await act(async () => gates.onboarding.open());
  expect(await screen.findByRole('button', { name: 'Load sample' })).toHaveFocus();
  opener.remove();
});
