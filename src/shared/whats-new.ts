import type { UpdateChannel } from './types.js';

export interface WhatsNewFeature {
  id: string;
  title: string;
  description: string;
  imageSrc?: string;
  action?: { kind: 'settings'; category: 'Shortcuts' | 'Updates & about' } | { kind: 'onboarding' };
}

export interface WhatsNewRelease {
  minVersion: string;
  channel: UpdateChannel;
  title: string;
  summary: string;
  preview: boolean;
  features: readonly WhatsNewFeature[];
}

const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-nightly\.(\d{8})\.([1-9]\d*)(?:\.([1-9]\d*))?)?$/;

/** Compare only Imnota's published stable and nightly version forms. */
export function compareWhatsNewVersions(left: string, right: string): number | null {
  const a = versionPattern
    .exec(left)
    ?.slice(1)
    .map((part) => (part === undefined ? undefined : Number(part)));
  const b = versionPattern
    .exec(right)
    ?.slice(1)
    .map((part) => (part === undefined ? undefined : Number(part)));
  if (!a || !b || [...a, ...b].some((part) => part !== undefined && !Number.isSafeInteger(part))) return null;
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1;
  if (a[3] === undefined || b[3] === undefined) return a[3] === b[3] ? 0 : a[3] === undefined ? 1 : -1;
  for (let index = 3; index < 6; index++) {
    if (a[index] === b[index]) continue;
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

/** Local release content. Screenshot paths are optional while an asset is unavailable. */
export const WHATS_NEW_RELEASES: readonly WhatsNewRelease[] = [
  {
    minVersion: '0.2.7-nightly.20260919.1',
    channel: 'nightly',
    title: 'What’s new in this Nightly',
    summary: 'Preview the next update controls and guided handoff improvements before they reach Stable.',
    preview: true,
    features: [
      {
        id: 'updates',
        title: 'Updates stay within reach',
        description: 'One compact control shows when a check, download, restart, or retry is available.',
        action: { kind: 'settings', category: 'Updates & about' },
      },
      {
        id: 'handoff',
        title: 'Try the complete handoff',
        description: 'Use the short guided sample to see an annotated screenshot and its context together.',
        action: { kind: 'onboarding' },
      },
    ],
  },
  {
    minVersion: '0.2.8',
    channel: 'stable',
    title: 'What’s new',
    summary: 'A clearer update path and a guided way to prepare local handoff context.',
    preview: false,
    features: [
      {
        id: 'updates',
        title: 'Updates stay within reach',
        description: 'One compact control shows when a check, download, restart, or retry is available.',
        action: { kind: 'settings', category: 'Updates & about' },
      },
      {
        id: 'handoff',
        title: 'Try the complete handoff',
        description: 'Use the short guided sample to see an annotated screenshot and its context together.',
        action: { kind: 'onboarding' },
      },
    ],
  },
];

export function findWhatsNewRelease(version: string | undefined, channel: UpdateChannel | undefined) {
  if (!version || !channel) return undefined;
  return WHATS_NEW_RELEASES.filter(
    (release) =>
      release.channel === channel &&
      compareWhatsNewVersions(version, release.minVersion) !== null &&
      compareWhatsNewVersions(version, release.minVersion)! >= 0,
  ).at(-1);
}

export function shouldShowWhatsNew(
  version: string | undefined,
  acknowledgedVersion: string | undefined,
  release: WhatsNewRelease | undefined,
): boolean {
  if (!version || !release) return false;
  if (!acknowledgedVersion) return true;
  const comparison = compareWhatsNewVersions(version, acknowledgedVersion);
  return comparison !== null && comparison > 0;
}
