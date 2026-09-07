import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

export async function backupMetadata({ db, config, now = Date.now(), onlyIfDue = false }) {
  await fsp.mkdir(config.backupsDir, { recursive: true, mode: 0o700 });
  if (onlyIfDue) {
    for (const entry of await fsp.readdir(config.backupsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith('metadata-') || !entry.name.endsWith('.sqlite')) continue;
      const stat = await fsp.stat(path.join(config.backupsDir, entry.name));
      if (stat.mtimeMs > now - config.backupIntervalMs) return { skipped: true };
    }
  }
  const stamp = new Date(now).toISOString().replaceAll(':', '-');
  const finalName = `metadata-${stamp}-${randomUUID()}.sqlite`;
  const finalPath = path.join(config.backupsDir, finalName);
  const temporaryPath = path.join(config.backupsDir, `.pending-${randomUUID()}.sqlite`);
  try {
    db.prepare('VACUUM INTO ?').run(temporaryPath);
    await fsp.chmod(temporaryPath, 0o600);
    await fsp.rename(temporaryPath, finalPath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    throw error;
  }

  const cutoff = now - config.backupRetentionMs;
  const pendingCutoff = now - config.cleanupGraceMs;
  let deletedBackups = 0;
  for (const entry of await fsp.readdir(config.backupsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.startsWith('.pending-') && entry.name.endsWith('.sqlite')) {
      const pending = path.join(config.backupsDir, entry.name);
      if ((await fsp.stat(pending)).mtimeMs <= pendingCutoff) {
        await fsp.rm(pending, { force: true });
        deletedBackups += 1;
      }
      continue;
    }
    if (
      !entry.isFile() ||
      !entry.name.startsWith('metadata-') ||
      !entry.name.endsWith('.sqlite') ||
      entry.name === finalName
    ) {
      continue;
    }
    const candidate = path.join(config.backupsDir, entry.name);
    if ((await fsp.stat(candidate)).mtimeMs > cutoff) continue;
    await fsp.rm(candidate, { force: true });
    await fsp.rm(`${candidate}-wal`, { force: true });
    await fsp.rm(`${candidate}-shm`, { force: true });
    deletedBackups += 1;
  }
  return { filename: finalName, deletedBackups };
}
