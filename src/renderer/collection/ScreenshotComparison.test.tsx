import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyProject } from '../../shared/utils';
import type { ProjectData, ScreenshotRecord } from '../../shared/types';
import { useAppStore } from '../store';
import { ScreenshotComparison } from './ScreenshotComparison';
import { renderAnnotatedImageWithDimensions } from '../export-image';

vi.mock('../export-image', () => ({ renderAnnotatedImageWithDimensions: vi.fn() }));
const renderImage = vi.mocked(renderAnnotatedImageWithDimensions);
let project: ProjectData;
function shot(id: string, position: number): ScreenshotRecord {
  const collectionId = project.collections[0].id;
  return {
    id,
    position,
    collectionId,
    originalFilename: `${id}.png`,
    storedFilename: `${id}.png`,
    title: id,
    description: `${id} context`,
    createdAt: '',
    updatedAt: '',
    priority: 'medium',
    annotationFile: `collections/${collectionId}/annotations/${id}.png.json`,
    descriptionFile: `collections/${collectionId}/descriptions/${id}.png.md`,
    originalWidth: 200,
    originalHeight: 100,
    includeInExport: true,
  };
}
function publish(next = project) {
  useAppStore.setState({
    snapshot: { projectPath: '/fixture', project: next, recoveryFound: false, thumbnails: {} },
    activeCollectionId: next.collections[0].id,
    activeScreenshotId: next.screenshots[0]?.id ?? null,
  });
}
beforeEach(() => {
  project = emptyProject('Comparison', '');
  project.screenshots = [shot('one', 0), shot('two', 1)];
  publish();
  window.imnota = {
    loadScreenshotContent: vi.fn(async ({ screenshot }: { screenshot: ScreenshotRecord }) => ({
      image: {
        filename: screenshot.originalFilename,
        dataUrl: `data:image/png;base64,${screenshot.id}`,
        width: 200,
        height: 100,
      },
      annotations: [{ id: 'mask', kind: 'blur', x: 0, y: 0, width: 10, height: 10, zIndex: 0 }],
      description: screenshot.description,
      contentRevision: screenshot.id,
    })),
  } as never;
  renderImage.mockImplementation(async (image) => ({
    dataUrl: image.dataUrl,
    width: image.width,
    height: image.height,
    bounds: { x: 0, y: 0, width: image.width, height: image.height },
    sourceBounds: { x: 0, y: 0, width: image.width, height: image.height },
  }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAppStore.setState({ snapshot: null });
});

async function open(
  onSaveProject = vi.fn(async (next: ProjectData) => {
    act(() => publish(next));
    return true;
  }),
  onFlush = vi.fn(async () => true),
) {
  render(
    <StrictMode>
      <ScreenshotComparison onFlush={onFlush} onSaveProject={onSaveProject} />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  await screen.findByRole('dialog', { name: 'Compare screenshots' });
  return { onSaveProject, onFlush };
}

it('saves both modes without changing images, descriptions or order, then reopens the saved pair', async () => {
  const { onSaveProject } = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Save comparison' }));
  await screen.findByText('Comparison saved. Roles will be included in prompt bundles.');
  expect(onSaveProject.mock.calls[0][0].collections[0].comparison).toEqual({
    kind: 'current-expected',
    leftId: 'one',
    rightId: 'two',
  });
  expect(onSaveProject.mock.calls[0][0].screenshots).toEqual(project.screenshots);
  fireEvent.change(screen.getByLabelText('Comparison'), { target: { value: 'before-after' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save comparison' }));
  await waitFor(() => expect(onSaveProject).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  expect(await screen.findByLabelText('Comparison')).toHaveValue('before-after');
  expect(screen.getByLabelText('After screenshot')).toHaveValue('two');
});

it('blocks identical screenshots and keeps selections after a save failure for retry', async () => {
  const onSaveProject = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  await open(onSaveProject);
  fireEvent.change(screen.getByLabelText('Expected screenshot'), { target: { value: 'one' } });
  expect(screen.getByRole('button', { name: 'Save comparison' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Expected screenshot'), { target: { value: 'two' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save comparison' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('kept');
  expect(screen.getByLabelText('Expected screenshot')).toHaveValue('two');
  fireEvent.click(screen.getByRole('button', { name: 'Save comparison' }));
  await screen.findByText('Comparison saved. Roles will be included in prompt bundles.');
  expect(onSaveProject).toHaveBeenCalledTimes(2);
});

it('renders through the annotation/redaction path, links zoom and scrolling, and preserves role labels', async () => {
  await open();
  await screen.findByAltText('Expected annotated screenshot');
  expect(renderImage).toHaveBeenCalledWith(
    expect.anything(),
    expect.arrayContaining([expect.objectContaining({ kind: 'blur' })]),
  );
  fireEvent.change(screen.getByRole('slider', { name: 'Current zoom' }), { target: { value: '200' } });
  expect(screen.getByRole('slider', { name: 'Expected zoom' })).toHaveValue('200');
  const panes = screen.getAllByRole('region');
  panes.forEach((pane) =>
    Object.defineProperties(pane, {
      scrollWidth: { value: 1000 },
      clientWidth: { value: 200 },
      scrollHeight: { value: 500 },
      clientHeight: { value: 100 },
    }),
  );
  panes[0].scrollLeft = 200;
  panes[0].scrollTop = 100;
  fireEvent.scroll(panes[0]);
  expect(panes[1].scrollLeft).toBe(200);
  expect(panes[1].scrollTop).toBe(100);
});

it('reports mismatched dimensions without linking views or stretching images', async () => {
  renderImage
    .mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,one',
      width: 200,
      height: 100,
      bounds: { x: 0, y: 0, width: 200, height: 100 },
      sourceBounds: { x: 0, y: 0, width: 200, height: 100 },
    })
    .mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,two',
      width: 300,
      height: 100,
      bounds: { x: 0, y: 0, width: 300, height: 100 },
      sourceBounds: { x: 0, y: 0, width: 300, height: 100 },
    });
  await open();
  await screen.findByText(/Rendered dimensions differ/);
  expect(screen.getByRole('checkbox', { name: 'Link zoom and scrolling' })).toBeDisabled();
  fireEvent.change(screen.getByRole('slider', { name: 'Current zoom' }), { target: { value: '200' } });
  expect(screen.getByRole('slider', { name: 'Expected zoom' })).toHaveValue('100');
});

it('keeps incomplete pair metadata recoverable and removes only the relationship', async () => {
  project.collections[0].comparison = { kind: 'before-after', leftId: 'one', rightId: 'missing' };
  project.screenshots[0].includeInExport = false;
  publish();
  const { onSaveProject } = await open();
  expect(screen.getByLabelText('After screenshot')).toHaveValue('missing');
  expect(screen.getByRole('button', { name: 'Save comparison' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove comparison' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const next = onSaveProject.mock.calls[0][0];
  expect(next.collections[0].comparison).toBeUndefined();
  expect(next.screenshots).toEqual(project.screenshots);
});

it('shows excluded-image and read-failure states and allows a bounded explicit retry', async () => {
  project.screenshots[1].includeInExport = false;
  publish();
  const load = vi.mocked(window.imnota.loadScreenshotContent);
  // StrictMode starts and abandons the first effect before running the live effect.
  load
    .mockRejectedValueOnce(new Error('Image read failed'))
    .mockRejectedValueOnce(new Error('Image read failed'));
  await open();
  expect(await screen.findByText(/Comparison incomplete for export/)).toBeVisible();
  await screen.findByText('Image read failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry images' }));
  await screen.findByAltText('Expected annotated screenshot');
});

it('does not open comparison after a failed flush', async () => {
  render(<ScreenshotComparison onFlush={async () => false} onSaveProject={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save the current edits');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
