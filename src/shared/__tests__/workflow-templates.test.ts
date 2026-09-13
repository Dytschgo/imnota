import { describe, expect, it } from 'vitest';
import { getWorkflowTemplate, WORKFLOW_TEMPLATES } from '../workflow-templates';

describe('workflow templates', () => {
  it('keeps the five bundled templates versioned with deterministic text ordering', () => {
    expect(WORKFLOW_TEMPLATES.map((template) => template.id)).toEqual([
      'bug-report',
      'ui-review',
      'feature-request',
      'design-to-code',
      'architecture-handoff',
    ]);
    for (const template of WORKFLOW_TEMPLATES) {
      expect(template.version).toBe(1);
      expect(template.textBlocks.map((block) => block.position)).toEqual(
        template.textBlocks.map((_, index) => index),
      );
      expect(template.textBlocks.every((block) => block.markdown.trim())).toBe(true);
    }
  });

  it('does not resolve unknown template IDs', () => {
    expect(getWorkflowTemplate('retired-template')).toBeUndefined();
  });
});
