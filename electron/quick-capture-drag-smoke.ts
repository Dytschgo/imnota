import { app, BrowserWindow, screen } from 'electron';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { QuickCaptureCard } from '../src/shared/quick-capture.js';
import type { QuickCaptureWindow } from './quick-capture-window.js';
import { NativeUiDriver } from './smoke-native-driver.js';
import { createWindowsSmokePointer } from './windows-smoke-input.js';
import { smokeStringLiteral } from './smoke-string-literal.js';

const execute = promisify(execFile);
let macInputHelper: Promise<string> | undefined;
async function macDragInput(points: {
  start: { x: number; y: number };
  end: { x: number; y: number };
  restore: { x: number; y: number };
}): Promise<void> {
  macInputHelper ??= (async () => {
    const directory = await fs.mkdtemp(path.join(app.getPath('userData'), 'quick-drag-input-'));
    const source = path.join(directory, 'input.swift'),
      executable = path.join(directory, 'input');
    // This helper is compiled only in the owned native verification profile. Its
    // input permission is a test-host prerequisite, never a product permission.
    await fs.writeFile(
      source,
      `import Foundation
import ApplicationServices
guard AXIsProcessTrusted() else {
  fputs("Native drag input injection requires an Accessibility-authorized test host. No permission or TCC state was changed.\\n", stderr)
  exit(77)
}
let values = CommandLine.arguments.dropFirst().compactMap(Double.init)
guard values.count == 6 else { exit(2) }
let start = CGPoint(x: values[0], y: values[1]), end = CGPoint(x: values[2], y: values[3]), restore = CGPoint(x: values[4], y: values[5])
func send(_ kind: CGEventType, _ point: CGPoint) {
  CGEvent(mouseEventSource: nil, mouseType: kind, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}
defer { send(.leftMouseUp, end); CGWarpMouseCursorPosition(restore) }
send(.mouseMoved, start); usleep(100000)
send(.leftMouseDown, start); usleep(100000)
for index in 1...20 {
  let fraction = Double(index) / 20.0
  send(.leftMouseDragged, CGPoint(x: start.x + (end.x-start.x)*fraction, y: start.y + (end.y-start.y)*fraction))
  usleep(20000)
}
usleep(100000); send(.leftMouseUp, end)
`,
    );
    await execute('/usr/bin/xcrun', ['--sdk', 'macosx', 'swiftc', source, '-o', executable], {
      timeout: 60000,
    });
    return executable;
  })();
  const executable = await macInputHelper;
  await execute(
    executable,
    [points.start.x, points.start.y, points.end.x, points.end.y, points.restore.x, points.restore.y].map(
      String,
    ),
    { timeout: 15000 },
  );
}

/** OS delivery to a synthetic Electron receiver, not a claim about external editors. */
export async function exerciseQuickCaptureNativeDrag(
  manager: QuickCaptureWindow,
  card: QuickCaptureCard,
): Promise<void> {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  const source = manager.browserWindow!;
  const driver = new NativeUiDriver(source);
  const selector = `[data-testid="quick-capture-${card.id}"] button`;
  await driver.evaluate(
    `(()=>{const button=[...document.querySelectorAll(${smokeStringLiteral(selector)})].find(button=>button.textContent==='Drag PNG');if(!button)throw new Error('Drag control missing');button.focus();})()`,
  );
  await driver.waitFor({ selector: '[role="status"]', text: 'PNG ready to drag.', exact: true });
  if (!manager.store.item(card.id, card.revision).dragPath)
    throw new Error('Native drag PNG was not staged.');
  const expected = manager.store.item(card.id, card.revision).renderedPng;
  const workArea = screen.getDisplayMatching(source.getBounds()).workArea;
  const receiver = new BrowserWindow({
    x: workArea.x + 16,
    y: workArea.y + 16,
    width: Math.min(420, workArea.width - 32),
    height: 240,
    show: false,
    frame: false,
    alwaysOnTop: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  let worker: Worker | undefined;
  try {
    await receiver.loadURL(
      'data:text/html,<title>Imnota synthetic PNG receiver</title><body style="margin:0;background:white;color:black;min-height:100vh">Drop synthetic fixture PNG here</body>',
    );
    await receiver.webContents.executeJavaScript(`(() => {
      window.__imnotaQuickDrop = new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('Native PNG drop was not observed within 15000ms')), 15000);
        document.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect='copy'; });
        document.addEventListener('drop', async event => {
          event.preventDefault();
          try {
            const files = [...event.dataTransfer.files];
            if (files.length !== 1 || files[0].size > 100000000) throw new Error('Native drag did not deliver exactly one bounded file');
            const data = await new Promise((done, fail) => { const reader = new FileReader();reader.onload=()=>done(reader.result);reader.onerror=()=>fail(new Error('Dropped PNG could not be read'));reader.readAsDataURL(files[0]); });
            clearTimeout(deadline); resolve({ name: files[0].name, type: files[0].type, data });
          } catch (error) { clearTimeout(deadline); reject(error); }
        }, {once:true});
      });
      window.__imnotaQuickDrop.catch(()=>{});
    })()`);
    receiver.showInactive();
    source.show();
    source.focus();
    const rect = await driver.evaluate<{ x: number; y: number }>(
      `(()=>{const button=[...document.querySelectorAll(${smokeStringLiteral(selector)})].find(button=>button.textContent==='Drag PNG');const bounds=button.getBoundingClientRect();return {x:Math.round(bounds.x+bounds.width/2),y:Math.round(bounds.y+bounds.height/2)};})()`,
    );
    const origin = source.getContentBounds(),
      target = receiver.getContentBounds();
    const restore = screen.getCursorScreenPoint();
    const globalPoints = {
      start: { x: origin.x + rect.x, y: origin.y + rect.y },
      end: {
        x: target.x + Math.round(target.width / 2),
        y: target.y + Math.round(target.height / 2),
      },
      restore,
    };
    let completed: Promise<void>;
    if (process.platform === 'win32') {
      const workerData = {
        start: screen.dipToScreenPoint(globalPoints.start),
        end: screen.dipToScreenPoint(globalPoints.end),
        restore: screen.dipToScreenPoint(restore),
      };
      worker = new Worker(new URL('./windows-quick-drag-input.js', import.meta.url), { workerData });
      completed = new Promise<void>((resolve, reject) => {
        worker!.once('error', reject);
        worker!.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`Native drag input worker exited ${code}`)),
        );
      });
    } else {
      // Quartz uses the same top-left global point coordinates as Electron on macOS.
      completed = macDragInput(globalPoints);
    }
    const [, delivered] = await Promise.all([
      completed,
      receiver.webContents.executeJavaScript('window.__imnotaQuickDrop') as Promise<{
        name: string;
        type: string;
        data: string;
      }>,
    ]);
    if (
      delivered.name !== 'Capture.png' ||
      delivered.type !== 'image/png' ||
      !delivered.data.startsWith('data:image/png;base64,') ||
      !Buffer.from(delivered.data.slice('data:image/png;base64,'.length), 'base64').equals(expected)
    )
      throw new Error('Native drag delivered different PNG bytes to the synthetic receiver.');
  } finally {
    if (process.platform === 'win32') createWindowsSmokePointer().up();
    if (worker) await worker.terminate();
    receiver.destroy();
  }
}
