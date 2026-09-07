import type { ContentItem } from '../src/shared/content-items.js';

export interface ContentItemPaths {
  source?: string;
  image?: string;
  markdown?: string;
}

export function contentItemRelativePaths(item: ContentItem): ContentItemPaths {
  const base = `collections/${item.collectionId}`;
  return item.kind === 'drawing'
    ? {
        source: `${base}/drawings/${item.sourceFilename}`,
        image: `${base}/drawings/${item.imageFilename}`,
      }
    : { markdown: `${base}/text/${item.markdownFilename}` };
}
