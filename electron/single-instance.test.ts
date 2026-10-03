// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { requiresSingleInstanceLock } from './single-instance.js';

describe('single-instance lock policy', () => {
  it('locks the interactive application', () => {
    expect(requiresSingleInstanceLock(['Imnota.exe'], {})).toBe(true);
    expect(requiresSingleInstanceLock(['electron', '.'], { IMNOTA_SMOKE: '0' })).toBe(true);
  });

  it('lets an editor spawn the stdio MCP server beside a running instance', () => {
    expect(requiresSingleInstanceLock(['Imnota.exe', '--mcp'], {})).toBe(false);
  });

  it('leaves isolated smoke and packaged verification profiles unlocked', () => {
    expect(requiresSingleInstanceLock(['Imnota.exe'], { IMNOTA_SMOKE: '1' })).toBe(false);
    expect(requiresSingleInstanceLock(['Imnota.exe', '--mcp'], { IMNOTA_SMOKE: '1' })).toBe(false);
  });
});
