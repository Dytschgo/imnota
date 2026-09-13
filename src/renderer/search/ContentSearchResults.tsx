import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Image, Layers3, PenTool } from 'lucide-react';
import type {
  ContentSearchResponse,
  ContentSearchResult,
  ContentSearchScope,
} from '../../shared/content-search';
import type { ProjectListItem } from '../../shared/types';
import { Button } from '../components/ui';
import './content-search.css';

interface Props {
  query: string;
  workspacePath: string;
  projects: ProjectListItem[];
  favouritesOnly: boolean;
  scope: ContentSearchScope;
  onSelect(result: ContentSearchResult): void;
}

export function ContentSearchResults({
  query,
  workspacePath,
  projects,
  favouritesOnly,
  scope,
  onSelect,
}: Props) {
  const [refresh, setRefresh] = useState(0);
  // A new projects array represents the library refresh generation, including edits with
  // unchanged timestamps. Keeping that identity in the render key hides old rows immediately.
  const identity = useMemo(
    () => ({ query, workspacePath, projects, favouritesOnly, scope, refresh }),
    [query, workspacePath, projects, favouritesOnly, scope, refresh],
  );
  const [state, setState] = useState<{
    identity: typeof identity;
    response?: ContentSearchResponse;
    error?: string;
  }>();
  const previousIndex = useRef<
    { workspacePath: string; projects: ProjectListItem[]; refresh: number } | undefined
  >(undefined);

  useEffect(() => {
    const refreshSearch = () => setRefresh((value) => value + 1);
    // Existing project watchers report external content changes, even without metadata edits.
    const unsubscribe = window.imnota.onProjectWatchEvent?.(refreshSearch);
    window.addEventListener('focus', refreshSearch);
    return () => {
      unsubscribe?.();
      window.removeEventListener('focus', refreshSearch);
    };
  }, []);

  useEffect(() => {
    let current = true;
    setState(undefined);
    const timer = window.setTimeout(() => {
      const previous = previousIndex.current;
      const rebuild =
        !previous ||
        previous.workspacePath !== workspacePath ||
        previous.projects !== projects ||
        previous.refresh !== refresh;
      previousIndex.current = { workspacePath, projects, refresh };
      void Promise.resolve()
        .then(() =>
          window.imnota.searchContent({ workspacePath, query, favouritesOnly, scope, refresh: rebuild }),
        )
        .then((response) => {
          if (current) setState({ identity, response });
        })
        .catch(() => {
          if (current)
            setState({
              identity,
              error: 'Search could not read this workspace. Check that the folder is available, then retry.',
            });
        });
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [identity, query, workspacePath, projects, favouritesOnly, scope, refresh]);

  const current = state?.identity === identity ? state : undefined;
  const results = current?.response?.results ?? [];
  const retry = () => setRefresh((value) => value + 1);
  return (
    <section aria-label="Content search results" aria-busy={!current}>
      <p className="content-search-scope" role="status">
        Projects and content{!current ? ' · Searching…' : ''}
      </p>
      {current?.error ? (
        <div className="content-search-feedback" role="alert">
          <p>{current.error}</p>
          <Button onClick={retry}>Retry search</Button>
        </div>
      ) : current?.response ? (
        <>
          {current.response.warnings.length > 0 && (
            <div className="content-search-feedback" role="status">
              {current.response.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              <Button onClick={retry}>Refresh search</Button>
            </div>
          )}
          {results.length ? (
            <div className="content-search-results">
              {results.map((result) => {
                const Icon =
                  result.kind === 'screenshot'
                    ? Image
                    : result.kind === 'drawing'
                      ? PenTool
                      : result.kind === 'text'
                        ? FileText
                        : Layers3;
                return (
                  <button
                    type="button"
                    className="content-search-result"
                    key={`${result.projectPath}:${result.kind}:${result.collectionId ?? ''}:${result.itemId ?? ''}`}
                    onClick={() => onSelect(result)}
                  >
                    <Icon size={17} aria-hidden="true" />
                    <span className="content-search-result-copy">
                      <strong>{result.label}</strong>
                      {result.excerpt && <span>{result.excerpt}</span>}
                      <small>
                        {result.projectName}
                        {result.collectionName ? ` / ${result.collectionName}` : ''} · matched{' '}
                        {result.matchSource}
                      </small>
                    </span>
                    <span className="content-search-kind">{result.kind}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p role="status">
              {current.response.warnings.length
                ? 'No matches in the available content.'
                : 'No matching projects or content.'}{' '}
              Try another name or phrase.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
