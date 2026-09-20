import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WhatsNewDialog, WhatsNewSettings } from './WhatsNew';
import type { WhatsNewRelease } from '../../shared/whats-new';

afterEach(() => cleanup());

const release: WhatsNewRelease = {
  afterVersion: '0.2.7',
  channel: 'nightly',
  title: 'What’s new in this Nightly',
  summary: 'Preview the next update controls.',
  preview: true,
  features: [
    {
      id: 'updates',
      title: 'Updates stay within reach',
      description: 'One compact control for check, download, restart, or retry.',
      action: { kind: 'settings', category: 'Updates & about' },
    },
    {
      id: 'handoff',
      title: 'Try the complete handoff',
      description: 'Use the guided sample.',
      imageSrc: 'https://example.test/handoff.png',
      action: { kind: 'onboarding' },
    },
  ],
};

it('labels nightly guidance as preview and keeps missing screenshots from blocking the dialog', () => {
  const onClose = vi.fn();
  const onLater = vi.fn();
  const onAction = vi.fn();
  render(<WhatsNewDialog release={release} onClose={onClose} onLater={onLater} onAction={onAction} />);

  expect(screen.getByTestId('whats-new-dialog')).toHaveTextContent('Nightly preview');
  expect(screen.getByText('Preview the next update controls.')).toBeInTheDocument();
  expect(document.querySelectorAll('.whats-new-card img')).toHaveLength(1);
  fireEvent.error(document.querySelector('.whats-new-card img')!);
  expect(document.querySelector('.whats-new-card img')).not.toBeInTheDocument();
  expect(screen.getByTestId('whats-new-dialog')).toBeInTheDocument();
  expect(screen.getByText('Updates stay within reach')).toBeInTheDocument();

  fireEvent.click(screen.getAllByRole('button', { name: 'Try it now' })[0]!);
  expect(onAction).toHaveBeenCalledWith({ kind: 'settings', category: 'Updates & about' });
  fireEvent.click(screen.getByRole('button', { name: 'Later' }));
  expect(onLater).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
  expect(onClose).toHaveBeenCalledOnce();
});

it('omits the preview label for stable notes', () => {
  render(
    <WhatsNewDialog
      release={{ ...release, preview: false, title: 'What’s new' }}
      onClose={vi.fn()}
      onLater={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  expect(screen.queryByText(/Nightly preview/)).not.toBeInTheDocument();
});

it('replays bundled notes from Settings and stays available when this version has no release notes', () => {
  const onReplay = vi.fn();
  const onAction = vi.fn();
  const { rerender } = render(
    <WhatsNewSettings
      version="0.2.8"
      channel="stable"
      releaseUrl="https://example.test"
      onReplay={onReplay}
      onAction={onAction}
    />,
  );
  expect(screen.getByRole('heading', { name: 'What’s new' })).toBeInTheDocument();
  expect(screen.getByText(/Stable/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Replay what’s new' }));
  expect(onReplay).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', { name: /Release details/ })).toHaveAttribute(
    'href',
    'https://example.test',
  );

  rerender(<WhatsNewSettings version="0.2.7" channel="stable" onReplay={onReplay} onAction={onAction} />);
  expect(screen.getByRole('button', { name: 'Replay what’s new' })).toBeDisabled();
  expect(screen.getByText(/Release guidance for this version is not bundled yet/)).toBeInTheDocument();
});

it('keeps Settings feature cards when a screenshot is omitted or fails to load', () => {
  render(
    <WhatsNewSettings
      version="0.2.8-nightly.20260919.35412472440"
      channel="nightly"
      onReplay={vi.fn()}
      onAction={vi.fn()}
    />,
  );
  expect(screen.getByText('Choose a display to capture')).toBeInTheDocument();
  const screenshots = document.querySelectorAll('.whats-new-settings .whats-new-card img');
  expect(screenshots).toHaveLength(2);
  fireEvent.error(screenshots[0]!);
  expect(document.querySelectorAll('.whats-new-settings .whats-new-card img')).toHaveLength(1);
  expect(screen.getByText('Read before downloading')).toBeInTheDocument();
  expect(screen.getByText('Choose what to copy')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Replay what’s new' })).toBeEnabled();
});
