/**
 * Byte-level PNG checks shared by the main process and renderer. Pure `Uint8Array` code:
 * no Node `Buffer`, no decoding. Callers keep their own limits and user-facing messages.
 */

export const PNG_SIGNATURE: readonly number[] = [137, 80, 78, 71, 13, 10, 26, 10];
/** Signature plus one complete IHDR chunk (length, type, 13 data bytes, CRC). */
export const PNG_HEADER_BYTES = 33;

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compression: number;
  filter: number;
  interlace: number;
}

export function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * The IHDR fields when `bytes` starts with the PNG signature followed by a 13-byte IHDR
 * chunk; otherwise undefined. The CRC is not checked here; `validatePng` does that.
 */
export function readPngHeader(bytes: Uint8Array): PngHeader | undefined {
  if (bytes.length < PNG_HEADER_BYTES || !hasPngSignature(bytes)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || chunkType(bytes, 12) !== 'IHDR') return undefined;
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
    compression: bytes[26],
    filter: bytes[27],
    interlace: bytes[28],
  };
}

/** Whether both sides are non-zero and inside the caller's edge and pixel-count limits. */
export function pngDimensionsWithin(
  width: number,
  height: number,
  limits: { maxEdge: number; maxPixels: number },
): boolean {
  return (
    width >= 1 &&
    height >= 1 &&
    width <= limits.maxEdge &&
    height <= limits.maxEdge &&
    width * height <= limits.maxPixels
  );
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++)
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

export interface PngValidationPolicy {
  /** Inclusive byte bounds; failures report `size`. The minimum never drops below a full header. */
  minBytes?: number;
  maxBytes?: number;
  maxEdge: number;
  maxPixels: number;
  /** Exact dimensions the caller reserved; a difference reports `dimension-mismatch`. */
  expected?: { width: number; height: number };
  /** When set, IHDR must use 8-bit samples, one of these color types, and standard methods. */
  allowedColorTypes?: readonly number[];
  /** Reject a second IHDR chunk anywhere after the first. */
  rejectRepeatedHeader?: boolean;
  /** Maximum chunk count including IHDR and IEND. */
  maxChunks?: number;
}

export type PngValidationFailure =
  | { reason: 'size' }
  | { reason: 'signature' }
  | { reason: 'header' }
  | { reason: 'dimensions' }
  | { reason: 'dimension-mismatch' }
  | { reason: 'encoding' }
  | { reason: 'truncated' }
  | { reason: 'truncated-chunk' }
  | { reason: 'crc'; chunkType: string }
  | { reason: 'too-many-chunks' }
  | { reason: 'repeated-header' }
  | { reason: 'end-not-empty' }
  /** `trailing` reports whether more bytes followed this early IEND. */
  | { reason: 'end-before-data'; trailing: boolean }
  | { reason: 'trailing-data' }
  | { reason: 'incomplete' };

export type PngValidationResult = { ok: true; header: PngHeader } | ({ ok: false } & PngValidationFailure);

/**
 * Structural validation without decoding: signature, IHDR limits, every chunk's bounds and
 * CRC, at least one IDAT before an empty IEND, and nothing after IEND. Checks run in that
 * order, so an input with several defects reports the first one found.
 */
export function validatePng(bytes: Uint8Array, policy: PngValidationPolicy): PngValidationResult {
  const fail = (failure: PngValidationFailure): PngValidationResult => ({ ok: false, ...failure });
  const minBytes = Math.max(policy.minBytes ?? 0, PNG_HEADER_BYTES);
  if (bytes.length < minBytes || (policy.maxBytes !== undefined && bytes.length > policy.maxBytes))
    return fail({ reason: 'size' });
  if (!hasPngSignature(bytes)) return fail({ reason: 'signature' });
  const header = readPngHeader(bytes);
  if (!header) return fail({ reason: 'header' });
  if (!pngDimensionsWithin(header.width, header.height, policy)) return fail({ reason: 'dimensions' });
  if (policy.expected && (header.width !== policy.expected.width || header.height !== policy.expected.height))
    return fail({ reason: 'dimension-mismatch' });
  if (
    policy.allowedColorTypes &&
    (header.bitDepth !== 8 ||
      !policy.allowedColorTypes.includes(header.colorType) ||
      header.compression !== 0 ||
      header.filter !== 0 ||
      (header.interlace !== 0 && header.interlace !== 1))
  )
    return fail({ reason: 'encoding' });

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  let chunks = 0;
  let sawData = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return fail({ reason: 'truncated' });
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) return fail({ reason: 'truncated-chunk' });
    const type = chunkType(bytes, offset + 4);
    const crcOffset = offset + 8 + length;
    if (view.getUint32(crcOffset) !== crc32(bytes.subarray(offset + 4, crcOffset)))
      return fail({ reason: 'crc', chunkType: type });
    chunks += 1;
    if (policy.maxChunks !== undefined && chunks > policy.maxChunks)
      return fail({ reason: 'too-many-chunks' });
    offset = crcOffset + 4;
    if (type === 'IHDR' && chunks > 1 && policy.rejectRepeatedHeader)
      return fail({ reason: 'repeated-header' });
    if (type === 'IDAT') sawData = true;
    else if (type === 'IEND') {
      if (length !== 0) return fail({ reason: 'end-not-empty' });
      if (!sawData) return fail({ reason: 'end-before-data', trailing: offset !== bytes.length });
      return offset === bytes.length ? { ok: true, header } : fail({ reason: 'trailing-data' });
    }
  }
  return fail({ reason: 'incomplete' });
}
