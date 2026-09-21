import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../../shared/types';
import { OnboardingDemo, type OnboardingDemoProps } from './OnboardingDemo';

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

const grant = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  filenames: ['component-search.md', 'component-search.png'] as const,
};

async function reachCopyStep(overrides: Partial<OnboardingDemoProps> = {}) {
  const props: OnboardingDemoProps = {
    fileClipboardAvailable: true,
    onMarkCompleted: vi.fn(async () => {}),
    onCreateFirstProject: vi.fn(async () => {}),
    onPrepareHandoff: vi.fn(async () => grant),
    ...overrides,
  };
  const view = render(<OnboardingDemo {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use sample screenshot' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add guided note' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue to copy' }));
  await screen.findByRole('heading', { name: 'Copy the matching bundle' });
  return { props, ...view };
}

describe('OnboardingDemo', () => {
  it('marks a dismissal complete without touching a workspace', async () => {
    const onMarkCompleted = vi.fn(async () => {});
    const onDismiss = vi.fn();
    const onCreateFirstProject = vi.fn();
    const onPrepareHandoff = vi.fn();
    const onCopyHandoff = vi.fn();
    render(
      <OnboardingDemo
        fileClipboardAvailable
        onMarkCompleted={onMarkCompleted}
        onCreateFirstProject={onCreateFirstProject}
        onPrepareHandoff={onPrepareHandoff}
        onCopyHandoff={onCopyHandoff}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skip guide' }));
    await waitFor(() =>
      expect(onMarkCompleted).toHaveBeenCalledWith({ completed: true, completedVersion: 1 }, 'dismissed'),
    );
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onCreateFirstProject).not.toHaveBeenCalled();
    expect(onPrepareHandoff).not.toHaveBeenCalled();
    expect(onCopyHandoff).not.toHaveBeenCalled();
  });

  it('skips from Escape without preparing workspace files', async () => {
    const onMarkCompleted = vi.fn(async () => {});
    const onCreateFirstProject = vi.fn();
    const onPrepareHandoff = vi.fn();
    render(
      <OnboardingDemo
        fileClipboardAvailable
        onMarkCompleted={onMarkCompleted}
        onCreateFirstProject={onCreateFirstProject}
        onPrepareHandoff={onPrepareHandoff}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('onboarding-dialog'), { key: 'Escape' });
    await waitFor(() => expect(onMarkCompleted).toHaveBeenCalledOnce());
    expect(onCreateFirstProject).not.toHaveBeenCalled();
    expect(onPrepareHandoff).not.toHaveBeenCalled();
  });

  it('walks through a real annotation bundle before project creation', async () => {
    const onCopyHandoff = vi.fn(async () => ({
      text: false,
      html: false,
      image: false,
      files: true,
    }));
    const { props } = await reachCopyStep({ onCopyHandoff });
    fireEvent.click(screen.getByRole('button', { name: 'Copy files' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Files ready');
    expect(screen.getByTestId('onboarding-copy-warning')).toHaveTextContent(/files were confirmed/i);
    expect(props.onCreateFirstProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create your first project' }));

    await waitFor(() => expect(props.onCreateFirstProject).toHaveBeenCalledOnce());
    expect(props.onPrepareHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'component-search.png',
        markdownFilename: 'component-search.md',
        markdown: expect.stringContaining('Picture 1 / Note 1'),
      }),
    );
    expect(onCopyHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: grant.sessionId }),
      'files',
    );
    expect(props.onMarkCompleted).toHaveBeenLastCalledWith(
      { completed: true, completedVersion: 1 },
      'finished',
    );
  });

  it('allows project creation when combined clipboard access is unavailable', async () => {
    const onCopyHandoff = vi.fn(async () => {
      throw new Error('Clipboard unavailable');
    });
    const { props } = await reachCopyStep({ onCopyHandoff });
    fireEvent.click(screen.getByRole('button', { name: 'Copy files' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try copying again, or continue');
    fireEvent.click(screen.getByRole('button', { name: 'Create your first project' }));

    await waitFor(() => expect(props.onCreateFirstProject).toHaveBeenCalledOnce());
    expect(props.onMarkCompleted).toHaveBeenCalledWith({ completed: true, completedVersion: 1 }, 'finished');
  });

  it('reports the verified file handoff and exposes every explicit fallback', async () => {
    const onCopyHandoff = vi.fn(async () => ({
      text: false,
      html: false,
      image: false,
      files: true,
    }));
    const onOpenHandoff = vi.fn(async () => {});
    await reachCopyStep({ onCopyHandoff, onOpenHandoff });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy files' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Files ready');
    expect(screen.getByTestId('onboarding-copy-warning')).toHaveTextContent(/receiving app still decides/i);
    for (const name of [
      'Copy Markdown only',
      'Copy image only',
      'Open files',
      'Copy file paths',
      'Open export folder',
    ])
      expect(screen.getByRole('button', { name })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Open files' }));
    await waitFor(() => expect(onOpenHandoff).toHaveBeenCalledWith(grant, 'files'));
    expect(screen.getByRole('status')).toHaveTextContent('Generated files opened.');
  });

  it('does not claim Markdown + image when Windows keeps only the image', async () => {
    const onCopyHandoff = vi.fn(async () => ({
      text: false,
      html: false,
      image: true,
      files: false,
    }));
    await reachCopyStep({
      defaultCopyVariant: 'rich',
      onCopyHandoff,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rich copy' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Image copied');
    expect(screen.queryByText(/markdown \+ image prepared/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('onboarding-copy-warning')).toHaveTextContent(
      /Markdown was not confirmed.*Copy Markdown only or Open files/i,
    );
    expect(screen.getByRole('button', { name: 'Copy Markdown only' })).toBeEnabled();
  });

  it('does not claim combined copy when read-back cannot confirm a format', async () => {
    const onCopyHandoff = vi.fn(async () => undefined);
    await reachCopyStep({ defaultCopyVariant: 'rich', onCopyHandoff });
    fireEvent.click(screen.getByRole('button', { name: 'Rich copy' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/could not be confirmed/i);
    expect(screen.queryByText(/markdown \+ image prepared/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      /Copy Markdown only, Copy image only, or Open files/,
    );
  });

  it('keeps onboarding rich copy available when native file clipboard support is absent', async () => {
    await reachCopyStep({ fileClipboardAvailable: false });
    expect(await screen.findByRole('button', { name: 'Rich copy' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Copy files' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Files + rich copy' })).not.toBeInTheDocument();
  });

  it('saves a dropdown choice without copying until the primary action is clicked', async () => {
    const onDefaultCopyVariantChange = vi.fn(async () => {});
    const onCopyHandoff = vi.fn(async () => ({ text: true, html: true, image: true, files: true }));
    const { props, rerender } = await reachCopyStep({
      defaultCopyVariant: 'files',
      onCopyHandoff,
      onDefaultCopyVariantChange,
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Native copy function' }), {
      target: { value: 'rich' },
    });
    await waitFor(() => expect(onDefaultCopyVariantChange).toHaveBeenCalledWith('rich'));
    expect(onCopyHandoff).not.toHaveBeenCalled();

    rerender(<OnboardingDemo {...props} defaultCopyVariant="rich" />);
    fireEvent.click(screen.getByRole('button', { name: 'Rich copy' }));
    await waitFor(() => expect(onCopyHandoff).toHaveBeenCalledWith(expect.anything(), 'rich'));
    expect(await screen.findByRole('status')).toHaveTextContent('Markdown + image prepared');
  });

  it('keeps the previous primary action when saving a dropdown choice fails', async () => {
    await reachCopyStep({
      defaultCopyVariant: 'files',
      onDefaultCopyVariantChange: vi.fn(async () => Promise.reject(new Error('disk full'))),
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Native copy function' }), {
      target: { value: 'rich' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('previous choice is still active');
    expect(screen.getByRole('button', { name: 'Copy files' })).toBeEnabled();
  });
});
