import type { NativeUiDriver } from './smoke-native-driver.js';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Measure the shipped tokens through Chromium's color parser, independently of unit conversion math. */
export async function assertLightTextContrast(
  driver: NativeUiDriver,
  artifactDirectory?: string,
): Promise<void> {
  const measurements = await driver.evaluate<
    Array<{ role: string; surface: string; color: string; rgb: number[]; ratio: number }>
  >(`(() => {
    if (document.documentElement.dataset.theme !== 'light') throw new Error('Contrast requires light theme.');
    const style = getComputedStyle(document.documentElement);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Color measurement canvas is unavailable.');
    const rgb = (color) => {
      if (!CSS.supports('color', color)) throw new Error('Unsupported shipped color: ' + color);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const pixel = [...context.getImageData(0, 0, 1, 1).data];
      if (pixel[3] !== 255) throw new Error('Solid text contrast requires opaque colors.');
      return pixel.slice(0, 3);
    };
    const luminance = (channels) => channels.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return ['--text-cyan', '--text-success'].flatMap((role) => {
      const color = style.getPropertyValue(role).trim();
      const foreground = rgb(color);
      const first = luminance(foreground);
      return ['--surface', '--surface-2', '--bg'].map((surface) => {
        const second = luminance(rgb(style.getPropertyValue(surface).trim()));
        return { role, surface, color, rgb: foreground,
          ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05) };
      });
    });
  })()`);
  if (measurements.some(({ ratio }) => !Number.isFinite(ratio) || ratio < 4.5))
    throw new Error(`Shipped light text contrast is below 4.5: ${JSON.stringify(measurements)}`);
  if (artifactDirectory)
    await fs.writeFile(
      path.join(artifactDirectory, 'light-text-contrast.json'),
      JSON.stringify({ theme: 'light', minimumRatio: 4.5, measurements }, null, 2),
      { flag: 'wx' },
    );
}

/** Set the Appearance glass switch through the visible control; clicks only when the state differs. */
export async function setGlassSurfaces(driver: NativeUiDriver, on: boolean): Promise<void> {
  const selector = 'input[name="glass-surfaces"]';
  await driver.waitFor({ selector: `${selector}:not(:disabled)` });
  const checked = await driver.evaluate<boolean>(
    `document.querySelector(${JSON.stringify(selector)}).checked`,
  );
  if (checked !== on) await driver.click({ selector: `label:has(${selector})` });
  await driver.waitFor({ selector: `${selector}${on ? ':checked' : ':not(:checked)'}:not(:disabled)` });
}
