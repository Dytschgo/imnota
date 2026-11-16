// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import {
  crc32,
  hasPngSignature,
  pngDimensionsWithin,
  readPngHeader,
  validatePng,
  type PngValidationPolicy,
} from './png';
import { ihdrChunk as ihdr, pngChunk as chunk, syntheticPng as png } from '../test/png-fixtures';

const policy: PngValidationPolicy = { maxEdge: 100, maxPixels: 5_000 };

describe('PNG byte checks', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('reads the signature and IHDR without decoding', () => {
    const bytes = png(7, 5);
    expect(hasPngSignature(bytes)).toBe(true);
    expect(hasPngSignature(bytes.subarray(0, 7))).toBe(false);
    expect(readPngHeader(bytes)).toEqual({
      width: 7,
      height: 5,
      bitDepth: 8,
      colorType: 6,
      compression: 0,
      filter: 0,
      interlace: 0,
    });
    // Works on a view that does not start at the beginning of its buffer.
    const offset = Buffer.concat([Buffer.from([1, 2, 3]), bytes]).subarray(3);
    expect(readPngHeader(offset)?.width).toBe(7);
    expect(readPngHeader(bytes.subarray(0, 32))).toBeUndefined();
    const badLength = Buffer.from(bytes);
    badLength.writeUInt32BE(12, 8);
    expect(readPngHeader(badLength)).toBeUndefined();
    const badType = Buffer.from(bytes);
    badType.write('IHDX', 12, 'ascii');
    expect(readPngHeader(badType)).toBeUndefined();
  });

  it('bounds dimensions by edge and pixel count', () => {
    expect(pngDimensionsWithin(100, 50, policy)).toBe(true);
    expect(pngDimensionsWithin(0, 1, policy)).toBe(false);
    expect(pngDimensionsWithin(101, 1, policy)).toBe(false);
    expect(pngDimensionsWithin(100, 51, policy)).toBe(false);
  });

  it('accepts a complete PNG and returns its header', () => {
    const result = validatePng(png(3, 4), policy);
    expect(result).toMatchObject({ ok: true, header: { width: 3, height: 4 } });
  });

  it('reports truncated input and truncated chunks', () => {
    const bytes = png();
    expect(validatePng(bytes.subarray(0, 32), policy)).toMatchObject({ ok: false, reason: 'size' });
    expect(validatePng(bytes.subarray(0, bytes.length - 1), policy)).toMatchObject({
      ok: false,
      reason: 'truncated',
    });
    const header = Buffer.from([0, 0, 0, 100, 73, 68, 65, 84]);
    expect(
      validatePng(Buffer.concat([bytes.subarray(0, 33), header, Buffer.alloc(20)]), policy),
    ).toMatchObject({
      ok: false,
      reason: 'truncated-chunk',
    });
    expect(validatePng(Buffer.concat([bytes.subarray(0, 33), Buffer.alloc(5)]), policy)).toMatchObject({
      ok: false,
      reason: 'truncated',
    });
    expect(validatePng(bytes.subarray(0, 33), policy)).toMatchObject({ ok: false, reason: 'incomplete' });
  });

  it('reports CRC failures with the chunk type', () => {
    const bytes = png();
    bytes[bytes.length - 20] ^= 0xff;
    expect(validatePng(bytes, policy)).toEqual({ ok: false, reason: 'crc', chunkType: 'IDAT' });
  });

  it('enforces byte, edge, pixel, and expected-dimension limits', () => {
    const bytes = png(10, 10);
    expect(validatePng(bytes, { ...policy, maxBytes: bytes.length - 1 })).toMatchObject({ reason: 'size' });
    expect(validatePng(bytes, { ...policy, minBytes: bytes.length + 1 })).toMatchObject({ reason: 'size' });
    expect(validatePng(png(101, 1), policy)).toMatchObject({ reason: 'dimensions' });
    expect(validatePng(png(80, 80), policy)).toMatchObject({ reason: 'dimensions' });
    expect(validatePng(png(0, 1), policy)).toMatchObject({ reason: 'dimensions' });
    expect(validatePng(bytes, { ...policy, expected: { width: 10, height: 11 } })).toMatchObject({
      reason: 'dimension-mismatch',
    });
  });

  it('rejects a bad signature or IHDR', () => {
    const signature = png();
    signature[1] = 0;
    expect(validatePng(signature, policy)).toMatchObject({ reason: 'signature' });
    const pixels = chunk('IDAT', deflateSync(Buffer.alloc(9)));
    const missing = png(2, 2, [chunk('tEXt', Buffer.alloc(13)), pixels, chunk('IEND')]);
    expect(validatePng(missing, policy)).toMatchObject({ reason: 'header' });
  });

  it('applies the optional encoding, repeated-header, and chunk-count policies', () => {
    const paletteSixteenBit = png(2, 2, [ihdr(2, 2, { 8: 16 }), chunk('IDAT'), chunk('IEND')]);
    expect(validatePng(paletteSixteenBit, policy).ok).toBe(true);
    const encoding = { ...policy, allowedColorTypes: [0, 2, 3, 4, 6] };
    expect(validatePng(paletteSixteenBit, encoding)).toMatchObject({ reason: 'encoding' });
    for (const override of [{ 9: 5 }, { 10: 1 }, { 11: 1 }, { 12: 2 }] as Record<number, number>[])
      expect(
        validatePng(png(2, 2, [ihdr(2, 2, override), chunk('IDAT'), chunk('IEND')]), encoding),
      ).toMatchObject({ reason: 'encoding' });
    expect(validatePng(png(2, 2, [ihdr(2, 2, { 12: 1 }), chunk('IDAT'), chunk('IEND')]), encoding).ok).toBe(
      true,
    );

    const repeated = png(2, 2, [ihdr(2, 2), ihdr(2, 2), chunk('IDAT'), chunk('IEND')]);
    expect(validatePng(repeated, policy).ok).toBe(true);
    expect(validatePng(repeated, { ...policy, rejectRepeatedHeader: true })).toMatchObject({
      reason: 'repeated-header',
    });

    const many = png(2, 2, [ihdr(2, 2), chunk('IDAT'), chunk('tEXt'), chunk('IEND')]);
    expect(validatePng(many, { ...policy, maxChunks: 4 }).ok).toBe(true);
    expect(validatePng(many, { ...policy, maxChunks: 3 })).toMatchObject({ reason: 'too-many-chunks' });
  });

  it('optionally rejects chunk types that are not ASCII letters', () => {
    const strict = { ...policy, requireLetterChunkTypes: true };
    const pixels = chunk('IDAT', deflateSync(Buffer.alloc(9)));
    expect(
      validatePng(png(2, 2, [ihdr(2, 2), chunk('tEXt'), chunk('zzZZ'), pixels, chunk('IEND')]), strict).ok,
    ).toBe(true);
    // IHDR, IDAT and IEND with the high bit set on one type byte (latin1 escapes), and the
    // bytes just outside A-Z and a-z, between IHDR and IDAT with a normal final IEND.
    for (const type of [
      '\u00c9HDR',
      '\u00c9DAT',
      '\u00c9END',
      'IE\u00ceD',
      'IDA\u00d4',
      '@END',
      '[END',
      '`END',
      '{END',
      '1234',
    ]) {
      const bytes = png(2, 2, [ihdr(2, 2), chunk(type), pixels, chunk('IEND')]);
      expect(validatePng(bytes, policy).ok, type).toBe(true);
      expect(validatePng(bytes, strict), type).toMatchObject({ ok: false, reason: 'chunk-type' });
    }
    // A CRC failure is still reported first.
    const damaged = png(2, 2, [ihdr(2, 2), chunk('\u00c9END'), pixels, chunk('IEND')]);
    damaged[33 + 8] ^= 1;
    expect(validatePng(damaged, strict)).toMatchObject({ reason: 'crc' });
  });

  it('requires image data before an empty IEND and nothing after it', () => {
    expect(validatePng(png(2, 2, [ihdr(2, 2), chunk('IEND')]), policy)).toMatchObject({
      reason: 'end-before-data',
      trailing: false,
    });
    expect(validatePng(png(2, 2, [ihdr(2, 2), chunk('IEND'), chunk('IDAT')]), policy)).toMatchObject({
      reason: 'end-before-data',
      trailing: true,
    });
    expect(
      validatePng(png(2, 2, [ihdr(2, 2), chunk('IDAT'), chunk('IEND', Buffer.alloc(1))]), policy),
    ).toMatchObject({ reason: 'end-not-empty' });
    expect(validatePng(Buffer.concat([png(), Buffer.alloc(1)]), policy)).toMatchObject({
      reason: 'trailing-data',
    });
    expect(validatePng(Buffer.concat([png(), chunk('tEXt')]), policy)).toMatchObject({
      reason: 'trailing-data',
    });
    expect(validatePng(png(2, 2, [ihdr(2, 2), chunk('IDAT')]), policy)).toMatchObject({
      reason: 'incomplete',
    });
  });
});
