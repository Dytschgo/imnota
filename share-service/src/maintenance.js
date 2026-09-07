import fsp from 'node:fs/promises';
import path from 'node:path';

export async function directorySize(directory) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile()) total += (await fsp.stat(entryPath)).size;
  }
  return total;
}

export async function reconcileArtifacts({ db, config, now = Date.now(), aggressive = false }) {
  const activeIds = new Set(
    db
      .prepare('SELECT id FROM shares')
      .all()
      .map((row) => row.id),
  );
  const stagingRows = db.prepare('SELECT id, created_at FROM staging_uploads').all();
  const stagingById = new Map(stagingRows.map((row) => [row.id, row]));
  const entries = await fsp.readdir(config.uploadsDir, { withFileTypes: true });
  let deletedDirectories = 0;
  const cutoff = now - config.cleanupGraceMs;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const isStagingName = entry.name.startsWith('.staging-');
    const id = isStagingName ? entry.name.slice('.staging-'.length) : entry.name;
    if (activeIds.has(id) && !isStagingName) continue;
    const staging = stagingById.get(id);
    const stats = await fsp.stat(path.join(config.uploadsDir, entry.name));
    const oldEnough = (staging?.created_at ?? stats.mtimeMs) <= cutoff;
    if (!aggressive && !oldEnough) continue;
    await fsp.rm(path.join(config.uploadsDir, entry.name), { recursive: true, force: true });
    deletedDirectories += 1;
  }
  let deletedReservations = 0;
  for (const staging of stagingRows) {
    if (activeIds.has(staging.id)) continue;
    if (!aggressive && staging.created_at > cutoff) continue;
    await fsp.rm(path.join(config.uploadsDir, `.staging-${staging.id}`), { recursive: true, force: true });
    await fsp.rm(path.join(config.uploadsDir, staging.id), { recursive: true, force: true });
    deletedReservations += db.prepare('DELETE FROM staging_uploads WHERE id = ?').run(staging.id).changes;
  }
  return { deletedDirectories, deletedReservations };
}

export async function cleanupExpired({ db, config, now = Date.now() }) {
  const cutoff = now - config.cleanupGraceMs;
  const records = db
    .prepare(
      `
    SELECT id FROM shares
    WHERE (expires_at <= ? AND expires_at <= ?)
       OR (revoked_at IS NOT NULL AND revoked_at <= ?)
  `,
    )
    .all(now, cutoff, cutoff);
  let deletedShares = 0;
  let failedShares = 0;
  for (const record of records) {
    try {
      await fsp.rm(path.join(config.uploadsDir, record.id), { recursive: true, force: true });
      db.prepare('DELETE FROM shares WHERE id = ?').run(record.id);
      deletedShares += 1;
    } catch (error) {
      failedShares += 1;
      console.error(`Cleanup failed for share ${record.id}:`, error);
    }
  }
  const deletedPairings = db.prepare('DELETE FROM pairings WHERE expires_at <= ?').run(cutoff).changes;
  return { deletedShares, failedShares, deletedPairings };
}
