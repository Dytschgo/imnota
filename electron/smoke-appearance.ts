import type { NativeUiDriver } from './smoke-native-driver.js';

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
