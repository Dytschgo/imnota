import { expect, it, vi } from 'vitest';
import { emptyProject } from '../shared/utils';
import type { Annotation, ScreenshotRecord } from '../shared/types';
import { prepareContext } from './prepare-context';

function shot(id: string, position: number, includeInExport = true): ScreenshotRecord {
  return {
    id,
    collectionId: '001-collection',
    title: id,
    originalFilename: `${id}.png`,
    storedFilename: `${id}.png`,
    description: `${id} description`,
    position,
    createdAt: `${position}`,
    updatedAt: '',
    priority: 'low',
    annotationFile: `collections/001-collection/annotations/${id}.png.json`,
    descriptionFile: `collections/001-collection/descriptions/${id}.png.md`,
    originalWidth: 10,
    originalHeight: 10,
    includeInExport,
  };
}

it('captures active edits, preserves pre-filter numbering, and reads each other included screenshot once', async () => {
  const project = emptyProject('Original brief', '');
  project.screenshots = [shot('one', 0), shot('excluded', 1, false), shot('three', 2)];
  const active = {
    id: 'one',
    content: {
      image: { dataUrl: 'active-pixels', width: 10, height: 10, filename: 'one.png' },
      annotations: [{ id: 'a', kind: 'text', text: 'Original mark', x: 0, y: 0, zIndex: 0 }] as Annotation[],
      description: 'one description',
      contentRevision: 'active-revision',
    },
  };
  let finish!: (value: string) => void;
  const render = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue('third-png');
  const load = vi.fn().mockResolvedValue({
    image: { dataUrl: 'disk', width: 10, height: 10, filename: 'three.png' },
    annotations: [],
    description: 'three description',
    contentRevision: 'disk-revision',
  });
  const pending = prepareContext(
    { project, projectPath: '/fixture', collectionId: '001-collection', active },
    load,
    render,
    () => undefined,
  );
  project.name = 'Changed while rendering';
  project.screenshots.reverse();
  active.content.annotations[0].text = 'Changed mark';
  finish('first-png');
  const result = await pending;
  expect(result.markdown).toContain('Original mark');
  expect(result.markdown).not.toContain('Changed mark');
  expect(result.markdown).toContain('Picture 2 was intentionally excluded');
  expect(result.images.map((item) => item.filename)).toEqual([
    '01-one-annotated.png',
    '03-three-annotated.png',
  ]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(render.mock.calls[0][1][0].text).toBe('Original mark');
});
