import { listPackage, statFile, extractFile } from '@electron/asar';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import adhocSign from './adhoc-sign.mjs';

async function filesBelow(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path.join(directory, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

export async function verifyPackageContents(archive, distDirectory, platform, architecture) {
  const entries = listPackage(archive).map((entry) => entry.replaceAll('\\', '/').replace(/^\//, ''));
  // ASAR 3 uses the host's path separator internally, including when reading an
  // archive produced on another platform. Keep portable names only for reports.
  const info = (entry) => statFile(archive, path.normalize(entry));
  const extract = (entry) => extractFile(archive, path.normalize(entry));
  const files = entries.filter((entry) => typeof info(entry).size === 'number');
  const has = (entry) => files.includes(entry);
  for (const entry of [
    'LICENSE',
    'build/icon.png',
    'scripts/update-macos.sh',
    'dist/index.html',
    'dist/capture-overlay.html',
    'dist/THIRD-PARTY-NOTICES.txt',
    'dist-electron/electron/main.js',
  ])
    assert.ok(has(entry), `Package is missing ${entry}`);
  for (const name of [
    '@excalidraw/excalidraw',
    'dompurify',
    'konva',
    'lucide-react',
    'marked',
    'mermaid',
    'react',
    'react-dom',
    'react-konva',
    'zustand',
  ])
    assert.ok(
      !entries.some((entry) => entry === `node_modules/${name}`),
      `Redundant renderer package shipped: ${name}`,
    );
  assert.ok(!files.some((entry) => /^node_modules\/.*\.map$/.test(entry)), 'Dependency source maps shipped');
  assert.ok(
    !files.some((entry) => /^node_modules\/(?:jszip|pako)\/dist\//.test(entry)),
    'Unused browser ZIP/compression distributions shipped',
  );
  const manifest = JSON.parse(extract('package.json').toString('utf8'));
  for (const name of Object.keys(manifest.dependencies))
    assert.ok(has(`node_modules/${name}/package.json`), `Missing Node runtime dependency ${name}`);
  if (platform === 'win32') {
    const nativeArch = { 1: 'x64', 3: 'arm64' }[architecture];
    assert.ok(nativeArch, `Unsupported Windows packaging architecture ${architecture}`);
    assert.ok(
      files.some(
        (entry) =>
          entry.startsWith(`node_modules/@koromix/koffi-win32-${nativeArch}/`) && entry.endsWith('.node'),
      ),
      'Missing Windows native capture/clipboard module',
    );
  }
  const distFiles = await filesBelow(distDirectory);
  assert.ok(
    distFiles.some((entry) => entry.startsWith('excalidraw/fonts/') && entry.endsWith('.woff2')),
    'Missing local drawing fonts',
  );
  for (const entry of distFiles) {
    const expected = await readFile(path.join(distDirectory, entry));
    assert.ok(has(`dist/${entry}`), `Missing built renderer asset ${entry}`);
    assert.ok(expected.equals(extract(`dist/${entry}`)), `Changed built renderer asset ${entry}`);
  }
  const total = (prefix) =>
    files.filter((entry) => entry.startsWith(prefix)).reduce((sum, entry) => sum + info(entry).size, 0);
  return {
    version: manifest.version,
    platform,
    architecture,
    asarBytes: (await stat(archive)).size,
    asarSha256: createHash('sha256')
      .update(await readFile(archive))
      .digest('hex'),
    nodeModuleBytes: total('node_modules/'),
    rendererBytes: total('dist/'),
    rendererFilesVerified: distFiles.length,
    runtimeDependencies: Object.keys(manifest.dependencies),
  };
}

export default async function afterPack(context) {
  const resources =
    context.electronPlatformName === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : path.join(context.appOutDir, 'resources');
  const report = await verifyPackageContents(
    path.join(resources, 'app.asar'),
    path.join(context.packager.projectDir, 'dist'),
    context.electronPlatformName,
    context.arch,
  );
  await writeFile(
    path.join(path.dirname(context.appOutDir), `package-contents-${path.basename(context.appOutDir)}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log('Verified packaged contents:', JSON.stringify(report));
  // Preserve the existing native-helper/signature order; nothing edits the app afterward.
  await adhocSign(context);
}
