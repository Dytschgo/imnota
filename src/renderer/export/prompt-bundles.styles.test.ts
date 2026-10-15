import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { expect, it } from 'vitest';

const stylesheet = postcss.parse(readFileSync(resolve('src/renderer/export/prompt-bundles.css'), 'utf8'));

// Check selector reachability and declarations in the shipped stylesheet.
// Computed colours, masking, and the full cascade are not covered here.
function declarationsFor(row: HTMLElement, reducedMotion: boolean) {
  const declarations: Array<{ property: string; value: string; pseudo: boolean }> = [];
  stylesheet.walkRules((rule) => {
    const parent = rule.parent;
    if (reducedMotion) {
      if (parent?.type !== 'atrule' || parent.params !== '(prefers-reduced-motion: reduce)') return;
    } else if (parent?.type !== 'root') return;
    for (const selector of rule.selectors) {
      const pseudo = selector.endsWith('::before');
      if (!row.matches(pseudo ? selector.slice(0, -'::before'.length) : selector)) continue;
      rule.walkDecls((declaration) => {
        declarations.push({ property: declaration.prop, value: declaration.value, pseudo });
      });
    }
  });
  return declarations;
}

it('does not animate a stale aria-busy card after dialog progress stops', () => {
  const row = document.createElement('article');
  row.className = 'prompt-bundle-card';
  row.setAttribute('aria-busy', 'true');
  const spins = () =>
    declarationsFor(row, false).some(
      ({ property, value }) => property === 'animation' && value.includes('prompt-halo-spin'),
    );
  expect(spins()).toBe(false);
  row.setAttribute('data-active', 'true');
  expect(spins()).toBe(true);
});

it.each([undefined, 'warning', 'error'])(
  'keeps a visible static success ring with reduced motion (tone: %s)',
  (tone) => {
    const row = document.createElement('article');
    row.className = 'prompt-bundle-card';
    row.setAttribute('data-celebrate', 'true');
    if (tone) row.setAttribute('data-tone', tone);
    const ring = declarationsFor(row, true).filter(({ pseudo }) => pseudo);
    expect(ring).not.toContainEqual({ property: 'display', value: 'none', pseudo: true });
    expect(ring).toContainEqual({ property: 'animation', value: 'none', pseudo: true });
    expect(ring.some(({ property, value }) => property === 'background' && value.includes('--success'))).toBe(
      true,
    );
    if (tone) {
      // The green acknowledgement must leave room for the steady outer tone.
      expect(ring.some(({ property, value }) => property === 'inset' && value !== '0')).toBe(true);
      expect(
        declarationsFor(row, true).some(({ property, pseudo }) => !pseudo && property === 'box-shadow'),
      ).toBe(false);
    }
  },
);
