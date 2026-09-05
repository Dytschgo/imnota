import {
  clipboardPngDimensions,
  contactSheetLayout,
  MAX_CLIPBOARD_PNG_LENGTH,
} from '../shared/clipboard-context';

export interface AnnotatedClipboardImage {
  filename: string;
  dataUrl: string;
}

/** Input is already rendered/cropped/masked PNG output; never source screenshots. */
export async function prepareClipboardImage(images: AnnotatedClipboardImage[]): Promise<string> {
  if (!images.length) throw new Error('No screenshots are selected. Copy the Markdown text instead.');
  if (images.length > 20)
    throw new Error('Too many screenshots to combine. Attach the exported PNG files instead.');
  const sizes = images.map((image) => clipboardPngDimensions(image.dataUrl));
  if (images.length === 1) return images[0].dataUrl;
  const layout = contactSheetLayout(sizes);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  try {
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('The combined image could not be prepared. Copy the individual images instead.');
    // Export artwork uses fixed high-contrast paper/ink, independent of UI theme.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = '18px sans-serif';
    context.fillStyle = '#17191f';
    for (let index = 0; index < images.length; index++) {
      const bitmap = new Image();
      try {
        bitmap.src = images[index].dataUrl;
        await bitmap.decode();
        if (bitmap.naturalWidth !== sizes[index].width || bitmap.naturalHeight !== sizes[index].height)
          throw new Error('The annotated PNG dimensions are inconsistent. Export it again.');
        const item = layout.items[index];
        context.save();
        context.beginPath();
        context.rect(16, item.labelY - 24, canvas.width - 32, 40);
        context.clip();
        context.fillText(`Screenshot ${index + 1}: ${images[index].filename}`, 16, item.labelY);
        context.restore();
        context.drawImage(bitmap, item.x, item.y);
      } finally {
        bitmap.src = '';
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const result = canvas.toDataURL('image/png');
    if (!result.startsWith('data:image/png;base64,') || result.length > MAX_CLIPBOARD_PNG_LENGTH)
      throw new Error('The combined image is too large. Attach the individual PNG files instead.');
    return result;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
