export type ContentSearchKind = 'project' | 'collection' | 'screenshot' | 'drawing' | 'text';
export type ContentSearchMatchSource = 'name' | 'description' | 'context' | 'markdown' | 'title';
export type ContentSearchScope = 'active' | 'archived';

export interface ContentSearchDocument {
  projectPath: string;
  projectId: string;
  projectName: string;
  status: ContentSearchScope;
  favourite?: boolean;
  collectionId?: string;
  collectionName?: string;
  itemId?: string;
  kind: ContentSearchKind;
  label: string;
  fields: Partial<Record<ContentSearchMatchSource, string>>;
}

export interface ContentSearchResult {
  projectPath: string;
  projectId: string;
  projectName: string;
  collectionId?: string;
  collectionName?: string;
  itemId?: string;
  kind: ContentSearchKind;
  label: string;
  matchSource: ContentSearchMatchSource;
  excerpt?: string;
}

export interface ContentSearchRequest {
  workspacePath: string;
  query: string;
  refresh?: boolean;
  favouritesOnly?: boolean;
  scope?: ContentSearchScope;
}

export interface ContentSearchResponse {
  results: ContentSearchResult[];
  warnings: string[];
  totalMatches: number;
}

const sourceOrder: ContentSearchMatchSource[] = ['name', 'title', 'description', 'context', 'markdown'];

export function normalizedSearchTerms(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

export function searchContent(
  documents: readonly ContentSearchDocument[],
  query: string,
): ContentSearchResult[] {
  const terms = normalizedSearchTerms(query);
  if (!terms.length) return [];
  return documents.flatMap((document) => {
    const values = sourceOrder.map((source) => [source, document.fields[source] ?? ''] as const);
    if (!terms.every((term) => values.some(([, value]) => value.toLocaleLowerCase().includes(term))))
      return [];
    const field = values.find(([, value]) =>
      terms.some((term) => value.toLocaleLowerCase().includes(term)),
    )?.[0];
    if (!field) return [];
    const value = document.fields[field] ?? '';
    return [
      {
        projectPath: document.projectPath,
        projectId: document.projectId,
        projectName: document.projectName,
        collectionId: document.collectionId,
        collectionName: document.collectionName,
        itemId: document.itemId,
        kind: document.kind,
        label: document.label,
        matchSource: field,
        excerpt: field === 'name' || field === 'title' ? undefined : searchExcerpt(value, terms),
      },
    ];
  });
}

export function searchExcerpt(value: string, terms: readonly string[], maximum = 180): string | undefined {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  const lower = compact.toLocaleLowerCase();
  const first = Math.max(0, ...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0));
  const start = Math.max(0, first - Math.floor(maximum / 3));
  const end = Math.min(compact.length, start + maximum);
  return `${start ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}
