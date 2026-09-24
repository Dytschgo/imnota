import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

function bundleMacCaptureHelper(bundle) {
  const source = fileURLToPath(new URL('../native/macos-capture-helper.swift', import.meta.url));
  const resources = path.join(bundle, 'Contents', 'Resources');
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'imnota-capture-helper-'));
  try {
    const sdk = execFileSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
      encoding: 'utf8',
    }).trim();
    const slices = ['arm64', 'x86_64'].map((architecture) => {
      const output = path.join(temporary, architecture);
      execFileSync(
        '/usr/bin/xcrun',
        [
          '--sdk',
          'macosx',
          'swiftc',
          '-O',
          '-target',
          `${architecture}-apple-macos13.0`,
          '-sdk',
          sdk,
          source,
          '-o',
          output,
        ],
        { stdio: 'inherit' },
      );
      return output;
    });
    mkdirSync(resources, { recursive: true });
    const target = path.join(resources, 'imnota-capture-helper');
    execFileSync('/usr/bin/lipo', ['-create', ...slices, '-output', target], { stdio: 'inherit' });
    const architectureList = execFileSync('/usr/bin/lipo', ['-archs', target], { encoding: 'utf8' });
    if (!architectureList.includes('arm64') || !architectureList.includes('x86_64'))
      throw new Error('The bundled macOS capture helper is not universal.');
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', target], {
      stdio: 'inherit',
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

// electron-builder 25 does not recognise '-' as an identity. Sign the assembled
// universal bundle before archives and update checksums are produced.
export default async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // Universal packaging invokes afterPack for both temporary architecture bundles.
  // Their signatures differ and must not be introduced before the merge.
  if (/^mac-universal-(?:x64|arm64)-temp$/.test(path.basename(context.appOutDir))) return;
  const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  bundleMacCaptureHelper(bundle);
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', bundle], {
    stdio: 'inherit',
  });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
}
