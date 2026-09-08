export type ProjectSearchScope = 'active' | 'archived';

export type ProjectSearchResultKind =
  'project' | 'collection' | 'screenshot' | 'annotation' | 'text' | 'drawing';

export interface ProjectSearchTarget {
  projectPath: string;
  collectionId?: string;
  /** Screenshot, text block, or drawing identifier. */
  itemId?: string;
  annotationId?: string;
}

export interface ProjectSearchResult {
  id: string;
  kind: ProjectSearchResultKind;
  title: string;
  excerpt: string;
  projectName: string;
  collectionName?: string;
  target: ProjectSearchTarget;
}

export interface ProjectSearchInput {
  query: string;
  scope?: ProjectSearchScope;
  limit?: number;
}

export interface ProjectSearchResponse {
  query: string;
  scope: ProjectSearchScope;
  results: ProjectSearchResult[];
  /** More projects, content, or matches existed than the bounded search could inspect or return. */
  truncated: boolean;
  /** Human-readable reasons that some local content could not be inspected. */
  warnings?: string[];
}
