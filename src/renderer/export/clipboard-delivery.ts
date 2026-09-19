import type { ClipboardFormatsReport, WindowsCopyVariantId } from '../../shared/workflow-bridge';
import type { PromptDeliveryOutcome } from './PromptBundleCard';

export interface CombinedDeliveryDescription {
  outcome: PromptDeliveryOutcome;
  warning?: string;
}

function verifiedFormats(placed: ClipboardFormatsReport): string[] {
  return [
    placed.files ? 'files' : undefined,
    placed.text ? 'Markdown' : undefined,
    placed.html ? 'HTML' : undefined,
    placed.image ? 'image' : undefined,
  ].filter((format): format is string => Boolean(format));
}

function sentenceList(items: readonly string[]): string {
  if (!items.length) return 'No requested format was confirmed on the clipboard.';
  if (items.length === 1 && items[0] === 'files') return 'Files were confirmed on the clipboard.';
  if (items.length === 1) return `${items[0]} was confirmed on the clipboard.`;
  const displayed = [...items];
  displayed[0] = `${displayed[0][0].toUpperCase()}${displayed[0].slice(1)}`;
  return `${displayed.slice(0, -1).join(', ')} and ${displayed.at(-1)} were confirmed on the clipboard.`;
}

export function describeCopyDelivery(
  variant: WindowsCopyVariantId,
  placed: ClipboardFormatsReport | undefined,
  hasImage: boolean,
): CombinedDeliveryDescription {
  if (!hasImage) return { outcome: 'markdown' };
  if (!placed)
    return {
      outcome: 'files',
      warning: 'The clipboard result could not be confirmed. Try a separate copy action.',
    };
  const confirmed = sentenceList(verifiedFormats(placed));
  if (variant === 'files')
    return placed.files
      ? {
          outcome: 'files',
          warning: `${confirmed} The receiving app still decides whether paste accepts file attachments.`,
        }
      : {
          outcome: 'files',
          warning: `${confirmed} Use Copy file paths or Open files instead.`,
        };
  if (variant === 'files-rich') {
    const complete = placed.files && placed.text && placed.html && placed.image;
    return {
      outcome: placed.files ? 'files' : placed.text && placed.image ? 'combined' : 'files',
      warning: complete
        ? `${confirmed} The receiving app chooses which of these formats it pastes.`
        : `${confirmed} Try another comparison option or a separate copy action.`,
    };
  }
  if (placed.text && placed.image) return { outcome: 'combined' };
  if (placed.text)
    return {
      outcome: 'markdown',
      warning: `${confirmed} Use Copy image only if the receiver omitted the picture.`,
    };
  if (placed.image)
    return {
      outcome: 'image',
      warning: `${confirmed} Use Copy Markdown only if the receiver omitted the text.`,
    };
  return {
    outcome: 'files',
    warning: `${confirmed} Use a separate copy action or Copy files.`,
  };
}

export function describeCopyMessage(variant: WindowsCopyVariantId, placed: ClipboardFormatsReport): string {
  const confirmed = sentenceList(verifiedFormats(placed));
  if (variant === 'files')
    return placed.files
      ? `${confirmed} Paste into the test app to see whether it accepts both attachments.`
      : `${confirmed} Try another option below.`;
  if (variant === 'files-rich')
    return `${confirmed} The test app may choose only one representation when you paste.`;
  if (placed.text && placed.image)
    return 'Markdown and image are on the clipboard. The test app may paste only one format.';
  return `${confirmed} Try another option below if the test app needs the missing format.`;
}

/** Existing compact copy surfaces use the rich variant outside the comparison UI. */
export function describeCombinedDelivery(
  placed: ClipboardFormatsReport | undefined,
  hasImage: boolean,
): CombinedDeliveryDescription {
  return describeCopyDelivery('rich', placed, hasImage);
}

export function describeCombinedCopyMessage(placed: ClipboardFormatsReport): string {
  return describeCopyMessage('rich', placed);
}
