import { useRef, useState } from 'react';
import { prepareClipboardImage, type AnnotatedClipboardImage } from '../clipboard-image';
import { Button } from './ui';

// Reuse the existing compact sharing controls; the compatibility warning stays
// next to the opt-in action rather than adding another settings screen.
export function CombinedContextCopy({
  markdown,
  images,
  onBusyChange,
}: {
  markdown: string;
  images: AnnotatedClipboardImage[];
  onBusyChange: (busy: boolean) => void;
}) {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function copy() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setMessage('');
    try {
      const imageDataUrl = await prepareClipboardImage(images);
      await window.imnota.copyContext({ markdown, imageDataUrl });
      setMessage(
        'Text and image are on the clipboard. Check that both appear after pasting; some apps accept only one.',
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Combined copy failed. Use the separate copy actions below.',
      );
    } finally {
      running.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="combined-copy" aria-label="Combined clipboard copy" aria-busy={busy}>
      <p>
        {images.length > 1
          ? `${images.length} screenshots will become one labelled image, at full resolution.`
          : 'Copy the annotated screenshot and Markdown together.'}
      </p>
      <p className="helper">Experimental: the receiving app may paste only text or only the image.</p>
      <Button variant="primary" busy={busy} disabled={busy || !images.length} onClick={() => void copy()}>
        Copy text + image (experimental)
      </Button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
