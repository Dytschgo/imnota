import fs from 'node:fs/promises';
import path from 'node:path';
import { readStableRegularFileBytes } from './files.js';

/** The bundled observer must survive replacement of its source application. */
export async function copyMacSecurityObserver(source: string, directory: string): Promise<void> {
  const bytes = await readStableRegularFileBytes(source, 2 * 1024 * 1024);
  if (bytes === null) return; // The helper refuses shared installs; user-owned folders remain usable.
  const destination = path.join(directory, 'imnota-security-observer');
  const handle = await fs.open(destination, 'wx', 0o700);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(0o700);
  } catch (error) {
    // The caller owns a new private directory; never retain a partial executable.
    await fs.rm(destination, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
}
