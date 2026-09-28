import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { nativeClipboard } from './native-clipboard.js';
import {
  loadWindowsClipboardApi,
  readWindowsClipboardFilesWhenAvailable,
  withWindowsClipboardLock,
  writeWindowsClipboard,
  type WindowsClipboardApi,
} from './windows-clipboard.js';

const SOURCE_FORMATS = [
  'HTML Format',
  'Chromium internal source RFH token',
  'Chromium internal source URL',
] as const;

async function readSource(owner: Buffer, api: WindowsClipboardApi): Promise<Buffer[]> {
  return withWindowsClipboardLock(
    owner,
    (locked) => {
      return [13, ...SOURCE_FORMATS.map((name) => locked.registerClipboardFormat(name))].map((format) => {
        const handle = locked.getClipboardData(format);
        if (!handle) throw new Error(`Chromium source did not publish clipboard format ${format}.`);
        const size = locked.globalSize(handle);
        if (size <= 0 || size > 64 * 1024) throw new Error('Unexpected Chromium fixture size.');
        const pointer = locked.globalLock(handle);
        if (!pointer) throw new Error('Chromium fixture could not be read.');
        try {
          const bytes = Buffer.alloc(size);
          locked.copyMemory(bytes, pointer, size);
          return bytes;
        } finally {
          locked.globalUnlock(handle);
        }
      });
    },
    { context: 'Chromium clipboard fixture readback' },
    api,
  );
}

/** Uses Chromium's real renderer copy path, including its opaque provenance bytes. */
export async function exerciseChromiumClipboardSmoke(
  owner: Buffer,
  filePaths: readonly [string, string],
  stage: (message: string) => void = () => undefined,
): Promise<void> {
  if (process.platform !== 'win32') return;
  const source = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const api = loadWindowsClipboardApi();
  const text = `Imnota synthetic browser selection ${randomUUID()}`;
  try {
    await source.loadURL(`data:text/html,<p id="source">${text}</p>`);
    const copied = await source.webContents.executeJavaScript(
      `
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('source'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('copy');
    `,
      true,
    );
    if (!copied) throw new Error('The synthetic Chromium selection could not be copied.');
    // execCommand returns before the browser process commits the clipboard write.
    const deadline = Date.now() + 5_000;
    while ((await nativeClipboard.readText()) !== text) {
      if (Date.now() >= deadline) throw new Error('Chromium did not commit the selected fixture text.');
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const prior = await readSource(owner, api);
    if (prior[0].toString('utf16le').replace(/\0+$/, '') !== text)
      throw new Error('Chromium copied unexpected fixture text.');
    stage('real browser content and provenance captured');

    let injected = false;
    try {
      await writeWindowsClipboard(
        owner,
        {
          filePaths,
          markdown: '# Replacement',
          html: '<p>Replacement</p>',
          png: Buffer.from('unused failure fixture'),
          dibV5: Buffer.from('unused failure fixture'),
        },
        {
          ...api,
          setClipboardData: (format, handle) => {
            // Fail after files and text were replaced, before writing any image bytes.
            if (format === api.registerClipboardFormat('HTML Format') && !injected) {
              injected = true;
              return null;
            }
            return api.setClipboardData(format, handle);
          },
        },
      );
      throw new Error('The injected Chromium clipboard write unexpectedly succeeded.');
    } catch (error) {
      if (!injected || !(error instanceof Error) || !/rejected clipboard format/i.test(error.message))
        throw error;
    }
    const restored = await readSource(owner, api);
    if (restored.some((bytes, index) => !bytes.equals(prior[index])))
      throw new Error('Clipboard rollback changed Chromium content or provenance bytes.');
    stage('browser content and provenance restored byte-for-byte after partial write failure');

    await writeWindowsClipboard(owner, { filePaths }, api);
    const files = await readWindowsClipboardFilesWhenAvailable(owner);
    if (
      files.length !== 2 ||
      files.some((file, index) => path.resolve(file) !== path.resolve(filePaths[index]))
    )
      throw new Error('Copy files did not replace Chromium content with the exact generated pair.');
    stage('generated pair confirmed after copying over browser content');
  } finally {
    source.destroy();
  }
}
