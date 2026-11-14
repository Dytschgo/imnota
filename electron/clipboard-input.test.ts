// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import {
  assertClipboardText,
  clipboardImage,
  nativeClipboardOwnerHandle,
  validateDecodedPromptPng,
} from './clipboard-input.js';
import { NativeWorkflowError, workflowOutcome } from './workflow-errors.js';

const images = vi.hoisted(() => ({ createFromDataURL: vi.fn(), createFromBuffer: vi.fn() }));
vi.mock('electron', () => ({ nativeImage: images }));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
beforeEach(() => vi.resetAllMocks());

it.each([
  ['invalid header', 'data:image/png;base64,AAAA', 'decode'],
  ['invalid base64', 'data:image/png;base64,!!!', 'decode'],
  ['wrong media type', 'data:image/jpeg;base64,AAAA', 'decode'],
  ['oversized data URL', `data:image/png;base64,${'A'.repeat(32_000_000)}`, 'too-large'],
  [
    'oversized dimensions',
    (() => {
      const bytes = Buffer.from(png);
      bytes.writeUInt32BE(8193, 16);
      return `data:image/png;base64,${bytes.toString('base64')}`;
    })(),
    'too-large',
  ],
] as const)('classifies %s before native decoding', async (_label, input, reason) => {
  await expect(workflowOutcome(() => clipboardImage(input))).resolves.toMatchObject({
    ok: false,
    error: { code: 'clipboard-limit', retryable: false, details: { reason } },
  });
  expect(images.createFromDataURL).not.toHaveBeenCalled();
});

it.each([true, false])('reports an empty or mismatched decoded image (empty: %s)', async (empty) => {
  images.createFromDataURL.mockReturnValue({
    isEmpty: () => empty,
    getSize: () => ({ width: 2, height: 1 }),
  });
  await expect(workflowOutcome(() => clipboardImage(dataUrl))).resolves.toMatchObject({
    ok: false,
    error: { code: 'clipboard-limit', retryable: false, details: { reason: 'decode' } },
  });
});

it('reports text over its clipboard limit and a missing owner explicitly', async () => {
  await expect(workflowOutcome(() => assertClipboardText('a'.repeat(2_000_001)))).resolves.toMatchObject({
    ok: false,
    error: { code: 'clipboard-limit', retryable: false, details: { reason: 'too-large' } },
  });
  await expect(workflowOutcome(() => nativeClipboardOwnerHandle(null))).resolves.toMatchObject({
    ok: false,
    error: { code: 'clipboard-limit', retryable: false, details: { reason: 'rejected' } },
  });
});

it('reports export PNG decoder mismatches as invalid renderer input', async () => {
  images.createFromBuffer.mockReturnValue({ isEmpty: () => false, getSize: () => ({ width: 2, height: 1 }) });
  await expect(
    workflowOutcome(() => validateDecodedPromptPng(png, { width: 1, height: 1 })),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'invalid-input', retryable: false },
  });
});

it.each(['createFromDataURL', 'isEmpty', 'getSize'] as const)(
  'reports unexpected Electron %s failures as image decoding failures',
  async (method) => {
    const fail = () => {
      throw new Error('native decoder failed');
    };
    images.createFromDataURL.mockImplementation(
      method === 'createFromDataURL'
        ? fail
        : () => ({
            isEmpty: method === 'isEmpty' ? fail : () => false,
            getSize: method === 'getSize' ? fail : () => ({ width: 1, height: 1 }),
          }),
    );
    await expect(workflowOutcome(() => clipboardImage(dataUrl))).resolves.toMatchObject({
      ok: false,
      error: { code: 'clipboard-limit', retryable: false, details: { reason: 'decode' } },
    });
  },
);

it('preserves an existing NativeWorkflowError from native decoding unchanged', () => {
  const failure = new NativeWorkflowError('clipboard-limit', 'Native decode limit', false, {
    reason: 'too-large',
  });
  images.createFromDataURL.mockImplementation(() => {
    throw failure;
  });
  let caught: unknown;
  try {
    clipboardImage(dataUrl);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(failure);
});

it('keeps native export decoder exceptions user-safe and invalid-input', async () => {
  images.createFromBuffer.mockImplementation(() => {
    throw new Error('Private decoder internals');
  });
  await expect(
    workflowOutcome(() => validateDecodedPromptPng(png, { width: 1, height: 1 })),
  ).resolves.toEqual({
    ok: false,
    error: {
      code: 'invalid-input',
      retryable: false,
      message: 'Prompt PNG could not be fully decoded at its reserved dimensions.',
    },
  });
});
