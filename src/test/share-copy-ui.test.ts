import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The service browser module is plain JavaScript.
import { boot } from '../../share-service/public/share-copy.js';
// @ts-expect-error The service page renderer is plain JavaScript.
import { sharePage } from '../../share-service/src/share-page.js';

const token = 'a'.repeat(43);

function renderShare(bundles: { number: number; imageFilename: string | null }[]) {
  const html = sharePage(
    {
      title: 'Checkout bugs',
      sender_name: 'Dylan',
      expires_at: '2026-09-29T12:00:00.000Z',
      has_archive: 0,
    },
    '<p>All prompts</p>',
    bundles
      .filter((bundle) => bundle.imageFilename)
      .map((bundle) => ({ filename: bundle.imageFilename, width: 10, height: 10 })),
    token,
    'https://app.imnota.xyz',
    bundles.map((bundle) => ({ ...bundle, markdownHtml: `<p>Prompt ${bundle.number}</p>` })),
    Date.parse('2026-09-28T12:00:00.000Z'),
  );
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  boot(document);
  return document.querySelector('[data-copy-status]')!;
}

function card(number: number) {
  return document.querySelector<HTMLElement>(`[data-bundle-number="${number}"]`)!;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('share clipboard recovery', () => {
  it.each([
    ['markdown', '[data-copy-markdown]', 'Download Markdown'],
    ['bundle', '[data-copy-bundle]', 'Download Markdown and Download PNG'],
  ])('opens real downloads after %s copying fails', async (_kind, selector, named) => {
    vi.stubGlobal('ClipboardItem', undefined);
    const status = renderShare([{ number: 1, imageFilename: 'prompt-001.png' }]);
    card(1).querySelector<HTMLButtonElement>(selector)!.click();
    const menu = card(1).querySelector<HTMLDetailsElement>('details.copy-options')!;
    await vi.waitFor(() => {
      expect(status.textContent).toContain(named);
      // The menu must survive the same click reaching the outside-click handler.
      expect(menu.open).toBe(true);
    });
    const downloads = [...menu.querySelectorAll<HTMLAnchorElement>('a[download]')].map((link) =>
      link.getAttribute('href'),
    );
    expect(downloads).toEqual([`/s/${token}/bundles/1/markdown`, `/s/${token}/assets/prompt-001.png`]);
    expect(status.classList.contains('error')).toBe(true);
    expect(card(1).classList.contains('is-copied')).toBe(false);
    expect(status.textContent).not.toContain('ZIP');
    expect(document.querySelector<HTMLButtonElement>('[data-copy-bundle]')!.disabled).toBe(false);
  });

  it('marks only the copied bundle and fades the success message', async () => {
    const write = vi.fn(async () => undefined);
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(readonly parts: Record<string, Promise<Blob>>) {}
      },
    );
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# Prompt', { headers: { 'Content-Type': 'text/markdown' } })),
    );
    vi.stubGlobal('location', {
      href: `https://app.imnota.xyz/s/${token}`,
      origin: 'https://app.imnota.xyz',
    });
    const status = renderShare([
      { number: 1, imageFilename: null },
      { number: 2, imageFilename: null },
    ]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    card(2).querySelector<HTMLButtonElement>('[data-copy-bundle]')!.click();
    await vi.waitFor(() =>
      expect(status.textContent).toBe('Bundle 2 copied. Paste it into your coding agent.'),
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(card(2).classList.contains('is-copied')).toBe(true);
    expect(card(2).querySelector('[data-copy-label]')!.textContent).toBe('Copied');
    expect(card(2).querySelector('[data-copied-badge]')!.hasAttribute('hidden')).toBe(false);
    expect(card(1).classList.contains('is-copied')).toBe(false);
    expect(status.classList.contains('is-visible')).toBe(true);
    vi.advanceTimersByTime(4_000);
    expect(status.classList.contains('is-visible')).toBe(false);
    expect(status.textContent).toContain('Bundle 2 copied');
  });
});
