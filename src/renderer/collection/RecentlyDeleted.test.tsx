import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecentlyDeletedItem } from '../../shared/recently-deleted';
import type { Collection, ImnotaBridge } from '../../shared/types';
import { RecentlyDeleted } from './RecentlyDeleted';

const collections: Collection[] = [
  {
    id: 'collection-a',
    name: 'Checkout',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    overallContext: '',
  },
];

const shot: RecentlyDeletedItem = {
  kind: 'screenshot',
  undoToken: 'delete-1',
  itemId: 'shot-1',
  title: 'Payment form',
  collectionId: 'collection-a',
  deletedAt: '2026-01-05T10:00:00.000Z',
};
const text: RecentlyDeletedItem = {
  kind: 'text',
  undoToken: 'content-delete-1',
  itemId: 'text-1',
  title: 'Context note',
  collectionId: 'collection-a',
  deletedAt: '2026-01-04T10:00:00.000Z',
};

function bridge(...responses: RecentlyDeletedItem[][]) {
  const listRecentlyDeleted = vi.fn(async () => responses[0] ?? []);
  for (const response of responses) listRecentlyDeleted.mockResolvedValueOnce(response);
  window.imnota = { listRecentlyDeleted } as unknown as ImnotaBridge;
  return listRecentlyDeleted;
}

function open(onRestore: (item: RecentlyDeletedItem) => Promise<string | null>) {
  render(
    <RecentlyDeleted projectPath="/workspace/project" collections={collections} onRestore={onRestore} />,
  );
  const trigger = screen.getByRole('button', { name: 'Recently deleted' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

afterEach(cleanup);

describe('RecentlyDeleted', () => {
  it('lists deleted items with their type, collection, deletion time and the retention', async () => {
    const list = bridge([shot, text]);
    open(vi.fn());

    const dialog = await screen.findByRole('dialog', { name: 'Recently deleted' });
    expect(dialog).toHaveAccessibleDescription(/kept for 30 days/);
    expect(list).toHaveBeenCalledWith('/workspace/project');
    const rows = within(await within(dialog).findByRole('list', { name: 'Deleted items' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Payment form');
    expect(rows[0]).toHaveTextContent('Screenshot · Checkout · Deleted');
    expect(rows[0].querySelector('time')).toHaveAttribute('dateTime', shot.deletedAt);
    expect(rows[1]).toHaveTextContent('Text block · Checkout · Deleted');
    expect(within(dialog).getByRole('button', { name: 'Restore screenshot: Payment form' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Restore text block: Context note' })).toBeEnabled();
  });

  it('restores through the supplied Undo handler, refreshes the list and announces the result', async () => {
    bridge([shot, text], [text]);
    const onRestore = vi.fn(async () => null);
    open(onRestore);

    fireEvent.click(await screen.findByRole('button', { name: 'Restore screenshot: Payment form' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Restored “Payment form”.'));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(shot);
    expect(screen.queryByRole('button', { name: 'Restore screenshot: Payment form' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore text block: Context note' })).toBeEnabled();
    // The restored row is gone, so focus moves to the announcement instead of being lost.
    expect(screen.getByRole('status')).toHaveFocus();
  });

  it('keeps the item and shows why when Undo reports a conflict', async () => {
    bridge([shot], [shot]);
    open(vi.fn(async () => 'The screenshot collection no longer exists.'));

    const restore = await screen.findByRole('button', { name: 'Restore screenshot: Payment form' });
    fireEvent.click(restore);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Restore could not be completed for “Payment form”. The screenshot collection no longer exists.',
    );
    const retry = screen.getByRole('button', { name: 'Restore screenshot: Payment form' });
    expect(retry).toBeEnabled();
    expect(retry).toHaveFocus();
  });

  it('blocks a second restore while one is running', async () => {
    bridge([shot, text], [text]);
    let finish: (value: string | null) => void = () => undefined;
    const onRestore = vi.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
    open(onRestore);

    fireEvent.click(await screen.findByRole('button', { name: 'Restore screenshot: Payment form' }));
    const other = screen.getByRole('button', { name: 'Restore text block: Context note' });
    expect(other).toBeDisabled();
    fireEvent.click(other);
    expect(onRestore).toHaveBeenCalledTimes(1);

    finish(null);
    await waitFor(() => expect(other).toBeEnabled());
  });

  it('explains an empty list and a list that could not be read', async () => {
    bridge([]);
    open(vi.fn());
    expect(await screen.findByText(/Nothing deleted from this project in the last 30 days/)).toBeVisible();
    cleanup();

    window.imnota = {
      listRecentlyDeleted: vi.fn(async () => {
        throw new Error('The project directory is unavailable.');
      }),
    } as unknown as ImnotaBridge;
    open(vi.fn());
    expect(await screen.findByRole('alert')).toHaveTextContent('The project directory is unavailable.');
  });

  it('closes on Escape and returns focus to the rail button', async () => {
    bridge([shot]);
    const trigger = open(vi.fn());
    const dialog = await screen.findByRole('dialog', { name: 'Recently deleted' });
    await within(dialog).findByRole('list');

    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
