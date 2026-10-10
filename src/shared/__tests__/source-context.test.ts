// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  appFromWindowTitle,
  cleanSourceUrl,
  createScreenshotSource,
  screenshotSourceSchema,
  sourceMarkdownLines,
} from '../source-context';
import { validateProject } from '../schema';
import { emptyProject } from '../utils';

const now = new Date('2026-10-10T10:15:00.000Z');

describe('screenshot source info', () => {
  it('infers well-known apps from Windows title suffixes and keeps Windows paths in titles', () => {
    expect(appFromWindowTitle('Checkout – Shop - Google Chrome')).toBe('Google Chrome');
    expect(appFromWindowTitle('Issues · repo - Personal - Microsoft Edge')).toBe('Microsoft Edge');
    expect(appFromWindowTitle('C:\\Users\\Dylan\\shop\\src\\App.tsx - shop - Visual Studio Code')).toBe(
      'Visual Studio Code',
    );
    expect(appFromWindowTitle('Untitled')).toBeUndefined();
    expect(
      createScreenshotSource({
        via: 'capture',
        now,
        windowTitle: '  C:\\Users\\Dylan\\shop\\App.tsx - Visual Studio Code\u0007 ',
        display: 'Display 2 of 2',
      }),
    ).toEqual({
      via: 'capture',
      capturedAt: '2026-10-10T10:15:00.000Z',
      app: 'Visual Studio Code',
      windowTitle: 'C:\\Users\\Dylan\\shop\\App.tsx - Visual Studio Code',
      display: 'Display 2 of 2',
    });
    // A reported owner app (macOS) wins over the title heuristic; imports record only the time.
    expect(createScreenshotSource({ via: 'capture', now, app: 'Safari', windowTitle: 'Docs' }).app).toBe(
      'Safari',
    );
    expect(createScreenshotSource({ via: 'import', now })).toEqual({
      via: 'import',
      capturedAt: '2026-10-10T10:15:00.000Z',
    });
  });

  it('keeps only http(s) URLs', () => {
    expect(cleanSourceUrl('https://example.com/a b')).toBe('https://example.com/a%20b');
    expect(cleanSourceUrl('javascript:alert(1)')).toBeUndefined();
    expect(cleanSourceUrl('file:///C:/Users/x.txt')).toBeUndefined();
    expect(cleanSourceUrl('not a url')).toBeUndefined();
  });

  it('writes escaped Markdown lines and nothing for a missing source', () => {
    expect(sourceMarkdownLines(undefined)).toEqual([]);
    const lines = sourceMarkdownLines({
      via: 'capture',
      capturedAt: now.toISOString(),
      app: 'Google Chrome',
      windowTitle: '[Click](javascript:x) *Sale* - C:\\Temp\\a_b',
      url: 'https://shop.example/checkout?step=2',
      display: 'Display 1 of 2',
    });
    expect(lines.slice(0, 5)).toEqual([
      'Source:',
      '- App: Google Chrome',
      '- Window: \\[Click\\](javascript:x) \\*Sale\\* - C:\\\\Temp\\\\a\\_b',
      '- URL: <https://shop.example/checkout?step=2>',
      '- Display: Display 1 of 2',
    ]);
    expect(lines[5]).toMatch(/^- Captured: 2026-10-1\d \d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/);
    // Edited values are cleaned again on export.
    expect(
      sourceMarkdownLines({ via: 'import', capturedAt: now.toISOString(), url: 'javascript:alert(1)' }),
    ).toHaveLength(2);
  });

  it('drops damaged source records on read instead of rejecting the project', () => {
    expect(
      screenshotSourceSchema.parse({
        via: 'capture',
        capturedAt: now.toISOString(),
        windowTitle: 'x'.repeat(301),
        url: 'javascript:alert(1)',
        app: 'Notepad',
      }),
    ).toEqual({ via: 'capture', capturedAt: now.toISOString(), app: 'Notepad' });
    const project = emptyProject('Source', '');
    const shot = {
      collectionId: project.collections[0]!.id,
      id: 'shot-1',
      originalFilename: 'a.png',
      storedFilename: 'a.png',
      title: 'a',
      description: '',
      position: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      priority: 'medium' as const,
      annotationFile: `collections/${project.collections[0]!.id}/annotations/a.png.json`,
      descriptionFile: `collections/${project.collections[0]!.id}/descriptions/a.png.md`,
      originalWidth: 1,
      originalHeight: 1,
      includeInExport: true,
    };
    const valid = validateProject({
      ...project,
      screenshots: [{ ...shot, source: { via: 'import', capturedAt: now.toISOString() } }],
    });
    expect(valid.screenshots[0]!.source).toEqual({ via: 'import', capturedAt: now.toISOString() });
    const damaged = validateProject({ ...project, screenshots: [{ ...shot, source: { via: 'teleport' } }] });
    expect(damaged.screenshots[0]!.source).toBeUndefined();
    expect(JSON.parse(JSON.stringify(damaged)).screenshots[0]).not.toHaveProperty('source');
  });
});
