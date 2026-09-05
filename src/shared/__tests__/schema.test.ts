import { describe, expect, it } from 'vitest';
import { emptyProject } from '../utils.js';
import { validateProject } from '../schema.js';

describe('project schema', () => {
  it('accepts the versioned project shape', () => {
    expect(validateProject(emptyProject('Valid', ''))).toMatchObject({ schemaVersion: 2, name: 'Valid' });
  });
  it('rejects missing project identity', () => {
    expect(() => validateProject({ schemaVersion: 1 })).toThrow();
  });
});
