export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

const BASE64_TAIL = /^[A-Za-z0-9+/]{0,3}$/;
/** Bytes re-encoded per comparison step; a multiple of 3 so every step encodes without padding. */
const COMPARE_CHUNK_BYTES = 3 * 1024 * 1024;

/** The longest PNG data URL whose payload can decode to at most `maxBytes` bytes. */
export function maxPngDataUrlLength(maxBytes: number): number {
  return PNG_DATA_URL_PREFIX.length + Math.ceil(maxBytes / 3) * 4;
}

/**
 * Decodes `data:image/png;base64,<payload>` and returns undefined unless the whole string
 * is at most `maxLength` characters and matches `^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$`,
 * the pattern IPC boundaries used before. That regex took about 45 ms per 8 MiB image; this
 * check uses native base64 decode and encode plus string comparison instead. It accepts
 * exactly the same strings (including unpadded and non-canonical trailing bits) and decodes
 * them exactly as `Buffer.from` did. Does not check that the bytes are a PNG.
 *
 * Nothing is allocated for a string over `maxLength`, a wrong prefix, misplaced padding, or a
 * bad final partial group. Other malformed payloads allocate at most the decoded bytes (three
 * quarters of `maxLength`) and one comparison chunk before rejection.
 */
export function decodePngDataUrl(value: string, maxLength: number): Buffer | undefined {
  if (typeof value !== 'string' || value.length > maxLength || !value.startsWith(PNG_DATA_URL_PREFIX))
    return undefined;
  // At most two trailing '=' belong to the pattern; any other '=' is outside its alphabet.
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const end = Math.max(value.length - padding, PNG_DATA_URL_PREFIX.length);
  const body = value.slice(PNG_DATA_URL_PREFIX.length, end);
  if (!body.length || body.includes('=')) return undefined;
  // A partial final group may carry non-zero spare bits, so only its alphabet is checked.
  const complete = body.length - (body.length % 4);
  const tail = body.length - complete;
  if (!BASE64_TAIL.test(body.slice(complete))) return undefined;
  const decoded = Buffer.from(value.slice(PNG_DATA_URL_PREFIX.length), 'base64');
  // Node's decoder skips characters outside its alphabets (whitespace, '.', ...), which
  // shortens the output, and reads '-' and '_' as URL-safe digits. A length check catches
  // most skips; every complete group must then re-encode to itself.
  const completeBytes = (complete / 4) * 3;
  if (decoded.length !== completeBytes + Math.max(tail - 1, 0)) return undefined;
  for (let start = 0; start < completeBytes; start += COMPARE_CHUNK_BYTES) {
    const stop = Math.min(start + COMPARE_CHUNK_BYTES, completeBytes);
    if (decoded.toString('base64', start, stop) !== body.slice((start / 3) * 4, (stop / 3) * 4))
      return undefined;
  }
  return decoded;
}

export function isPngDataUrl(value: string, maxLength: number): boolean {
  return decodePngDataUrl(value, maxLength) !== undefined;
}
