import type { Event } from 'electron';

/** Only main's configured app document may reload, regardless of renderer history changes. */
export function preventForeignNavigation(
  event: Pick<Event, 'preventDefault'> & { url: string },
  trustedAppUrl: string,
): void {
  try {
    const target = new URL(event.url);
    const trusted = new URL(trustedAppUrl);
    // A fragment identifies a location inside the same document, not another file or origin.
    target.hash = '';
    trusted.hash = '';
    if (target.href === trusted.href) return;
  } catch {
    // Missing or malformed startup/target URLs cannot grant navigation.
  }
  event.preventDefault();
}
