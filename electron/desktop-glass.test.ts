import { describe, expect, it } from 'vitest';
import { desktopMaterial } from './desktop-glass.js';
describe('desktop glass capability', () => {
  it('uses native macOS vibrancy and Windows 11 22H2 acrylic only', () => {
    expect(desktopMaterial('darwin', '24.0.0')).toBe('vibrancy');
    expect(desktopMaterial('win32', '10.0.22621')).toBe('acrylic');
    expect(desktopMaterial('win32', '10.0.19045')).toBeNull();
    expect(desktopMaterial('win32', 'invalid')).toBeNull();
    expect(desktopMaterial('linux', '6.8.0')).toBeNull();
  });
});
