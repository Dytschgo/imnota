import { expect, it, vi } from 'vitest';
import { EMPTY_NOTES, emptyProject } from '../shared/utils';
import type { Annotation, ScreenshotRecord } from '../shared/types';
import { prepareContext } from './prepare-context';

function shot(id: string, roundId = '001-first-feedback'): ScreenshotRecord {
  return {
    id,
    roundId,
    title: id,
    originalFilename: `${id}.png`,
    storedFilename: `${id}.png`,
    description: '',
    position: 0,
    createdAt: '',
    updatedAt: '',
    tags: [],
    priority: 'low',
    status: 'draft',
    annotationFile: '',
    notesFile: '',
    originalWidth: 10,
    originalHeight: 10,
    includeInExport: true,
  };
}

it('captures selection and active edits before asynchronous rendering and reads each other reference once', async () => {
  const project = emptyProject('Original brief', '');
  project.screenshots = [shot('one'), shot('two'), shot('excluded'), shot('other', 'other-folder')];
  project.screenshots[2].includeInExport = false;
  const active = {
    id: 'one',
    content: {
      image: { dataUrl: 'active-pixels', width: 10, height: 10, filename: 'one.png' },
      notes: { ...EMPTY_NOTES, problem: 'Original problem' },
      annotations: [{ id: 'a', kind: 'text', text: 'Original mark', x: 0, y: 0, zIndex: 0 }] as Annotation[],
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
    .mockResolvedValue('second-png');
  const load = vi.fn().mockResolvedValue({
    image: { dataUrl: 'disk', width: 10, height: 10 },
    notes: { ...EMPTY_NOTES, problem: 'Disk problem' },
    annotations: [],
  });
  const pending = prepareContext(
    { project, projectPath: '/fixture', roundId: '001-first-feedback', active },
    load,
    render,
    () => undefined,
  );
  project.name = 'Changed while rendering';
  project.screenshots.reverse();
  project.screenshots.forEach((item) => {
    item.includeInExport = false;
  });
  active.content.notes.problem = 'Changed problem';
  active.content.annotations[0].text = 'Changed mark';
  finish('first-png');
  const result = await pending;
  expect(result.markdown).toContain('# Original brief');
  expect(result.markdown).toContain('Original problem');
  expect(result.markdown).toContain('Original mark');
  expect(result.markdown).toContain('Disk problem');
  expect(result.markdown).not.toContain('Changed');
  expect(result.images.map((item) => item.filename)).toEqual(['one-annotated.png', 'two-annotated.png']);
  expect(load).toHaveBeenCalledTimes(1);
  expect(render.mock.calls[0][1][0].text).toBe('Original mark');
});
