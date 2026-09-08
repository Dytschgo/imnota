import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PROJECT_ICON_OPTIONS, ProjectIcon } from './ProjectIcon';

describe('ProjectIcon', () => {
  it('offers every persisted icon and renders Target as the real target glyph', () => {
    expect(PROJECT_ICON_OPTIONS.map(({ key }) => key)).toEqual([
      'layers',
      'briefcase',
      'code-2',
      'folder',
      'lightbulb',
      'rocket',
      'sparkles',
      'target',
    ]);

    render(<ProjectIcon icon="target" />);

    expect(screen.getByTestId('project-icon-target')).toHaveClass('lucide-target');
  });
});
