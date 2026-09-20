// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  compareWhatsNewVersions,
  findWhatsNewRelease,
  releaseChannelForVersion,
  shouldShowWhatsNew,
} from '../whats-new';

describe('what’s new releases', () => {
  it('orders Imnota stable and nightly versions without using lexical comparison', () => {
    expect(compareWhatsNewVersions('0.2.10', '0.2.9')).toBeGreaterThan(0);
    expect(compareWhatsNewVersions('0.2.7', '0.2.7-nightly.20260919.1')).toBeGreaterThan(0);
    expect(compareWhatsNewVersions('0.2.7-nightly.20260920.1', '0.2.7-nightly.20260919.9')).toBeGreaterThan(
      0,
    );
    expect(compareWhatsNewVersions('unknown', '0.2.7')).toBeNull();
  });

  it('uses the installed build channel and excludes the preceding nightly', () => {
    expect(releaseChannelForVersion('0.2.8-nightly.20260918.35402081017')).toBe('nightly');
    expect(findWhatsNewRelease('0.2.8-nightly.20260918.35402081016')).toBeUndefined();
    expect(findWhatsNewRelease('0.2.8-nightly.20260918.35402081017')?.preview).toBe(true);
    expect(findWhatsNewRelease('0.2.8-nightly.20260918.35402081017')?.features[0]?.imageSrc).toMatch(
      /whats-new-updates\.png$/,
    );
    expect(findWhatsNewRelease('0.2.8-nightly.20260918.35402081017')?.features[1]?.imageSrc).toMatch(
      /whats-new-handoff\.png$/,
    );
    expect(findWhatsNewRelease('0.2.8-nightly.20260918.35402081017')?.features[2]?.imageSrc).toMatch(
      /whats-new-capture-chooser\.png$/,
    );
    expect(findWhatsNewRelease('0.2.7')).toBeUndefined();
    expect(findWhatsNewRelease('0.2.8')?.preview).toBe(false);
  });

  it('shows each eligible release only when the installed version is newer than its acknowledgement', () => {
    const release = findWhatsNewRelease('0.2.8');
    expect(shouldShowWhatsNew('0.2.8', undefined, release)).toBe(true);
    expect(shouldShowWhatsNew('0.2.8', '0.2.8', release)).toBe(false);
    expect(shouldShowWhatsNew('0.2.8', '0.2.9', release)).toBe(false);
    expect(shouldShowWhatsNew('0.2.9', '0.2.8', release)).toBe(true);
    expect(shouldShowWhatsNew('0.2.8', 'not-a-version', release)).toBe(true);
  });

  it('keeps the published nightly content until the comparison nightly is installed', () => {
    expect(findWhatsNewRelease('0.2.8-nightly.20260919.35412472439')?.features[0]?.id).toBe('updates');
    const next = findWhatsNewRelease('0.2.8-nightly.20260919.35412472440');
    expect(next?.features.map((feature) => feature.id)).toEqual([
      'update-hover',
      'copy-variants',
      'capture-choose-display',
    ]);
    expect(findWhatsNewRelease('0.2.8')?.features[0]?.id).toBe('updates');
  });
});
