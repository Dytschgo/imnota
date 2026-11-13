/** Block markers at the start of a first line: headings, quotes, bullets and task boxes. */
const LEADING_MARKDOWN = /^(?:#{1,6}(?:\s+|$)|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?)+/;

/**
 * Display label for a text block. Its stored preview is the raw first Markdown line, so a
 * heading would otherwise read as "# Summary" in lists, names and search results.
 */
export function textBlockLabel(preview: string | undefined, fallback = 'Text block'): string {
  return (preview ?? '').trim().replace(LEADING_MARKDOWN, '').trim() || fallback;
}
