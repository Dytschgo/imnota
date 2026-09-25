import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { nativeImage } from 'electron';
import { nativeClipboard } from './native-clipboard.js';
import {
  loadWindowsClipboardApi,
  readWindowsClipboardFilesWhenAvailable,
  windowsDibV5Buffer,
  withWindowsClipboardLock,
  writeWindowsClipboard,
  type WindowsClipboardApi,
} from './windows-clipboard.js';

const PRIOR_TEXT = 'Imnota synthetic OLE clipboard prior text';

// Keep the STA clipboard owner alive while Win32 requests its delayed formats.
const OLE_SOURCE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
try {
  $data = New-Object System.Windows.Forms.DataObject
  $data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $false, '${PRIOR_TEXT}')
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $false)
  [Console]::WriteLine('READY')
  [System.Windows.Forms.Application]::Run((New-Object System.Windows.Forms.ApplicationContext))
} catch {
  [Console]::WriteLine('ERROR: ' + $_.Exception.Message)
}
`;

async function liveOleSource(): Promise<{ stop(): Promise<void> }> {
  const encoded = Buffer.from(OLE_SOURCE, 'utf16le').toString('base64');
  const child: ChildProcessWithoutNullStreams = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded],
    { stdio: 'pipe', windowsHide: true },
  );
  const lines = readline.createInterface({ input: child.stdout });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-1_000);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`The synthetic OLE source did not start. ${stderr}`));
      }, 15_000);
      const onLine = (line: string) => {
        cleanup();
        if (line === 'READY') resolve();
        else reject(new Error(`The synthetic OLE source failed: ${line}`));
      };
      const onExit = () => {
        cleanup();
        reject(new Error(`The synthetic OLE source exited before it was ready. ${stderr}`));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        lines.off('line', onLine);
        child.off('exit', onExit);
        child.off('error', onError);
      };
      lines.on('line', onLine);
      child.once('exit', onExit);
      child.once('error', onError);
    });
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const stopped = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill();
      await Promise.race([stopped, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);
      if (child.exitCode === null && child.signalCode === null)
        throw new Error('The synthetic OLE clipboard owner did not exit.');
      lines.close();
    },
  };
}

async function assertOlePrior(owner: Buffer, api: WindowsClipboardApi): Promise<void> {
  const hasBroker = await withWindowsClipboardLock(
    owner,
    (locked) => locked.isClipboardFormatAvailable(locked.registerClipboardFormat('DataObject')),
    { context: 'Synthetic OLE clipboard verification' },
    api,
  );
  if (!hasBroker) throw new Error('The synthetic OLE source did not publish a live DataObject format.');
  if ((await nativeClipboard.readText()) !== PRIOR_TEXT)
    throw new Error('The synthetic OLE source did not publish its expected text.');
}

/** Native Windows smoke: real OLE ownership, file copy, then bounded content rollback. */
export async function exerciseOleClipboardSmoke(
  owner: Buffer,
  filePaths: readonly [string, string],
  stage: (message: string) => void = () => undefined,
): Promise<void> {
  if (process.platform !== 'win32') return;
  stage('starting OLE source');
  let source = await liveOleSource();
  const api = loadWindowsClipboardApi();
  try {
    stage('asserting prior OLE content');
    await assertOlePrior(owner, api);
    stage('writing files over OLE content');
    await writeWindowsClipboard(owner, { filePaths }, api);
    stage('checking copied files');
    const copied = await readWindowsClipboardFilesWhenAvailable(owner);
    if (
      copied.length !== 2 ||
      copied.some((file, index) => path.resolve(file) !== path.resolve(filePaths[index]))
    )
      throw new Error('Copy files did not replace the live OLE clipboard with the generated pair.');

    stage('resetting prior OLE content');
    await source.stop();
    source = await liveOleSource();
    stage('asserting reset OLE content');
    await assertOlePrior(owner, api);
    const image = nativeImage.createFromBuffer(await fs.readFile(filePaths[1]));
    if (image.isEmpty()) throw new Error('The native OLE smoke PNG could not be decoded.');
    const size = image.getSize();
    let injected = false;
    const failingApi: WindowsClipboardApi = {
      ...api,
      setClipboardData: (format, handle) => {
        if (format === 17 && !injected) {
          injected = true;
          return null;
        }
        return api.setClipboardData(format, handle);
      },
    };
    stage('injecting partial write failure');
    try {
      await writeWindowsClipboard(
        owner,
        {
          filePaths,
          markdown: '# Synthetic OLE rollback',
          html: '<p>Synthetic OLE rollback</p>',
          png: image.toPNG(),
          dibV5: windowsDibV5Buffer(image.toBitmap(), size.width, size.height),
        },
        failingApi,
      );
      throw new Error('The injected late clipboard write unexpectedly succeeded.');
    } catch (error) {
      if (!injected || !(error instanceof Error) || !/rejected clipboard format/i.test(error.message))
        throw error;
    }
    stage('checking restored prior text');
    if ((await nativeClipboard.readText()) !== PRIOR_TEXT)
      throw new Error('The prior OLE text could not be pasted after clipboard rollback.');
    const staleBroker = await withWindowsClipboardLock(
      owner,
      (locked) => locked.isClipboardFormatAvailable(locked.registerClipboardFormat('DataObject')),
      { context: 'Synthetic OLE rollback verification' },
      api,
    );
    if (staleBroker) throw new Error('Clipboard rollback replayed a dead OLE DataObject broker.');
    stage('OLE rollback verified');
  } finally {
    await source.stop();
  }
}
