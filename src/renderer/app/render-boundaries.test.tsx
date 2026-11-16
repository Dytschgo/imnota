import { writeFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { memo, Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCE_SETTINGS } from '../../shared/preferences';
import type { Annotation, ImnotaBridge, ProjectSnapshot, ScreenshotRecord } from '../../shared/types';
import type { AnnotationCanvasProps } from '../components/AnnotationCanvas';
import { useAppStore } from '../store';
import App from '../App';

const counts = vi.hoisted(() => ({ canvas: 0, inspector: 0, rows: 0 }));
const canvasProps = vi.hoisted(() => ({ current: null as AnnotationCanvasProps | null }));
/** Counts each render of `component` and keeps its memo comparison, so skipped renders stay skipped. */
const counted = vi.hoisted(() => <P extends object>(component: unknown, key: 'inspector' | 'rows') => {
  const memoized = component as { type?: (props: P) => ReactNode; compare?: (a: P, b: P) => boolean };
  const render = memoized.type ?? (component as (props: P) => ReactNode);
  const Counted = (props: P) => {
    counts[key] += 1;
    return render(props);
  };
  return memoized.type ? memo(Counted, memoized.compare) : Counted;
});

// The canvas needs a real 2D context; count its renders and keep its latest props instead.
vi.mock('../components/AnnotationCanvas', () => ({
  AnnotationCanvas: (props: AnnotationCanvasProps) => {
    counts.canvas += 1;
    canvasProps.current = props;
    return null;
  },
}));
vi.mock('../inspector/ScreenshotInspector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../inspector/ScreenshotInspector')>();
  return { ...actual, ScreenshotInspector: counted(actual.ScreenshotInspector, 'inspector') };
});
vi.mock('../collection/CollectionRailRow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../collection/CollectionRailRow')>();
  return { ...actual, CollectionRailRow: counted(actual.CollectionRailRow, 'rows') };
});

const SHOT_COUNT = 100;
const SAMPLES = 20;
const createdAt = '2026-01-01T00:00:00.000Z';

function screenshot(index: number): ScreenshotRecord {
  const id = `shot-${String(index).padStart(3, '0')}`;
  return {
    id,
    collectionId: '001-collection',
    originalFilename: `${id}.png`,
    storedFilename: `${id}.png`,
    title: `Screen ${index + 1}`,
    description: `Note ${index + 1}`,
    position: index,
    createdAt,
    updatedAt: createdAt,
    priority: 'medium',
    annotationFile: `collections/001-collection/annotations/${id}.png.json`,
    descriptionFile: `collections/001-collection/descriptions/${id}.png.md`,
    originalWidth: 100,
    originalHeight: 100,
    includeInExport: true,
  };
}

const screenshots = Array.from({ length: SHOT_COUNT }, (_, index) => screenshot(index));
const largeSnapshot: ProjectSnapshot = {
  projectPath: '/workspace/large',
  thumbnails: Object.fromEntries(screenshots.map((shot) => [shot.id, `data:image/png;base64,${shot.id}`])),
  recoveryFound: false,
  project: {
    schemaVersion: 3,
    id: 'large-project',
    name: 'Large project',
    description: '',
    createdAt,
    updatedAt: createdAt,
    status: 'active',
    favourite: false,
    collections: [
      {
        id: '001-collection',
        name: 'Collection 01',
        archived: false,
        createdAt,
        updatedAt: createdAt,
        overallContext: '',
      },
    ],
    screenshots,
    exportPreferences: {
      includeOriginalScreenshots: true,
      includeAnnotationMetadata: true,
      template: 'default',
    },
  },
};

function installBridge() {
  localStorage.setItem(
    'imnota:last-session',
    JSON.stringify({
      workspacePath: '/workspace',
      view: 'projects',
      projectPath: null,
      collectionId: '001-collection',
      itemId: null,
      search: '',
      savedAt: new Date().toISOString(),
    }),
  );
  const preferenceResult = {
    ok: true,
    value: {
      settings: DEFAULT_PREFERENCE_SETTINGS,
      profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
    },
  };
  window.imnota = {
    getSettings: async () => ({ ...useAppStore.getState().settings, workspacePath: '/workspace' }),
    listProjects: async () => [],
    onUpdateStatus: () => () => {},
    getUpdateStatus: async () => ({ state: 'idle' as const }),
    getPreferenceSettings: async () => preferenceResult,
    setPreferenceSettings: async () => preferenceResult,
    getNativePerformanceProfile: async () => ({
      ok: true,
      value: {
        platform: 'windows',
        performanceClass: 'standard',
        reducedEffectsRecommended: false,
        reasons: [],
      },
    }),
    getNativeCapabilities: async () => ({
      ok: true,
      value: { fileClipboard: true, globalCaptureShortcutRegistered: true },
    }),
    onRegionCaptureHotkey: () => () => {},
    onCaptureTray: () => () => {},
    captureRendererReady: async () => ({ ok: true as const, value: undefined }),
    startProjectWatch: async ({ projectPath }: { projectPath: string }) => ({
      ok: true,
      value: { watchId: 'watch', projectPath, projectRevision: 'project-1' },
    }),
    stopProjectWatch: async () => ({ ok: true, value: undefined }),
    onProjectWatchEvent: () => () => {},
    loadScreenshotContent: async () => ({
      image: { filename: 'shot-000.png', dataUrl: '', width: 100, height: 100 },
      annotations: [],
      description: 'Note 1',
      contentRevision: 'a'.repeat(64),
    }),
    // Saves never settle here, so the measured commits are the edits alone.
    saveScreenshotContent: () => new Promise(() => {}),
  } as unknown as ImnotaBridge;
  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

interface Measurement {
  commits: number;
  canvas: number;
  inspector: number;
  rows: number;
  durationMs: number;
}

/** Render counts per action are deterministic, so report the largest; report the median duration. */
function summarize(samples: Measurement[]) {
  const max = (key: Exclude<keyof Measurement, 'durationMs'>) =>
    Math.max(...samples.map((sample) => sample[key]));
  const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
  return {
    commits: max('commits'),
    canvas: max('canvas'),
    inspector: max('inspector'),
    rows: max('rows'),
    medianDurationMs: durations[Math.floor(durations.length / 2)],
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  useAppStore.setState({ snapshot: null, activeScreenshotId: null, view: 'projects', rightPanelOpen: true });
});

describe('render boundaries in a 100-screenshot collection', () => {
  it('limits renders per description keystroke and per annotation commit', async () => {
    installBridge();
    let commits = 0;
    let durationMs = 0;
    const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
      commits += 1;
      durationMs += actualDuration;
    };
    render(
      <Profiler id="app" onRender={onRender}>
        <App />
      </Profiler>,
    );
    await screen.findByTestId('library-full-search');
    act(() => useAppStore.getState().setProject(largeSnapshot, 'shot-000'));
    const note = await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => expect(canvasProps.current?.image).not.toBeNull());
    vi.useFakeTimers();

    const measure = (run: () => void): Measurement => {
      const before = { ...counts, commits, durationMs };
      act(run);
      return {
        commits: commits - before.commits,
        canvas: counts.canvas - before.canvas,
        inspector: counts.inspector - before.inspector,
        rows: counts.rows - before.rows,
        durationMs: Number((durationMs - before.durationMs).toFixed(2)),
      };
    };

    const keystrokes = Array.from({ length: SAMPLES }, (_, index) =>
      measure(() => {
        fireEvent.change(note, { target: { value: `Note 1${'!'.repeat(index + 1)}` } });
      }),
    );
    const annotation: Annotation = {
      id: 'a1',
      kind: 'rectangle',
      x: 1,
      y: 1,
      width: 10,
      height: 10,
      zIndex: 0,
    };
    const annotationCommits = Array.from({ length: SAMPLES }, (_, index) =>
      measure(() => {
        canvasProps.current!.onChange([{ ...annotation, x: index + 2 }]);
      }),
    );
    const summary = { keystroke: summarize(keystrokes), annotationCommit: summarize(annotationCommits) };
    if (process.env.RENDER_PROFILE_OUT)
      writeFileSync(process.env.RENDER_PROFILE_OUT, JSON.stringify(summary, null, 2));

    expect(note).toHaveValue(`Note 1${'!'.repeat(SAMPLES)}`);
    // A keystroke re-renders the inspector that shows it and the one rail row whose item changed.
    expect(summary.keystroke).toMatchObject({ canvas: 0, inspector: 1, rows: 1 });
    // An annotation commit with nothing selected re-renders only the canvas.
    expect(summary.annotationCommit).toMatchObject({ canvas: 1, inspector: 0, rows: 0 });
  });
});
