import { describe, expect, it } from 'vitest';
import { emptyProject, sanitizeFilename, slugify } from '../utils.js';
import { isPathWithin } from '../security.js';

describe('Imnota data helpers', () => {
  it('sanitises filenames without losing predictable extensions', () => {
    expect(sanitizeFilename('  checkout / error?.png  ')).toBe('checkout-error-.png');
    expect(slugify('My Project')).toBe('my-project');
  });
  it('creates a versioned project with safe defaults', () => {
    const project = emptyProject('Review', 'A brief');
    expect(project.schemaVersion).toBe(1);
    expect(project.screenshots).toEqual([]);
    expect(project.exportPreferences.includeAnnotationMetadata).toBe(true);
  });
  it('rejects traversal outside an approved workspace', () => {
    expect(isPathWithin('C:/workspace', 'C:/workspace/project/project.json')).toBe(true);
    expect(isPathWithin('C:/workspace', 'C:/workspace/../secrets')).toBe(false);
  });
});
