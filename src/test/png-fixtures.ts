import { deflateSync } from 'node:zlib';
import { crc32, PNG_SIGNATURE } from '../shared/png.js';

/** One PNG chunk with a correct length and CRC. */
export function pngChunk(type: string, data: Uint8Array = new Uint8Array()): Buffer {
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 'latin1');
  output.set(data, 8);
  output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length);
  return output;
}

/** An 8-bit RGBA IHDR chunk; `overrides` replaces IHDR data bytes by index (8 = bit depth). */
export function ihdrChunk(width: number, height: number, overrides: Record<number, number> = {}): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  for (const [index, value] of Object.entries(overrides)) data[Number(index)] = value;
  return pngChunk('IHDR', data);
}

/** A structurally valid PNG; pass `chunks` to replace everything after the signature. */
export function syntheticPng(width = 2, height = 2, chunks?: Buffer[]): Buffer {
  const pixels = deflateSync(Buffer.alloc((width * 4 + 1) * height));
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    ...(chunks ?? [ihdrChunk(width, height), pngChunk('IDAT', pixels), pngChunk('IEND')]),
  ]);
}
