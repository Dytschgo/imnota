// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PromptExportBundleContent } from '../src/shared/workflow-bridge.js';
import { collectHostedShareArtifacts, type HostedShareBundleReader } from './hosted-share-artifacts.js';

const png = 'data:image/png;base64,c291cmNl';

function bundle(bundleNumber: number, imageDataUrl: string | undefined = png): PromptExportBundleContent {
  return {
    bundleNumber,
    pngFilename: imageDataUrl ? `bundle-${bundleNumber}.png` : '',
    markdownFilename: `bundle-${bundleNumber}.md`,
    markdown: `# Prompt ${bundleNumber}`,
    ...(imageDataUrl ? { imageDataUrl } : {}),
  };
}

describe('collectHostedShareArtifacts', () => {
  it('reads the requested finalized session, sorts bundles, and aggregates Markdown and normalized PNGs', async () => {
    const read = vi.fn(async (_sessionId: string, number: number) => bundle(number, number === 2 ? '' : png));
    const artifacts = await collectHostedShareArtifacts({ read }, 'final-session', [3, 1, 2], () => ({
      width: 2_000,
      height: 2_000,
      dataBase64: 'bm9ybWFsaXplZA==',
    }));

    expect(read.mock.calls).toEqual([
      ['final-session', 1],
      ['final-session', 2],
      ['final-session', 3],
    ]);
    expect(artifacts.markdown).toBe('# Prompt 1\n\n---\n\n# Prompt 2\n\n---\n\n# Prompt 3');
    expect(artifacts.images.map((image) => image.filename)).toEqual(['prompt-001.png', 'prompt-003.png']);
    expect(artifacts.images[0].dataBase64).toBe('bm9ybWFsaXplZA==');
    expect(artifacts.bundles).toEqual([
      { bundleNumber: 1, markdown: '# Prompt 1', imageFilename: 'prompt-001.png' },
      { bundleNumber: 2, markdown: '# Prompt 2', imageFilename: null },
      { bundleNumber: 3, markdown: '# Prompt 3', imageFilename: 'prompt-003.png' },
    ]);
  });

  it('does not bypass the workflow final-session grant', async () => {
    const reader: HostedShareBundleReader = {
      read: vi.fn(async () => {
        throw new Error('Stored prompt export grant was not found.');
      }),
    };
    await expect(collectHostedShareArtifacts(reader, 'active-session', [1], vi.fn())).rejects.toThrow(
      /grant was not found/,
    );
  });

  it('rejects duplicate bundle numbers before reading or uploading artifacts', async () => {
    const read = vi.fn(async () => bundle(1));
    await expect(collectHostedShareArtifacts({ read }, 'final-session', [1, 1], vi.fn())).rejects.toThrow(
      /shared once/,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    { width: 10_001, height: 1, dataBase64: 'eA==' },
    { width: 4_001, height: 4_000, dataBase64: 'eA==' },
    undefined,
  ])('rejects unsafe PNG dimensions or decoding: %s', async (normalized) => {
    await expect(
      collectHostedShareArtifacts({ read: async () => bundle(1) }, 'final-session', [1], () => normalized),
    ).rejects.toThrow(/16 million pixels/);
  });

  it('rejects a reader that returns a different bundle grant', async () => {
    await expect(
      collectHostedShareArtifacts({ read: async () => bundle(2) }, 'final-session', [1], vi.fn()),
    ).rejects.toThrow(/did not match/);
  });

  it('rejects five individually valid 16-million-pixel images at the 64-million-pixel aggregate cap', async () => {
    await expect(
      collectHostedShareArtifacts(
        { read: async (_sessionId, number) => bundle(number) },
        'final-session',
        [1, 2, 3, 4, 5],
        () => ({ width: 4_000, height: 4_000, dataBase64: 'eA==' }),
      ),
    ).rejects.toThrow(/aggregate limit of 64 million pixels/);
  });

  it('keeps the normal 20-small-image bundle within the aggregate pixel limit', async () => {
    const numbers = Array.from({ length: 20 }, (_, index) => index + 1);
    const result = await collectHostedShareArtifacts(
      { read: async (_sessionId, number) => bundle(number) },
      'final-session',
      numbers,
      () => ({ width: 100, height: 100, dataBase64: 'eA==' }),
    );
    expect(result.images).toHaveLength(20);
  });
});
