import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

// Compare approved native captures, never update baselines as part of a test.
export function comparePixels(expected, actual, { channelTolerance = 16, maxChangedRatio = 0.001 } = {}) {
  if (expected.width !== actual.width || expected.height !== actual.height)
    return { passed: false, reason: 'dimensions', changedRatio: 1 };
  let changed = 0;
  const diff = new PNG({ width: actual.width, height: actual.height });
  for (let offset = 0; offset < actual.data.length; offset += 4) {
    const different = [0, 1, 2, 3].some(
      (channel) =>
        Math.abs(expected.data[offset + channel] - actual.data[offset + channel]) > channelTolerance,
    );
    if (different) changed++;
    diff.data[offset] = different ? 255 : actual.data[offset] / 3;
    diff.data[offset + 1] = different ? 0 : actual.data[offset + 1] / 3;
    diff.data[offset + 2] = different ? 100 : actual.data[offset + 2] / 3;
    diff.data[offset + 3] = 255;
  }
  const changedRatio = changed / (actual.width * actual.height);
  return { passed: changedRatio <= maxChangedRatio, changedRatio, diff };
}

export async function compareCaptures(baselineDirectory, actualDirectory, diffDirectory) {
  const manifest = JSON.parse(await fs.readFile(path.join(baselineDirectory, 'manifest.json'), 'utf8'));
  if (manifest.platform !== process.platform)
    throw new Error(`Baseline requires ${manifest.platform}; this runner is ${process.platform}.`);
  if (!Array.isArray(manifest.captures) || manifest.captures.length === 0)
    throw new Error('The baseline has no approved captures.');
  const results = [];
  for (const filename of manifest.captures) {
    if (!/^[a-zA-Z0-9_-]+\.png$/.test(filename)) throw new Error('Unsafe baseline filename.');
    const [expectedBytes, actualBytes] = await Promise.all([
      fs.readFile(path.join(baselineDirectory, filename)),
      fs.readFile(path.join(actualDirectory, filename)),
    ]);
    const result = comparePixels(
      PNG.sync.read(expectedBytes),
      PNG.sync.read(actualBytes),
      manifest.tolerance,
    );
    results.push({
      filename,
      passed: result.passed,
      changedRatio: result.changedRatio,
      reason: result.reason,
    });
    if (!result.passed && result.diff) {
      await fs.mkdir(diffDirectory, { recursive: true });
      await fs.writeFile(path.join(diffDirectory, filename), PNG.sync.write(result.diff));
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baseline, actual, differences] = process.argv.slice(2);
  if (!baseline || !actual || !differences) {
    console.error('Usage: node scripts/visual-regression.mjs BASELINE_DIR CAPTURE_DIR DIFF_DIR');
    process.exitCode = 2;
  } else {
    try {
      const results = await compareCaptures(baseline, actual, differences);
      console.log(JSON.stringify(results, null, 2));
      if (results.some((result) => !result.passed)) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
