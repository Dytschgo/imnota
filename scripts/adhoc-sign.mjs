import { execFileSync } from 'node:child_process';
import path from 'node:path';

// electron-builder 25 does not recognise '-' as an identity. Sign the assembled
// universal bundle before archives and update checksums are produced.
export default async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', bundle], {
    stdio: 'inherit',
  });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
}
