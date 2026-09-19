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
        fileClipboardAvailable
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
    const onPrepareHandoff = vi.fn(async () => ({
      sessionId: '00000000-0000-4000-8000-000000000001',
      filenames: ['component-search.md', 'component-search.png'] as const,
    }));
    const onCopyHandoff = vi.fn(async () => ({
      text: true,
      html: true,
      image: true,
      files: false,
    }));
    render(
      <OnboardingDemo
        fileClipboardAvailable
        onMarkCompleted={onMarkCompleted}
        onCreateFirstProject={onCreateFirstProject}
        onPrepareHandoff={onPrepareHandoff}
        onCopyHandoff={onCopyHandoff}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use sample screenshot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add guided note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to copy' }));
    await screen.findByRole('button', { name: 'Rich copy' });
    fireEvent.click(screen.getByRole('button', { name: 'Rich copy' }));
    await screen.findByText(/Markdown and image are on the clipboard/);
    fireEvent.click(screen.getByRole('button', { name: 'Create your first project' }));

    await waitFor(() => expect(onCreateFirstProject).toHaveBeenCalledOnce());
    expect(onPrepareHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'component-search.png',
        markdownFilename: 'component-search.md',
        markdown: expect.stringContaining('Picture 1 / Note 1'),
      }),
    );
    expect(onCopyHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: '00000000-0000-4000-8000-000000000001' }),
      'rich',
    );
    expect(onMarkCompleted).toHaveBeenLastCalledWith({ completed: true, completedVersion: 1 }, 'finished');
  });

  it('allows project creation when combined clipboard access is unavailable', async () => {
    const onMarkCompleted = vi.fn(async () => {});
    const onCreateFirstProject = vi.fn(async () => {});
    const onPrepareHandoff = vi.fn(async () => ({
      sessionId: '00000000-0000-4000-8000-000000000001',
      filenames: ['component-search.md', 'component-search.png'] as const,
    }));
    const onCopyHandoff = vi.fn(async () => {
      throw new Error('Clipboard unavailable');
    });
    render(
      <OnboardingDemo
        fileClipboardAvailable
        onMarkCompleted={onMarkCompleted}
        onCreateFirstProject={onCreateFirstProject}
        onPrepareHandoff={onPrepareHandoff}
        onCopyHandoff={onCopyHandoff}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use sample screenshot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add guided note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to copy' }));
    await screen.findByRole('button', { name: 'Rich copy' });
    fireEvent.click(screen.getByRole('button', { name: 'Rich copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try copying again, or continue');
    fireEvent.click(screen.getByRole('button', { name: 'Create your first project' }));

    await waitFor(() => expect(onCreateFirstProject).toHaveBeenCalledOnce());
    expect(onMarkCompleted).toHaveBeenCalledWith({ completed: true, completedVersion: 1 }, 'finished');
  });

  it('reports the verified file handoff and exposes every explicit fallback', async () => {
    const grant = {
      sessionId: '00000000-0000-4000-8000-000000000001',
      filenames: ['component-search.md', 'component-search.png'] as const,
    };
    const onCopyHandoff = vi.fn(async () => ({
      text: false,
      html: false,
      image: false,
      files: true,
    }));
    const onOpenHandoff = vi.fn(async () => {});
    render(
      <OnboardingDemo
        fileClipboardAvailable
        onMarkCompleted={vi.fn()}
        onCreateFirstProject={vi.fn()}
        onPrepareHandoff={vi.fn(async () => grant)}
        onCopyHandoff={onCopyHandoff}
        onOpenHandoff={onOpenHandoff}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use sample screenshot' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown explanation' }), {
      target: { value: 'Keep filters visible while reviewing results.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add guided note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to copy' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy files' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/files were confirmed.*attachments/i);
    for (const name of ['Copy Markdown', 'Copy image', 'Open files', 'Copy file paths', 'Open export folder'])
      expect(screen.getByRole('button', { name })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open files' }));
    await waitFor(() => expect(onOpenHandoff).toHaveBeenCalledWith(grant, 'files'));
  });

  it('keeps onboarding rich copy available when native file clipboard support is absent', async () => {
    render(
      <OnboardingDemo
        onMarkCompleted={vi.fn()}
        onCreateFirstProject={vi.fn()}
        onPrepareHandoff={vi.fn(async () => ({
          sessionId: '00000000-0000-4000-8000-000000000001',
          filenames: ['component-search.md', 'component-search.png'] as const,
        }))}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use sample screenshot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add guided note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to copy' }));
    expect(await screen.findByRole('button', { name: 'Rich copy' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Copy files' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Files + rich copy' })).not.toBeInTheDocument();
  });
});
