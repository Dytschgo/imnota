import { useEffect, useState } from 'react';

export function useDecodedImage(dataUrl: string | undefined) {
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setImageObj(null);
    setDecodeFailed(false);
    if (!dataUrl) return;
    const next = new window.Image();
    let cancelled = false;
    next.onload = () => {
      if (!cancelled) setImageObj(next);
    };
    next.onerror = () => {
      if (!cancelled) setDecodeFailed(true);
    };
    next.src = dataUrl;
    return () => {
      cancelled = true;
    };
  }, [dataUrl, attempt]);
  return { imageObj, decodeFailed, retryDecode: () => setAttempt((value) => value + 1) };
}
