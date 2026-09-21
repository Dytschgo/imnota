import { createRequire } from 'node:module';

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_SHIFT = 0x10;
const VK_F9 = 0x78;

export const WINDOWS_SMOKE_CAPTURE_SHORTCUT = 'Ctrl+Alt+Shift+F9';

interface KoffiLibrary {
  func(name: string, result: string, parameters: readonly string[]): (...args: unknown[]) => unknown;
}

interface KoffiModule {
  load(name: string): KoffiLibrary;
}

export interface WindowsSendInputApi {
  sendInput(count: number, inputs: Buffer, inputSize: number): number;
  getLastError(): number;
}

interface KeyboardInput {
  virtualKey: number;
  keyUp?: boolean;
}

export interface WindowsKeyboardInputs {
  buffer: Buffer;
  count: number;
  inputSize: number;
}

function loadKoffi(): KoffiModule {
  const packageName =
    process.arch === 'x64'
      ? '@koromix/koffi-win32-x64'
      : process.arch === 'arm64'
        ? '@koromix/koffi-win32-arm64'
        : undefined;
  if (!packageName) throw new Error(`Windows native smoke input is unavailable on ${process.arch}.`);
  return createRequire(import.meta.url)(packageName) as KoffiModule;
}

function loadWindowsSendInputApi(): WindowsSendInputApi {
  if (process.platform !== 'win32')
    throw new Error('Windows native smoke input is available only on Windows.');
  const koffi = loadKoffi();
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const SendInput = user32.func('SendInput', 'uint32_t', ['uint32_t', 'void *', 'int']);
  const GetLastError = kernel32.func('GetLastError', 'uint32_t', []);
  return {
    sendInput: (count, inputs, inputSize) => Number(SendInput(count, inputs, inputSize)),
    getLastError: () => Number(GetLastError()),
  };
}

export function windowsKeyboardInputs(
  inputs: readonly KeyboardInput[],
  pointerBytes: 4 | 8 = process.arch === 'ia32' ? 4 : 8,
): WindowsKeyboardInputs {
  const inputSize = pointerBytes === 8 ? 40 : 28;
  const unionOffset = pointerBytes === 8 ? 8 : 4;
  const buffer = Buffer.alloc(inputSize * inputs.length);
  inputs.forEach((input, index) => {
    const offset = index * inputSize;
    buffer.writeUInt32LE(INPUT_KEYBOARD, offset);
    buffer.writeUInt16LE(input.virtualKey, offset + unionOffset);
    buffer.writeUInt32LE(input.keyUp ? KEYEVENTF_KEYUP : 0, offset + unionOffset + 4);
  });
  return { buffer, count: inputs.length, inputSize };
}

export function sendWindowsSmokeCaptureShortcut(api: WindowsSendInputApi = loadWindowsSendInputApi()): void {
  const inputs = windowsKeyboardInputs([
    { virtualKey: VK_CONTROL },
    { virtualKey: VK_MENU },
    { virtualKey: VK_SHIFT },
    { virtualKey: VK_F9 },
    { virtualKey: VK_F9, keyUp: true },
    { virtualKey: VK_SHIFT, keyUp: true },
    { virtualKey: VK_MENU, keyUp: true },
    { virtualKey: VK_CONTROL, keyUp: true },
  ]);
  const inserted = api.sendInput(inputs.count, inputs.buffer, inputs.inputSize);
  if (inserted !== inputs.count) {
    const error = api.getLastError();
    const releases = windowsKeyboardInputs([
      { virtualKey: VK_F9, keyUp: true },
      { virtualKey: VK_SHIFT, keyUp: true },
      { virtualKey: VK_MENU, keyUp: true },
      { virtualKey: VK_CONTROL, keyUp: true },
    ]);
    api.sendInput(releases.count, releases.buffer, releases.inputSize);
    throw new Error(
      `Windows SendInput inserted ${inserted} of ${inputs.count} capture shortcut events (error ${error}).`,
    );
  }
}
