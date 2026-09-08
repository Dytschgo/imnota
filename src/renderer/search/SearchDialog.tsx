import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  Archive,
  FileText,
  Folder,
  Image,
  Layers3,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Search,
} from 'lucide-react';
import type {
  ProjectSearchResponse,
  ProjectSearchResult,
  ProjectSearchScope,
  ProjectSearchTarget,
} from '../../shared/project-search';
import { Modal } from '../components/ui';
import './search.css';

export interface SearchDialogProps {
  open: boolean;
  scope?: ProjectSearchScope;
  onScopeChange?(scope: ProjectSearchScope): void;
  onClose(): void;
  onOpenResult(target: ProjectSearchTarget): void | Promise<void>;
}

const kindLabels: Record<ProjectSearchResult['kind'], string> = {
  project: 'Project',
  collection: 'Collection',
  screenshot: 'Screenshot',
  annotation: 'Annotation',
  text: 'Text',
  drawing: 'Drawing',
};

const kindIcons: Record<ProjectSearchResult['kind'], ReactNode> = {
  project: <Layers3 size={16} aria-hidden="true" />,
  collection: <Folder size={16} aria-hidden="true" />,
  screenshot: <Image size={16} aria-hidden="true" />,
  annotation: <MessageSquareText size={16} aria-hidden="true" />,
  text: <FileText size={16} aria-hidden="true" />,
  drawing: <Pencil size={16} aria-hidden="true" />,
};

function normalizeSearchQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function SearchDialog({
  open,
  scope = 'active',
  onScopeChange,
  onClose,
  onOpenResult,
}: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const [currentScope, setCurrentScope] = useState<ProjectSearchScope>(scope);
  const [response, setResponse] = useState<ProjectSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const requestSequence = useRef(0);
  const openGeneration = useRef(0);

  useEffect(() => setCurrentScope(scope), [scope]);
  useEffect(() => {
    openGeneration.current += 1;
    if (!open) {
      requestSequence.current += 1;
      return;
    }
    setQuery('');
    setResponse(null);
    setError('');
    setLoading(false);
    setOpening(false);
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const normalizedQuery = normalizeSearchQuery(query);
    if (!normalizedQuery) {
      requestSequence.current += 1;
      setResponse(null);
      setLoading(false);
      setError('');
      setActiveIndex(0);
      return;
    }
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    setResponse(null);
    setActiveIndex(0);
    const timeout = window.setTimeout(() => {
      void window.imnota
        .searchProjects({ query: normalizedQuery, scope: currentScope, limit: 50 })
        .then((result) => {
          if (requestSequence.current !== sequence) return;
          setResponse(result);
          setActiveIndex(0);
        })
        .catch((reason: unknown) => {
          if (requestSequence.current !== sequence) return;
          setResponse(null);
          setError(reason instanceof Error ? reason.message : 'Search is unavailable. Try again.');
        })
        .finally(() => {
          if (requestSequence.current === sequence) setLoading(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      if (requestSequence.current === sequence) requestSequence.current += 1;
    };
  }, [currentScope, open, query]);

  if (!open) return null;
  const results = response?.results ?? [];

  const openResult = async (result: ProjectSearchResult) => {
    if (opening) return;
    const generation = openGeneration.current;
    setOpening(true);
    setError('');
    try {
      await onOpenResult(result.target);
      if (openGeneration.current === generation) onClose();
    } catch (reason) {
      if (openGeneration.current !== generation) return;
      setError(reason instanceof Error ? reason.message : 'This result could not be opened.');
      setOpening(false);
    }
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      !results.length ||
      loading ||
      response?.query !== normalizeSearchQuery(query) ||
      response.scope !== currentScope
    )
      return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((value) => (value + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((value) => (value - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void openResult(results[activeIndex] ?? results[0]);
    }
  };

  return (
    <Modal
      title="Search workspace"
      description="Find project context, screenshots, annotations, text, and drawings stored on this device."
      onClose={onClose}
    >
      <div className="project-search" aria-busy={loading || opening} data-testid="global-search-dialog">
        <div className="project-search-controls">
          <label className="project-search-input">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search workspace</span>
            <input
              data-autofocus
              data-testid="global-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search everything…"
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={results.length > 0}
              aria-controls="project-search-results"
              aria-activedescendant={results[activeIndex] ? `search-option-${activeIndex}` : undefined}
            />
            {loading && <LoaderCircle className="spin" size={16} aria-label="Searching" />}
          </label>
          <div className="project-search-scope" aria-label="Search location">
            {(['active', 'archived'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={currentScope === value ? 'active' : ''}
                aria-pressed={currentScope === value}
                onClick={() => {
                  setCurrentScope(value);
                  onScopeChange?.(value);
                }}
              >
                {value === 'active' ? (
                  <Layers3 size={13} aria-hidden="true" />
                ) : (
                  <Archive size={13} aria-hidden="true" />
                )}
                {value === 'active' ? 'Active' : 'Archive'}
              </button>
            ))}
          </div>
        </div>

        <div className="project-search-status" aria-live="polite">
          {error ? (
            <p className="project-search-error" role="alert">
              {error}
            </p>
          ) : !query.trim() ? (
            <p>Type a word or phrase to search saved project content.</p>
          ) : loading && !response ? (
            <p>Searching local projects…</p>
          ) : response && results.length === 0 ? (
            <p>
              No matches in {currentScope === 'active' ? 'active projects' : 'the archive'}.
              {response.warnings?.length ? ' Some local content could not be searched.' : ''}
            </p>
          ) : response?.truncated ? (
            <p>Showing the best {results.length} matches. Refine your search for more specific results.</p>
          ) : response ? (
            <p>
              {results.length} {results.length === 1 ? 'match' : 'matches'}
              {response.warnings?.length ? ' · Some local content was skipped.' : ''}
            </p>
          ) : null}
        </div>

        <div id="project-search-results" className="project-search-results" role="listbox">
          {results.map((result, index) => (
            <button
              id={`search-option-${index}`}
              key={result.id}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              className={activeIndex === index ? 'active' : ''}
              data-testid="global-search-result"
              data-kind={result.kind}
              data-item-id={result.target.itemId}
              data-annotation-id={result.target.annotationId}
              disabled={opening}
              onMouseMove={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => void openResult(result)}
            >
              <span className="project-search-result-icon">{kindIcons[result.kind]}</span>
              <span className="project-search-result-copy">
                <span className="project-search-result-heading">
                  <strong>{result.title}</strong>
                  <span>{kindLabels[result.kind]}</span>
                </span>
                {result.excerpt && <span className="project-search-excerpt">{result.excerpt}</span>}
                <span className="project-search-location">
                  {[result.projectName, result.collectionName].filter(Boolean).join(' / ')}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
