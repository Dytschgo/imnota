import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CaptureDestinationDialog } from './CaptureDestinationDialog';

afterEach(cleanup);

const choices = [
  {
    projectPath: '/workspace/project',
    collectionId: '001-collection',
    projectName: 'Project',
    collectionName: 'Workspace',
  },
  {
    projectPath: '/workspace/other',
    collectionId: '002-collection',
    projectName: 'Other',
    collectionName: 'Review',
  },
];

it('selects a current collection as the capture destination', () => {
  const select = vi.fn();
  render(<CaptureDestinationDialog choices={choices} onSelect={select} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save to Review in Other' }));
  expect(select).toHaveBeenCalledExactlyOnceWith(choices[1]);
});

it('cancels without choosing a destination', () => {
  const cancel = vi.fn();
  const select = vi.fn();
  render(<CaptureDestinationDialog choices={choices} onSelect={select} onCancel={cancel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
});
