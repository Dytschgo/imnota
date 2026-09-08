import type { PromptExportBundleContent } from '../src/shared/workflow-bridge.js';
import type { HostedShareArtifacts } from './hosted-share-client.js';
import { NativeWorkflowError } from './workflow-errors.js';

const MAX_BUNDLES = 20;
const MAX_DIMENSION = 10_000;
const MAX_PIXELS = 16_000_000;
const MAX_BUNDLE_PIXELS = 64_000_000;

export interface HostedShareBundleReader {
  read(sessionId: string, bundleNumber: number): Promise<PromptExportBundleContent>;
}

export interface NormalizedHostedPng {
  width: number;
  height: number;
  dataBase64: string;
}

export type NormalizeHostedPng = (dataBase64: string) => NormalizedHostedPng | undefined;

export function hostedPngDimensionsAreSafe(width: number, height: number): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION &&
    width * height <= MAX_PIXELS
  );
}

/** Collects only finalized, main-owned bundle grants and normalizes their rendered PNGs. */
export async function collectHostedShareArtifacts(
  reader: HostedShareBundleReader,
  sessionId: string,
  bundleNumbers: readonly number[],
  normalizePng: NormalizeHostedPng,
): Promise<HostedShareArtifacts> {
  const unique = [...new Set(bundleNumbers)].sort((left, right) => left - right);
  if (unique.length === 0 || unique.length > MAX_BUNDLES)
    throw new NativeWorkflowError('invalid-input', 'Choose between 1 and 20 finalized prompt bundles.');
  if (unique.length !== bundleNumbers.length)
    throw new NativeWorkflowError('invalid-input', 'Each finalized prompt bundle can be shared once.');

  const bundles = await Promise.all(unique.map((bundleNumber) => reader.read(sessionId, bundleNumber)));
  const images: { filename: string; dataBase64: string }[] = [];
  const structuredBundles: { bundleNumber: number; markdown: string; imageFilename: string | null }[] = [];
  let totalPixels = 0;
  for (let index = 0; index < bundles.length; index++) {
    const bundle = bundles[index];
    const expectedNumber = unique[index];
    if (bundle.bundleNumber !== expectedNumber)
      throw new NativeWorkflowError(
        'bundle-not-found',
        'A finalized prompt bundle grant did not match its request.',
      );
    if (!bundle.imageDataUrl) {
      structuredBundles.push({
        bundleNumber: expectedNumber,
        markdown: bundle.markdown,
        imageFilename: null,
      });
      continue;
    }
    const prefix = 'data:image/png;base64,';
    if (!bundle.imageDataUrl.startsWith(prefix))
      throw new NativeWorkflowError('io-failure', 'A finalized prompt image is not a PNG artifact.');
    const normalized = normalizePng(bundle.imageDataUrl.slice(prefix.length));
    if (!normalized || !hostedPngDimensionsAreSafe(normalized.width, normalized.height))
      throw new NativeWorkflowError(
        'invalid-input',
        'A finalized PNG exceeds the hosted-sharing limit of 16 million pixels and 10,000 pixels per side.',
      );
    totalPixels += normalized.width * normalized.height;
    if (totalPixels > MAX_BUNDLE_PIXELS)
      throw new NativeWorkflowError(
        'invalid-input',
        'The finalized PNGs exceed the hosted-sharing aggregate limit of 64 million pixels.',
      );
    const filename = `prompt-${String(expectedNumber).padStart(3, '0')}.png`;
    images.push({
      filename,
      dataBase64: normalized.dataBase64,
    });
    structuredBundles.push({
      bundleNumber: expectedNumber,
      markdown: bundle.markdown,
      imageFilename: filename,
    });
  }

  return {
    title: 'Imnota prompt',
    markdown: bundles.map((bundle) => bundle.markdown).join('\n\n---\n\n'),
    images,
    bundles: structuredBundles,
  };
}
