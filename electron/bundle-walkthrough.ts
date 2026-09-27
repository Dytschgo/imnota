import { nativeImage, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { nativeClipboard } from './native-clipboard.js';
import { NativeUiDriver, type SmokeCapture } from './smoke-native-driver.js';

/** Optional, fixture-only evidence capture for the real bundle UI. */
export class BundleWalkthrough {
  private steps: Array<{ image: string; title: string; observation: string }> = [];
  private sampling = false;
  private sampler?: Promise<void>;
  private samplingError?: unknown;
  private phases = new Set<string>();

  constructor(
    private readonly driver: NativeUiDriver,
    private readonly directory: string,
    private readonly artifacts: SmokeCapture[],
  ) {}

  async capture(title: string, observation: string): Promise<void> {
    const filename = `walkthrough-${String(this.steps.length + 1).padStart(2, '0')}.png`;
    this.artifacts.push(await this.driver.capture(this.directory, filename));
    this.steps.push({ image: filename, title, observation });
    await this.save();
  }

  private async save(): Promise<void> {
    await fs.writeFile(path.join(this.directory, 'walkthrough.json'), JSON.stringify(this.steps, null, 2));
  }

  startProgressCapture(): void {
    this.sampling = true;
    this.sampler = (async () => {
      while (this.sampling) {
        const readPhase = () =>
          this.driver.evaluate<string | undefined>(`(() => {
          const status = document.querySelector('.prompt-sharing-progress');
          return [...(status?.classList ?? [])].find(name => name.startsWith('prompt-sharing-progress-'))?.replace('prompt-sharing-progress-', '');
        })()`);
        const phase = await readPhase();
        if (
          phase &&
          !this.phases.has(phase) &&
          ['planning', 'rendering', 'writing', 'copying'].includes(phase)
        ) {
          // Let the compositor present the DOM state before reading its pixels.
          await this.driver.evaluate(
            'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
          );
          if (phase !== (await readPhase())) continue;
          const image = await this.driver.browserWindow.webContents.capturePage();
          if (!image.isEmpty() && phase === (await readPhase())) {
            const filename = `live-${phase}.png`;
            await fs.writeFile(path.join(this.directory, filename), image.toPNG(), { flag: 'wx' });
            this.phases.add(phase);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    })().catch((error) => {
      this.samplingError = error;
    });
  }

  async stopProgressCapture(): Promise<void> {
    if (!this.sampler) return;
    this.sampling = false;
    await this.sampler;
    this.sampler = undefined;
    if (this.samplingError) throw this.samplingError;
    await fs.writeFile(path.join(this.directory, 'live-phases.json'), JSON.stringify([...this.phases]));
  }

  async inspectOpening(): Promise<void> {
    await this.driver.resize({ width: 1280, height: 800 });
    const cardCount = await this.driver.evaluate<number>(
      'document.querySelectorAll("[data-testid=prompt-bundle-card]").length',
    );
    await this.capture(
      'Open Export bundles',
      `The toolbar opens a plan with ${cardCount} cards. No export files have been generated yet.`,
    );
    await this.driver.click({ selector: '.prompt-sharing-info summary' });
    await this.capture(
      'Copying help',
      'Help explains clipboard formats, receiving-app compatibility, file paths and explicit Open actions.',
    );
    await this.driver.click({ selector: '.prompt-sharing-info summary' });
    await this.menu();
    await this.capture(
      'Copy options',
      process.platform === 'win32'
        ? 'Copy format above the cards changes the default. Every menu item is an immediate action.'
        : 'The menu contains immediate single-format and file actions.',
    );
    await this.driver.press('Down');
    await this.driver.press('Escape');
    const focus = await this.driver.evaluate<string | null>(
      'document.activeElement?.getAttribute("aria-label")',
    );
    if (focus !== 'Copy options') throw new Error(`Copy menu did not restore focus: ${focus}`);
    await this.preview('before exporting');
  }

  async menu(): Promise<void> {
    await this.driver.click({ selector: '[data-bundle-number="1"] button[aria-label="Copy options"]' });
    await this.driver.waitFor({ selector: '[role="menu"]' });
  }

  async option(label: string): Promise<void> {
    await this.menu();
    await this.driver.click({ selector: '[role="menuitem"]', text: label, exact: true });
  }

  async idle(): Promise<void> {
    await this.driver.waitFor(
      { selector: '[data-testid="prompt-sharing-dialog"][aria-busy="false"]' },
      { timeoutMs: 60_000 },
    );
  }

  async preview(when: string): Promise<void> {
    await this.driver.click({ selector: '[aria-label="Open full bundle preview for Bundle 1"]' });
    await this.driver.waitFor({ selector: '[data-testid="prompt-large-preview"] img' });
    for (const label of ['Fit image', 'Fit width', 'Actual size']) {
      await this.driver.click({ selector: '.prompt-preview-controls button', text: label, exact: true });
      const selected = await this.driver.evaluate<boolean>(
        `[...document.querySelectorAll('.prompt-preview-controls button')].some(button => button.textContent.trim() === ${JSON.stringify(label)} && button.getAttribute('aria-pressed') === 'true')`,
      );
      if (!selected) throw new Error(`Preview scale did not change to ${label}.`);
      await this.capture(
        `Preview: ${label}`,
        `Real rendered Bundle 1 ${when}; the preview is an image, while the card thumbnail shows its first source picture.`,
      );
    }
    await this.driver.press('Escape');
    await this.driver.waitFor({ selector: '[data-testid="prompt-preview-close"]' }, { absent: true });
    await this.driver.waitFor({ selector: '[data-testid="prompt-sharing-dialog"]' });
  }

  async inspectSaved(markdownPath: string, pngPath: string): Promise<void> {
    const expectedText = await fs.readFile(markdownPath, 'utf8');
    const expectedImage = nativeImage.createFromBuffer(await fs.readFile(pngPath));
    const assertImage = async () => {
      const image = await nativeClipboard.readImage();
      if (
        image.isEmpty() ||
        JSON.stringify(image.getSize()) !== JSON.stringify(expectedImage.getSize()) ||
        !image.toBitmap().equals(expectedImage.toBitmap())
      )
        throw new Error('PNG-only copy differs from the generated image.');
    };
    await this.driver.click({ selector: '[data-bundle-number="1"] .prompt-bundle-files summary' });
    await this.capture(
      'Generated files',
      'The disclosure shows the actual Markdown and PNG filenames saved for Bundle 1.',
    );
    await this.driver.click({ selector: '[data-bundle-number="1"] .prompt-bundle-files summary' });
    await this.option('Copy Markdown');
    await this.driver.waitFor({
      selector: '[data-bundle-number="1"] [role="status"]',
      text: 'Last copied: Markdown',
    });
    if ((await nativeClipboard.readText()) !== expectedText)
      throw new Error('Markdown-only action changed exported text.');
    await this.capture(
      'Copy Markdown',
      'The immediate menu action copies the exact saved Markdown and reports Markdown copied.',
    );
    await this.option('Copy PNG');
    await this.driver.waitFor({
      selector: '[data-bundle-number="1"] [role="status"]',
      text: 'Last copied: Image',
    });
    await assertImage();
    await this.capture(
      'Copy PNG',
      'The immediate menu action copies the rendered image and reports Image copied.',
    );
    await this.option('Copy file paths');
    await this.driver.waitFor({
      selector: '[data-bundle-number="1"] [role="status"]',
      text: 'Last copied: File paths',
    });
    const copiedPaths = await nativeClipboard.readText();
    if (!copiedPaths.includes(markdownPath) || !copiedPaths.includes(pngPath))
      throw new Error('File paths do not identify the generated pair.');
    await this.capture(
      'Copy file paths',
      'Copies filesystem paths as text. This is different from attaching files.',
    );

    const openPath = shell.openPath;
    const opened: string[] = [];
    // Verify the OS handoff without opening disposable fixtures in desktop apps.
    shell.openPath = async (target) => {
      opened.push(target);
      return '';
    };
    try {
      await this.option('Open files');
      await this.driver.waitFor({ selector: '[role="menu"]' }, { absent: true });
      await this.idle();
      await this.driver.click({ text: 'Open export folder', exact: true });
      await this.idle();
      const deadline = Date.now() + 5000;
      while (opened.length < 3 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
      if (JSON.stringify(opened) !== JSON.stringify([pngPath, markdownPath, path.dirname(markdownPath)]))
        throw new Error(`Open actions did not dispatch the saved export folder: ${JSON.stringify(opened)}`);
      await fs.writeFile(
        path.join(this.directory, 'open-action-dispatches.json'),
        JSON.stringify(opened, null, 2),
      );
    } finally {
      shell.openPath = openPath;
    }
    await this.capture(
      'Open actions',
      'Both buttons were exercised through the production controller. The OS-launch boundary was intercepted and recorded; no claim is made about Explorer or an external editor.',
    );

    const heldPath = `${pngPath}.walkthrough-held`;
    await fs.rename(pngPath, heldPath);
    try {
      await nativeClipboard.writeText('Preserve clipboard on missing-file error');
      await this.option('Copy PNG');
      await this.driver.waitFor({ selector: '.prompt-sharing-error' });
      if ((await nativeClipboard.readText()) !== 'Preserve clipboard on missing-file error')
        throw new Error('A rejected copy changed the clipboard.');
      const errorState = await this.driver.evaluate<{
        alerts: number;
        copied: number;
        detailsOpen: boolean;
      }>(`(() => {
        const dialog = document.querySelector('[data-testid="prompt-sharing-dialog"]');
        return { alerts: document.querySelectorAll('[role="alert"]').length,
          copied: dialog.querySelectorAll('.is-copied').length,
          detailsOpen: Boolean(dialog.querySelector('.prompt-sharing-error details[open]')) };
      })()`);
      if (errorState.alerts !== 1 || errorState.copied !== 0 || errorState.detailsOpen)
        throw new Error('Missing-file error is duplicated, retains copied status, or exposes raw details.');
      await this.capture(
        'Missing-file error',
        'Fault injection: one synthetic generated PNG was temporarily moved. Copy fails, preserves the clipboard, and shows one readable error with Rebuild bundles.',
      );
      await this.driver.click({ text: 'Rebuild bundles', exact: true });
      await this.idle();
      await this.driver.waitFor({ selector: '.prompt-sharing-error' }, { absent: true });
    } finally {
      await fs.rename(heldPath, pngPath);
    }
    await this.option('Copy PNG');
    await this.driver.waitFor({
      selector: '[data-bundle-number="1"] [role="status"]',
      text: 'Last copied: Image',
    });
    await this.driver.waitFor({ selector: '.prompt-sharing-error' }, { absent: true });
    await this.idle();
    await assertImage();
    await this.capture(
      'Recover with Rebuild bundles',
      'Rebuild generates a new complete export. Copy PNG then succeeds with the same rendered content; the original export is preserved.',
    );
  }

  async inspectHosted(): Promise<void> {
    await this.driver.click({ text: 'Share online', exact: true });
    await this.driver.waitFor({ selector: '.hosted-share' }, { timeoutMs: 60_000 });
    const consentState = await this.driver.evaluate<boolean>(`(() => {
      const create = [...document.querySelectorAll('.hosted-share button')].find(button => button.textContent.trim() === 'Create link');
      return Boolean(create?.disabled && document.querySelector('.hosted-share [role="switch"]')?.getAttribute('aria-checked') === 'false');
    })()`);
    if (!consentState) throw new Error('Hosted sharing was enabled before consent.');
    await this.capture(
      'Share online: review',
      'Opening this screen reuses the validated current local export. Upload has not been requested. Consent is off and Create link is disabled.',
    );
    await this.driver.click({ selector: '.hosted-share-file-details summary' });
    await this.driver.click({ selector: '.hosted-share-info summary' });
    await this.driver.click({ selector: '.hosted-share-expiry-choices label', text: '7 days', exact: true });
    await this.driver.click({ selector: '.hosted-share-pairing-toggle' });
    await this.capture(
      'Share online: choices',
      'Included files, expiry, consent, privacy explanation, and optional pairing-code entry. No pairing page or upload was triggered.',
    );
    await this.driver.click({ selector: '[data-testid="hosted-share-close"]' });
    await this.driver.waitFor({ selector: '.hosted-share' }, { absent: true });
  }
}
