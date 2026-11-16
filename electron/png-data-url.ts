export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

const BASE64_TAIL = /^[A-Za-z0-9+/]{0,3}$/;

/**
 * Decodes `data:image/png;base64,<payload>` and returns undefined unless the whole string
 * matches `^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$`, the pattern IPC boundaries used
 * before. That regex took about 45 ms per 8 MiB image; this check uses native base64 decode
 * and encode plus string comparison instead. It accepts exactly the same strings (including
 * unpadded and non-canonical trailing bits) and decodes them exactly as `Buffer.from` did.
 * Does not check that the bytes are a PNG.
 */
export function decodePngDataUrl(value: string): Buffer | undefined {
  if (typeof value !== 'string' || !value.startsWith(PNG_DATA_URL_PREFIX)) return undefined;
  // At most two trailing '=' belong to the pattern; any other '=' is outside its alphabet.
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const end = Math.max(value.length - padding, PNG_DATA_URL_PREFIX.length);
  const body = value.slice(PNG_DATA_URL_PREFIX.length, end);
  if (!body.length || body.includes('=')) return undefined;
  const decoded = Buffer.from(value.slice(PNG_DATA_URL_PREFIX.length), 'base64');
  // Node's decoder skips or reinterprets characters outside the standard alphabet
  // (whitespace, '-', '_', ...), so every complete 4-character group must re-encode to
  // itself. A partial final group may carry non-zero spare bits; check its alphabet only.
  const complete = body.length - (body.length % 4);
  const encoded = decoded.toString('base64');
  if (encoded.length < complete || encoded.slice(0, complete) !== body.slice(0, complete)) return undefined;
  return BASE64_TAIL.test(body.slice(complete)) ? decoded : undefined;
}

export function isPngDataUrl(value: string): boolean {
  return decodePngDataUrl(value) !== undefined;
}
