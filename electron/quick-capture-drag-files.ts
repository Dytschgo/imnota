import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoLinks, isWithin } from './files.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_BYTE_LIMIT = 500_000_000;
const OWNERSHIP_MARKER = 'Imnota quick capture native drag v1\n';

/** Immutable private PNGs may outlive a card so OS drop receivers can finish reading. */
export class QuickCaptureDragFiles {
  private root: Promise<string> | undefined;
  private bytes = 0;

  constructor(private readonly requestedRoot: string) {}

  private async prepareRoot(): Promise<string> {
    if (!this.root)
      this.root = this.initialize().catch((error) => {
        this.root = undefined;
        throw error;
      });
    return this.root;
  }

  private async initialize(): Promise<string> {
    const parent = await fs.realpath(path.dirname(this.requestedRoot));
    const root = path.join(parent, path.basename(this.requestedRoot));
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    await assertNoLinks(root);
    if (!(await fs.lstat(root)).isDirectory())
      throw new Error('Temporary drag storage is unavailable. Use Copy image or Add to collection.');
    const cutoff = Date.now() - RETENTION_MS;
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^capture-[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
      const directory = path.join(root, entry.name);
      const stat = await fs.lstat(directory);
      if (stat.isSymbolicLink() || stat.mtimeMs >= cutoff) continue;
      // Retire only regular, single-link PNG fixtures created by this store. Unknown
      // files or links are preserved; never follow a replacement directory alias.
      const children = await fs.readdir(directory, { withFileTypes: true });
      if (
        children.length !== 2 ||
        !children.every((child) => child.isFile() && ['Capture.png', '.imnota-owned'].includes(child.name))
      )
        continue;
      const marker = path.join(directory, '.imnota-owned');
      const markerStat = await fs.lstat(marker);
      if (
        !markerStat.isFile() ||
        markerStat.isSymbolicLink() ||
        markerStat.nlink !== 1 ||
        markerStat.size !== Buffer.byteLength(OWNERSHIP_MARKER) ||
        (await fs.readFile(marker, 'utf8')) !== OWNERSHIP_MARKER
      )
        continue;
      const file = path.join(directory, 'Capture.png');
      const fileStat = await fs.lstat(file);
      if (fileStat.isSymbolicLink() || fileStat.nlink !== 1 || !isWithin(root, await fs.realpath(directory)))
        continue;
      await fs.unlink(file).catch(() => undefined);
      await fs.unlink(marker).catch(() => undefined);
      await fs.rmdir(directory).catch(() => undefined);
    }
    return root;
  }

  async prepare(png: Buffer): Promise<string> {
    if (this.bytes + png.length > SESSION_BYTE_LIMIT)
      throw new Error('Temporary drag storage is full. Copy image or Add to collection instead.');
    // Reserve before awaiting so preparations for different cards share one bound.
    this.bytes += png.length;
    let directory: string | undefined;
    try {
      const root = await this.prepareRoot();
      await assertNoLinks(root);
      directory = await fs.mkdtemp(path.join(root, 'capture-'));
      const target = path.join(directory, 'Capture.png');
      await fs.chmod(directory, 0o700);
      await fs.writeFile(path.join(directory, '.imnota-owned'), OWNERSHIP_MARKER, {
        flag: 'wx',
        mode: 0o600,
      });
      await fs.writeFile(target, png, { flag: 'wx', mode: 0o600 });
      return target;
    } catch (error) {
      this.bytes -= png.length;
      if (!directory) throw error;
      const target = path.join(directory, 'Capture.png');
      // Own fresh directory only; do not recursively delete replacements or links.
      const stat = await fs.lstat(target).catch(() => undefined);
      if (stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1)
        await fs.unlink(target).catch(() => undefined);
      await fs.unlink(path.join(directory, '.imnota-owned')).catch(() => undefined);
      await fs.rmdir(directory).catch(() => undefined);
      throw error;
    }
  }
}
