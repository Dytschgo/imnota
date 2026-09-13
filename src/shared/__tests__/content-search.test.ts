import { describe, expect, it } from 'vitest';
import { normalizedSearchTerms, searchContent, searchExcerpt } from '../content-search';

const document = {
  projectPath: '/workspace/atlas',
  projectId: 'atlas',
  projectName: 'Atlas',
  status: 'active' as const,
  collectionId: 'review',
  collectionName: 'Review',
  itemId: 'text-1',
  kind: 'text' as const,
  label: 'Text block',
  fields: { markdown: 'A long Markdown note about the navigation regression and retry behaviour.' },
};

describe('content search', () => {
  it('normalizes whitespace and finds every multi-word term case-insensitively', () => {
    expect(normalizedSearchTerms('  NAVIGATION   retry ')).toEqual(['navigation', 'retry']);
    expect(searchContent([document], ' NAVIGATION retry ')).toEqual([
      expect.objectContaining({ itemId: 'text-1', kind: 'text', matchSource: 'markdown' }),
    ]);
  });

  it('returns no result for empty or incomplete queries and bounds excerpts', () => {
    expect(searchContent([document], '   ')).toEqual([]);
    expect(searchContent([document], 'navigation missing')).toEqual([]);
    expect(searchExcerpt('x'.repeat(300), ['x'], 80)).toHaveLength(81);
  });

  it('supports multi-word queries whose terms span metadata fields', () => {
    expect(
      searchContent(
        [
          {
            ...document,
            kind: 'project',
            itemId: undefined,
            fields: { name: 'Design', description: 'System overview' },
          },
        ],
        'design overview',
      ),
    ).toEqual([expect.objectContaining({ matchSource: 'name' })]);
  });
});
