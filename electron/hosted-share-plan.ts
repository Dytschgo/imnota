import type { HostedShareArtifacts } from './hosted-share-client.js';
import {
  collectHostedShareArtifacts,
  type HostedShareBundleReader,
  type NormalizeHostedPng,
} from './hosted-share-artifacts.js';
import { NativeWorkflowError } from './workflow-errors.js';
import {
  HOSTED_MARKDOWN_BYTES,
  HOSTED_UPLOAD_BYTES,
  HOSTED_IMAGE_BYTES,
  HOSTED_BUNDLE_COUNT,
  HOSTED_IMAGE_PIXELS,
  type HostedSharePartSummary,
} from '../src/shared/hosted-share-limits.js';

const separator = '\n\n---\n\n';

/** Lossless UTF-8 pieces. Prefer line boundaries; never cut a surrogate pair. */
export function splitHostedMarkdown(markdown: string): string[] {
  const bytes = Buffer.from(markdown, 'utf8');
  const chunks: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    let end = Math.min(offset + HOSTED_MARKDOWN_BYTES / 2, bytes.length);
    if (end < bytes.length) {
      while ((bytes[end] & 0xc0) === 0x80) end--;
      const newline = bytes.lastIndexOf(10, end - 1);
      if (newline >= offset + (end - offset) / 2) end = newline + 1;
    }
    chunks.push(bytes.subarray(offset, end).toString('utf8'));
    offset = end;
  }
  return chunks.length ? chunks : [''];
}

export function hostedShareSummary(artifacts: HostedShareArtifacts): HostedSharePartSummary {
  const markdownBytes =
    Buffer.byteLength(artifacts.markdown, 'utf8') +
    (artifacts.bundles ?? []).reduce((sum, bundle) => sum + Buffer.byteLength(bundle.markdown, 'utf8'), 0);
  return {
    markdownBytes,
    uploadBytes:
      markdownBytes +
      artifacts.images.reduce((sum, image) => sum + Buffer.from(image.dataBase64, 'base64').length, 0),
    bundleNumbers: (artifacts.bundles ?? []).map((bundle) => bundle.bundleNumber),
    imageBundleNumbers: (artifacts.bundles ?? [])
      .filter((bundle) => bundle.imageFilename !== null)
      .map((bundle) => bundle.bundleNumber),
  };
}

/** Plans only finalized artifacts; no pairing request, upload or local history mutation. */
export async function planHostedShares(
  reader: HostedShareBundleReader,
  sessionId: string,
  bundleNumbers: readonly number[],
  normalizePng: NormalizeHostedPng,
): Promise<HostedShareArtifacts[]> {
  const numbers = [...new Set(bundleNumbers)].sort((a, b) => a - b);
  if (!numbers.length || numbers.length > 999 || numbers.length !== bundleNumbers.length)
    throw new NativeWorkflowError('invalid-input', 'Choose unique finalized prompt bundles.');
  const parts: HostedShareArtifacts[] = [];
  let current: HostedShareArtifacts | undefined;
  let pixels = 0;
  let retainedBytes = 0;
  for (const number of numbers) {
    let imagePixels = 0;
    const source = await collectHostedShareArtifacts(reader, sessionId, [number], (data) => {
      const image = normalizePng(data);
      if (image) imagePixels = image.width * image.height;
      return image;
    });
    if (source.images.some((image) => Buffer.from(image.dataBase64, 'base64').length > HOSTED_IMAGE_BYTES))
      throw new NativeWorkflowError(
        'invalid-input',
        `Bundle ${number} has a PNG larger than 10 MiB. Use Open files to share it directly.`,
      );
    retainedBytes += hostedShareSummary(source).uploadBytes;
    if (retainedBytes > 128 * 1024 * 1024)
      throw new NativeWorkflowError(
        'invalid-input',
        'This export exceeds the 128 MiB local share-plan limit. Share smaller collections or use Open files.',
      );
    const chunks = splitHostedMarkdown(source.markdown);
    for (let chunk = 0; chunk < chunks.length; chunk++) {
      const fragment: HostedShareArtifacts = {
        title: source.title,
        markdown: chunks[chunk],
        images: chunk === 0 ? source.images : [],
        bundles: [
          {
            ...source.bundles![0],
            markdown: chunks[chunk],
            imageFilename: chunk === 0 ? source.bundles![0].imageFilename : null,
          },
        ],
      };
      const fragmentPixels = chunk === 0 ? imagePixels : 0;
      const candidate: HostedShareArtifacts = current
        ? {
            title: current.title,
            markdown: current.markdown + separator + fragment.markdown,
            images: [...current.images, ...fragment.images],
            bundles: [...current.bundles!, ...fragment.bundles!],
          }
        : fragment;
      const size = hostedShareSummary(candidate);
      if (
        current &&
        (size.markdownBytes > HOSTED_MARKDOWN_BYTES ||
          size.uploadBytes > HOSTED_UPLOAD_BYTES ||
          Buffer.byteLength(JSON.stringify(candidate)) > 36 * 1024 * 1024 - 4096 ||
          candidate.bundles!.length > HOSTED_BUNDLE_COUNT ||
          pixels + fragmentPixels > HOSTED_IMAGE_PIXELS ||
          current.bundles!.some((bundle) => bundle.bundleNumber === number))
      ) {
        parts.push(current);
        current = fragment;
        pixels = fragmentPixels;
      } else {
        current = candidate;
        pixels += fragmentPixels;
      }
    }
  }
  if (current) parts.push(current);
  const title = parts[0]?.title ?? 'Imnota prompt';
  if (parts.length > 1)
    parts.forEach((part, index) => {
      // Leave room for the suffix without splitting a UTF-16 surrogate pair.
      const suffix = ` · Part ${index + 1} of ${parts.length}`;
      part.title =
        Array.from(title).reduce(
          (title, character) =>
            title.length + character.length <= 200 - suffix.length ? title + character : title,
          '',
        ) + suffix;
    });
  return parts;
}
