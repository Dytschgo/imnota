import type { ShortcutPlatform } from '../../shared/shortcuts';
import type { WindowsCopyVariantId } from '../../shared/workflow-bridge';

export function copyVariantLabels(
  platform: ShortcutPlatform,
): Record<WindowsCopyVariantId, { label: string; detail: string }> {
  return {
    files: { label: 'Copy files', detail: 'MD + PNG files' },
    'files-rich':
      platform === 'mac'
        ? { label: 'Files + text', detail: 'MD + PNG files + Markdown' }
        : { label: 'Files + rich copy', detail: 'Files, text + image' },
    rich: { label: 'Rich copy', detail: 'Text + image' },
  };
}
