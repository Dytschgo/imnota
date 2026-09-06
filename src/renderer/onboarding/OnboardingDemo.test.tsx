import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../../shared/types';
import { OnboardingDemo } from './OnboardingDemo';

vi.mock('../components/AnnotationCanvas', () => ({ AnnotationCanvas: () => <div>Interactive canvas</div> }));
vi.mock('../export-image', () => ({
  renderAnnotatedImage: vi.fn(async () => 'data:image/png;base64,annotated'),
}));
vi.mock('./sampleScreenshot', async () => {
  const actual = await vi.importActual<typeof import('./sampleScreenshot')>('./sampleScreenshot');
  const annotations: Annotation[] = [
    {
      id: 'guided',
      kind: 'text',
      x: 10,
      y: 10,
      text: 'Keep search visible.',
      zIndex: 0,
    },
  ];
  return {
    ...actual,
    createSampleSearchScreenshot: () => ({
      filename: 'component-search.png',
      dataUrl: 'data:image/png;base64,sample',
      width: 1280,
      height: 760,
    }),
    createGuidedAnnotations: () => annotations,
    composeSamplePromptPng: async () => 'data:image/png;base64,prompt-with-header',
  };
});

afterEach(cleanup);

describe('OnboardingDemo', () => {
  it('marks a dismissal complete without touching a workspace', async () => {
    const onMarkCompleted = vi.fn(async () => {});
    const onDismiss = vi.fn();
    render(
      <OnboardingDemo
        onMarkCompleted={onMarkCompleted}
        onCreateFirstProject={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skip guide' }));
    await waitFor(() =>
      expect(onMarkCompleted).toHaveBeenCalledWith({ completed: true, completedVersion: 1 }, 'dismissed'),
    );
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('walks through a real annotation bundle before project creation', async () => {
    const onMarkCompleted = vi.fn(async () => {});
    const onCreateFirstProject = vi.fn(async () => {});
    const onCopyBundle = vi.fn(async () => {});
    render(
      <OnboardingDemo
        onMarkCompleted={onMarkCompleted}
        onCreateFirstProject={onCreateFirstProject}
        onCopyBundle={onCopyBundle}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use sample screenshot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add guided note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to copy' }));
    await screen.findByRole('button', { name: 'Copy PNG + Markdown' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy PNG + Markdown' }));
    await screen.findByText('PNG and Markdown copied together');
    fireEvent.click(screen.getByRole('button', { name: 'Create your first project' }));

    await waitFor(() => expect(onCreateFirstProject).toHaveBeenCalledOnce());
    expect(onCopyBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'component-search.png',
        markdownFilename: 'component-search.md',
        markdown: expect.stringContaining('Picture 1 / Note 1'),
      }),
    );
    expect(onMarkCompleted).toHaveBeenLastCalledWith({ completed: true, completedVersion: 1 }, 'finished');
  });

  it('allows project creation when combined clipboard access is unavailable', async () => {
    const onMarkCompleted = vi.fn(async () => {});
    const onCreateFirstProject = vi.fn(async () => {});
    const onCopyBundle = vi.fn(async () => {
      throw new Error('Clipboard unavailable');
    });
    render(
      <OnboardingDemo
        onMarkCompleted={onMarkCompleted}
        onCreateFirstProject={onCreateFirstProject}
        onCopyBundle={onCopyBundle}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use sample screenshot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add guided note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to copy' }));
    await screen.findByRole('button', { name: 'Copy PNG + Markdown' });
    fireEvent.click(screen.getByRole('button', { name: 'Copy PNG + Markdown' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try copying again, or continue');
    fireEvent.click(screen.getByRole('button', { name: 'Create your first project' }));

    await waitFor(() => expect(onCreateFirstProject).toHaveBeenCalledOnce());
    expect(onMarkCompleted).toHaveBeenCalledWith({ completed: true, completedVersion: 1 }, 'finished');
  });
});
