import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The service browser module is plain JavaScript.
import { boot } from '../../share-service/public/share-copy.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('share clipboard recovery', () => {
  it.each(['markdown', 'bundle'])(
    'exposes a real download after %s copying fails without an archive',
    async (kind) => {
      vi.stubGlobal('ClipboardItem', undefined);
      document.body.innerHTML = `<main data-share-copy-root>
      <p data-copy-status role="status"></p>
      <section data-copy-scope data-markdown-url="/s/example/markdown">
        <button data-copy-${kind}>Copy</button>
      </section>
      <details class="markdown-preview"><summary>Read Markdown</summary>
        <a href="/s/example/markdown" download>Download Markdown</a>
      </details>
    </main>`;
      boot(document);
      document.querySelector<HTMLButtonElement>('button')!.click();
      await vi.waitFor(() => {
        expect(document.querySelector('[data-copy-status]')?.textContent).toContain('Download Markdown');
      });
      expect(document.querySelector('details')?.open).toBe(true);
      expect(document.querySelector('[data-copy-status]')?.textContent).not.toContain('ZIP');
      expect(document.querySelector('button')?.disabled).toBe(false);
    },
  );
});
