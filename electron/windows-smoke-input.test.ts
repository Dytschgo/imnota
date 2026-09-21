// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  sendWindowsSmokeCaptureShortcut,
  windowsKeyboardInputs,
  type WindowsSendInputApi,
} from './windows-smoke-input.js';

describe('Windows native smoke input', () => {
  it('lays out 64-bit keyboard INPUT records at the native stride', () => {
    const inputs = windowsKeyboardInputs([{ virtualKey: 0x11 }, { virtualKey: 0x11, keyUp: true }], 8);
    expect(inputs.inputSize).toBe(40);
    expect(inputs.count).toBe(2);
    expect(inputs.buffer).toHaveLength(80);
    expect(inputs.buffer.readUInt32LE(0)).toBe(1);
    expect(inputs.buffer.readUInt16LE(8)).toBe(0x11);
    expect(inputs.buffer.readUInt32LE(12)).toBe(0);
    expect(inputs.buffer.readUInt32LE(40)).toBe(1);
    expect(inputs.buffer.readUInt16LE(48)).toBe(0x11);
    expect(inputs.buffer.readUInt32LE(52)).toBe(2);
  });

  it('sends the complete Ctrl+Alt+Shift+F9 press and release sequence', () => {
    const sendInput = vi.fn<(count: number, inputs: Buffer, inputSize: number) => number>(() => 8);
    const api: WindowsSendInputApi = { sendInput, getLastError: () => 0 };
    sendWindowsSmokeCaptureShortcut(api);
    expect(sendInput).toHaveBeenCalledOnce();
    const [count, buffer, inputSize] = sendInput.mock.calls[0]!;
    expect(count).toBe(8);
    expect(inputSize).toBe(40);
    expect(buffer.readUInt16LE(8)).toBe(0x11);
    expect(buffer.readUInt16LE(48)).toBe(0x12);
    expect(buffer.readUInt16LE(88)).toBe(0x10);
    expect(buffer.readUInt16LE(128)).toBe(0x78);
    expect(buffer.readUInt32LE(172)).toBe(2);
    expect(buffer.readUInt32LE(212)).toBe(2);
    expect(buffer.readUInt32LE(252)).toBe(2);
    expect(buffer.readUInt32LE(292)).toBe(2);
  });

  it('reports partial native injection with the Windows error', () => {
    const sendInput = vi.fn<(count: number, inputs: Buffer, inputSize: number) => number>(() => 0);
    const api: WindowsSendInputApi = { sendInput, getLastError: () => 5 };
    expect(() => sendWindowsSmokeCaptureShortcut(api)).toThrow(
      'Windows SendInput inserted 0 of 8 capture shortcut events (error 5).',
    );
    expect(sendInput).toHaveBeenCalledTimes(2);
    expect(sendInput.mock.calls[1]?.[0]).toBe(4);
  });
});
