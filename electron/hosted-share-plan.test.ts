// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { planHostedShares, hostedShareSummary, splitHostedMarkdown } from './hosted-share-plan.js';
import { HOSTED_MARKDOWN_BYTES, HOSTED_UPLOAD_BYTES } from '../src/shared/hosted-share-limits.js';

const textReader = (markdown: string) => ({
  read: async (_session: string, bundleNumber: number) => ({
    bundleNumber,
    markdown,
    markdownFilename: 'prompt.md',
    pngFilename: '',
  }),
});

it('splits the formerly rejected 600 KiB prompt into complete, bounded shares', async () => {
  const markdown = '# Large prompt\n' + '🙂 café\n'.repeat(70_000);
  const parts = await planHostedShares(textReader(markdown), 'final-session', [1], vi.fn());
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.map((part) => part.markdown).join('')).toBe(markdown);
  for (const part of parts) {
    expect(part.markdown).not.toContain('\ufffd');
    expect(hostedShareSummary(part).markdownBytes).toBeLessThanOrEqual(HOSTED_MARKDOWN_BYTES);
    expect(part.bundles).toHaveLength(1);
    expect(part.bundles![0].markdown).toBe(part.markdown);
  }
});

it.each([0, 1, 2])('handles the exact duplicated-text byte boundary plus %i bytes', async (extra) => {
  const markdown = 'a'.repeat(HOSTED_MARKDOWN_BYTES / 2 + extra);
  const parts = await planHostedShares(textReader(markdown), 'final-session', [1], vi.fn());
  expect(parts).toHaveLength(extra ? 2 : 1);
  expect(parts.map((part) => part.markdown).join('')).toBe(markdown);
});

it('preserves astral characters across a long line and preserves whitespace-only continuations', () => {
  const text = 'a'.repeat(HOSTED_MARKDOWN_BYTES / 2 - 1) + '🙂' + ' '.repeat(HOSTED_MARKDOWN_BYTES);
  const chunks = splitHostedMarkdown(text);
  expect(chunks.join('')).toBe(text);
  expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= HOSTED_MARKDOWN_BYTES / 2)).toBe(true);
  expect(chunks.join('')).not.toContain('\ufffd');
});

it('partitions more than 20 bundles and preserves their order', async () => {
  const numbers = Array.from({ length: 21 }, (_, i) => i + 1);
  const parts = await planHostedShares(
    textReader('# Collection'),
    'final-session',
    numbers.reverse(),
    vi.fn(),
  );
  expect(parts.map((part) => part.bundles!.length)).toEqual([20, 1]);
  expect(parts.flatMap((part) => part.bundles!.map((bundle) => bundle.bundleNumber))).toEqual(
    [...numbers].reverse(),
  );
});

it('splits aggregate image bytes and pixels, and carries a fragmented bundle image only once', async () => {
  const reader = {
    read: async (_session: string, bundleNumber: number) => ({
      bundleNumber,
      markdown: 'a'.repeat(600_000),
      markdownFilename: 'prompt.md',
      pngFilename: 'prompt.png',
      imageDataUrl: 'data:image/png;base64,eA==',
    }),
  };
  const parts = await planHostedShares(reader, 'final-session', [1, 2, 3, 4, 5], () => ({
    width: 4000,
    height: 4000,
    dataBase64: Buffer.alloc(9 * 1024 * 1024).toString('base64'),
  }));
  expect(parts.flatMap((part) => part.images)).toHaveLength(5);
  for (const part of parts) {
    expect(hostedShareSummary(part).uploadBytes).toBeLessThanOrEqual(HOSTED_UPLOAD_BYTES);
    expect(part.images.length * 16_000_000).toBeLessThanOrEqual(64_000_000);
    expect(new Set(part.bundles!.map((bundle) => bundle.bundleNumber)).size).toBe(part.bundles!.length);
  }
});

it('rejects duplicate grants, unreadable grants and a single oversized image before any upload', async () => {
  const read = vi.fn(textReader('prompt').read);
  await expect(planHostedShares({ read }, 'final-session', [1, 1], vi.fn())).rejects.toThrow(/unique/);
  expect(read).not.toHaveBeenCalled();
  await expect(
    planHostedShares(
      {
        read: async () => {
          throw new Error('grant unavailable');
        },
      },
      'final-session',
      [1],
      vi.fn(),
    ),
  ).rejects.toThrow(/grant unavailable/);
  const imageReader = {
    read: async () => ({
      bundleNumber: 1,
      markdown: 'prompt',
      markdownFilename: 'p.md',
      pngFilename: 'p.png',
      imageDataUrl: 'data:image/png;base64,eA==',
    }),
  };
  await expect(
    planHostedShares(imageReader, 'final-session', [1], () => ({
      width: 1,
      height: 1,
      dataBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64'),
    })),
  ).rejects.toThrow(/10 MiB/);
});
