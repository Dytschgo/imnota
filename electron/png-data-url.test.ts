import { describe, expect, it } from 'vitest';
import { decodePngDataUrl, isPngDataUrl, PNG_DATA_URL_PREFIX } from './png-data-url.js';

// The pattern this decoder replaces at IPC boundaries; acceptance must stay identical.
const LEGACY = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

function legacyDecode(value: string): Buffer | undefined {
  const match = LEGACY.exec(value);
  return match ? Buffer.from(match[1], 'base64') : undefined;
}

function expectLegacyEquivalent(value: string): void {
  const expected = legacyDecode(value);
  const actual = decodePngDataUrl(value);
  expect(actual === undefined, JSON.stringify(value)).toBe(expected === undefined);
  if (expected && actual) expect(actual.equals(expected), JSON.stringify(value)).toBe(true);
}

const url = (payload: string) => `${PNG_DATA_URL_PREFIX}${payload}`;

describe('PNG data URL decoding', () => {
  it('decodes canonical base64 exactly', () => {
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 1]);
    expect(decodePngDataUrl(url(bytes.toString('base64')))?.equals(bytes)).toBe(true);
    expect(isPngDataUrl(url(bytes.toString('base64')))).toBe(true);
  });

  it('rejects a missing or different prefix', () => {
    for (const value of [
      'iVBORw0KGgo=',
      'data:image/jpeg;base64,iVBORw0KGgo=',
      'DATA:image/png;base64,iVBORw0KGgo=',
      'data:image/png;charset=utf-8;base64,iVBORw0KGgo=',
      ' data:image/png;base64,iVBORw0KGgo=',
      'data:image/png,iVBORw0KGgo=',
    ])
      expect(decodePngDataUrl(value), value).toBeUndefined();
    expect(decodePngDataUrl(undefined as unknown as string)).toBeUndefined();
    expect(isPngDataUrl('data:image/jpeg;base64,AAAA')).toBe(false);
  });

  it('rejects empty payloads, whitespace, URL-safe characters, and misplaced padding', () => {
    for (const payload of [
      '',
      '=',
      '==',
      'AAAA===',
      'AA=A',
      'AA==AAAA',
      'AA==B',
      '=AAA',
      'AAAA AAAA',
      'AAAA\nAAAA',
      'AAAA\r\nAAAA',
      ' AAAA',
      'AAAA ',
      'AAAA\t',
      'AA-_',
      'AAAA%3D',
      'AAAA*',
      'AAAÀ',
    ]) {
      expect(decodePngDataUrl(url(payload)), JSON.stringify(payload)).toBeUndefined();
      expectLegacyEquivalent(url(payload));
    }
  });

  it('keeps accepting the unpadded and non-canonical forms the pattern allowed', () => {
    for (const payload of [
      'A',
      'AA',
      'AAA',
      'AAAAA',
      'AB',
      'AB=',
      'AB==',
      'ABC=',
      'AAAA=',
      'AAA==',
      'AP//',
      '+/+/',
    ])
      expectLegacyEquivalent(url(payload));
    expect(decodePngDataUrl(url('AB'))?.equals(Buffer.from([0]))).toBe(true);
    expect(decodePngDataUrl(url('AB=='))?.equals(Buffer.from([0]))).toBe(true);
  });

  it('matches the legacy pattern on generated inputs', () => {
    const alphabet = 'ABCZabcz0189+/=-_ \n.%À';
    let seed = 0x2545f491;
    const next = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    for (let round = 0; round < 20_000; round++) {
      const length = next() % 14;
      let payload = '';
      for (let index = 0; index < length; index++) payload += alphabet[next() % alphabet.length];
      expectLegacyEquivalent(url(payload));
    }
    for (let round = 0; round < 200; round++) {
      const bytes = Buffer.alloc(next() % 64);
      for (let index = 0; index < bytes.length; index++) bytes[index] = next() & 0xff;
      const encoded = bytes.toString('base64');
      expectLegacyEquivalent(url(encoded));
      expectLegacyEquivalent(url(encoded.replace(/=+$/, '')));
      const position = next() % (encoded.length + 1);
      expectLegacyEquivalent(url(`${encoded.slice(0, position)} ${encoded.slice(position)}`));
    }
  });
});
