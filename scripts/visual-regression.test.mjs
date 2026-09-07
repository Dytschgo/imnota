import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { comparePixels } from './visual-regression.mjs';

function fixture(width = 100, height = 100) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  return png;
}

test('accepts identical pixels and bounded rasterization noise', () => {
  const actual = fixture();
  actual.data[0] = 245;
  assert.equal(comparePixels(fixture(), actual).passed, true);
});

test('detects missing controls and emits a visible difference image', () => {
  const actual = fixture();
  for (let pixel = 0; pixel < 100; pixel++) actual.data[pixel * 4] = 0;
  const result = comparePixels(fixture(), actual);
  assert.equal(result.passed, false);
  assert.equal(result.changedRatio, 0.01);
  assert.deepEqual([...result.diff.data.subarray(0, 4)], [255, 0, 100, 255]);
});

test('rejects changed viewport dimensions', () => {
  assert.equal(comparePixels(fixture(), fixture(99)).reason, 'dimensions');
});
