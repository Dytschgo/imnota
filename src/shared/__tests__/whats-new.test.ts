import { describe, expect, it } from 'vitest';
import { compareWhatsNewVersions, findWhatsNewRelease, shouldShowWhatsNew } from '../whats-new';

describe('what’s new releases', () => {
  it('orders Imnota stable and nightly versions without using lexical comparison', () => {
    expect(compareWhatsNewVersions('0.2.10', '0.2.9')).toBeGreaterThan(0);
    expect(compareWhatsNewVersions('0.2.7', '0.2.7-nightly.20260919.1')).toBeGreaterThan(0);
    expect(compareWhatsNewVersions('0.2.7-nightly.20260920.1', '0.2.7-nightly.20260919.9')).toBeGreaterThan(
      0,
    );
    expect(compareWhatsNewVersions('unknown', '0.2.7')).toBeNull();
  });

  it('keeps nightly content out of stable and older installs', () => {
    expect(findWhatsNewRelease('0.2.7-nightly.20260919.1', 'nightly')?.preview).toBe(true);
    expect(findWhatsNewRelease('0.2.7', 'stable')).toBeUndefined();
    expect(findWhatsNewRelease('0.2.8', 'stable')?.preview).toBe(false);
  });

  it('shows each eligible release only when the installed version is newer than its acknowledgement', () => {
    const release = findWhatsNewRelease('0.2.8', 'stable');
    expect(shouldShowWhatsNew('0.2.8', undefined, release)).toBe(true);
    expect(shouldShowWhatsNew('0.2.8', '0.2.8', release)).toBe(false);
    expect(shouldShowWhatsNew('0.2.8', '0.2.9', release)).toBe(false);
    expect(shouldShowWhatsNew('0.2.9', '0.2.8', release)).toBe(true);
    expect(shouldShowWhatsNew('0.2.8', 'not-a-version', release)).toBe(true);
  });
});
