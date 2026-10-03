import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeMacClipboardObservation, type MacClipboardObservation } from './mac-clipboard.js';

/** Report only the isolated handoff's paths and comparisons, never unrelated payload text. */
export async function onboardingCopyEvidence(input: {
  attempt: number;
  action: 'files' | 'files-rich';
  expectedFiles: readonly string[];
  actualFiles: readonly string[];
  expectedText: string;
  actualText: string;
  html: string;
  image: { empty: boolean; width: number; height: number };
  before: MacClipboardObservation;
  after: MacClipboardObservation;
}) {
  const { expectedFiles, actualFiles, expectedText, actualText, before, after } = input;
  const orderedPathsEqual = expectedFiles.map(
    (file, index) =>
      actualFiles[index] !== undefined && path.resolve(file) === path.resolve(actualFiles[index]),
  );
  const handoffDirectory = await fs.realpath(path.dirname(expectedFiles[0])).catch(() => undefined);
  const actualFileEvidence = await Promise.all(
    actualFiles.map(async (file) => {
      const resolvedPath = await fs.realpath(file).catch(() => undefined);
      const relative =
        handoffDirectory && resolvedPath ? path.relative(handoffDirectory, resolvedPath) : undefined;
      const withinHandoff =
        relative !== undefined &&
        relative !== '' &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative);
      return withinHandoff
        ? { name: path.basename(file), path: file, resolvedPath }
        : { name: '[outside synthetic handoff]', path: '[redacted]' };
    }),
  );
  const operands = {
    count: actualFiles.length === 2,
    orderedPaths: orderedPathsEqual.length === 2 && orderedPathsEqual.every(Boolean),
    text: actualText === expectedText,
    noHtml: input.html === '',
    noImage: input.image.empty,
  };
  const consistent = before.changeCount === after.changeCount;
  return {
    attempt: input.attempt,
    action: input.action,
    operands,
    files: {
      expectedCount: 2,
      actualCount: actualFiles.length,
      expected: expectedFiles.map((file) => ({ name: path.basename(file), path: file })),
      actual: actualFileEvidence,
      orderedPathsEqual,
    },
    text: {
      equal: operands.text,
      expectedLength: expectedText.length,
      actualLength: actualText.length,
      expectedBytes: Buffer.byteLength(expectedText),
      actualBytes: Buffer.byteLength(actualText),
    },
    html: { empty: operands.noHtml, length: input.html.length },
    image: input.image,
    native: {
      before: sanitizeMacClipboardObservation(before),
      after: sanitizeMacClipboardObservation(after),
      consistent,
    },
    formatsValid:
      operands.count &&
      operands.orderedPaths &&
      (input.action === 'files' || (operands.text && operands.noHtml && operands.noImage)),
  };
}
