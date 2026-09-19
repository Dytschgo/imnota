import type { ClipboardFormatsReport } from '../../shared/workflow-bridge';
import type { PromptDeliveryOutcome } from './PromptBundleCard';

export interface CombinedDeliveryDescription {
  outcome: PromptDeliveryOutcome;
  /** Shown on the card when the clipboard holds less than the combined write requested. */
  warning?: string;
}

function describeVerifiedClipboard(placed: ClipboardFormatsReport): string {
  if (placed.text && placed.image) return 'Markdown and image formats were confirmed on the clipboard.';
  if (placed.text) return 'Only Markdown was confirmed on the clipboard.';
  if (placed.image) return 'Only the image was confirmed on the clipboard.';
  if (placed.html) return 'Only HTML was confirmed on the clipboard.';
  return 'No clipboard format was confirmed.';
}

/**
 * Turns the clipboard read-back into what the card may claim. Imnota reports
 * only formats the operating system confirmed; it never promises that the
 * receiving app pastes both, and it points at the separate fallback for the
 * missing format.
 */
export function describeCombinedDelivery(
  placed: ClipboardFormatsReport | undefined,
  hasImage: boolean,
): CombinedDeliveryDescription {
  if (!hasImage) return { outcome: 'markdown' };
  if (placed?.fileHandoff === 'opened')
    return {
      outcome: 'files',
      warning: `${describeVerifiedClipboard(placed)} Imnota opened the generated folder with the Markdown and PNG selected so you can attach both files reliably.`,
    };
  if (placed?.fileHandoff === 'failed')
    return {
      outcome: 'files',
      warning: `${describeVerifiedClipboard(placed)} The generated Markdown and PNG could not be opened and selected. Use Open export folder or the separate copy actions.`,
    };
  if (placed?.text && placed.image) return { outcome: 'combined' };
  if (!placed)
    return {
      outcome: 'files',
      warning:
        'The clipboard result could not be confirmed. Use Copy Markdown and Copy image separately, or open the generated files.',
    };
  if (placed.text)
    return {
      outcome: 'markdown',
      warning:
        'The clipboard kept only the Markdown, not the image. Paste the text, then use Copy image for the picture, or open the generated files.',
    };
  if (placed.image)
    return {
      outcome: 'image',
      warning:
        'The clipboard kept only the image, not the Markdown. Paste the picture, then use Copy Markdown for the text, or open the generated files.',
    };
  return {
    outcome: 'files',
    warning:
      'The clipboard could not confirm any copied format. Use Copy Markdown and Copy image separately, or open the generated files.',
  };
}

/** Status line for the compact combined copy control. */
export function describeCombinedCopyMessage(placed: ClipboardFormatsReport): string {
  if (placed.fileHandoff === 'opened')
    return `${describeVerifiedClipboard(placed)} Imnota also opened the generated folder with the Markdown and PNG selected for attachment.`;
  if (placed.fileHandoff === 'failed')
    return `${describeVerifiedClipboard(placed)} The generated Markdown and PNG could not be opened and selected; use the separate actions below.`;
  if (placed.text && placed.image)
    return 'Text and image are on the clipboard. Check that both appear after pasting; some apps accept only one.';
  if (placed.text) return 'Only the text reached the clipboard. Use the separate image copy for the picture.';
  if (placed.image)
    return 'Only the image reached the clipboard. Use the separate Markdown copy for the text.';
  return 'The clipboard could not confirm the copy. Use the separate copy actions below.';
}
