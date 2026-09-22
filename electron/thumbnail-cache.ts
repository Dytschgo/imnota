const MAX_THUMBNAIL_EDGE = 220;
const MAX_CACHE_ENTRIES = 300;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_CONCURRENT_DECODES = 2;

interface ImageSize {
  width: number;
  height: number;
}

export function thumbnailSize(size: ImageSize): ImageSize {
  if (
    !Number.isSafeInteger(size.width) ||
    !Number.isSafeInteger(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  )
    throw new Error('The image preview has invalid dimensions.');
  const scale = Math.min(1, MAX_THUMBNAIL_EDGE / size.width, MAX_THUMBNAIL_EDGE / size.height);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

interface FileVersion {
  mtimeMs: number;
  size: number;
}

interface CachedThumbnail extends FileVersion {
  dataUrl: string;
  bytes: number;
}

/** Cache encoded previews only. Original image buffers never enter the cache. */
export class ThumbnailCache {
  private readonly entries = new Map<string, CachedThumbnail>();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly waiters: Array<() => void> = [];
  private activeDecodes = 0;
  private retainedBytes = 0;

  constructor(
    private readonly decode: (filePath: string) => string | Promise<string>,
    private readonly limits = { entries: MAX_CACHE_ENTRIES, bytes: MAX_CACHE_BYTES },
  ) {}

  async get(filePath: string, version: FileVersion): Promise<string> {
    const cached = this.entries.get(filePath);
    if (cached?.mtimeMs === version.mtimeMs && cached.size === version.size) {
      this.entries.delete(filePath);
      this.entries.set(filePath, cached);
      return cached.dataUrl;
    }
    const key = JSON.stringify([filePath, version.mtimeMs, version.size]);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const work = this.generate(filePath, version);
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }

  private async generate(filePath: string, version: FileVersion): Promise<string> {
    if (this.activeDecodes < MAX_CONCURRENT_DECODES) this.activeDecodes += 1;
    else await new Promise<void>((resolve) => this.waiters.push(resolve));
    try {
      // Yield between native decodes so a large project cannot monopolize the main thread.
      await new Promise<void>((resolve) => setImmediate(resolve));
      const dataUrl = await this.decode(filePath);
      const bytes = Buffer.byteLength(dataUrl, 'utf8');
      this.remove(filePath);
      if (bytes <= this.limits.bytes) {
        while (
          this.entries.size &&
          (this.entries.size >= this.limits.entries || this.retainedBytes + bytes > this.limits.bytes)
        )
          this.remove(this.entries.keys().next().value!);
        this.entries.set(filePath, { mtimeMs: version.mtimeMs, size: version.size, dataUrl, bytes });
        this.retainedBytes += bytes;
      }
      return dataUrl;
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.activeDecodes -= 1;
    }
  }

  private remove(filePath: string): void {
    const cached = this.entries.get(filePath);
    if (cached) this.retainedBytes -= cached.bytes;
    this.entries.delete(filePath);
  }
}
