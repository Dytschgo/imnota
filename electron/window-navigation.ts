import type { Event } from 'electron';
import { fileURLToPath } from 'node:url';

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
    if (target.protocol === 'file:' && trusted.protocol === 'file:') {
      // loadFile and pathToFileURL can escape the same path differently (notably
      // ~ in Windows portable extraction paths). Compare decoded file operands,
      // while retaining the configured host and query and rejecting bad escapes.
      if (
        target.host === trusted.host &&
        target.search === trusted.search &&
        // URL.search omits an empty query marker; it must not broaden this grant.
        target.href.includes('?') === trusted.href.includes('?') &&
        fileURLToPath(target) === fileURLToPath(trusted)
      )
        return;
    } else if (target.href === trusted.href) return;
  } catch {
    // Missing or malformed startup/target URLs cannot grant navigation.
  }
  event.preventDefault();
}
