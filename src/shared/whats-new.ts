import type { UpdateChannel } from './types.js';

export interface WhatsNewFeature {
  id: string;
  title: string;
  description: string;
  imageSrc?: string;
  action?: { kind: 'settings'; category: 'Shortcuts' | 'Updates & about' } | { kind: 'onboarding' };
}

export interface WhatsNewRelease {
  afterVersion: string;
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

export function releaseChannelForVersion(version: string | undefined): UpdateChannel | undefined {
  if (!version) return undefined;
  const match = versionPattern.exec(version);
  return match ? (match[4] === undefined ? 'stable' : 'nightly') : undefined;
}

/** Local release content. Screenshot paths are optional while an asset is unavailable. */
export const WHATS_NEW_RELEASES: readonly WhatsNewRelease[] = [
  {
    afterVersion: '0.2.8-nightly.20260918.35402081016',
    channel: 'nightly',
    title: 'What’s new in this Nightly',
    summary: 'Preview the next update controls and guided handoff improvements before they reach Stable.',
    preview: true,
    features: [
      {
        id: 'updates',
        title: 'Updates stay within reach',
        description: 'One compact control shows when a check, download, restart, or retry is available.',
        imageSrc: new URL('../renderer/assets/whats-new-updates.png', import.meta.url).href,
        action: { kind: 'settings', category: 'Updates & about' },
      },
      {
        id: 'handoff',
        title: 'Try the complete handoff',
        description: 'Use the short guided sample to see an annotated screenshot and its context together.',
        imageSrc: new URL('../renderer/assets/whats-new-handoff.png', import.meta.url).href,
        action: { kind: 'onboarding' },
      },
      {
        id: 'capture-display',
        title: 'Choose the screen to capture',
        description:
          'On Windows, select the display before Imnota captures a region. Capture pixels stay local.',
        imageSrc: new URL('../renderer/assets/whats-new-capture-chooser.png', import.meta.url).href,
        action: { kind: 'settings', category: 'Shortcuts' },
      },
    ],
  },
  {
    afterVersion: '0.2.8-nightly.20260919.35412472439',
    channel: 'nightly',
    title: 'Choose your Windows copy format',
    summary:
      'Save your preferred copy format, choose a Windows display to capture, and read update notes on hover.',
    preview: true,
    features: [
      {
        id: 'update-hover',
        title: 'Read before downloading',
        imageSrc: new URL('../renderer/assets/whats-new-hover-notes.png', import.meta.url).href,
        description:
          'Hover over an available update to read and scroll its changes. The same button downloads, shows progress, and restarts.',
        action: { kind: 'settings', category: 'Updates & about' },
      },
      {
        id: 'copy-variants',
        title: 'Choose what to copy',
        imageSrc: new URL('../renderer/assets/whats-new-copy-preference.png', import.meta.url).href,
        description:
          'Copy files by default, or save another format from the copy dropdown or Settings. Explorer stays closed unless you choose Open files.',
        action: { kind: 'onboarding' },
      },
      {
        id: 'capture-choose-display',
        title: 'Choose a display to capture',
        description:
          'On Windows with more than one display, pick which screen to capture. Imnota then captures only that display; it does not silently use the primary.',
        action: { kind: 'settings', category: 'Shortcuts' },
      },
    ],
  },
  {
    afterVersion: '0.2.7',
    channel: 'stable',
    title: 'What’s new',
    summary: 'A clearer update path and a guided way to prepare local handoff context.',
    preview: false,
    features: [
      {
        id: 'updates',
        title: 'Updates stay within reach',
        description: 'One compact control shows when a check, download, restart, or retry is available.',
        imageSrc: new URL('../renderer/assets/whats-new-updates.png', import.meta.url).href,
        action: { kind: 'settings', category: 'Updates & about' },
      },
      {
        id: 'handoff',
        title: 'Try the complete handoff',
        description: 'Use the short guided sample to see an annotated screenshot and its context together.',
        imageSrc: new URL('../renderer/assets/whats-new-handoff.png', import.meta.url).href,
        action: { kind: 'onboarding' },
      },
      {
        id: 'capture-display',
        title: 'Choose the screen to capture',
        description:
          'On Windows, select the display before Imnota captures a region. Capture pixels stay local.',
        imageSrc: new URL('../renderer/assets/whats-new-capture-chooser.png', import.meta.url).href,
        action: { kind: 'settings', category: 'Shortcuts' },
      },
    ],
  },
  {
    afterVersion: '0.2.9-nightly.20260924.36070290089',
    channel: 'nightly',
    title: 'Select an area across your screens',
    summary: 'Screenshot capture opens every connected screen directly, with no monitor chooser.',
    preview: true,
    features: [
      {
        id: 'capture-all-displays',
        title: 'Start selecting immediately',
        description:
          'Drag an area on any screen or across screen boundaries. Repeat last area keeps the complete selection. Capture pixels stay local.',
        action: { kind: 'settings', category: 'Shortcuts' },
      },
    ],
  },
  {
    afterVersion: '0.2.8',
    channel: 'stable',
    title: 'Capture faster, hand off more',
    summary:
      'Capture from anywhere, give agents readable marks, and optionally let them load bundles locally.',
    preview: false,
    features: [
      {
        id: 'capture-all-displays',
        title: 'Capture an area, window or screen',
        description:
          'Use the capture shortcut or tray icon, drag across screens, add a short delay or repeat the last area. Capture pixels stay local.',
        action: { kind: 'settings', category: 'Shortcuts' },
      },
      {
        id: 'readable-marks',
        title: 'Marks your agent can read',
        description:
          'Prompt Markdown lists arrows, boxes and steps as positions with the screenshot size. Optional on-device text recognition adds visible text.',
      },
      {
        id: 'agent-access',
        title: 'Let your agent read bundles',
        description:
          'Turn on local agent access in Settings so MCP-capable coding agents can load prepared bundles. It is off by default and stays on this computer.',
      },
    ],
  },
];

export function findWhatsNewRelease(version: string | undefined) {
  const channel = releaseChannelForVersion(version);
  if (!version || !channel) return undefined;
  return WHATS_NEW_RELEASES.filter((release) => {
    const comparison = compareWhatsNewVersions(version, release.afterVersion);
    return release.channel === channel && comparison !== null && comparison > 0;
  }).at(-1);
}

export function whatsNewReleaseUrl(version: string | undefined): string | undefined {
  return releaseChannelForVersion(version)
    ? `https://github.com/Dytschgo/imnota/releases/tag/v${encodeURIComponent(version!)}`
    : undefined;
}

export function shouldShowWhatsNew(
  version: string | undefined,
  acknowledgedVersion: string | undefined,
  release: WhatsNewRelease | undefined,
): boolean {
  if (!version || !release) return false;
  if (!acknowledgedVersion) return true;
  const comparison = compareWhatsNewVersions(version, acknowledgedVersion);
  return comparison === null || comparison > 0;
}
