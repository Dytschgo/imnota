import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import pngjs from 'pngjs';

const { PNG } = pngjs;

export const pngFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.png$/i;

export function randomToken() {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function deriveToken(receiptSecret, uploadToken, requestId, purpose) {
  return createHmac('sha256', Buffer.from(receiptSecret, 'base64url'))
    .update(`imnota-share-v1:${purpose}:`, 'utf8')
    .update(uploadToken, 'utf8')
    .update(':', 'utf8')
    .update(requestId, 'utf8')
    .digest('base64url');
}

export function safeHashEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isSafePngFilename(filename) {
  return (
    typeof filename === 'string' &&
    filename.length <= 100 &&
    path.basename(filename) === filename &&
    pngFilenamePattern.test(filename)
  );
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function normalizePng(buffer, limits) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error('The image is not a PNG file.');
  }
  let offset = 8;
  let header;
  let sawIdat = false;
  let sawIend = false;
  let idatEnded = false;
  const compressedParts = [];
  while (offset < buffer.length) {
    if (buffer.length - offset < 12) throw new Error('The PNG is truncated.');
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > buffer.length)
      throw new Error('The PNG chunk length is invalid.');
    const typeBuffer = buffer.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString('ascii');
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new Error('The PNG chunk type is invalid.');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) {
      throw new Error(`The PNG ${type} checksum is invalid.`);
    }
    if (!header && type !== 'IHDR') throw new Error('The PNG must begin with IHDR.');
    if (type === 'IHDR') {
      if (header || length !== 13) throw new Error('The PNG IHDR chunk is invalid.');
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const depth = data[8];
      const colorType = data[9];
      const validDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!validDepths[colorType]?.includes(depth) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('The PNG format is unsupported or invalid.');
      }
      if (width < 1 || height < 1 || width > limits.maxDimension || height > limits.maxDimension) {
        throw new Error(`PNG dimensions must be between 1 and ${limits.maxDimension} pixels.`);
      }
      const pixels = width * height;
      if (!Number.isSafeInteger(pixels) || pixels > limits.maxPixels) {
        throw new Error(`PNG pixel area must not exceed ${limits.maxPixels} pixels.`);
      }
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
      const inflatedBytes = (Math.ceil((width * channels * depth) / 8) + 1) * height;
      if (!Number.isSafeInteger(inflatedBytes) || inflatedBytes > limits.maxInflatedBytes) {
        throw new Error('The decoded PNG exceeds the memory limit.');
      }
      header = { width, height, inflatedBytes };
    } else if (type === 'IDAT') {
      if (idatEnded) throw new Error('PNG IDAT chunks must be consecutive.');
      sawIdat = true;
      compressedParts.push(data);
    } else {
      if (sawIdat) idatEnded = true;
      if (type === 'IEND') {
        if (length !== 0 || sawIend) throw new Error('The PNG IEND chunk is invalid.');
        sawIend = true;
        if (chunkEnd !== buffer.length) throw new Error('The PNG has trailing content.');
      } else if ((typeBuffer[0] & 0x20) === 0 && type !== 'PLTE') {
        throw new Error(`The PNG contains unsupported critical chunk ${type}.`);
      }
    }
    offset = chunkEnd;
  }
  if (!header || !sawIdat || !sawIend) throw new Error('The PNG is incomplete.');
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(compressedParts), { maxOutputLength: header.inflatedBytes });
  } catch {
    throw new Error('The PNG compressed data is invalid or exceeds its decoded size.');
  }
  if (inflated.length !== header.inflatedBytes)
    throw new Error('The PNG decoded data has an invalid length.');
  let decoded;
  try {
    decoded = PNG.sync.read(buffer, { checkCRC: true });
  } catch {
    throw new Error('The PNG pixel data is invalid.');
  }
  const data = PNG.sync.write(
    { width: decoded.width, height: decoded.height, data: decoded.data },
    {
      bitDepth: 8,
      colorType: 6,
      inputColorType: 6,
      inputHasAlpha: true,
      deflateLevel: 9,
    },
  );
  return { width: decoded.width, height: decoded.height, pixels: decoded.width * decoded.height, data };
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
