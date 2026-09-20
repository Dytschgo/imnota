import type { ClipboardFormatsReport, WindowsCopyVariantId } from '../../shared/workflow-bridge';
import type { PromptDeliveryOutcome } from './PromptBundleCard';

export interface CombinedDeliveryDescription {
  outcome?: PromptDeliveryOutcome;
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

const UNCONFIRMED_RICH_FALLBACK = 'Use Copy Markdown only, Copy image only, or Open files.';

function missingRichGuidance(placed: ClipboardFormatsReport): string {
  if (placed.text && placed.image) return '';
  if (!placed.text && !placed.image)
    return `Markdown and image were not confirmed. ${UNCONFIRMED_RICH_FALLBACK}`;
  if (!placed.image) return 'Image was not confirmed. Use Copy image only or Open files.';
  return 'Markdown was not confirmed. Use Copy Markdown only or Open files.';
}

export function describeCopyDelivery(
  variant: WindowsCopyVariantId,
  placed: ClipboardFormatsReport | undefined,
  hasImage: boolean,
): CombinedDeliveryDescription {
  if (!hasImage) return { outcome: 'markdown' };
  if (!placed)
    return {
      warning: `The clipboard result could not be confirmed. ${UNCONFIRMED_RICH_FALLBACK}`,
    };
  const confirmed = sentenceList(verifiedFormats(placed));
  if (variant === 'files')
    return placed.files
      ? {
          outcome: 'files',
          warning: `${confirmed} The receiving app still decides whether paste accepts file attachments.`,
        }
      : {
          warning: `${confirmed} Use Copy file paths or Open files instead.`,
        };
  if (variant === 'files-rich') {
    const complete = placed.files && placed.text && placed.html && placed.image;
    return {
      outcome: placed.files ? 'files' : placed.text && placed.image ? 'combined' : undefined,
      warning: complete
        ? `${confirmed} The receiving app chooses which of these formats it pastes.`
        : `${confirmed} Try another comparison option or a separate copy action.`,
    };
  }
  if (placed.text && placed.image) return { outcome: 'combined' };
  if (placed.text)
    return {
      outcome: 'markdown',
      warning: `${confirmed} ${missingRichGuidance(placed)}`,
    };
  if (placed.image)
    return {
      outcome: 'image',
      warning: `${confirmed} ${missingRichGuidance(placed)}`,
    };
  return {
    warning: `${confirmed} ${missingRichGuidance(placed)}`,
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
  return `${confirmed} ${missingRichGuidance(placed)}`;
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
