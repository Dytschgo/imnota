import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCE_SETTINGS } from '../../shared/preferences';
import { AppDialogs } from './AppDialogs';

afterEach(cleanup);

describe('new project templates', () => {
  it('selects an optional workflow template and lets the user return to blank', () => {
    let draft = { name: 'Checkout', description: '' };
    const change = vi.fn((next) => {
      draft = next;
    });
    const { rerender } = render(
      <AppDialogs
        dialog="new-project"
        newProject={draft}
        shortcuts={DEFAULT_PREFERENCE_SETTINGS.shortcuts}
        onNewProjectChange={change}
        onCreateProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onShortcutChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: /Blank project/i })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /Bug report/i }));
    expect(change).toHaveBeenLastCalledWith({ ...draft, templateId: 'bug-report' });
    rerender(
      <AppDialogs
        dialog="new-project"
        newProject={{ ...draft, templateId: 'bug-report' }}
        shortcuts={DEFAULT_PREFERENCE_SETTINGS.shortcuts}
        onNewProjectChange={change}
        onCreateProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onShortcutChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Blank project/i }));
    expect(change).toHaveBeenLastCalledWith({ ...draft, templateId: undefined });
  });

  it('cancels without submitting a project', () => {
    const create = vi.fn();
    const close = vi.fn();
    render(
      <AppDialogs
        dialog="new-project"
        newProject={{ name: 'Checkout', description: '', templateId: 'ui-review' }}
        shortcuts={DEFAULT_PREFERENCE_SETTINGS.shortcuts}
        onNewProjectChange={vi.fn()}
        onCreateProject={create}
        onDeleteProject={vi.fn()}
        onShortcutChange={vi.fn()}
        onClose={close}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });
});
