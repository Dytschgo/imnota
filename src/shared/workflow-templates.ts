export interface WorkflowTemplateTextBlock {
  markdown: string;
  position: number;
}

export interface WorkflowTemplate {
  id: string;
  version: number;
  name: string;
  description: string;
  collectionName: string;
  textBlocks: readonly WorkflowTemplateTextBlock[];
}

const blocks = (...markdown: string[]): readonly WorkflowTemplateTextBlock[] =>
  markdown.map((value, position) => ({ markdown: value, position }));

/** Bundled templates are deliberately immutable: existing projects never follow later revisions. */
export const WORKFLOW_TEMPLATES = [
  {
    id: 'bug-report',
    version: 1,
    name: 'Bug report',
    description: 'Capture a reproducible problem, its impact, and the expected behaviour.',
    collectionName: 'Bug report',
    textBlocks: blocks(
      '# Summary\n\nDescribe the problem in one or two sentences.',
      '# Steps to reproduce\n\n1. \n2. \n3. ',
      '# Expected behaviour\n\n',
      '# Actual behaviour\n\n',
      '# Environment and impact\n\n',
    ),
  },
  {
    id: 'ui-review',
    version: 1,
    name: 'UI review',
    description: 'Organize observations into priorities and clear next changes.',
    collectionName: 'UI review',
    textBlocks: blocks(
      '# Review goal\n\nWhat task and audience is this review about?',
      '# What works\n\n',
      '# Findings\n\nFor each finding: location, impact, and suggested correction.',
      '# Priorities\n\n1. \n2. \n3. ',
    ),
  },
  {
    id: 'feature-request',
    version: 1,
    name: 'Feature request',
    description: 'Frame a user outcome, constraints, and evidence for a proposed feature.',
    collectionName: 'Feature request',
    textBlocks: blocks(
      '# User outcome\n\n',
      '# Problem and evidence\n\n',
      '# Proposed behaviour\n\n',
      '# Scope and constraints\n\n',
      '# Acceptance criteria\n\n- [ ] ',
    ),
  },
  {
    id: 'design-to-code',
    version: 1,
    name: 'Design-to-code brief',
    description: 'Turn a visual direction into implementation-ready decisions.',
    collectionName: 'Design-to-code brief',
    textBlocks: blocks(
      '# Product task\n\n',
      '# Visual direction\n\n',
      '# Layout and responsive behaviour\n\n',
      '# Components and states\n\n',
      '# Implementation notes\n\n',
    ),
  },
  {
    id: 'architecture-handoff',
    version: 1,
    name: 'Architecture handoff',
    description: 'Explain a system boundary, decisions, risks, and the next implementation steps.',
    collectionName: 'Architecture handoff',
    textBlocks: blocks(
      '# Context and goal\n\n',
      '# System overview\n\n',
      '# Key decisions\n\n',
      '# Interfaces and data flow\n\n',
      '# Risks, trade-offs, and next steps\n\n',
    ),
  },
] as const satisfies readonly WorkflowTemplate[];

export type WorkflowTemplateId = (typeof WORKFLOW_TEMPLATES)[number]['id'];

export function getWorkflowTemplate(id: string | undefined): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id);
}
