// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { rendererNotices } from './renderer-licenses';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'imnota-renderer-licenses-'));
  roots.push(root);
  const directory = path.join(root, 'node_modules', 'drawing');
  await mkdir(path.join(directory, 'dist', 'fonts'), { recursive: true });
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ name: 'drawing', version: '1.0.0', license: 'MIT' }),
  );
  // Export-condition metadata is not the package identity.
  await writeFile(path.join(directory, 'dist', 'package.json'), '{"type":"module"}');
  return { root, directory, module: path.join(directory, 'dist', 'index.js') };
}

it('retains package notices and nested font licenses once, without local paths or application code', async () => {
  const drawing = await fixture();
  await writeFile(path.join(drawing.directory, 'LICENSE'), 'Copyright drawing authors\nMIT grant');
  await writeFile(
    path.join(drawing.directory, 'dist', 'LICENSE.txt'),
    'Copyright drawing authors\nMIT grant',
  );
  await writeFile(path.join(drawing.directory, 'NOTICE'), 'Additional attribution');
  await writeFile(
    path.join(drawing.directory, 'dist', 'fonts', 'OFL.txt'),
    'Copyright font authors\nSIL OFL',
  );
  const text = await rendererNotices([
    drawing.module,
    `${drawing.module}?commonjs-proxy`,
    path.join(drawing.root, 'src', 'app.ts'),
    '\0virtual',
  ]);
  expect(text).toContain('drawing@1.0.0');
  expect(text.match(/MIT grant/g)).toHaveLength(1);
  expect(text).toContain('Additional attribution');
  expect(text).toContain('dist/fonts/OFL.txt');
  expect(text).toContain('SIL OFL');
  expect(text).not.toContain(drawing.root);
});

it('fails the build when a bundled package has no retained license text', async () => {
  const drawing = await fixture();
  await expect(rendererNotices([drawing.module])).rejects.toThrow(
    'Missing renderer license text for drawing@1.0.0',
  );
});

it('does not accept an empty license file as retained attribution', async () => {
  const drawing = await fixture();
  await writeFile(path.join(drawing.directory, 'LICENSE'), '  \n');
  await expect(rendererNotices([drawing.module])).rejects.toThrow(
    'Missing renderer license text for drawing@1.0.0',
  );
});

it('retains a complete MIT grant from README without unrelated sections', async () => {
  const drawing = await fixture();
  await writeFile(
    path.join(drawing.directory, 'README.md'),
    '# Drawing\n\n## License\nCopyright drawing authors\nPermission is hereby granted\nTHE SOFTWARE IS PROVIDED\n\n## Usage\nNot a license',
  );
  const text = await rendererNotices([drawing.module]);
  expect(text).toContain('Copyright drawing authors');
  expect(text).not.toContain('Not a license');
});

it('does not treat a README license identifier as the full license text', async () => {
  const drawing = await fixture();
  await writeFile(path.join(drawing.directory, 'README.md'), '## License\nMIT');
  await expect(rendererNotices([drawing.module])).rejects.toThrow(
    'Missing renderer license text for drawing@1.0.0',
  );
});

it('retains notices for prebundled dependencies and exact-version supplements', async () => {
  const drawing = await fixture();
  await writeFile(
    path.join(drawing.directory, 'package.json'),
    JSON.stringify({
      name: 'drawing',
      version: '1.0.0',
      dependencies: { helper: '2.0.0' },
    }),
  );
  const helper = path.join(drawing.root, 'node_modules', 'helper');
  await mkdir(helper);
  await writeFile(path.join(helper, 'package.json'), '{"name":"helper","version":"2.0.0"}');
  await writeFile(path.join(helper, 'LICENSE'), 'Copyright helper authors');
  const supplement = {
    'drawing@1.0.0': [
      { source: 'https://example.invalid/pinned/LICENSE', text: 'Copyright drawing authors' },
    ],
  };
  const text = await rendererNotices([drawing.module], supplement);
  expect(text).toContain('Copyright drawing authors');
  expect(text).toContain('helper@2.0.0');
  expect(text).toContain('Copyright helper authors');
  await expect(
    rendererNotices([drawing.module], { 'drawing@0.9.0': supplement['drawing@1.0.0'] }),
  ).rejects.toThrow('Missing renderer license text for drawing@1.0.0');
});
