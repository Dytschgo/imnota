import {
  mergePreferenceSettings,
  preferenceSettingsUpdateSchema,
} from '../src/shared/preference-settings.js';
import type { PreferenceSettingsUpdate } from '../src/shared/workflow-bridge.js';
import { desktopMaterial } from './desktop-glass.js';
import { nativePerformanceProfile } from './native-performance.js';
import { windowsFileClipboardAvailable } from './windows-clipboard.js';
import {
  MAX_OCR_DATA_URL_CHARACTERS,
  recognizeOnDevicePngDataUrl,
  windowsOcrAvailable,
} from './windows-ocr.js';
import { BrowserWindow, nativeTheme } from 'electron';
import os from 'node:os';
import { z } from 'zod';
import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';

export function registerPreferenceIpc(router: IpcRouter, host: IpcHost): void {
  const { handleWorkflow } = router;
  const {
    captureGlobalShortcut,
    cropPngForOcr,
    persistApplicationSettings,
    raiseMainWindow,
    resolvedWindowBackground,
  } = host;
  handleWorkflow('workflow:preferences:get', (_event, ...args) => {
    z.tuple([]).parse(args);
    return host.preferenceSettingsResult;
  });
  handleWorkflow(
    'workflow:preferences:set',
    async (_event, ...args) => {
      const [input] = z.tuple([preferenceSettingsUpdateSchema]).parse(args);
      const next = mergePreferenceSettings(
        host.preferenceSettingsResult.settings,
        input as PreferenceSettingsUpdate,
      );
      await persistApplicationSettings(host.settings, next);
      return host.preferenceSettingsResult;
    },
    true,
  );
  handleWorkflow('workflow:performance:get', (_event, ...args) => {
    z.tuple([]).parse(args);
    return nativePerformanceProfile();
  });
  handleWorkflow('workflow:capabilities:get', (_event, ...args) => {
    z.tuple([]).parse(args);
    return {
      windowsFileClipboard: windowsFileClipboardAvailable(),
      globalCaptureShortcutRegistered: captureGlobalShortcut.registeredAccelerator !== null,
    };
  });
  handleWorkflow('workflow:window:raise', (_event, ...args) => {
    z.tuple([]).parse(args);
    raiseMainWindow();
  });
  handleWorkflow('workflow:ocr:recognize', async (_event, ...args) => {
    if (!windowsOcrAvailable()) return { text: '' };
    const [input] = z
      .tuple([
        z
          .object({
            pngDataUrl: z.string().max(MAX_OCR_DATA_URL_CHARACTERS),
            crop: z
              .object({
                x: z.number().int().nonnegative(),
                y: z.number().int().nonnegative(),
                width: z.number().int().positive(),
                height: z.number().int().positive(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      ])
      .parse(args);
    return {
      text: await recognizeOnDevicePngDataUrl(input.pngDataUrl, {
        crop: input.crop,
        cropPng: cropPngForOcr,
      }),
    };
  });
  handleWorkflow('workflow:appearance:desktop', (event, ...args) => {
    const [input] = z.tuple([z.object({ enabled: z.boolean() }).strict()]).parse(args);
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target) return { active: false };
    const material = desktopMaterial(process.platform, os.release());
    const appearance = host.preferenceSettingsResult.settings.appearance;
    const active = Boolean(
      input.enabled &&
      material &&
      appearance.desktopGlass &&
      !appearance.backgroundImage &&
      appearance.glassLevel !== 'off' &&
      !nativeTheme.shouldUseHighContrastColors &&
      !nativeTheme.prefersReducedTransparency &&
      !nativePerformanceProfile().reducedEffectsRecommended,
    );
    try {
      if (material === 'vibrancy') target.setVibrancy(active ? 'under-window' : null);
      if (material === 'acrylic') target.setBackgroundMaterial(active ? 'acrylic' : 'none');
      target.setBackgroundColor(active ? '#00000000' : resolvedWindowBackground(appearance.mode));
      if (material === 'vibrancy') target.invalidateShadow();
      return { active };
    } catch {
      target.setBackgroundColor(resolvedWindowBackground(appearance.mode));
      return { active: false };
    }
  });
}
