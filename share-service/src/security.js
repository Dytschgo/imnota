import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

export const pngFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.png$/i;

export function randomToken() {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function deriveToken(uploadToken, requestId, purpose) {
  return createHmac('sha256', uploadToken)
    .update(`imnota-share-v1:${purpose}:${requestId}`, 'utf8')
    .digest('base64url');
}

export function safeHashEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isSafePngFilename(filename) {
  return typeof filename === 'string'
    && filename.length <= 100
    && path.basename(filename) === filename
    && pngFilenamePattern.test(filename);
}

export function inspectPng(buffer, maxDimension) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error('The image is not a PNG file.');
  }
  if (buffer.readUInt32BE(8) !== 13 || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('The PNG header is invalid.');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1 || width > maxDimension || height > maxDimension) {
    throw new Error(`PNG dimensions must be between 1 and ${maxDimension} pixels.`);
  }
  return { width, height };
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
